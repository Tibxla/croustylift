// Records personnels dérivés de l'historique d'un exo (issue #34).
//
// Deux records, deux mesures (cf. GLOSSARY.md « Record personnel ») :
//   - bestE1rm       : le meilleur 1RM estimé (Epley décalé, RIR compté comme des
//                      reps, cf. e1rm.ts et ADR 0013),
//                      pris sur TOUTES les séries — un record est une perf
//                      démontrée, quel que soit le rang de la série. La courbe
//                      e1RM d'analyse, elle, reste sur la 1ʳᵉ série de chaque
//                      exécution (firstSeriesWeakSet) pour la comparabilité jour à
//                      jour : le record peut donc dépasser le sommet de la courbe.
//   - bestWeightReps : le record de CHARGE — la série la plus lourde jamais
//                      faite (toutes séries confondues), les reps départageant
//                      à poids égal.
// `bestE1rmSet` porte la perf (poids × reps) derrière le meilleur e1RM : c'est
// ELLE qu'on affiche en salle (« Record : 95 × 10 · e1RM 127 »).
//
// CHARGE NULLE (ADR 0013, amendement du 2026-11-23) : un exo au poids du corps
// saisi à 0 kg a un e1RM nul quelle que soit la perf. Tant qu'aucune série de
// l'exo n'a été chargée, le record « e1RM » est donc celui des REPS EFFECTIVES
// (reps + RIR). Dès qu'une charge apparaît, l'e1RM reprend : une série chargée
// passe devant toute série à 0 kg. Une seule règle d'ordre, `comparePerformance`.
//
// Tout est DÉRIVÉ de l'historique, jamais stocké : un record se recalcule depuis
// les exécutions. Style aligné sur reference.ts (fonctions pures, ExerciseExecution[]).
import type { ExerciseExecution, PerformedSet } from './types'
import { comparePerformance, e1rmBeats, effectiveReps, estimateE1rm, isZeroLoad } from './e1rm'
import { pairSidesByOrder, weakerSide } from './unilateral'

/** Une charge réalisée : poids et reps (le couple d'un record poids×reps). */
export interface WeightReps {
  weightKg: number
  reps: number
}

/**
 * La perf qui porte le meilleur e1RM. Le RIR sert à charge nulle, où le record
 * se juge aux reps effectives ; optionnel pour tolérer un record construit sans.
 */
export interface RecordSet extends WeightReps {
  rir?: number
}

/** Les records d'un exo. `null` = aucun historique réel (premier passage). */
export interface PersonalRecord {
  /** Meilleur e1RM (toutes séries confondues), ou null si aucune perf. */
  bestE1rm: number | null
  /**
   * La perf qui porte le meilleur e1RM (poids × reps de cette série ; la ligne du
   * côté FAIBLE en unilatéral). Null exactement quand `bestE1rm` est null.
   * Quand elle est à 0 kg, aucune série de l'exo n'a été chargée et le record se
   * lit en reps effectives (`bestE1rm` vaut alors 0).
   */
  bestE1rmSet: RecordSet | null
  /** Série la plus lourde (reps en départage), ou null si aucune perf. */
  bestWeightReps: WeightReps | null
}

/** `b` est-elle une charge strictement supérieure à `a` (poids, puis reps) ? */
export function heavier(a: WeightReps, b: WeightReps): boolean {
  if (b.weightKg !== a.weightKg) return b.weightKg > a.weightKg
  return b.reps > a.reps
}

/**
 * Records d'un exo dérivés de son historique. Les exécutions vides (trous) et
 * les séries des autres exos sont ignorées. Sans aucune série réelle, les deux
 * records valent `null`.
 */
export function personalRecord(
  executions: ExerciseExecution[],
  exerciseId: string,
): PersonalRecord {
  let best: PerformedSet | null = null
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue

    // e1RM : TOUTES les séries comptent. Pour un exo UNILATÉRAL, chaque série
    // logique (paire G/D au même order) vaut son CÔTÉ FAIBLE, cohérent avec la
    // courbe primaire et l'ADR 0005 ; la perf porteuse est la ligne de ce côté.
    for (const set of seriesWeakSets(exec.sets)) {
      if (best === null || comparePerformance(set, best) > 0) best = set
    }

    // poids×reps : la charge max sur l'ensemble des séries.
    for (const s of exec.sets) {
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { ...e1rmRecordOf(best), bestWeightReps }
}

/** Les deux champs du record e1RM, depuis la série qui le porte. */
function e1rmRecordOf(
  best: PerformedSet | null,
): Pick<PersonalRecord, 'bestE1rm' | 'bestE1rmSet'> {
  if (best === null) return { bestE1rm: null, bestE1rmSet: null }
  return {
    bestE1rm: estimateE1rm(best.weightKg, best.reps, best.rir),
    bestE1rmSet: { weightKg: best.weightKg, reps: best.reps, rir: best.rir },
  }
}

/**
 * La ligne qui porte chaque série logique d'une exécution :
 *   - BILATÉRAL (séries sans `side`) : chaque ligne ;
 *   - UNILATÉRAL : une ligne par paire G/D (appariée par order), celle du CÔTÉ
 *     FAIBLE (la moindre perf des deux ; à égalité, la ligne gauche). Un côté
 *     manquant (saisie incomplète) retombe sur le côté présent.
 */
function seriesWeakSets(sets: PerformedSet[]): PerformedSet[] {
  const isUnilateral = sets.some((s) => s.side !== undefined)
  if (!isUnilateral) return sets

  const out: PerformedSet[] = []
  for (const pair of pairSidesByOrder(sets)) {
    const weak = weakerSide(pair)
    if (weak) out.push(weak)
  }
  return out
}

/** Les records d'un exo unilatéral, tenus SÉPARÉMENT par côté (ADR 0010). */
export interface PersonalRecordBySide {
  left: PersonalRecord
  right: PersonalRecord
}

/**
 * Records d'un exo unilatéral dérivés PAR CÔTÉ (ADR 0010) : en salle, chaque bras
 * est sa propre piste — son meilleur e1RM (toutes séries du côté confondues)
 * et sa charge la plus lourde. Distinct du record côté faible que l'analyse
 * conserve (`personalRecord`). Côté sans aucune série réelle -> records nuls.
 * Un exo bilatéral n'a pas à l'appeler (ses séries n'ont pas de côté).
 */
export function personalRecordBySide(
  executions: ExerciseExecution[],
  exerciseId: string,
): PersonalRecordBySide {
  return {
    left: sideRecord(executions, exerciseId, 'left'),
    right: sideRecord(executions, exerciseId, 'right'),
  }
}

/** Record d'UN côté : best e1RM + best charge, toutes séries du côté confondues. */
function sideRecord(
  executions: ExerciseExecution[],
  exerciseId: string,
  side: 'left' | 'right',
): PersonalRecord {
  let best: PerformedSet | null = null
  let bestWeightReps: WeightReps | null = null

  for (const exec of executions) {
    if (exec.exerciseId !== exerciseId || exec.sets.length === 0) continue

    for (const s of exec.sets) {
      if (s.side !== side) continue

      // e1RM : toutes les séries de CE côté comptent (même règle qu'en bilatéral).
      if (best === null || comparePerformance(s, best) > 0) best = s

      // charge : la plus lourde de CE côté.
      const candidate = { weightKg: s.weightKg, reps: s.reps }
      if (bestWeightReps === null || heavier(bestWeightReps, candidate)) {
        bestWeightReps = candidate
      }
    }
  }

  return { ...e1rmRecordOf(best), bestWeightReps }
}

/**
 * La série `set` bat-elle le record d'e1RM ? Strict : un record égalé n'est pas
 * un nouveau record, y compris par un autre couple poids/reps de même e1RM
 * (comparaison exacte, sans arrondi, cf. `e1rmBeats`). Un record vierge (null) est
 * toujours battu par une série réelle.
 *
 * Record tenu à 0 kg (aucune série chargée dans l'historique) : une série à 0 kg
 * le bat aux reps effectives, une série chargée le bat par son e1RM.
 */
export function isE1rmRecord(record: PersonalRecord, set: PerformedSet): boolean {
  if (record.bestE1rm === null) return true
  const e1rm = estimateE1rm(set.weightKg, set.reps, set.rir)
  if (e1rmBeats(e1rm, record.bestE1rm)) return true
  const holder = record.bestE1rmSet
  if (holder === null || !isZeroLoad(holder.weightKg) || !isZeroLoad(set.weightKg)) return false
  return effectiveReps(set.reps, set.rir) > effectiveReps(holder.reps, holder.rir ?? 0)
}

/** Le record d'e1RM est-il tenu à charge nulle, donc lu en reps effectives ? */
export function isRepsRecord(record: PersonalRecord): boolean {
  return record.bestE1rmSet !== null && isZeroLoad(record.bestE1rmSet.weightKg)
}

/**
 * La série `set` bat-elle le record de charge (poids×reps) ? Strict : poids
 * strictement supérieur, ou poids égal avec reps strictement supérieures. Un
 * record vierge (null) est toujours battu.
 */
export function isWeightRepsRecord(record: PersonalRecord, set: PerformedSet): boolean {
  if (record.bestWeightReps === null) return true
  return heavier(record.bestWeightReps, { weightKg: set.weightKg, reps: set.reps })
}
