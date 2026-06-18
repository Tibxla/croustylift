// Coeur de l'export / backup JSON (issue #8).
//
// Tout le travail testable vit ici, en fonctions PURES ou à client INJECTÉ, sans
// jamais importer `lib/supabase` : la couche app (data.ts) câble le vrai client,
// les tests passent un faux. On sépare trois étapes :
//   1. `collectUserData(client)` : un `select *` par table, scopé par RLS côté
//      serveur (pas de filtre owner_id explicite, cf. capture/data.ts).
//   2. `buildExport(collected, exportedAt)` : enveloppe versionnée { version,
//      exportedAt, data } (pure).
//   3. `serializeExport(export)` : JSON indenté, lisible et diffable (pur).
//
// FORMAT DE L'EXPORT (v1), en vue d'un import ultérieur :
//   {
//     "version": 1,                       // version du format, pas des données
//     "exportedAt": "2026-06-18T10:00:00.000Z",  // ISO 8601 UTC
//     "data": {                           // une clé par table, lignes BRUTES
//       "exercises":           [ ... ],   // exos PERSO uniquement (owner_id non null)
//       "exercise_notes":      [ ... ],
//       "routines":            [ ... ],
//       "routine_activations": [ ... ],
//       "seances":             [ ... ],
//       "seance_versions":     [ ... ],
//       "prescriptions":       [ ... ],
//       "executions":          [ ... ],
//       "performed_sets":      [ ... ],
//       "dated_notes":         [ ... ]
//     }
//   }
//
// Les lignes sont la forme BRUTE des tables Supabase (snake_case, ids inclus) :
// un import futur réinsère telles quelles. Les exos de BASE (catalogue commun,
// owner_id null) sont VOLONTAIREMENT exclus : ils ne sont pas « les données de
// l'utilisateur » et seront présents chez celui qui réimporte.

/** Version du FORMAT d'export (à incrémenter si la structure change). */
export const EXPORT_FORMAT_VERSION = 1 as const;

/**
 * Tables exportées, dans l'ordre des dépendances (parents avant enfants) pour
 * qu'un import puisse les rejouer dans l'ordre sans violer les clés étrangères.
 */
export const EXPORT_TABLES = [
  'exercises',
  'exercise_notes',
  'routines',
  'routine_activations',
  'seances',
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
// .select('*')`. Mocker ça suffit aux tests ; le vrai `supabase` la satisfait.

// Le vrai `select(...)` de supabase-js renvoie un PostgrestFilterBuilder
// (thenable, pas une Promise stricte) : on type donc le retour en `PromiseLike`
// pour que le vrai client satisfasse l'interface sans cast.
export interface ExportClient {
  from(table: string): {
    select(columns: string): PromiseLike<{
      data: unknown[] | null;
      error: { message: string } | null;
    }>;
  };
}

// --- Collecte -----------------------------------------------------------------

/**
 * Lit toutes les tables scopées à l'utilisateur (RLS) et renvoie leurs lignes.
 * Les requêtes tournent en parallèle (une par table). Une erreur Supabase sur
 * n'importe quelle table fait échouer la collecte (pas d'export partiel).
 *
 * Les exos de BASE (owner_id null) sont filtrés : seuls les exos perso sortent.
 */
export async function collectUserData(client: ExportClient): Promise<CollectedData> {
  const entries = await Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { data, error } = await client.from(table).select('*');
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      return [table, table === 'exercises' ? rows.filter(isPersonalExercise) : rows] as const;
    }),
  );

  return Object.fromEntries(entries) as CollectedData;
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
