// Le RÉCAP d'une séance du journal (cf. issue #32, brainstorm-intent.md §4
// « journal de séances enrichi »). L'en-tête de chaque entrée du log brut résume
// la séance d'un coup d'œil : nom, date, durée, BPM moyen, nombre de séries et
// kg soulevés (Σ poids×reps). Là où la vue dépliée montre le détail des séries,
// le récap donne la vue d'ensemble repliée.
//
// nb séries et kg soulevés sont DÉRIVÉS des séries de l'entrée (calcul pur, testé).
// Le décompte compte les SÉRIES LOGIQUES, pas les lignes : sur un exo unilatéral
// (ADR 0005) les deux côtés G/D partagent le même `order` et ne valent qu'UNE
// série (sinon le récap doublerait le compte, illisible). Les métadonnées (nom,
// durée, BPM) sont déjà portées par l'entrée et seulement REPRISES telles quelles :
// une métrique manquante reste `null` pour que l'UI ne montre pas de récap
// trompeur (cf. AC #32). Pure, sans dépendance réseau.
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
  /**
   * Nombre total de SÉRIES LOGIQUES de la séance, tous exos confondus. Une série
   * unilatérale (deux côtés G/D au même `order`, ADR 0005) ne compte qu'une fois.
   */
  setCount: number
  /** Total Σ (poids × reps) sur toutes les séries (les deux côtés), en kg. */
  totalVolumeKg: number
}

/**
 * Dérive le récap d'une entrée du log brut : reprend ses métadonnées telles
 * quelles (jamais de valeur inventée pour une métrique `null`) et agrège ses
 * séries en nombre de séries logiques + total Σ poids×reps. Pure.
 */
export function summarizeSession(entry: RawLogEntry): SessionSummary {
  let setCount = 0
  let totalVolumeKg = 0
  for (const exercise of entry.exercises) {
    // Séries LOGIQUES, pas lignes : on compte les `order` distincts de l'exo. En
    // unilatéral, les deux côtés partagent un order et ne valent qu'une série ;
    // le total Σ poids×reps, lui, cumule bien les deux côtés (chacun une ligne).
    const orders = new Set<number>()
    for (const set of exercise.sets) {
      orders.add(set.order)
      totalVolumeKg += set.weightKg * set.reps
    }
    setCount += orders.size
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
