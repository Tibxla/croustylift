// Couche d'accès Supabase de la capture.
//
// Produit EXACTEMENT la forme consommée par les composants (`Session` /
// `SessionExercise`, cf. fixtures.ts) pour que l'UI reste inchangée : seule la
// SOURCE des données change (Supabase au lieu de la fixture mockée).
//
// Conventions DB (cf. ADR 0003 + migration 0001) :
//   - owner_id se remplit tout seul (default auth.uid()) — on ne l'écrit JAMAIS.
//   - RLS scope déjà tout à l'utilisateur connecté ; pas de filtre owner_id côté client.
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import type { ExerciseExecution, PerformedSet, Side } from '../../domain/types';
import { lastReference } from '../../domain/reference';
import { personalRecord, type PersonalRecord } from '../../domain/pr';
import { getCurrentRoutineId, getCurrentVersionId, listRoutines, listSeances } from '../authoring/data';
import type { DatedNoteDraft, HydratedProgress } from './state';
import type { Session, SessionExercise } from './fixtures';
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
  const [currentRoutineId, routines] = await Promise.all([
    getCurrentRoutineId(),
    listRoutines(),
  ]);
  const routineId = resolveCaptureRoutineId(
    currentRoutineId,
    routines.map((r) => r.id),
  );
  if (routineId === null) return decideCaptureSource(null, []);

  const seances = await listSeances(routineId);
  const choices: SeanceChoice[] = seances.map((s) => ({ id: s.id, name: s.name }));
  return decideCaptureSource(routineId, choices);
}

/**
 * Résout une séance choisie vers sa version courante (= version max), prête à
 * être chargée par `loadSeanceForCapture`. Réutilise `getCurrentVersionId` de
 * l'authoring (pas de duplication de la résolution « version courante »).
 * Lève si la séance n'a aucune version (template incomplet, ne devrait pas
 * arriver : createSeance crée toujours une v1).
 */
export async function loadChosenSeance(seance: SeanceChoice): Promise<LoadedSeance> {
  const versionId = await getCurrentVersionId(seance.id);
  if (!versionId) {
    throw new Error(`Séance ${seance.id} sans version : template incomplet.`);
  }
  return { seance: { id: seance.id, name: seance.name }, seanceVersionId: versionId };
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
 * consommée par la Capture, avec la cible par défaut des ajouts. `reference` et
 * `personalRecord` sont laissés à `null` ici : `loadCatalogExercise` les remplit
 * depuis l'historique. Pur (testable sans Supabase).
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
 * Charge un exo du catalogue prêt à entrer dans la séance courante : sa forme
 * `SessionExercise` (cible par défaut) enrichie de sa référence (dernière fois)
 * et de ses records, dérivés de l'historique.
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
): Promise<SessionExercise> {
  const needsMerge = row.unilateral === undefined || row.primary_muscles === undefined;
  const merged = needsMerge ? await loadMergedExerciseRow(row.id) : null;
  const base = catalogExerciseToSession(merged ?? row);
  const [reference, personalRecord] = await Promise.all([
    loadReference(row.id),
    loadPersonalRecord(row.id),
  ]);
  return { ...base, reference, personalRecord };
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
  weight_kg: number;
  reps: number;
  rir: number;
  set_order: number;
  side: string | null;
  execution_id: string;
  executions: { performed_on: string; created_at: string } | null;
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
 * Historique réel d'un exo : ses exécutions (un jour = une `ExerciseExecution`),
 * chacune avec ses séries. Lit les performed_sets de l'user (scopés RLS) + la
 * date de leur exécution, puis délègue le regroupement à la partie PURE
 * `reconstructExerciseExecutions`. Base partagée des dérivées du domaine :
 * `lastReference` (dernière perf) ET `personalRecord` (records). User neuf
 * (aucune perf) -> liste vide.
 */
async function loadExerciseExecutions(exerciseId: string): Promise<ExerciseExecution[]> {
  const { data, error } = await supabase
    .from('performed_sets')
    .select('weight_kg, reps, rir, set_order, side, execution_id, executions ( performed_on, created_at )')
    .eq('exercise_id', exerciseId)
    // Ordre explicite : sans lui, l'ordre des lignes n'est pas garanti. Le
    // domaine (`lastReference`) départage à `performed_on` égal par `created_at`
    // (reprise / 2 séances le même jour) — un tri déterministe ici rend ce
    // tie-break stable entre deux chargements.
    .order('performed_on', { referencedTable: 'executions' })
    .order('created_at', { referencedTable: 'executions' });
  if (error) throw error;

  const rows = (data ?? []) as unknown as PerformedSetWithExecutionRow[];
  return reconstructExerciseExecutions(rows, exerciseId);
}

// --- Référence (dernière perf réelle) -----------------------------------------

/**
 * Référence d'un exo : sa dernière performance réelle, dérivée de l'historique.
 * User neuf (aucune perf) -> `null` (« première fois »).
 */
export async function loadReference(exerciseId: string): Promise<PerformedSet[] | null> {
  const executions = await loadExerciseExecutions(exerciseId);
  return lastReference(executions, exerciseId);
}

// --- Records personnels (issue #34) -------------------------------------------

/**
 * Records personnels d'un exo (meilleur e1RM + meilleure charge poids×reps),
 * dérivés de TOUT l'historique. Sert à signaler en Capture qu'une série bat un
 * record. User neuf -> records nuls (bestE1rm/bestWeightReps à `null`).
 */
export async function loadPersonalRecord(exerciseId: string): Promise<PersonalRecord> {
  const executions = await loadExerciseExecutions(exerciseId);
  return personalRecord(executions, exerciseId);
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
  seanceVersionId: string,
  date: string,
): Promise<TodayExecution | null> {
  const { data: exec, error: execErr } = await supabase
    .from('executions')
    .select('id')
    .eq('seance_version_id', seanceVersionId)
    .eq('performed_on', date)
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

  return { executionId: exec.id, progress, datedNotes };
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
// Toutes ces fonctions sont IDEMPOTENTES par `id` (UUID client, cf. ADR 0003) :
// l'outbox peut les rejouer sans crainte de doublon ni d'effet de bord. Elles
// sont les `SyncFns` consommées par `flush()` ; le mapping op→fonction se fait
// dans CaptureScreen.

/**
 * Crée (ou ré-affirme) l'exécution du jour, par son id client. `upsert` avec
 * `onConflict: 'id'` : rejouer la même op est sans effet (la ligne existe déjà,
 * ses colonnes identiques). owner_id se remplit via default auth.uid().
 */
export async function upsertExecution(params: {
  id: string;
  seanceVersionId: string;
  performedOn: string;
}): Promise<void> {
  const { error } = await supabase.from('executions').upsert(
    {
      id: params.id,
      seance_version_id: params.seanceVersionId,
      performed_on: params.performedOn,
    },
    { onConflict: 'id' },
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
 * déjà absente ne fait rien et ne lève pas (delete par id ciblé).
 */
export async function deleteSetById(id: string): Promise<void> {
  const { error } = await supabase.from('performed_sets').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Pose les métriques de fin (BPM moyen, durée) sur l'exécution, par id. Update
 * idempotent : rejouer pose les mêmes valeurs. Un champ omis (`undefined`)
 * laisse la colonne inchangée plutôt que de l'effacer.
 */
export async function updateExecution(params: {
  id: string;
  bpmAvg?: number | null;
  durationMin?: number | null;
  /** Horodatage de clôture (ISO) : matérialise une séance « rangée » (ADR 0009) ;
   *  `loadTodayExecution` filtre dessus pour ne pas réhydrater une exécution close. */
  closedAt?: string | null;
}): Promise<void> {
  const patch: Database['public']['Tables']['executions']['Update'] = {};
  if (params.bpmAvg !== undefined) patch.bpm_avg = params.bpmAvg;
  if (params.durationMin !== undefined) patch.duration_min = params.durationMin;
  if (params.closedAt !== undefined) patch.closed_at = params.closedAt;

  // Rien à poser : on évite un update vide (no-op réseau).
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase.from('executions').update(patch).eq('id', params.id);
  if (error) throw error;
}

/**
 * Supprime une EXÉCUTION entière par son id (issue #44, ADR 0008) : hard delete,
 * pas de soft delete. Un unique `DELETE FROM executions WHERE id` ; la CASCADE DB
 * (`performed_sets`/`dated_notes` en on delete cascade, cf. migration 0001)
 * efface les séries et notes datées filles. Idempotent : supprimer une exécution
 * déjà absente ne fait rien et ne lève pas (delete par id ciblé, RLS scopé).
 */
export async function deleteExecutionById(id: string): Promise<void> {
  const { error } = await supabase.from('executions').delete().eq('id', id);
  if (error) throw error;
}
