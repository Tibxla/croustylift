// Comparaison de DEUX blocs d'un même exercice (cf. issue #6).
//
// But produit : « quel volume me fait le plus progresser ? ». On superpose les
// pentes de progression e1RM (%/semaine) de deux blocs et on désigne le plus
// rapide. Un bloc est une période continue de configuration de template
// inchangée (cf. ADR 0001 + `detectBlocks`).
//
// Fonction PURE : aucune lecture réseau. On RÉUTILISE le domaine déjà testé :
// `buildPrimaryCurve` (courbe e1RM de la 1ʳᵉ série) et `weeklyProgressionRate`
// (régression linéaire %/semaine). Le seul travail propre à ce module est de
// DÉCOUPER les exécutions par fenêtre de bloc avant de mesurer chaque pente.
import { buildPrimaryCurve } from './primary-curve'
import { weeklyProgressionRate } from './progression'
import type { ExerciseExecution, E1rmPoint, Block } from './types'

/** Le côté d'une comparaison à deux blocs. */
export type Side = 'first' | 'second'

/** Désignation du verdict. `null` = pas assez de données pour trancher. */
export type Winner = Side | 'tie' | null

/** L'analyse d'UN bloc dans la comparaison : sa courbe e1RM et sa pente. */
export interface BlockProgression {
  block: Block
  /** Courbe e1RM (1ʳᵉ série) des exécutions tombant dans la fenêtre du bloc. */
  curve: E1rmPoint[]
  /** Nombre de points e1RM du bloc (sert à expliquer un « pas assez de points »). */
  pointCount: number
  /** Pente %/semaine, ou `null` si pas assez de points pour ajuster une droite. */
  weeklyRate: number | null
}

/** Le résultat d'une comparaison de deux blocs pour un exo donné. */
export interface BlockComparison {
  first: BlockProgression
  second: BlockProgression
  /**
   * Le bloc à la pente la plus raide, `'tie'` si les pentes sont égales, ou
   * `null` si l'un des deux n'a pas de pente mesurable (pas de verdict trompeur).
   */
  winner: Winner
}

/** Égalité de pente sous ce seuil (en points de %/semaine) : départage indécis. */
const TIE_EPSILON = 0.05

/**
 * Garde les exécutions de cet exo dont la date tombe dans la fenêtre du bloc.
 * Fenêtre demi-ouverte `[start, end)` : `end` est le start du bloc suivant, donc
 * une exécution à cette date appartient déjà au bloc suivant. Un bloc en cours
 * (`end === null`) capte toute date depuis son start. Les dates ISO 'YYYY-MM-DD'
 * se comparent lexicographiquement.
 */
function executionsInBlock(
  executions: ExerciseExecution[],
  exerciseId: string,
  block: Block,
): ExerciseExecution[] {
  return executions.filter((execution) => {
    if (execution.exerciseId !== exerciseId) return false
    if (execution.date < block.start) return false
    if (block.end !== null && execution.date >= block.end) return false
    return true
  })
}

function progressionOf(
  executions: ExerciseExecution[],
  exerciseId: string,
  block: Block,
): BlockProgression {
  const curve = buildPrimaryCurve(
    executionsInBlock(executions, exerciseId, block),
    exerciseId,
  )
  return {
    block,
    curve,
    pointCount: curve.length,
    weeklyRate: weeklyProgressionRate(curve),
  }
}

/** Désigne le gagnant à partir des deux pentes. */
function decideWinner(
  first: number | null,
  second: number | null,
): Winner {
  // Sans deux pentes mesurables, aucun verdict (cf. issue #6 : pas trompeur).
  if (first === null || second === null) return null
  if (Math.abs(first - second) < TIE_EPSILON) return 'tie'
  return first > second ? 'first' : 'second'
}

/**
 * Calcule la progression (courbe e1RM + pente %/semaine) de CHAQUE bloc d'une
 * liste, dans l'ordre d'entrée. Sert à l'UI de sélection : lister les blocs
 * d'un exo avec leur nombre de points, pour ne proposer à la comparaison que
 * ceux qui ont de quoi tracer une pente (et étiqueter les trop maigres).
 */
export function summarizeBlocks(
  executions: ExerciseExecution[],
  exerciseId: string,
  blocks: Block[],
): BlockProgression[] {
  return blocks.map((block) => progressionOf(executions, exerciseId, block))
}

/**
 * Compare deux blocs d'un même exercice par vitesse de progression e1RM.
 * Découpe les exécutions par fenêtre de bloc, mesure la pente %/semaine de
 * chacun, puis désigne le plus rapide (ou `null` faute de données).
 */
export function compareBlocks(
  executions: ExerciseExecution[],
  exerciseId: string,
  first: Block,
  second: Block,
): BlockComparison {
  const firstProgression = progressionOf(executions, exerciseId, first)
  const secondProgression = progressionOf(executions, exerciseId, second)

  return {
    first: firstProgression,
    second: secondProgression,
    winner: decideWinner(firstProgression.weeklyRate, secondProgression.weeklyRate),
  }
}

// --- Couples bloc + séance (ADR 0016) -----------------------------------------
//
// Une option de comparaison est un bloc lu dans UNE séance. Deux routines se
// comparent ainsi (Upper A pendant Upper/Lower contre Push pendant PPL), deux
// séances d'un même bloc aussi. La règle de fatigue de l'issue #67 interdit de
// mêler deux séances dans une même pente, pas de comparer deux pentes lues
// chacune dans sa séance : on compare des vitesses, pas des niveaux.

/** Une option de comparaison : un bloc lu dans une séance. */
export interface BlockSeance {
  block: Block
  seanceId: string
}

/** La progression d'un couple bloc + séance, avec la date de son dernier point. */
export interface BlockSeanceProgression extends BlockProgression {
  seanceId: string
  /** Date ISO du dernier point : ordonne les options d'un même bloc. */
  lastDate: string
}

function executionsOfSeance(
  executions: ExerciseExecution[],
  seanceId: string,
): ExerciseExecution[] {
  return executions.filter((execution) => execution.seanceId === seanceId)
}

/**
 * Tous les couples (bloc, séance) où l'exo a au moins un point, ordonnés par
 * bloc (ordre d'entrée) puis par dernière exécution dans le bloc : la dernière
 * option est la plus récente. Les exécutions sans séance ne forment aucune
 * option, elles mêleraient des contextes de fatigue.
 */
export function summarizeBlockSeances(
  executions: ExerciseExecution[],
  exerciseId: string,
  blocks: Block[],
): BlockSeanceProgression[] {
  const seanceIds = [
    ...new Set(
      executions
        .filter((e) => e.exerciseId === exerciseId && e.seanceId !== undefined)
        .map((e) => e.seanceId as string),
    ),
  ]

  return blocks.flatMap((block) =>
    seanceIds
      .map((seanceId): BlockSeanceProgression => {
        const progression = progressionOf(
          executionsOfSeance(executions, seanceId),
          exerciseId,
          block,
        )
        return {
          ...progression,
          seanceId,
          lastDate: progression.curve[progression.curve.length - 1]?.date ?? '',
        }
      })
      .filter((option) => option.pointCount > 0)
      .sort((a, b) => a.lastDate.localeCompare(b.lastDate)),
  )
}

/** Compare deux couples bloc + séance par vitesse de progression e1RM. */
export function compareBlockSeances(
  executions: ExerciseExecution[],
  exerciseId: string,
  first: BlockSeance,
  second: BlockSeance,
): BlockComparison {
  const firstProgression = progressionOf(
    executionsOfSeance(executions, first.seanceId),
    exerciseId,
    first.block,
  )
  const secondProgression = progressionOf(
    executionsOfSeance(executions, second.seanceId),
    exerciseId,
    second.block,
  )

  return {
    first: firstProgression,
    second: secondProgression,
    winner: decideWinner(firstProgression.weeklyRate, secondProgression.weeklyRate),
  }
}

/**
 * Pré-sélection du panneau, sur des options déjà ordonnées (cf.
 * `summarizeBlockSeances`) : la plus récente, face à la plus récente d'un AUTRE
 * bloc ; faute d'autre bloc, les deux plus récentes. `null` sous deux options.
 * Rend les index `[premier, second]`, le plus ancien en premier.
 */
export function defaultComparisonPair(
  options: readonly BlockSeance[],
): [number, number] | null {
  if (options.length < 2) return null
  const second = options.length - 1
  const latestBlock = options[second]!.block
  for (let i = second - 1; i >= 0; i--) {
    if (options[i]!.block.start !== latestBlock.start) return [i, second]
  }
  return [second - 1, second]
}
