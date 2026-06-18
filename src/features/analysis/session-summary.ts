// Le RÉCAP d'une séance du journal (cf. issue #32, brainstorm-intent.md §4
// « journal de séances enrichi »). L'en-tête de chaque entrée du log brut résume
// la séance d'un coup d'œil : nom, date, durée, BPM moyen, nombre de séries et
// volume total (Σ poids×reps). Là où la vue dépliée montre le détail des séries,
// le récap donne la vue d'ensemble repliée.
//
// nb séries et volume sont DÉRIVÉS des séries de l'entrée (calcul pur, testé).
// Les métadonnées (nom, durée, BPM) sont déjà portées par l'entrée et seulement
// REPRISES telles quelles : une métrique manquante reste `null` pour que l'UI ne
// montre pas de récap trompeur (cf. AC #32). Pure, sans dépendance réseau.
import type { RawLogEntry } from './raw-log'

/** Le récap d'une séance : ses métadonnées + les agrégats de ses séries. */
export interface SessionSummary {
  /** Nom de la séance jouée (`null` si exécution hors-template). */
  sessionName: string | null
  /** Date ISO 'YYYY-MM-DD'. */
  date: string
  /** Durée en minutes (`null` si non renseignée). */
  durationMin: number | null
  /** BPM moyen saisi (`null` si non renseigné). */
  bpmAvg: number | null
  /** Nombre total de séries loggées dans la séance, tous exos confondus. */
  setCount: number
  /** Volume total Σ (poids × reps) sur toutes les séries, en kg. */
  totalVolumeKg: number
}

/**
 * Dérive le récap d'une entrée du log brut : reprend ses métadonnées telles
 * quelles (jamais de valeur inventée pour une métrique `null`) et agrège ses
 * séries en nombre de séries + volume total Σ poids×reps. Pure.
 */
export function summarizeSession(entry: RawLogEntry): SessionSummary {
  let setCount = 0
  let totalVolumeKg = 0
  for (const exercise of entry.exercises) {
    for (const set of exercise.sets) {
      setCount += 1
      totalVolumeKg += set.weightKg * set.reps
    }
  }

  return {
    sessionName: entry.sessionName,
    date: entry.date,
    durationMin: entry.durationMin,
    bpmAvg: entry.bpmAvg,
    setCount,
    totalVolumeKg,
  }
}
