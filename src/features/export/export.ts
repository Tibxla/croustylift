// Coeur de l'export / backup JSON (issue #8).
//
// Tout le travail testable vit ici, en fonctions PURES ou à client INJECTÉ, sans
// jamais importer `lib/supabase` : la couche app (data.ts) câble le vrai client,
// les tests passent un faux. On sépare trois étapes :
//   1. `collectUserData(client)` : un `select *` par table, scopé par RLS côté
//      serveur (pas de filtre owner_id explicite, cf. capture/data.ts), lu en
//      ENTIER page par page (cf. lib/fetch-all : sans pagination, PostgREST
//      tronquait la sauvegarde à 1000 lignes par table, en silence). Les lignes
//      dont un parent manque (exécution, version, exercice...) sont écartées :
//      la sauvegarde rendue est toujours restaurable.
//   2. `buildExport(collected, exportedAt)` : enveloppe versionnée { version,
//      exportedAt, data } (pure).
//   3. `serializeExport(export)` : JSON indenté, lisible et diffable (pur).
//
// FORMAT DE L'EXPORT (v2), en vue d'un import ultérieur :
//   {
//     "version": 2,                       // version du format, pas des données
//     "exportedAt": "2026-06-18T10:00:00.000Z",  // ISO 8601 UTC
//     "data": {                           // une clé par table, lignes BRUTES
//       "exercises":           [ ... ],   // exos PERSO uniquement (owner_id non null)
//       "exercise_notes":      [ ... ],
//       "exercise_overrides":  [ ... ],   // overrides perso des exos de base (user_id)
//       "routines":            [ ... ],
//       "routine_activations": [ ... ],
//       "seances":             [ ... ],
//       "seance_archive_events": [ ... ], // journal daté des archivages (v2, ADR 0017)
//       "seance_versions":     [ ... ],
//       "prescriptions":       [ ... ],
//       "executions":          [ ... ],
//       "performed_sets":      [ ... ],
//       "dated_notes":         [ ... ]
//     }
//   }
//
// Les lignes sont la forme BRUTE des tables Supabase (snake_case, ids inclus) :
// l'import les réinsère telles quelles. Les exos de BASE (catalogue commun,
// owner_id null) sont VOLONTAIREMENT exclus : ils ne sont pas « les données de
// l'utilisateur » et seront présents chez celui qui réimporte.

import { afterId, fetchAllRows } from '../../lib/fetch-all';

/**
 * Version du FORMAT d'export (à incrémenter si la structure change).
 * v2 (2026-09-13) : ajout de `seance_archive_events` (ADR 0017). L'import lit
 * toujours les sauvegardes v1.
 */
export const EXPORT_FORMAT_VERSION = 2 as const;

/**
 * Tables exportées, dans l'ordre des dépendances (parents avant enfants) pour
 * qu'un import puisse les rejouer dans l'ordre sans violer les clés étrangères.
 */
export const EXPORT_TABLES = [
  'exercises',
  'exercise_notes',
  'exercise_overrides',   // overrides perso des exos de base (FK → exercises + auth.users)
  'routines',
  'routine_activations',
  'seances',
  'seance_archive_events', // journal daté des archivages de séance (FK → seances, ADR 0017)
  'seance_versions',
  'prescriptions',
  'executions',
  'performed_sets',
  'dated_notes',
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

/** Une ligne brute de table (clé -> valeur JSON), telle que renvoyée par Supabase. */
export type Row = Record<string, unknown>;

/** Données collectées : une liste de lignes brutes par table. */
export type CollectedData = Record<ExportTable, Row[]>;

/** L'enveloppe d'export sérialisée en JSON. */
export interface UserDataExport {
  version: typeof EXPORT_FORMAT_VERSION;
  exportedAt: string;
  data: CollectedData;
}

// --- Client injectable --------------------------------------------------------
//
// Surface MINIMALE du client Supabase dont l'export a besoin : `from(table)
// .select('*').order('id')[.gt('id', curseur)].limit(n)` — une page au curseur.
// Mocker ça suffit aux tests ; le vrai `supabase` la satisfait.

// Le vrai `limit(...)` de supabase-js renvoie un builder (thenable, pas une
// Promise stricte) : on type donc le retour en `PromiseLike` pour que le vrai
// client satisfasse l'interface sans cast.
/** Une page de l'export : curseur optionnel sur `id`, puis limite (qui exécute). */
export interface ExportPage {
  gt(column: 'id', value: string): ExportPage;
  limit(count: number): PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }>;
}

export interface ExportClient {
  from(table: string): {
    select(columns: string): {
      order(column: string): ExportPage;
    };
  };
}

// --- Collecte -----------------------------------------------------------------

/**
 * Lit toutes les tables scopées à l'utilisateur (RLS) et renvoie leurs lignes.
 * Les tables se lisent en parallèle, chacune PAGE PAR PAGE jusqu'au bout (curseur
 * sur `id`, clé unique de toutes les tables exportées : aucune ligne sautée ni
 * doublée entre deux pages, même si une écriture arrive pendant l'export). Ce
 * n'est PAS un instantané transactionnel : chaque table est lue à part ; les
 * lignes dont le parent manque à la lecture sont écartées
 * (`withoutRowsNewerThanTheirParent`). Une erreur Supabase sur n'importe quelle
 * table fait échouer la collecte (pas d'export partiel).
 *
 * Les exos de BASE (owner_id null) sont filtrés : seuls les exos perso sortent.
 * Ils sont lus quand même, et leurs ids servent à vérifier les liens vers
 * `exercises` AVANT ce filtre : une série sur un exo de base a bien son parent,
 * une série sur un exo perso disparu pendant la lecture ne l'a plus.
 */
export async function collectUserData(client: ExportClient): Promise<CollectedData> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const rows: Row[] = await fetchAllRows<Row & { id: string }>(async (after, limit) => {
        const { data, error } = await afterId(
          client.from(table).select('*').order('id'),
          after,
        ).limit(limit);
        // Même message qu'avant la pagination : l'erreur Supabase, en `Error`.
        return { data, error: error ? new Error(error.message) : null };
      });
      return [table, rows] as const;
    }),
  );

  const read = Object.fromEntries(entries) as CollectedData;
  // Tout le catalogue lu, exos de base compris : les parents des liens `exercise_id`.
  const catalogueIds = new Set(read.exercises.map((row) => row.id));
  return withoutRowsNewerThanTheirParent(
    { ...read, exercises: read.exercises.filter(isPersonalExercise) },
    catalogueIds,
  );
}

/**
 * Liens enfant → parent entre tables EXPORTÉES. Colonne nullable
 * (`executions.seance_version_id`) : une valeur nulle n'a pas de parent à
 * vérifier. Les liens vers `exercises` sont à part (`EXERCISE_LINKS`) : leur
 * parent peut être un exo de base, lu mais pas exporté.
 */
const PARENT_LINKS: readonly { child: ExportTable; column: string; parent: ExportTable }[] = [
  { child: 'routine_activations', column: 'routine_id', parent: 'routines' },
  { child: 'seances', column: 'routine_id', parent: 'routines' },
  { child: 'seance_archive_events', column: 'seance_id', parent: 'seances' },
  { child: 'seance_versions', column: 'seance_id', parent: 'seances' },
  { child: 'prescriptions', column: 'seance_version_id', parent: 'seance_versions' },
  { child: 'executions', column: 'seance_version_id', parent: 'seance_versions' },
  { child: 'performed_sets', column: 'execution_id', parent: 'executions' },
  { child: 'dated_notes', column: 'execution_id', parent: 'executions' },
];

/** Tables qui pointent un exercice par `exercise_id` (exo de base ou perso). */
const EXERCISE_LINKS: readonly ExportTable[] = [
  'exercise_notes',
  'exercise_overrides',
  'prescriptions',
  'performed_sets',
  'dated_notes',
];

/**
 * Écarte les lignes dont le parent manque à la sauvegarde (logique PURE, testée).
 * Chaque table est lue à part : une séance synchronisée PENDANT l'export peut
 * faire entrer ses séries alors que son exécution, lue avant, n'y est pas ; un
 * exo perso supprimé pendant la lecture laisse derrière lui une note lue juste
 * avant. Une telle sauvegarde échouerait à la restauration (clé étrangère).
 * Écarter ces lignes rend une sauvegarde cohérente. Répété jusqu'à stabilité,
 * l'écart d'un parent pouvant en orpheliner d'autres.
 *
 * `catalogueIds` : les ids de TOUS les exercices lus, exos de base compris (ils
 * ne figurent pas dans `data.exercises`, qui ne garde que les exos perso).
 */
export function withoutRowsNewerThanTheirParent(
  data: CollectedData,
  catalogueIds: ReadonlySet<unknown>,
): CollectedData {
  const out = { ...data };
  for (const table of EXERCISE_LINKS) {
    out[table] = out[table].filter(
      (row) => row.exercise_id == null || catalogueIds.has(row.exercise_id),
    );
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const { child, column, parent } of PARENT_LINKS) {
      const parents = new Set(out[parent].map((row) => row.id));
      const kept = out[child].filter((row) => row[column] == null || parents.has(row[column]));
      if (kept.length !== out[child].length) {
        out[child] = kept;
        changed = true;
      }
    }
  }
  return out;
}

/** Un exo perso a un owner_id ; les exos de base (catalogue commun) ont owner_id null. */
function isPersonalExercise(row: Row): boolean {
  return row.owner_id != null;
}

// --- Sérialisation (pure) -----------------------------------------------------

/** Enveloppe les données collectées dans le format d'export versionné. */
export function buildExport(data: CollectedData, exportedAt: string): UserDataExport {
  return { version: EXPORT_FORMAT_VERSION, exportedAt, data };
}

/** Sérialise l'export en JSON indenté (2 espaces) : lisible et diffable. */
export function serializeExport(value: UserDataExport): string {
  return JSON.stringify(value, null, 2);
}
