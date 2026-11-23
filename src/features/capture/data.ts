// Couche d'accès Supabase de la capture.
//
// Produit EXACTEMENT la forme consommée par les composants (`Session` /
// `SessionExercise`, cf. fixtures.ts) pour que l'UI reste inchangée : seule la
// SOURCE des données change (Supabase au lieu de la fixture mockée).
//
// Conventions DB (cf. ADR 0003 + migration 0001) :
//   - owner_id se remplit tout seul (default auth.uid()) — on ne l'écrit JAMAIS.
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre owner_id côté client.
//
// HORS-LIGNE (ADR 0012) : le chemin de LECTURE de la capture passe par le cache
// « cache d'abord » de lib/read-cache — la salle n'a pas de réseau fiable, la
// séance doit se charger sur la copie locale. Les lectures composites sont
// cachées APRÈS fusion des overrides (valeur sérialisable, pas de Map). Les
// lectures datées du jour (exécution en cours, repère « tu notais ») sont
// TOLÉRANTES : leur absence est un état valide, un échec réseau ne bloque pas
// l'écran — le réalisé local (state.ts + outbox) reste la vérité de l'appareil.
// Conséquence assumée : une copie servie peut être en retard d'une édition
// faite ailleurs ; elle se revalide en arrière-plan à chaque lecture en ligne
// (même classe d'imprécision que le last-write-wins, ADR 0003). Les surfaces
// d'ÉDITION (authoring, journal), elles, lisent toujours le réseau en direct.
import {
  cachedKeys,
  cachedRead,
  dropRead,
  networkFirstRead,
  onReadWritten,
  peekRead,
  refreshRead,
} from '../../lib/read-cache';
import {
  CAPTURE_SOURCE_KEY,
  EXERCISE_NOTE_PREFIX,
  EXERCISES_KEY,
  SEANCE_TEMPLATE_PREFIX,
  SEANCE_VERSION_IDS_PREFIX,
  SEANCE_VERSION_PREFIX,
} from './plan-copies';
import { supabase } from '../../lib/supabase';
import { afterId, fetchAllRows } from '../../lib/fetch-all';
import type { Database } from '../../lib/database.types';
import type { ExerciseExecution, PerformedSet, Side } from '../../domain/types';
import { lastReference } from '../../domain/reference';
import {
  personalRecord,
  personalRecordBySide,
  type PersonalRecord,
  type PersonalRecordBySide,
} from '../../domain/pr';
import { getCurrentRoutineId, getCurrentVersionId, listRoutines, listSeances } from '../authoring/data';
import { loadExerciseNote } from '../notes/data';
import type { DatedNoteDraft, HydratedProgress } from './state';
import { readOwnQueue, type OutboxOp } from './outbox';
import type { PreviousDatedNote, Session, SessionExercise } from './fixtures';
import { groupSetsForEdit, type EditableExercise, type EditableSetRow } from './past-session-edit';
import {
  loadExerciseOverrides,
  loadMergedExerciseRow,
  mergeRowWithOverride,
} from '../exercises/overrides';
import { mergeExerciseOverride } from '../../domain/exercise-override';

export type { Session, SessionExercise } from './fixtures';

export type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

/**
 * Mappe la colonne `side` (DB : `string | null`) vers le type domaine
 * (`Side | undefined`) : null = bilatéral, traduit en `undefined` pour que le
 * domaine (PerformedSet.side, weakSideE1rm) ne voie jamais qu'un côté valide.
 * Toute autre valeur (jamais émise, le check DB la refuse) tombe sur `undefined`.
 */
function toSide(raw: string | null | undefined): Side | undefined {
  return raw === 'left' || raw === 'right' ? raw : undefined;
}

/** Rang de tri d'un côté : gauche (0) avant droite (1) à `order` égal. */
function sideRank(side: Side | undefined): number {
  return side === 'right' ? 1 : 0;
}

/** Une séance chargée pour la capture : la séance + l'id de sa version courante. */
export interface LoadedSeance {
  seance: { id: string; name: string };
  /** Version courante (= version max) de la séance. */
  seanceVersionId: string;
}

// --- Choix de la séance dans la routine courante (issue #1) -------------------
//
// En arrivant en Capture, l'user choisit QUELLE séance de sa routine courante il
// attaque, au lieu de toujours charger la 1ʳᵉ séance de la 1ʳᵉ routine. Si aucune
// routine n'est explicitement courante, on REPLIE sur la 1ʳᵉ routine existante
// (un user peut avoir créé une routine via l'onglet Séances sans cliquer
// « Définir courante », ou avoir une routine pré-existante) : sans ce repli, la
// Capture restait coincée sur « rien à logger » alors qu'une séance existe.
// La Capture n'affiche un ÉTAT VIDE que si l'user n'a AUCUNE routine, ou si la
// routine retenue n'a pas de séance : depuis l'onboarding (issue #3) on ne crée
// plus rien en silence. Un user totalement neuf ne passe d'ailleurs pas par ici,
// App l'envoie d'abord sur l'écran de premier lancement.

/** Une séance proposée au choix en Capture : juste de quoi l'afficher et la résoudre. */
export interface SeanceChoice {
  id: string;
  name: string;
}

/**
 * Source de la Capture, dérivée de la routine courante :
 *   - `demo`   : rien à capturer (aucune routine courante, ou routine courante
 *                sans séance) -> la Capture affiche un état vide, sans rien créer ;
 *   - `choose` : la routine courante a des séances -> l'user en choisit une.
 */
export type CaptureSource =
  | { kind: 'demo' }
  | { kind: 'choose'; seances: SeanceChoice[] };

/**
 * Tranche la source de la Capture (logique PURE, testée) à partir de l'id de
 * routine courante et des séances de cette routine, déjà lus côté Supabase.
 *
 * `demo` (rien à capturer) si : aucune routine courante (`null`) OU routine
 * courante sans séance. Sinon : choix parmi les séances de la routine courante.
 */
export function decideCaptureSource(
  currentRoutineId: string | null,
  seances: SeanceChoice[],
): CaptureSource {
  if (currentRoutineId === null || seances.length === 0) {
    return { kind: 'demo' };
  }
  return { kind: 'choose', seances };
}

/**
 * Routine sur laquelle ouvrir la Capture : la routine courante si elle est
 * définie, sinon (REPLI) la 1ʳᵉ routine existante. Le repli évite l'impasse
 * « rien à logger » pour un user qui a une routine sans avoir cliqué « Définir
 * courante ». `null` seulement si l'user n'a AUCUNE routine. Logique PURE, testée.
 */
export function resolveCaptureRoutineId(
  currentRoutineId: string | null,
  routineIds: string[],
): string | null {
  if (currentRoutineId !== null) return currentRoutineId;
  return routineIds[0] ?? null;
}

/**
 * Lit la routine courante (getCurrentRoutineId), avec repli sur la 1ʳᵉ routine
 * (resolveCaptureRoutineId), puis ses séances, et tranche la source de la Capture
 * via `decideCaptureSource`. Point d'entrée de l'écran : il dit s'il faut proposer
 * un choix ou afficher l'état vide.
 */
export async function loadCaptureSource(): Promise<CaptureSource> {
  // Cache d'abord (ADR 0012) : l'arrivée en salle ne dépend pas du réseau.
  return cachedRead(CAPTURE_SOURCE_KEY, async () => {
    const [currentRoutineId, routines] = await Promise.all([
      getCurrentRoutineId(),
      listRoutines(),
    ]);
    // Une routine ou une séance archivée ne se choisit plus en salle (ADR 0017).
    const routineId = resolveCaptureRoutineId(
      currentRoutineId,
      routines.filter((r) => r.archived_at === null).map((r) => r.id),
    );
    if (routineId === null) return decideCaptureSource(null, []);

    const seances = await listSeances(routineId);
    const choices: SeanceChoice[] = seances
      .filter((s) => s.archived_at === null)
      .map((s) => ({ id: s.id, name: s.name }));
    return decideCaptureSource(routineId, choices);
  });
}

/**
 * Résout une séance choisie vers sa version courante (= version max), prête à
 * être chargée par `loadSeanceForCapture`. Réutilise `getCurrentVersionId` de
 * l'authoring (pas de duplication de la résolution « version courante »).
 * Lève si la séance n'a aucune version (template incomplet, ne devrait pas
 * arriver : createSeance crée toujours une v1).
 */
export async function loadChosenSeance(seance: SeanceChoice): Promise<LoadedSeance> {
  const versionId = await cachedRead(`${SEANCE_VERSION_PREFIX}${seance.id}`, () =>
    getCurrentVersionId(seance.id),
  );
  if (!versionId) {
    throw new Error(`Séance ${seance.id} sans version : template incomplet.`);
  }
  return { seance: { id: seance.id, name: seance.name }, seanceVersionId: versionId };
}

/**
 * TOUS les ids de version d'une séance (append-only, ADR 0001). C'est le périmètre
 * de la Référence scopée séance (cf. GLOSSARY.md « Référence ») : les versions sont
 * des retouches du même template, l'historique de l'exo les traverse toutes.
 */
export async function listSeanceVersionIds(seanceId: string): Promise<string[]> {
  return cachedRead(`${SEANCE_VERSION_IDS_PREFIX}${seanceId}`, async () => {
    // Append-only (une version par édition) : lu en entier, page par page (cf.
    // lib/fetch-all) — une version manquante sortirait ses exécutions du
    // périmètre de la Référence.
    const rows = await fetchAllRows<{ id: string }>((after, limit) =>
      afterId(
        supabase
          .from('seance_versions')
          .select('id')
          .eq('seance_id', seanceId)
          .order('id')
          .limit(limit),
        after,
      ),
    );
    return rows.map((row) => row.id);
  });
}

// --- Lecture du catalogue -----------------------------------------------------

/**
 * Catalogue visible par l'user : exos de base (owner_id null) + perso (RLS),
 * DÉJÀ FUSIONNÉS avec les overrides per-user (issue #50). C'est le point d'entrée
 * UNIQUE du catalogue : tout consommateur (onglet Exercices, picker d'ajout en
 * Capture, donc indirectement le compteur de séries #37 via les muscles/unilatéral)
 * voit ainsi les champs personnalisés sans réimplémenter la fusion. Un exo perso
 * n'a jamais d'override (l'UI n'en crée que pour les exos de base) : sa row reste
 * inchangée.
 */
export async function listExercises(): Promise<ExerciseRow[]> {
  const [{ data, error }, overrides] = await Promise.all([
    supabase.from('exercises').select('*'),
    loadExerciseOverrides(),
  ]);
  if (error) throw error;
  return (data ?? []).map((row) => mergeRowWithOverride(row, overrides.get(row.id) ?? null));
}

/**
 * Variante « cache d'abord » du catalogue, pour la CAPTURE seulement (picker
 * d'ajout/swap en salle, ADR 0012). Les éditeurs (ExercisesScreen, SeanceEditor)
 * gardent `listExercises` en direct : ils relisent juste après une écriture
 * (créer/renommer un exo) et une copie servie d'abord leur montrerait l'état
 * d'AVANT leur propre modification.
 */
export async function listExercisesForCapture(): Promise<ExerciseRow[]> {
  return cachedRead(EXERCISES_KEY, listExercises);
}

/**
 * Note d'instructions d'un exo, « cache d'abord » pour la CAPTURE (ADR 0012).
 * Même partage des rôles que le catalogue : les éditeurs lisent en direct.
 *
 * Une note éditée EN CAPTURE passe par l'outbox : tant que son écriture attend,
 * c'est elle qui fait foi, par-dessus la copie (`applyPendingExerciseNote`).
 * Sans cela la note corrigée revenait à son ancien texte au remontage, et la
 * retaper depuis l'ancien texte écrasait la correction. Une fois acquittée, sa
 * valeur est posée dans la copie (cf. sync.ts).
 */
export async function loadExerciseNoteCached(exerciseId: string): Promise<string> {
  const pending = pendingExerciseNote(readOwnQueue(), exerciseId);
  try {
    const body = await cachedRead(`${EXERCISE_NOTE_PREFIX}${exerciseId}`, () =>
      loadExerciseNote(exerciseId),
    );
    // La file est relue APRÈS la lecture : une édition a pu arriver entre-temps.
    return applyPendingExerciseNote(body, readOwnQueue(), exerciseId);
  } catch (err) {
    // Ni copie ni réseau, mais une édition en attente : son texte est connu.
    if (pending !== null) return pending;
    throw err;
  }
}

/**
 * Le corps que la file d'écritures donne à la note d'instructions de l'exo : sa
 * DERNIÈRE op (`upsertExerciseNote` pose le corps, `deleteExerciseNote` le
 * vide). `null` si aucune op ne la vise. Pur.
 */
export function pendingExerciseNote(ops: readonly OutboxOp[], exerciseId: string): string | null {
  let body: string | null = null;
  for (const op of ops) {
    if (op.id !== exerciseId) continue;
    if (op.type === 'upsertExerciseNote') body = op.body;
    else if (op.type === 'deleteExerciseNote') body = '';
  }
  return body;
}

/** La note lue, sauf si une écriture encore en file la remplace. Pur. */
export function applyPendingExerciseNote(
  body: string,
  ops: readonly OutboxOp[],
  exerciseId: string,
): string {
  return pendingExerciseNote(ops, exerciseId) ?? body;
}

// --- Ajout / swap d'un exo à la volée (issue #36) -----------------------------
//
// Un exo ajouté hors template n'a PAS de prescription versionnée (il n'est pas
// au programme du jour). On lui donne une cible par défaut, sobre et atteignable :
// `min: 1` série suffit à le passer « fait ». C'est un repère neutre, pas un plan.

/** Cible par défaut d'un exo ajouté à la volée (pas de prescription versionnée). */
export const DEFAULT_ADDED_PRESCRIPTION = {
  sets: { min: 1, max: 3 },
  reps: { min: 8, max: 12 },
  rir: { min: 1, max: 2 },
} as const;

/**
 * Mappe un exo du catalogue (`ExerciseRow`) vers la forme `SessionExercise`
 * consommée par la Capture, avec la cible par défaut des ajouts. `reference`,
 * `personalRecord` et les notes sont laissés vides ici : `loadCatalogExercise`
 * les remplit depuis l'historique. Pur (testable sans Supabase).
 */
export function catalogExerciseToSession(
  row: Pick<ExerciseRow, 'id' | 'name'> & {
    unilateral?: boolean;
    primary_muscles?: string[];
  },
): SessionExercise {
  return {
    exerciseId: row.id,
    name: row.name,
    unilateral: row.unilateral ?? false,
    primaryMuscles: row.primary_muscles ?? [],
    prescription: {
      sets: { ...DEFAULT_ADDED_PRESCRIPTION.sets },
      reps: { ...DEFAULT_ADDED_PRESCRIPTION.reps },
      rir: { ...DEFAULT_ADDED_PRESCRIPTION.rir },
    },
    reference: null,
    personalRecord: null,
    perExerciseNote: '',
  };
}

/**
 * Le contexte de séance dont les dérivées d'historique ont besoin en Capture :
 * le périmètre de la Référence scopée (toutes les versions de la séance) et les
 * notes datées de la dernière exécution passée (repère « tu notais »), résolus
 * UNE fois au chargement de la séance et partagés par tous les exos — y compris
 * ceux ajoutés à la volée.
 */
export interface SeanceHistoryContext {
  seanceVersionIds: string[];
  /** Notes datées de la DERNIÈRE exécution passée de la séance, par exerciseId. */
  previousDatedNotes: Record<string, PreviousDatedNote>;
  /**
   * L'exécution du jour ADOPTÉE, écartée du repère « dernière fois » (ADR 0014) :
   * un exo ajouté en pleine séance ne doit pas prendre pour Référence les séries
   * qu'on vient d'y saisir. `null` avant qu'une exécution existe.
   */
  currentExecutionId: string | null;
}

/**
 * Charge un exo du catalogue prêt à entrer dans la séance courante : sa forme
 * `SessionExercise` (cible par défaut) enrichie de sa référence (dernière fois
 * dans CETTE séance), de son repli de préremplissage, de ses records all-time,
 * de sa note d'instructions et du repère « tu notais » — le tout dérivé de
 * l'historique via le contexte de séance.
 *
 * Fusion override per-user (issue #50) : si l'appelant ne fournit PAS les champs
 * partagés (cas du picker d'ajout à la volée, qui ne passe que id + name), on
 * relit la row DÉJÀ FUSIONNÉE par son id pour que l'exo ajouté porte ses champs
 * personnalisés (unilatéral #46, muscles #37). Si les champs sont déjà fournis
 * (row issue de `listExercises`, donc déjà fusionnée), on les garde tels quels.
 */
export async function loadCatalogExercise(
  row: Pick<ExerciseRow, 'id' | 'name'> & {
    unilateral?: boolean;
    primary_muscles?: string[];
  },
  ctx: SeanceHistoryContext,
): Promise<SessionExercise> {
  const needsMerge = row.unilateral === undefined || row.primary_muscles === undefined;
  const merged = needsMerge ? await loadMergedExerciseRow(row.id) : null;
  const base = catalogExerciseToSession(merged ?? row);
  const [history, perExerciseNote] = await Promise.all([
    loadExerciseHistory(
      row.id,
      ctx.seanceVersionIds,
      base.unilateral ?? false,
      ctx.currentExecutionId,
    ),
    loadExerciseNoteCached(row.id),
  ]);
  return {
    ...base,
    ...history,
    perExerciseNote,
    previousDatedNote: ctx.previousDatedNotes[row.id] ?? null,
  };
}

// --- Chargement de la séance pour la capture ----------------------------------

type PrescriptionWithExercise = {
  exercise_id: string;
  position: number;
  sets_min: number;
  sets_max: number;
  reps_min: number;
  reps_max: number;
  rir_min: number;
  rir_max: number;
  exercises: { name: string; unilateral: boolean; primary_muscles: string[] } | null;
};

/**
 * Charge les prescriptions d'une version de séance, jointes au nom de l'exo,
 * triées par position, dans la forme `SessionExercise` attendue par l'UI.
 * La `reference` est laissée à `null` et `perExerciseNote` à '' ici : `loadReference`
 * et `loadExerciseNote` les remplissent par exo (cf. loadSeance dans CaptureScreen).
 */
export async function loadSeanceForCapture(
  seance: { id: string; name: string },
  seanceVersionId: string,
): Promise<Session> {
  // Cache d'abord (ADR 0012), APRÈS fusion des overrides : la copie locale porte
  // déjà les champs personnalisés, prête à servir hors-ligne telle quelle.
  return cachedRead(`${SEANCE_TEMPLATE_PREFIX}${seanceVersionId}:${seance.id}`, async () => {
    const [{ data, error }, overrides] = await Promise.all([
      supabase
        .from('prescriptions')
        .select(
          'exercise_id, position, sets_min, sets_max, reps_min, reps_max, rir_min, rir_max, exercises ( name, unilateral, primary_muscles )',
        )
        .eq('seance_version_id', seanceVersionId)
        .order('position', { ascending: true }),
      // Fusion override per-user (issue #50) : la Capture du jour doit logger avec
      // les champs personnalisés (unilatéral pour le côté #46, muscles pour #37).
      loadExerciseOverrides(),
    ]);
    if (error) throw error;

    const rows = (data ?? []) as unknown as PrescriptionWithExercise[];

    const exercises: SessionExercise[] = rows.map((row) => {
      // L'exo joint peut manquer (FK orpheline) : on garde le repli « inconnu ».
      const merged = mergeExerciseOverride(
        {
          name: row.exercises?.name ?? '(exercice inconnu)',
          unilateral: row.exercises?.unilateral ?? false,
          primaryMuscles: row.exercises?.primary_muscles ?? [],
        },
        overrides.get(row.exercise_id) ?? null,
      );
      return {
        exerciseId: row.exercise_id,
        name: merged.name,
        unilateral: merged.unilateral,
        primaryMuscles: merged.primaryMuscles,
        prescription: {
          sets: { min: row.sets_min, max: row.sets_max },
          reps: { min: row.reps_min, max: row.reps_max },
          rir: { min: row.rir_min, max: row.rir_max },
        },
        reference: null,
        perExerciseNote: '',
      };
    });

    return { id: seance.id, name: seance.name, exercises };
  });
}

// --- Historique d'un exo (base des dérivées : référence ET records) -----------

/**
 * Une ligne plate `performed_sets` jointe à sa `executions` (performed_on +
 * created_at), telle que la renvoie la requête de `loadExerciseExecutions`. La
 * jointure peut manquer (`executions: null`) : une ligne sans exécution est une
 * orpheline, ignorée à la reconstruction. Type exporté pour que la partie PURE
 * (`reconstructExerciseExecutions`) soit testable sans Supabase.
 */
export type PerformedSetWithExecutionRow = {
  /**
   * Id de la LIGNE (UUID client, ADR 0003) : identité stable pour fusionner les
   * écritures encore en attente (`applyPendingSets`). Absent des copies locales
   * écrites avant ce champ — d'où la clé de repli `execution:order:side`.
   */
  id?: string;
  weight_kg: number;
  reps: number;
  rir: number;
  set_order: number;
  side: string | null;
  execution_id: string;
  executions: { performed_on: string; created_at: string; seance_version_id: string } | null;
};

/**
 * Reconstruit l'historique domaine (`ExerciseExecution[]`) à partir des lignes
 * plates `performed_sets`+`executions`. Partie PURE de `loadExerciseExecutions`
 * (aucun accès Supabase), extraite pour être testée directement.
 *
 * Regroupe les séries par exécution (une ExerciseExecution = un jour). Le `side`
 * est porté jusqu'au domaine : la courbe primaire d'un exo unilatéral suit le
 * côté faible (cf. weakSideE1rm), donc l'analyse a besoin des deux côtés. Le
 * `created_at` est porté aussi : il départage deux exécutions à `performed_on`
 * égal (cf. `lastReference`). L'`execution_id` (clé de regroupement) est posé
 * comme `id` : tie-break FINAL stable des dérivées quand `performed_on` ET
 * `created_at` sont égaux (cf. `isMoreRecent`, les courbes). Une ligne dont la
 * jointure `executions` manque (orpheline) est ignorée. L'ordre des exécutions
 * renvoyé suit l'ordre de PREMIÈRE apparition des lignes (déjà trié par la
 * requête : performed_on puis created_at).
 */
export function reconstructExerciseExecutions(
  rows: PerformedSetWithExecutionRow[],
  exerciseId: string,
): ExerciseExecution[] {
  const byExecution = new Map<string, ExerciseExecution>();
  for (const row of rows) {
    const date = row.executions?.performed_on;
    if (!date) continue; // garde-fou : exécution orpheline.
    let exec = byExecution.get(row.execution_id);
    if (!exec) {
      exec = {
        date,
        exerciseId,
        sets: [],
        createdAt: row.executions?.created_at,
        id: row.execution_id,
      };
      byExecution.set(row.execution_id, exec);
    }
    exec.sets.push({
      weightKg: Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      order: row.set_order,
      side: toSide(row.side),
    });
  }

  return [...byExecution.values()];
}

/**
 * Fusionne les écritures ENCORE EN ATTENTE (outbox) par-dessus les lignes lues,
 * pour un exo donné (ADR 0014). Sans elle, une séance capturée hors-ligne
 * n'existe dans AUCUNE source de la Référence — ni en base (pas remontée), ni
 * dans la copie locale (que le réseau alimente) — et le repère « dernière fois »
 * affiche l'avant-dernière séance, de façon garantie.
 *
 * Applique la file DANS SON ORDRE (FIFO, cf. outbox) : `insertSet` pose ou
 * remplace une ligne, `deleteSet` la retire, `deleteExecution` retire toutes
 * celles de son exécution. Le contexte d'exécution (date, version de séance)
 * vient des lignes déjà lues, complété par les `upsertExecution` encore en file
 * — c'est ce qui rend datable une séance jamais remontée.
 *
 * LIMITE ASSUMÉE : une série dont l'`upsertExecution` est DÉJÀ partie alors
 * qu'elle-même attend encore (coupure entre deux ops d'un même flush) n'a plus
 * de contexte lisible ici et reste ignorée jusqu'au prochain chargement en
 * ligne. Idem pour un `deleteSet` visant une ligne d'une copie locale écrite
 * avant le champ `id`. Deux cas transitoires, résorbés par la revalidation.
 */
export function applyPendingSets(
  rows: PerformedSetWithExecutionRow[],
  ops: readonly OutboxOp[],
  exerciseId: string,
): PerformedSetWithExecutionRow[] {
  const context = new Map<string, NonNullable<PerformedSetWithExecutionRow['executions']>>();
  for (const row of rows) {
    if (row.executions) context.set(row.execution_id, row.executions);
  }
  for (const op of ops) {
    if (op.type !== 'upsertExecution') continue;
    context.set(op.id, {
      performed_on: op.performedOn,
      // La ligne n'existe pas encore côté serveur, donc pas de `created_at` :
      // `startedAt` en tient lieu pour le départage à date égale (cf.
      // `lastReference`). Absent (legacy, ADR 0011) -> chaîne vide, qui perd le
      // départage : sans conséquence, la date suffit à trancher hors du jour même.
      created_at: op.startedAt ?? '',
      seance_version_id: op.seanceVersionId,
    });
  }

  // Identité d'une ligne : son `id` quand la copie locale le porte, sinon
  // (execution, order, côté) — unique par exo et stable, cf. ADR 0005.
  const keyOf = (row: PerformedSetWithExecutionRow): string =>
    row.id ?? `${row.execution_id}:${row.set_order}:${row.side ?? ''}`;
  const byKey = new Map(rows.map((row) => [keyOf(row), row] as const));

  for (const op of ops) {
    switch (op.type) {
      case 'insertSet': {
        if (op.exerciseId !== exerciseId) break;
        const executions = context.get(op.executionId);
        if (!executions) break; // Sans date ni scope, la ligne ne dérive rien.
        byKey.set(op.id, {
          id: op.id,
          weight_kg: op.weightKg,
          reps: op.reps,
          rir: op.rir,
          set_order: op.setOrder,
          side: op.side ?? null,
          execution_id: op.executionId,
          executions,
        });
        break;
      }
      case 'deleteSet':
        byKey.delete(op.id);
        break;
      case 'deleteExecution':
        for (const [key, row] of byKey) {
          if (row.execution_id === op.id) byKey.delete(key);
        }
        break;
      default:
        break;
    }
  }

  // Même ordre que la requête (performed_on puis created_at) : `reconstructExerciseExecutions`
  // documente que l'ordre des exécutions rendues suit celui des lignes.
  return [...byKey.values()].sort((a, b) => {
    const da = a.executions?.performed_on ?? '';
    const db = b.executions?.performed_on ?? '';
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.executions?.created_at ?? '';
    const cb = b.executions?.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return 0;
  });
}

/**
 * Lignes plates de l'historique réel d'un exo : ses performed_sets (scopés RLS)
 * joints à leur exécution (date, created_at, version de séance). Base UNIQUE des
 * dérivées (`deriveExerciseHistory`) : la Référence scopée séance se filtre sur
 * `seance_version_id`, les records gardent tout. User neuf -> liste vide.
 */
async function loadExerciseExecutions(exerciseId: string): Promise<PerformedSetWithExecutionRow[]> {
  // Cache d'abord (ADR 0012) : la Référence et les Records se dérivent de la
  // copie locale hors-ligne. Elle peut être en retard d'une exécution faite
  // ailleurs (cas résiduel ADR 0003) ; ce qui est écrit d'ICI ne la laisse pas
  // périmée : tant qu'une série attend, l'outbox la fusionne (ADR 0014), et dès
  // qu'elle est acquittée la copie est relue (`refreshExerciseRows`).
  return cachedRead(exerciseRowsKey(exerciseId), () => fetchExerciseRows(exerciseId));
}

/** Clé de la copie locale de l'historique d'un exo. */
const EXERCISE_ROWS_PREFIX = 'exo-execs:';
function exerciseRowsKey(exerciseId: string): string {
  return `${EXERCISE_ROWS_PREFIX}${exerciseId}`;
}

/**
 * Relit depuis le réseau la copie locale de l'historique des exos donnés.
 * Appelée après un flush qui a fait passer des séries (cf. sync.ts) : une fois
 * acquittées, elles quittent l'outbox et la Référence de la séance suivante ne
 * les verrait plus que dans une copie à jour. En échec réseau la copie reste
 * telle quelle (la revalidation de fond rattrapera).
 */
export async function refreshExerciseRows(exerciseIds: readonly string[]): Promise<void> {
  await Promise.all(
    exerciseIds.map((id) => refreshRead(exerciseRowsKey(id), () => fetchExerciseRows(id))),
  );
}

/**
 * Les exos dont la copie locale d'historique CONTIENT une des lignes supprimées
 * (une série par son id, une exécution par l'`execution_id` de ses séries). Une
 * suppression ne porte que l'id de sa ligne, pas l'exo : c'est le contenu des
 * copies qui dit lesquelles sont périmées. Les autres ne sont pas à relire, et
 * surtout pas à marquer d'un seuil (`refreshRead`), qui écarterait la réponse
 * valide et tardive d'une lecture en cours sur un exo sans rapport.
 */
export function exercisesHoldingRows(deleted: {
  setIds: readonly string[];
  executionIds: readonly string[];
}): string[] {
  return cachedKeys(EXERCISE_ROWS_PREFIX)
    .filter((key) =>
      copyHoldsDeletedRow(peekRead<PerformedSetWithExecutionRow[]>(key) ?? [], deleted),
    )
    .map((key) => key.slice(EXERCISE_ROWS_PREFIX.length));
}

/**
 * La copie contient-elle une des lignes supprimées ? Une ligne SANS id (copie
 * écrite avant ce champ) ne peut pas être comparée à une série supprimée : dans
 * le doute elle compte comme la contenant, la copie sera relue.
 */
export function copyHoldsDeletedRow(
  rows: readonly PerformedSetWithExecutionRow[],
  deleted: { setIds: readonly string[]; executionIds: readonly string[] },
): boolean {
  return rows.some(
    (row) =>
      deleted.executionIds.includes(row.execution_id) ||
      (deleted.setIds.length > 0 && (row.id === undefined || deleted.setIds.includes(row.id))),
  );
}

/** Lecture Supabase brute de l'historique d'un exo (cf. loadExerciseExecutions). */
function fetchExerciseRows(exerciseId: string): Promise<PerformedSetWithExecutionRow[]> {
  // TOUT l'historique de l'exo, donc lecture paginée (cf. lib/fetch-all) : un
  // exo très pratiqué passe le plafond de 1000 lignes de PostgREST, et la
  // Référence comme les records se dérivaient alors d'un historique tronqué.
  return fetchAllRows<PerformedSetWithExecutionRow & { id: string }>((after, limit) =>
    afterId(
      supabase
        .from('performed_sets')
        .select(
          'id, weight_kg, reps, rir, set_order, side, execution_id, executions ( performed_on, created_at, seance_version_id )',
        )
        .eq('exercise_id', exerciseId)
        // Tri par `id` seul, exigé par la pagination au curseur. L'ordre
        // chronologique des EXÉCUTIONS (performed_on puis created_at de
        // l'exécution, dont `lastReference` a besoin pour départager deux séances
        // du même jour) est posé côté client par `applyPendingSets`, par où
        // passent toutes les lectures ; l'ordre des séries DANS une exécution, par
        // leur `set_order` (le domaine trie, il ne se fie pas à l'ordre des lignes).
        .order('id')
        .limit(limit),
      after,
    ),
  );
}

// --- Dérivées d'historique (Référence scopée séance + records all-time) -------

/**
 * Toutes les dérivées d'historique d'un exo pour la Capture, issues d'UNE seule
 * lecture des performed_sets :
 *   - `reference` : la dernière perf DANS CETTE SÉANCE (cf. GLOSSARY.md
 *     « Référence » — le même exo dans une autre séance ne compte pas) ;
 *   - `fallbackReference` : repli du PRÉREMPLISSAGE seul quand la séance n'a pas
 *     d'historique (dernière perf toutes séances confondues) — jamais de repère
 *     ni de badge dessus ;
 *   - `personalRecord` / `personalRecordBySide` : les records, eux, restent
 *     ALL-TIME toutes séances confondues (cf. GLOSSARY.md « Record personnel »).
 */
export interface ExerciseHistory {
  reference: PerformedSet[] | null;
  fallbackReference: PerformedSet[] | null;
  personalRecord: PersonalRecord;
  personalRecordBySide: PersonalRecordBySide | null;
}

/**
 * Partie PURE de `loadExerciseHistory` (aucun accès Supabase), testée directement :
 * dérive Référence scopée, repli et records depuis les lignes plates. Le scope de
 * séance filtre par `seance_version_id` (toutes les versions du template, la
 * Référence traverse les retouches). Une ligne orpheline (jointure absente) est
 * hors scope par construction.
 */
export function deriveExerciseHistory(
  rows: PerformedSetWithExecutionRow[],
  exerciseId: string,
  seanceVersionIds: readonly string[],
  unilateral: boolean,
  currentExecutionId: string | null = null,
): ExerciseHistory {
  const versionIds = new Set(seanceVersionIds);
  // TOUT se dérive de l'historique D'AVANT l'exécution en cours (ADR 0014).
  //   - Référence : « la dernière fois » — on ne se compare pas à soi-même en
  //     train de se faire.
  //   - Records : le socle sur lequel la Capture REJOUE les séries du jour
  //     (`computeRecordFlags` fait avancer un record « running » série après
  //     série). Y verser déjà le jour éteindrait le badge d'une série qui vient
  //     de battre le record, au premier remontage de l'écran. Le record affiché
  //     reste all-time au sens du glossaire : le jour est rejoué par-dessus.
  const past = currentExecutionId
    ? rows.filter((r) => r.execution_id !== currentExecutionId)
    : rows;
  const all = reconstructExerciseExecutions(past, exerciseId);
  const scoped = reconstructExerciseExecutions(
    past.filter((r) => r.executions != null && versionIds.has(r.executions.seance_version_id)),
    exerciseId,
  );

  const reference = lastReference(scoped, exerciseId);
  return {
    reference,
    // Repli seulement quand la séance n'a AUCUN historique de l'exo : un point de
    // départ pour le poids, pas une comparaison (pas de repère, pas de badges).
    fallbackReference: reference === null ? lastReference(all, exerciseId) : null,
    personalRecord: personalRecord(all, exerciseId),
    // Records par côté (ADR 0010) seulement pour un unilatéral : un bilatéral n'en a pas.
    personalRecordBySide: unilateral ? personalRecordBySide(all, exerciseId) : null,
  };
}

/**
 * Charge les dérivées d'historique d'un exo (Référence scopée à la séance, repli
 * de préremplissage, records all-time) en UNE lecture des performed_sets. User
 * neuf (aucune perf) -> référence/repli null et records nuls.
 */
export async function loadExerciseHistory(
  exerciseId: string,
  seanceVersionIds: readonly string[],
  unilateral: boolean,
  currentExecutionId: string | null = null,
): Promise<ExerciseHistory> {
  const rows = await loadExerciseRows(exerciseId);
  return deriveExerciseHistory(rows, exerciseId, seanceVersionIds, unilateral, currentExecutionId);
}

/**
 * Les lignes plates d'un exo, copie locale FUSIONNÉE avec les écritures encore
 * en attente (ADR 0014) : la source unique des dérivées de Capture. Exportée
 * telle quelle pour l'ouverture d'une séance, qui dérive APRÈS avoir résolu
 * l'id de l'exécution du jour — les deux lectures partent en parallèle, seule
 * la dérivation (pure) attend.
 */
export async function loadExerciseRows(
  exerciseId: string,
): Promise<PerformedSetWithExecutionRow[]> {
  const rows = await loadExerciseExecutions(exerciseId);
  // Les écritures en attente du compte reconnu seulement : celles d'un autre
  // compte restées en file n'entrent pas dans ses repères.
  return applyPendingSets(rows, readOwnQueue(), exerciseId);
}

/**
 * Les dérivées d'historique d'un exo relues SANS réseau, depuis la copie locale
 * fusionnée avec les écritures en attente : de quoi rejouer la dérivation d'un
 * écran déjà monté quand la copie vient de changer (cf. `onExerciseRowsWritten`).
 * `null` si la copie est ABSENTE (purgée, stockage plein) : l'appelant ne touche
 * alors à rien, une copie qui manque n'est pas un historique vide.
 */
export function peekExerciseHistory(
  exerciseId: string,
  seanceVersionIds: readonly string[],
  unilateral: boolean,
  currentExecutionId: string | null,
): ExerciseHistory | null {
  const rows = peekRead<PerformedSetWithExecutionRow[]>(exerciseRowsKey(exerciseId));
  if (rows === null) return null;
  return deriveExerciseHistory(
    applyPendingSets(rows, readOwnQueue(), exerciseId),
    exerciseId,
    seanceVersionIds,
    unilateral,
    currentExecutionId,
  );
}

/**
 * S'abonne aux copies d'historique d'exo dont le contenu change (revalidation de
 * fond, relecture d'après acquittement) : `listener` reçoit l'id de l'exo. Rend
 * la fonction de désabonnement.
 */
export function onExerciseRowsWritten(listener: (exerciseId: string) => void): () => void {
  return onReadWritten((key) => {
    if (key.startsWith(EXERCISE_ROWS_PREFIX)) listener(key.slice(EXERCISE_ROWS_PREFIX.length));
  });
}

/** Les dérivées d'historique telles qu'un exo de séance les porte (champs optionnels ou nuls). */
type LooseExerciseHistory = { [K in keyof ExerciseHistory]?: ExerciseHistory[K] | null };

/**
 * Deux jeux de dérivées d'historique disent-ils la même chose ? Chaque série
 * acquittée réécrit la copie de son exo : la dérivation est rejouée souvent,
 * mais l'écran ne doit être re-rendu que si le résultat DIFFÈRE. Pur.
 */
export function sameExerciseHistory(a: LooseExerciseHistory, b: LooseExerciseHistory): boolean {
  const shape = (h: LooseExerciseHistory) =>
    JSON.stringify([
      h.reference ?? null,
      h.fallbackReference ?? null,
      h.personalRecord ?? null,
      h.personalRecordBySide ?? null,
    ]);
  return shape(a) === shape(b);
}

// --- Note datée reportée (repère « Dernière fois tu notais : … ») -------------

/**
 * La DERNIÈRE exécution passée de la séance (`performed_on < beforeDate`, toutes
 * versions confondues) : c'est ELLE seule qui peut porter le repère « Dernière
 * fois tu notais » (cf. GLOSSARY.md « Note datée » : si elle n'a pas de note pour
 * un exo, rien ne ressort, on ne repêche jamais plus ancien). `beforeDate` = la
 * date ADOPTÉE de la séance du jour : on exclut l'exécution en cours. `null` si
 * la séance n'a jamais été exécutée.
 *
 * UNE copie par séance (`last-exec:<séance>`), qui porte la date pour laquelle
 * elle a été lue. Avant, la clé portait la date et la liste des versions : un
 * jour nouveau n'avait jamais de copie (repère absent hors ligne) et chaque jour
 * d'entraînement laissait une clé orpheline. Désormais :
 *   - copie lue pour CE jour : servie d'abord, revalidée en fond ;
 *   - copie d'un autre jour : réseau d'abord, borné (3 s) ; en échec, la copie
 *     sert de secours si son exécution précède bien `beforeDate`. Elle peut alors
 *     avoir une exécution de retard, le repère affiche sa date.
 * La séance se filtre côté serveur, par jointure sur `seance_versions` : pas de
 * liste d'ids de versions dans l'URL.
 */
export async function loadLastSeanceExecution(
  seanceId: string,
  beforeDate: string,
): Promise<{ id: string; performedOn: string } | null> {
  type Copy = { before: string; last: { id: string; performedOn: string } | null };
  const key = `${LAST_EXECUTION_PREFIX}${seanceId}`;
  const fetcher = async (): Promise<Copy> => {
    const { data, error } = await supabase
      .from('executions')
      .select('id, performed_on, seance_versions!inner(seance_id)')
      .eq('seance_versions.seance_id', seanceId)
      .lt('performed_on', beforeDate)
      .order('performed_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return {
      before: beforeDate,
      last: data ? { id: data.id, performedOn: data.performed_on } : null,
    };
  };
  // Tolérant (ADR 0012) : le repère « tu notais » est un confort, jamais un
  // bloqueur. Sans copie ni réseau, il n'y a simplement rien à ressortir.
  try {
    if (peekRead<Copy>(key)?.before === beforeDate) return (await cachedRead(key, fetcher)).last;
    const read = await networkFirstRead(key, fetcher);
    if (read.before === beforeDate) return read.last;
    // Copie de secours, lue pour un autre jour : valable si elle précède ce jour.
    return read.last !== null && read.last.performedOn < beforeDate ? read.last : null;
  } catch {
    return null;
  }
}

/** Préfixes des copies du repère « tu notais », une par séance. */
const LAST_EXECUTION_PREFIX = 'last-exec:';
const PREVIOUS_NOTES_PREFIX = 'prev-notes:';

/**
 * Les notes datées portées par la dernière exécution passée de la séance, par
 * exerciseId : la source du repère « Dernière fois tu notais » de CHAQUE exo
 * (une seule requête pour toute la séance, exos ajoutés à la volée compris).
 * Corps vides écartés ; à doublon par exo (garde-fou), la plus récente gagne.
 * `{}` si la séance n'a pas d'exécution passée.
 *
 * UNE copie par séance (`prev-notes:<séance>`), qui nomme l'exécution dont elle
 * vient : elle ne sert que pour cette exécution-là. Avant, la clé portait l'id
 * de l'exécution et chaque séance faite laissait une clé orpheline.
 */
export async function loadPreviousDatedNotes(
  seanceId: string,
  lastExecution: { id: string; performedOn: string } | null,
): Promise<Record<string, PreviousDatedNote>> {
  if (!lastExecution) return {};
  type Copy = { executionId: string; notes: Record<string, PreviousDatedNote> };
  const key = `${PREVIOUS_NOTES_PREFIX}${seanceId}`;
  const fetcher = async (): Promise<Copy> => {
    const { data, error } = await supabase
      .from('dated_notes')
      .select('exercise_id, body, created_at')
      .eq('execution_id', lastExecution.id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const notes: Record<string, PreviousDatedNote> = {};
    for (const row of data ?? []) {
      if (row.body.trim() === '') continue;
      notes[row.exercise_id] = { body: row.body, performedOn: lastExecution.performedOn };
    }
    return { executionId: lastExecution.id, notes };
  };
  // Tolérant (ADR 0012) : même statut de confort que loadLastSeanceExecution.
  try {
    const own = peekRead<Copy>(key)?.executionId === lastExecution.id;
    const read = own ? await cachedRead(key, fetcher) : await networkFirstRead(key, fetcher);
    // Une copie de secours d'une AUTRE exécution ne dit rien de celle-ci.
    return read.executionId === lastExecution.id ? read.notes : {};
  } catch {
    return {};
  }
}

// --- Éviction des copies de lecture périmées ----------------------------------

/**
 * Retire les copies de lecture de la Capture qui ne seront plus jamais lues. Le
 * cache n'avait aucune éviction et partage son quota avec l'outbox. Appelée une
 * fois par lancement de l'app, à l'arrivée en Capture. Partent :
 *   - les copies du repère « tu notais » à l'ancien format (une clé par jour et
 *     par exécution, cf. `loadLastSeanceExecution`) ;
 *   - les templates des versions de séance qui ne sont plus la version courante,
 *     sauf celles de `keepVersionIds` (une séance entamée garde le template de
 *     la version sous laquelle elle est née).
 * L'historique des exos (`exo-execs`) reste entier : les records all-time en
 * dérivent, le tronquer les fausserait. Si le stockage sature malgré tout, le
 * cache entier cède la place aux écritures (cf. outbox, `writeQueue`).
 */
export function pruneCaptureCopies(keepVersionIds: readonly string[] = []): void {
  for (const key of cachedKeys(LAST_EXECUTION_PREFIX)) {
    // Ancien format : `last-exec:<condensé des versions>:<date>`.
    if (key.slice(LAST_EXECUTION_PREFIX.length).includes(':')) dropRead(key);
  }
  for (const key of cachedKeys(PREVIOUS_NOTES_PREFIX)) {
    // Ancien format : les notes seules, sans l'exécution dont elles viennent.
    const copy = peekRead<{ executionId?: unknown }>(key);
    if (typeof copy?.executionId !== 'string') dropRead(key);
  }
  for (const key of cachedKeys(SEANCE_TEMPLATE_PREFIX)) {
    const [versionId, seanceId] = key.slice(SEANCE_TEMPLATE_PREFIX.length).split(':');
    if (!versionId || !seanceId || keepVersionIds.includes(versionId)) continue;
    // Sans copie de la version courante, on ne sait pas : la copie reste.
    const current = peekRead<string | null>(`${SEANCE_VERSION_PREFIX}${seanceId}`);
    if (typeof current === 'string' && current !== versionId) dropRead(key);
  }
}

// --- Exécution du jour --------------------------------------------------------
//
// NOTE : l'id d'exécution n'est plus résolu côté serveur via un « find or
// create » du jour. Depuis l'ajout de l'outbox (ADR 0003), il est GÉNÉRÉ CÔTÉ
// CLIENT au démarrage de la session (state.executionId) et posé via
// `upsertExecution`, pour qu'une séance loggée offline remonte sans collision.
// La RÉHYDRATATION, elle, doit RETROUVER l'exécution du jour déjà en base (après
// un reload, ou une reprise après clôture transitoire) et ADOPTER son id réel,
// sinon l'UI repartirait sous un id fantôme décorrélé des séries (bug H1).

/**
 * L'exécution du jour réhydratée depuis la base : son id RÉEL, son réalisé (par
 * exerciseId, avec l'id réel de chaque série pour rester annulable) et ses notes
 * datées (avec leur id réel). `null` = aucune exécution ce jour-là (séance neuve).
 * Les trois vues décrivent la MÊME exécution (une seule résolution), pour que
 * séries et notes réhydratées ne divergent jamais.
 */
export interface TodayExecution {
  executionId: string;
  /**
   * La version de séance sous laquelle l'exécution est NÉE (elle n'en change
   * jamais, ADR 0021). Peut différer de la version courante si le plan a été
   * retouché depuis : c'est son template que la Capture doit afficher. `null`
   * pour une ligne héritée sans version.
   */
  seanceVersionId: string | null;
  /**
   * Lancement (epoch ms) pour reprendre le chrono (ADR 0011), borné par `created_at`
   * (le lancement ne peut être postérieur au 1er log). Toujours défini : à défaut de
   * `started_at` en base (legacy / valeur dérivée), retombe sur `created_at`.
   */
  startedAt: number;
  progress: Record<string, HydratedProgress>;
  datedNotes: Record<string, DatedNoteDraft>;
}

/**
 * Charge l'exécution EN COURS du jour `date` pour cette séance, et tout son
 * réalisé persisté (séries + notes datées), pour RÉHYDRATER la capture au montage
 * — c'est Supabase qui fait foi après un reload. `date` est la date ADOPTÉE par
 * `resolveCaptureDate` (today, ou la VEILLE si une séance entamée hier n'a pas été
 * clôturée, bug H1/F10) : on interroge ce jour-là, pas un `todayIso()` interne qui
 * basculerait après minuit. Remonte l'id RÉEL de l'exécution ET de chaque ligne
 * `performed_sets`/`dated_notes`, pour que l'état réhydraté reste corrélé à la
 * base (annulation, idempotence). `null` si aucune exécution ce jour-là.
 */
export async function loadTodayExecution(
  seanceId: string,
  date: string,
  /**
   * L'exécution que l'appareil tient DÉJÀ en cours (état de capture restauré), ou
   * `null`. Quand elle est connue, c'est ELLE qu'on relit, par son id : ses séries
   * écrites ailleurs (journal) manqueraient sinon à la reprise. Sans état local
   * (autre appareil, stockage vidé), on cherche l'exécution ouverte du jour pour
   * la SÉANCE, toutes versions confondues : une exécution garde la version sous
   * laquelle elle est née (`upsertExecution` est une insertion seule), donc une
   * recherche par version courante ne la retrouvait plus après une retouche du
   * plan, et la suite de la séance ouvrait une seconde exécution.
   */
  localExecutionId: string | null = null,
): Promise<TodayExecution | null> {
  // Tolérant SANS copie locale (ADR 0012) : hors-ligne, `null` suffit — le
  // réalisé LOCAL du jour (state.ts, fusionné par mergeProgress, qui PRIME pour
  // l'executionId et le chrono) reste la vérité de l'appareil, donc pas
  // d'exécution fantôme. Surtout, ne JAMAIS servir une copie d'abord ici : une
  // copie datant d'avant la Clôture ressusciterait une séance déjà rangée
  // (exactement ce que le filtre `closed_at` combat, ADR 0009). Le prix du
  // repli en échec NON-réseau : une exécution du jour en base peut être ignorée
  // et doublée — même classe résiduelle que le multi-appareil (ADR 0003), la
  // capture ne bloque jamais.
  //
  // La base ne suffit pas à dire qu'une exécution est encore EN COURS : Clôture,
  // Annulation et suppression effacent l'état local dès le geste, alors que leur
  // écriture attend peut-être encore dans l'outbox. Une exécution que la file
  // clôt ou supprime n'est donc PAS adoptée, comme si la base la montrait déjà
  // close. Une série qu'elle supprime est de même retirée du réalisé relu
  // (`withoutPendingDeletions`). On lit la file aux deux bouts de la lecture, car la réponse est figée
  // à son départ : avant (l'écriture a pu être acquittée pendant le trajet, la
  // file est alors vide au retour) et après (elle a pu être enfilée entre-temps).
  const pendingBefore = readOwnQueue();
  try {
    const today = await fetchTodayExecution(seanceId, date, localExecutionId);
    if (today === null) return null;
    const pendingAfter = readOwnQueue();
    const retired =
      isExecutionRetiredInQueue(today.executionId, pendingBefore) ||
      isExecutionRetiredInQueue(today.executionId, pendingAfter);
    if (retired) return null;
    // Même décalage pour une SÉRIE annulée : elle a quitté l'état local dès le
    // geste, son `deleteSet` attend peut-être encore, et la base la porte
    // toujours. Rendue telle quelle, elle revenait à l'écran au remontage (la
    // fusion garde la liste la plus longue) et faussait le rang de la suivante.
    return withoutPendingDeletions(today, [...pendingBefore, ...pendingAfter]);
  } catch {
    return null;
  }
}

/** Budget d'attente de l'exécution du jour à l'ouverture d'une séance (ADR 0012). */
export const TODAY_READ_BUDGET_MS = 3000;

/**
 * `loadTodayExecution`, BORNÉE : au-delà de `budgetMs` la séance s'ouvre sans
 * attendre la base. C'est la seule lecture sans copie locale du chemin
 * d'ouverture ; hors ligne avec un jeton expiré elle tenait l'écran une
 * vingtaine de secondes (le temps que supabase-js renonce à rafraîchir le
 * jeton), et sans fin sur un wifi zombie.
 *
 * Un délai dépassé N'EST PAS une absence : `today` vaut alors `null` faute de
 * réponse, et `late` porte la lecture toujours en vol, pour que l'appelant
 * puisse appliquer sa réponse quand elle arrive. `late` est `null` quand la
 * lecture a répondu dans le budget (`today` est alors la vraie réponse).
 */
export async function loadTodayExecutionWithin(
  seanceId: string,
  date: string,
  localExecutionId: string | null,
  budgetMs: number = TODAY_READ_BUDGET_MS,
): Promise<{ today: TodayExecution | null; late: Promise<TodayExecution | null> | null }> {
  const read = loadTodayExecution(seanceId, date, localExecutionId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol('délai dépassé');
  const budget = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), budgetMs);
  });
  const first = await Promise.race([read, budget]);
  clearTimeout(timer);
  return first === timedOut ? { today: null, late: read } : { today: first, late: null };
}

/**
 * Le réalisé relu en base, moins les séries que la file d'écritures supprime
 * (`deleteSet` en attente). Un exo qui n'a plus aucune série sort du réalisé.
 * Pur : l'appelant passe la file lue avant ET après la lecture réseau.
 */
export function withoutPendingDeletions(
  today: TodayExecution,
  pendingOps: readonly OutboxOp[],
): TodayExecution {
  const deleted = new Set(
    pendingOps.filter((op) => op.type === 'deleteSet').map((op) => op.id),
  );
  if (deleted.size === 0) return today;
  const progress: Record<string, HydratedProgress> = {};
  for (const [exerciseId, entry] of Object.entries(today.progress)) {
    const kept = entry.setIds
      .map((id, index) => ({ id, set: entry.sets[index] }))
      .filter(
        (row): row is { id: string; set: PerformedSet } =>
          row.set !== undefined && !deleted.has(row.id),
      );
    if (kept.length === 0) continue;
    progress[exerciseId] = { sets: kept.map((r) => r.set), setIds: kept.map((r) => r.id) };
  }
  return { ...today, progress };
}

/**
 * La file d'écritures en attente RETIRE-t-elle cette exécution : une clôture
 * (`updateExecution` portant un `closedAt`) ou une suppression (`deleteExecution`,
 * posée par l'Annulation comme par le journal) qui la vise ? Une correction de
 * métriques sans clôture, ou une op visant une autre exécution, ne compte pas.
 */
export function isExecutionRetiredInQueue(
  executionId: string,
  pendingOps: readonly OutboxOp[],
): boolean {
  return pendingOps.some((op) => {
    if (op.id !== executionId) return false;
    if (op.type === 'deleteExecution') return true;
    return op.type === 'updateExecution' && typeof op.closedAt === 'string';
  });
}

/** Lecture Supabase brute de l'exécution du jour (cf. loadTodayExecution). */
async function fetchTodayExecution(
  seanceId: string,
  date: string,
  localExecutionId: string | null,
): Promise<TodayExecution | null> {
  // La séance se filtre CÔTÉ SERVEUR, par jointure sur `seance_versions` : toutes
  // ses versions d'un coup, sans liste d'ids dans l'URL (une séance très
  // versionnée dépassait la taille d'URL admise et la lecture échouait).
  // L'exécution tenue par l'appareil se relit par son id (cf. loadTodayExecution),
  // sans jointure ; sinon, l'exécution ouverte du jour de la séance, quelle que
  // soit sa version. Les gardes « en cours » ci-dessous valent pour les deux.
  const scoped =
    localExecutionId !== null
      ? supabase
          .from('executions')
          .select('id, started_at, created_at, seance_version_id')
          .eq('id', localExecutionId)
      : supabase
          .from('executions')
          .select('id, started_at, created_at, seance_version_id, seance_versions!inner(seance_id)')
          .eq('seance_versions.seance_id', seanceId)
          .eq('performed_on', date);
  const { data: exec, error: execErr } = await scoped
    // On ne réhydrate QUE l'exécution EN COURS (non clôturée) : la clôture pose un
    // `closed_at` en base (ADR 0009), donc une séance déjà RANGÉE ce jour-là est
    // exclue ici → on repart vierge, sans la ressusciter ni y rattacher un nouveau
    // log. À la granularité du jour deux exécutions de la même séance peuvent
    // coexister (reprise / 2 séances) ; on prend la PLUS RÉCENTE des NON clôturées.
    // Séries ET notes visent CETTE id.
    .is('closed_at', null)
    // Ceinture-bretelles : `duration_min` n'est posé QUE par la clôture (même op
    // que `closed_at`). Une exécution avec une durée enregistrée est donc TERMINÉE,
    // même si `closed_at` manque — cas des lignes héritées clôturées par un bundle
    // antérieur au fix, ou écrites par un service worker encore obsolète. On les
    // exclut aussi pour ne jamais ressusciter une séance déjà finie après refresh.
    .is('duration_min', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (execErr) throw execErr;
  if (!exec) return null;

  // Séries et notes de la MÊME exécution, en parallèle (toutes deux par execution_id).
  const [setsRes, notesRes] = await Promise.all([
    supabase
      .from('performed_sets')
      .select('id, exercise_id, weight_kg, reps, rir, set_order, side')
      .eq('execution_id', exec.id)
      .order('set_order', { ascending: true }),
    supabase
      .from('dated_notes')
      .select('id, exercise_id, body, created_at')
      .eq('execution_id', exec.id)
      .order('created_at', { ascending: true }),
  ]);
  if (setsRes.error) throw setsRes.error;
  if (notesRes.error) throw notesRes.error;

  // Réalisé par exo : on porte l'id RÉEL de chaque série (aligné par index avec
  // `sets`) pour qu'une série réhydratée reste ANNULABLE (deleteSet vise la bonne
  // ligne, bug H2/F1). Les deux tableaux restent alignés car remplis ensemble.
  const progress: Record<string, HydratedProgress> = {};
  for (const row of setsRes.data ?? []) {
    const p = progress[row.exercise_id] ?? (progress[row.exercise_id] = { sets: [], setIds: [] });
    p.sets.push({
      weightKg: Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      order: row.set_order,
      side: toSide(row.side),
    });
    p.setIds.push(row.id);
  }
  // Tri par order, puis gauche AVANT droite à order égal (série unilatérale,
  // issue #46) : l'état réhydraté garde G/D dans l'ordre de saisie, donc
  // `pendingSide`/`nextSetOrder` repartent juste après une série complète. On trie
  // un tableau d'INDEX pour réordonner `sets` ET `setIds` ENSEMBLE (ne pas casser
  // l'alignement série↔id réel).
  for (const id of Object.keys(progress)) {
    const entry = progress[id];
    if (!entry) continue;
    const { sets, setIds } = entry;
    const order = sets
      .map((_, i) => i)
      .sort((i, j) => {
        // `i`/`j` proviennent de `sets.map((_, i) => i)` → toujours des index valides
        // de `sets`. La garde rassure `noUncheckedIndexedAccess` sans toucher l'ordre.
        const si = sets[i];
        const sj = sets[j];
        if (!si || !sj) return 0;
        return si.order - sj.order || sideRank(si.side) - sideRank(sj.side);
      });
    progress[id] = {
      sets: order.map((i) => sets[i]).filter((s): s is PerformedSet => s !== undefined),
      setIds: order.map((i) => setIds[i]).filter((id): id is string => id !== undefined),
    };
  }

  // Une note par exo : la dernière créée gagne (l'UI n'en crée qu'une, garde-fou).
  const datedNotes: Record<string, DatedNoteDraft> = {};
  for (const row of notesRes.data ?? []) {
    datedNotes[row.exercise_id] = { id: row.id, body: row.body };
  }

  // Chrono repris du lancement persisté (ADR 0011). Le lancement ne peut JAMAIS
  // être postérieur à la création de la ligne (≈ 1er log) : on borne donc
  // `started_at` par `created_at`. Sans ce garde-fou, un `started_at` absent
  // (legacy) ou DÉRIVÉ EN AVANT (réécrit à `Date.now()` lors d'une reprise sans
  // valeur en base) faisait mesurer « reprise → clôture » au lieu de « lancement →
  // clôture » → durée tronquée (bug « séance complète = 2 min »). Retombe alors sur
  // `created_at`, qui donne au moins « 1er set → clôture ».
  const createdMs = new Date(exec.created_at).getTime();
  const startedMs = exec.started_at ? new Date(exec.started_at).getTime() : null;
  return {
    executionId: exec.id,
    seanceVersionId: exec.seance_version_id,
    startedAt: startedMs !== null ? Math.min(startedMs, createdMs) : createdMs,
    progress,
    datedNotes,
  };
}

// --- Édition d'une séance passée (issue #38) ----------------------------------
//
// Pour CORRIGER une exécution d'un jour antérieur depuis le journal, on charge
// ses séries telles qu'en base — avec leur id RÉEL, contrairement à la capture
// du jour qui n'a pas besoin de viser des lignes existantes (elle append). Cet
// id réel est ce qui permet à l'édition (via l'outbox : upsert/delete par id) de
// modifier/supprimer la BONNE ligne sans toucher les autres jours. On lit par
// `execution_id` (pas par date) : une seule exécution est concernée.

/** Une exécution passée prête à éditer : sa date + ses exos avec leurs séries. */
export interface EditableExecution {
  executionId: string;
  /** Date ISO 'YYYY-MM-DD' de l'exécution (affichée, jamais modifiée). */
  date: string;
  exercises: EditableExercise[];
  /**
   * Horodatage de clôture (ISO) ou `null` si la séance n'est pas clôturée. L'édition
   * des MÉTRIQUES (durée/BPM) n'est proposée que pour une séance FINIE (`closedAt`
   * non-null) : poser une durée sur une exécution en cours la ferait passer pour
   * close côté `loadTodayExecution` (filtre `duration_min`) → elle ne serait plus
   * réhydratée en Capture. Les SÉRIES, elles, restent éditables dans les deux cas.
   */
  closedAt: string | null;
  /** BPM moyen posé à la clôture (optionnel), ou `null`. Éditable si `closedAt` non-null. */
  bpmAvg: number | null;
  /** Durée chronométrée posée à la clôture (min), ou `null`. Éditable si `closedAt` non-null. */
  durationMin: number | null;
}

/**
 * Charge une exécution passée pour l'édition (issue #38) : sa date + ses séries
 * regroupées par exo (avec l'id réel de chaque série, pour cibler la bonne ligne
 * au moment d'écrire). Lit `performed_sets` filtré par `execution_id` (joint au
 * nom de l'exo) + la date de l'exécution. RLS scope déjà à l'user connecté : on
 * ne peut charger qu'une exécution à soi. Le groupage/tri est fait par le module
 * pur `groupSetsForEdit` ; cette couche ne fait que mapper et déléguer.
 */
export async function loadExecutionForEdit(
  executionId: string,
): Promise<EditableExecution> {
  const { data: exec, error: execErr } = await supabase
    .from('executions')
    .select('id, performed_on, closed_at, bpm_avg, duration_min')
    .eq('id', executionId)
    .maybeSingle();
  if (execErr) throw execErr;
  if (!exec) {
    throw new Error(`Exécution ${executionId} introuvable (ou non accessible).`);
  }

  const { data, error } = await supabase
    .from('performed_sets')
    .select('id, exercise_id, set_order, weight_kg, reps, rir, side, exercises ( name )')
    .eq('execution_id', executionId)
    .order('set_order', { ascending: true });
  if (error) throw error;

  type SetRow = {
    id: string;
    exercise_id: string;
    set_order: number;
    weight_kg: number;
    reps: number;
    rir: number;
    side: string | null;
    exercises: { name: string } | null;
  };
  const rows = (data ?? []) as unknown as SetRow[];

  // `side` porté de bout en bout (ADR 0005) : sur un exo unilatéral, une série =
  // deux lignes au même set_order distinguées par leur côté. Sans lui, l'édition
  // recompacterait/réécrirait `side` à null et dé-apparierait G/D (côté faible faux).
  const editableRows: EditableSetRow[] = rows.map((row) => ({
    id: row.id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercises?.name ?? '(exercice inconnu)',
    order: row.set_order,
    weightKg: Number(row.weight_kg),
    reps: row.reps,
    rir: row.rir,
    side: toSide(row.side),
  }));

  return {
    executionId,
    date: exec.performed_on,
    exercises: groupSetsForEdit(editableRows),
    closedAt: exec.closed_at,
    bpmAvg: exec.bpm_avg === null ? null : Number(exec.bpm_avg),
    durationMin: exec.duration_min === null ? null : Number(exec.duration_min),
  };
}

// --- Écriture idempotente (rejouable par l'outbox) ----------------------------
//
// LIGNES TOUCHÉES : `update` et `delete` demandent les lignes qu'ils touchent
// (`.select('id')`) et en rendent le nombre. PostgREST ne signale pas un `update`
// ou un `delete` qui ne trouve rien ; avant, on ne pouvait donc pas distinguer
// une écriture appliquée d'une écriture à vide. Ce que vaut « 0 ligne » :
//   - une suppression à 0 ligne est un succès idempotent (ligne déjà absente) ;
//   - une mise à jour d'exécution à 0 ligne est un succès sans effet, tracé. Sous
//     l'outbox elle ne peut vouloir dire que « cette exécution n'existe pas en
//     base » : la session est vérifiée avant et après chaque op (ADR 0019, donc
//     pas de requête sous clé publique), la création précède dans la file (FIFO),
//     et une création refusée emmène ses ops filles en quarantaine (ADR 0018).
//     Une exécution absente ne peut pas non plus être reprise à tort : la lecture
//     de reprise ne la trouvera pas davantage. Elle ne doit donc ni bloquer la
//     file ni partir en quarantaine.
//
// Toutes ces fonctions sont IDEMPOTENTES par `id` (UUID client, cf. ADR 0003) :
// l'outbox peut les rejouer sans crainte de doublon ni d'effet de bord. Elles
// sont les `SyncFns` consommées par `flush()` ; le mapping op→fonction se fait
// dans CaptureScreen.

/**
 * Crée l'exécution du jour, par son id client. INSERTION SEULE : `upsert` avec
 * `onConflict: 'id'` et `ignoreDuplicates` (`on conflict do nothing`). Rejouer
 * l'op, ou la ré-affirmer à chaque remontage de la Capture, ne touche JAMAIS une
 * ligne existante : ni sa version de séance, ni sa date, ni son lancement.
 *
 * Pourquoi pas un upsert qui réécrit : la Capture ré-enfile l'exécution avant la
 * première série de chaque montage, avec la version de séance qu'elle vient de
 * charger. Une séance retouchée en plein entraînement (nouvelle version) faisait
 * alors basculer l'exécution entamée, et toutes ses séries, sur la nouvelle
 * version. Aucun chemin n'a besoin de modifier ces trois colonnes après coup :
 * clôture et métriques passent par `updateExecution`, et le lancement est figé
 * dès que l'exécution est née (`shouldReanchorLaunch`, state.ts).
 * owner_id se remplit via default auth.uid().
 */
export async function upsertExecution(params: {
  id: string;
  seanceVersionId: string;
  performedOn: string;
  /** Horodatage du lancement (ISO), ADR 0011 ; omis = pas de chrono durable (legacy). */
  startedAt?: string;
}): Promise<void> {
  const { error } = await supabase.from('executions').upsert(
    {
      id: params.id,
      seance_version_id: params.seanceVersionId,
      performed_on: params.performedOn,
      // Posé seulement si fourni : sinon la colonne garde sa valeur par défaut.
      ...(params.startedAt !== undefined ? { started_at: params.startedAt } : {}),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

/**
 * Insère une série loggée, par son id client. `upsert` avec `onConflict: 'id'` :
 * rejouer l'op (retry après coupure) ne crée pas de doublon, elle ré-affirme la
 * même ligne. owner_id via default auth.uid().
 */
export async function upsertSet(params: {
  id: string;
  executionId: string;
  exerciseId: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number;
  /** Côté pour un exo unilatéral (issue #46) ; `null`/absent = bilatéral. */
  side?: Side | null;
}): Promise<void> {
  const { error } = await supabase.from('performed_sets').upsert(
    {
      id: params.id,
      execution_id: params.executionId,
      exercise_id: params.exerciseId,
      set_order: params.setOrder,
      weight_kg: params.weightKg,
      reps: params.reps,
      rir: params.rir,
      // `null` explicite pour le bilatéral : l'upsert ré-affirme bien « pas de côté ».
      side: params.side ?? null,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Supprime une série par son id (« annuler »). Idempotent : supprimer une ligne
 * déjà absente ne fait rien et ne lève pas (delete par id ciblé). Rend le nombre
 * de lignes touchées (cf. « LIGNES TOUCHÉES » plus bas) : 0 reste un succès.
 */
export async function deleteSetById(id: string): Promise<number> {
  const { data, error } = await supabase.from('performed_sets').delete().eq('id', id).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Pose les métriques de fin (BPM moyen, durée) sur l'exécution, par id. Update
 * idempotent : rejouer pose les mêmes valeurs. Un champ omis (`undefined`)
 * laisse la colonne inchangée plutôt que de l'effacer.
 *
 * Rend le nombre de lignes touchées. ZÉRO LIGNE reste un succès, y compris pour
 * une clôture : cela veut dire que l'exécution n'existe pas en base pour ce
 * compte (cf. « LIGNES TOUCHÉES »), donc qu'il n'y a rien à clore ni rien que la
 * reprise puisse adopter. C'est le cas voulu d'une clôture sans série envoyée
 * (cf. `handleFinish`). Le cas est tracé en console, pas avalé.
 */
export async function updateExecution(params: {
  id: string;
  bpmAvg?: number | null;
  durationMin?: number | null;
  /** Horodatage de clôture (ISO) : matérialise une séance « rangée » (ADR 0009) ;
   *  `loadTodayExecution` filtre dessus pour ne pas réhydrater une exécution close. */
  closedAt?: string | null;
}): Promise<number> {
  const patch: Database['public']['Tables']['executions']['Update'] = {};
  if (params.bpmAvg !== undefined) patch.bpm_avg = params.bpmAvg;
  if (params.durationMin !== undefined) patch.duration_min = params.durationMin;
  if (params.closedAt !== undefined) patch.closed_at = params.closedAt;

  // Rien à poser : on évite un update vide (no-op réseau).
  if (Object.keys(patch).length === 0) return 0;

  const { data, error } = await supabase
    .from('executions')
    .update(patch)
    .eq('id', params.id)
    .select('id');
  if (error) throw error;
  const touched = data?.length ?? 0;
  if (touched === 0) {
    // Voulu, pas avalé : la console dit quelle écriture n'a rien trouvé.
    console.warn(
      `[sync] mise à jour de l'exécution ${params.id} sans effet : la ligne n'existe pas en base` +
        (params.closedAt ? ' (clôture sans objet).' : '.'),
    );
  }
  return touched;
}

/**
 * Supprime une EXÉCUTION entière par son id (issue #44, ADR 0008) : hard delete,
 * pas de soft delete. Un unique `DELETE FROM executions WHERE id` ; la CASCADE DB
 * (`performed_sets`/`dated_notes` en on delete cascade, cf. migration 0001)
 * efface les séries et notes datées filles. Idempotent : supprimer une exécution
 * déjà absente ne fait rien et ne lève pas (delete par id ciblé, RLS scopé).
 */
export async function deleteExecutionById(id: string): Promise<number> {
  const { data, error } = await supabase.from('executions').delete().eq('id', id).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}
