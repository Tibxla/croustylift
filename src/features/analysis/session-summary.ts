// Le RÉCAP d'une séance du journal (cf. issue #32, brainstorm-intent.md §4
// « journal de séances enrichi »). L'en-tête de chaque entrée du log brut résume
// la séance d'un coup d'œil : nom, date, durée, BPM moyen, décompte de séries et
// kg soulevés (Σ poids×reps). Là où la vue dépliée montre le détail des séries,
// le récap donne la vue d'ensemble repliée.
//
// Séries et kg soulevés sont DÉRIVÉS des séries de l'entrée (calcul pur, testé).
// Le nombre de séries est le DÉCOMPTE DE SÉRIES du glossaire (ADR 0006), par la
// même fonction que la fin de séance (`countPerformedSets`) : pondéré par les
// reps, une série unilatérale comptant ses deux côtés. Le Journal et la Clôture
// affichent donc le même nombre pour la même séance (décision du 2026-11-23).
// Les métadonnées (nom, durée, BPM) sont déjà portées par l'entrée et seulement
// REPRISES telles quelles : une métrique manquante reste `null` pour que l'UI ne
// montre pas de récap trompeur (cf. AC #32). Pure, sans dépendance réseau.
import { countPerformedSets } from '../../domain/set-count'
import { liftedKg } from '../../domain/lifted'
import type { RawLogEntry } from './raw-log'

/** Le récap d'une séance : ses métadonnées + les agrégats de ses séries. */
export interface SessionSummary {
  /** Nom de la séance jouée (`null` si exécution hors-template). */
  sessionName: string | null
  /** Nom de sa routine (`null` si hors-template). */
  routineName: string | null
  /** Date ISO 'YYYY-MM-DD'. */
  date: string
  /** Durée en minutes (`null` si non renseignée). */
  durationMin: number | null
  /** BPM moyen saisi (`null` si non renseigné). */
  bpmAvg: number | null
  /**
   * Décompte de séries de la séance, tous exos confondus (ADR 0006) : chaque
   * série vaut `min(reps, 5) / 5`, une série unilatérale compte ses deux côtés
   * (2 quand elle est pleine). FRACTIONNAIRE : à afficher avec une décimale.
   */
  setCount: number
  /** kg soulevés : Σ (poids × reps) sur toutes les séries (les deux côtés). */
  totalLiftedKg: number
}

/**
 * Dérive le récap d'une entrée du log brut : reprend ses métadonnées telles
 * quelles (jamais de valeur inventée pour une métrique `null`) et agrège ses
 * séries en décompte de séries + kg soulevés. Pure.
 */
export function summarizeSession(entry: RawLogEntry): SessionSummary {
  // Les kg soulevés cumulent les deux côtés (chacun une ligne) : même calcul que
  // la fin de séance (`liftedKg`, domain/lifted.ts).
  const totalLiftedKg = liftedKg(entry.exercises.flatMap((exercise) => exercise.sets))

  // Même fonction que la Clôture. Le journal ne connaît pas le drapeau
  // unilatéral de l'exo : il se lit sur les lignes (un côté = exo unilatéral).
  // Le total ne dépend pas des muscles, laissés vides.
  const setCount = countPerformedSets(
    entry.exercises.map((exercise) => ({
      unilateral: exercise.sets.some((set) => set.side !== undefined),
      primaryMuscles: [],
      sets: exercise.sets,
    })),
  ).total

  return {
    sessionName: entry.sessionName,
    routineName: entry.routineName,
    date: entry.date,
    durationMin: entry.durationMin,
    bpmAvg: entry.bpmAvg,
    setCount,
    totalLiftedKg,
  }
}
