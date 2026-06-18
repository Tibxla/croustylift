// Le LOG BRUT des lifts (cf. issue #27, brainstorm-intent.md §4 « Log brut des
// lifts accessible directement, pas seulement les e1RM estimés »). Là où le reste
// de l'Analyse montre des courbes DÉRIVÉES (e1RM), cette vue rend les séries
// telles qu'elles ont été loggées : poids × reps × RIR, par date de séance.
//
// Forme produite : une entrée par EXÉCUTION (une séance un jour donné), la plus
// récente en tête (on consulte d'abord ce qu'on vient de faire), et dans chaque
// exécution les exos travaillés, chacun avec ses séries triées par order. Pure,
// sans dépendance réseau : la couche data (`loadRawLog`) ne fait que l'alimenter.

/** Une série loggée, dans la forme brute lue de `performed_sets`. */
export interface RawLogSet {
  weightKg: number
  reps: number
  rir: number
  /** Rang d'ordre de la série dans l'exo (à partir de 1), pour le tri. */
  order: number
}

/**
 * Le contexte d'une exécution porté par chaque ligne (stable d'une série à
 * l'autre dans la même exécution). Le nom de séance, le BPM et la durée sont
 * OPTIONNELS : une exécution peut être hors-template (pas de séance liée, cf.
 * `seance_version_id` nullable), la durée auto-chronométrée et le BPM saisi à la
 * main sont facultatifs (cf. issue #28). On garde `null` pour ne jamais inventer
 * de valeur dans le récap (cf. issue #32).
 */
export interface RawLogExecutionMeta {
  /** Nom de la séance jouée (`null` si exécution hors-template). */
  sessionName: string | null
  /** BPM moyen saisi (`null` si non renseigné). */
  bpmAvg: number | null
  /** Durée en minutes (`null` si non renseignée). */
  durationMin: number | null
}

/** Une ligne plate en entrée : une série + le contexte de son exécution/exo. */
export interface RawLogRow extends RawLogExecutionMeta {
  executionId: string
  /** Date ISO 'YYYY-MM-DD' de l'exécution. */
  date: string
  exerciseId: string
  exerciseName: string
  set: RawLogSet
}

/** Les séries d'un exo dans une exécution donnée. */
export interface RawLogExercise {
  exerciseId: string
  name: string
  sets: RawLogSet[]
}

/** Une exécution (séance d'un jour) avec les exos travaillés ce jour. */
export interface RawLogEntry extends RawLogExecutionMeta {
  executionId: string
  /** Date ISO 'YYYY-MM-DD'. */
  date: string
  exercises: RawLogExercise[]
}

/**
 * Regroupe des lignes plates `(exécution, exo, série)` en log brut consultable :
 * exécutions triées par date DÉCROISSANTE (la plus récente en tête), exos triés
 * par nom (locale fr), séries triées par order croissant. Pure.
 */
export function buildRawLog(rows: RawLogRow[]): RawLogEntry[] {
  const byExecution = new Map<string, RawLogEntry>()

  for (const row of rows) {
    let entry = byExecution.get(row.executionId)
    if (!entry) {
      // Les métadonnées sont stables par exécution : on les prend de la 1ʳᵉ ligne
      // vue pour cette exécution (les suivantes portent les mêmes).
      entry = {
        executionId: row.executionId,
        date: row.date,
        sessionName: row.sessionName,
        bpmAvg: row.bpmAvg,
        durationMin: row.durationMin,
        exercises: [],
      }
      byExecution.set(row.executionId, entry)
    }

    let exercise = entry.exercises.find((e) => e.exerciseId === row.exerciseId)
    if (!exercise) {
      exercise = { exerciseId: row.exerciseId, name: row.exerciseName, sets: [] }
      entry.exercises.push(exercise)
    }
    exercise.sets.push(row.set)
  }

  const entries = [...byExecution.values()]

  for (const entry of entries) {
    entry.exercises.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    for (const exercise of entry.exercises) {
      exercise.sets.sort((a, b) => a.order - b.order)
    }
  }

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  // On veut la plus récente en tête → comparaison inversée.
  entries.sort((a, b) => b.date.localeCompare(a.date))

  return entries
}
