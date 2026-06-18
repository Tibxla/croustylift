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

/** Une ligne plate en entrée : une série + le contexte de son exécution/exo. */
export interface RawLogRow {
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
export interface RawLogEntry {
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
      entry = { executionId: row.executionId, date: row.date, exercises: [] }
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
