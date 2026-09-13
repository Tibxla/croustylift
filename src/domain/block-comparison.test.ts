import { describe, it, expect } from 'vitest'
import type { ExerciseExecution, Block } from './types'
import {
  compareBlocks,
  compareBlockSeances,
  defaultComparisonPair,
  summarizeBlocks,
  summarizeBlockSeances,
} from './block-comparison'

// Helpers : fabrique des exécutions d'un exo avec une 1ʳᵉ série au poids voulu.
// `compareBlocks` dérive sa pente de la courbe primaire (1ʳᵉ série), exactement
// comme l'analyse mono-bloc : reps/rir fixés, seul le poids bouge dans le temps.
const EXO = 'dev-couche'

function exec(date: string, weightKg: number): ExerciseExecution {
  return {
    date,
    exerciseId: EXO,
    sets: [{ weightKg, reps: 5, rir: 2, order: 1 }],
  }
}

function block(configId: string, start: string, end: string | null): Block {
  return { configId, start, end }
}

describe('compareBlocks', () => {
  it('attribue à chaque bloc sa pente %/semaine et désigne le plus rapide', () => {
    // Bloc A (janvier) : progression douce. Bloc B (février) : progression raide.
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 101),
      exec('2026-01-15', 102),
      exec('2026-02-01', 100),
      exec('2026-02-08', 104),
      exec('2026-02-15', 108),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.block).toBe(blockA)
    expect(result.second.block).toBe(blockB)
    expect(result.first.weeklyRate).not.toBeNull()
    expect(result.second.weeklyRate).not.toBeNull()
    expect(result.second.weeklyRate!).toBeGreaterThan(result.first.weeklyRate!)
    // Le gagnant est le bloc à la pente la plus raide (ici B).
    expect(result.winner).toBe('second')
  })

  it('attribue les exécutions au bloc dont la fenêtre [start, end) couvre la date', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-01-15', 104),
      exec('2026-02-01', 200), // appartient à B (date == son start, exclue de A)
      exec('2026-02-08', 201),
      exec('2026-02-15', 202),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    // A n'a que ses 3 points de janvier ; le point du 1er février tombe dans B.
    expect(result.first.pointCount).toBe(3)
    expect(result.second.pointCount).toBe(3)
  })

  it('un bloc en cours (end null) capte toutes les dates depuis son start', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-02-01', 100),
      exec('2026-02-08', 102),
      exec('2026-02-15', 104),
      exec('2026-03-01', 106),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.pointCount).toBe(0)
    expect(result.second.pointCount).toBe(4)
  })

  it('ignore les exécutions d\'un autre exercice', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-01-15', 104),
      { date: '2026-01-08', exerciseId: 'autre-exo', sets: [{ weightKg: 999, reps: 5, rir: 2, order: 1 }] },
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.pointCount).toBe(3)
  })

  it('renvoie une pente null et aucun gagnant quand un bloc manque de points', () => {
    // Bloc A bien pourvu, bloc B avec un seul point (< minPoints).
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-01-15', 104),
      exec('2026-02-01', 110),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.weeklyRate).not.toBeNull()
    expect(result.second.weeklyRate).toBeNull()
    // Pas de verdict trompeur : sans deux pentes, pas de gagnant.
    expect(result.winner).toBeNull()
  })

  it('aucun gagnant quand les deux blocs manquent de points', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-02-01', 110),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.weeklyRate).toBeNull()
    expect(result.second.weeklyRate).toBeNull()
    expect(result.winner).toBeNull()
  })

  it('signale une égalité (tie) quand les deux pentes sont identiques', () => {
    // Deux blocs à progression strictement identique : aucun n'est plus rapide.
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-01-15', 104),
      exec('2026-02-01', 100),
      exec('2026-02-08', 102),
      exec('2026-02-15', 104),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.weeklyRate).toBeCloseTo(result.second.weeklyRate!, 10)
    expect(result.winner).toBe('tie')
  })

  it('expose la courbe e1RM de chaque bloc (pour la superposition)', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-02-01', 100),
      exec('2026-02-08', 110),
    ]
    const blockA = block('A', '2026-01-01', '2026-02-01')
    const blockB = block('B', '2026-02-01', null)

    const result = compareBlocks(executions, EXO, blockA, blockB)

    expect(result.first.curve).toHaveLength(2)
    expect(result.second.curve).toHaveLength(2)
    expect(result.first.curve[0]!.date).toBe('2026-01-01')
    expect(result.first.curve.every((p) => typeof p.e1rm === 'number')).toBe(true)
  })
})

describe('summarizeBlocks', () => {
  it('renvoie une progression par bloc, dans l\'ordre d\'entrée', () => {
    const executions: ExerciseExecution[] = [
      exec('2026-01-01', 100),
      exec('2026-01-08', 102),
      exec('2026-01-15', 104),
      exec('2026-02-01', 100),
      exec('2026-02-08', 110),
      exec('2026-02-15', 120),
    ]
    const blocks: Block[] = [
      block('A', '2026-01-01', '2026-02-01'),
      block('B', '2026-02-01', null),
    ]

    const summaries = summarizeBlocks(executions, EXO, blocks)

    expect(summaries).toHaveLength(2)
    expect(summaries[0]!.block).toBe(blocks[0])
    expect(summaries[1]!.block).toBe(blocks[1])
    expect(summaries[0]!.pointCount).toBe(3)
    expect(summaries[1]!.pointCount).toBe(3)
    expect(summaries[0]!.weeklyRate).not.toBeNull()
  })

  it('marque pointCount 0 pour un bloc sans exécution de cet exo', () => {
    const executions: ExerciseExecution[] = [exec('2026-02-08', 100)]
    const blocks: Block[] = [
      block('A', '2026-01-01', '2026-02-01'), // aucune exécution dedans
      block('B', '2026-02-01', null),
    ]

    const summaries = summarizeBlocks(executions, EXO, blocks)

    expect(summaries[0]!.pointCount).toBe(0)
    expect(summaries[0]!.weeklyRate).toBeNull()
    expect(summaries[1]!.pointCount).toBe(1)
  })

  it('renvoie [] pour une liste de blocs vide', () => {
    expect(summarizeBlocks([exec('2026-01-01', 100)], EXO, [])).toEqual([])
  })
})

// --- Couples bloc + séance (ADR 0016) ----------------------------------------
//
// Chaque option de comparaison est un bloc lu dans UNE séance : deux routines se
// comparent, deux séances d'un même bloc aussi, jamais deux séances mêlées dans
// une même pente.

function execIn(seanceId: string | undefined, date: string, weightKg: number): ExerciseExecution {
  return { ...exec(date, weightKg), seanceId }
}

describe('summarizeBlockSeances', () => {
  const upperLower = block('ul', '2026-01-01', '2026-02-01')
  const ppl = block('ppl', '2026-02-01', null)

  it('rend un couple par (bloc, séance) où l’exo a au moins un point', () => {
    const executions = [
      execIn('upper-a', '2026-01-02', 100),
      execIn('upper-b', '2026-01-04', 90),
      execIn('upper-a', '2026-01-09', 101),
      execIn('push', '2026-02-03', 102),
    ]
    const options = summarizeBlockSeances(executions, EXO, [upperLower, ppl])
    expect(options.map((o) => [o.block.configId, o.seanceId, o.pointCount])).toEqual([
      ['ul', 'upper-b', 1],
      ['ul', 'upper-a', 2],
      ['ppl', 'push', 1],
    ])
  })

  it('ordonne par bloc, puis par dernière exécution dans le bloc : la dernière option est la plus récente', () => {
    const executions = [
      execIn('upper-a', '2026-01-02', 100),
      execIn('upper-b', '2026-01-20', 90),
    ]
    const options = summarizeBlockSeances(executions, EXO, [upperLower, ppl])
    expect(options.map((o) => o.seanceId)).toEqual(['upper-a', 'upper-b'])
    expect(options.map((o) => o.lastDate)).toEqual(['2026-01-02', '2026-01-20'])
  })

  it('une séance présente dans deux blocs donne deux options distinctes', () => {
    const executions = [execIn('push', '2026-01-05', 100), execIn('push', '2026-02-05', 105)]
    const options = summarizeBlockSeances(executions, EXO, [upperLower, ppl])
    expect(options.map((o) => o.block.configId)).toEqual(['ul', 'ppl'])
  })

  it('les exécutions sans séance ne forment aucune option (elles mêleraient des contextes)', () => {
    const executions = [execIn(undefined, '2026-01-05', 100)]
    expect(summarizeBlockSeances(executions, EXO, [upperLower, ppl])).toEqual([])
  })

  it('les pentes se calculent sur la seule séance du couple', () => {
    const executions = [
      execIn('upper-a', '2026-01-01', 100),
      execIn('upper-b', '2026-01-02', 60),
      execIn('upper-a', '2026-01-08', 102),
      execIn('upper-b', '2026-01-09', 60),
      execIn('upper-a', '2026-01-15', 104),
      execIn('upper-b', '2026-01-16', 60),
    ]
    const options = summarizeBlockSeances(executions, EXO, [upperLower])
    const a = options.find((o) => o.seanceId === 'upper-a')
    const b = options.find((o) => o.seanceId === 'upper-b')
    expect(a?.weeklyRate).toBeGreaterThan(0)
    expect(b?.weeklyRate).toBe(0)
  })
})

describe('compareBlockSeances', () => {
  const upperLower = block('ul', '2026-01-01', '2026-02-01')
  const ppl = block('ppl', '2026-02-01', null)
  const executions = [
    // Upper A en janvier : +1 kg/semaine. Upper B, même bloc : plat, plus bas.
    execIn('upper-a', '2026-01-01', 100),
    execIn('upper-a', '2026-01-08', 101),
    execIn('upper-a', '2026-01-15', 102),
    execIn('upper-b', '2026-01-03', 80),
    execIn('upper-b', '2026-01-10', 80),
    execIn('upper-b', '2026-01-17', 80),
    // Push en février : +4 kg/semaine.
    execIn('push', '2026-02-01', 100),
    execIn('push', '2026-02-08', 104),
    execIn('push', '2026-02-15', 108),
  ]

  it('compare deux routines, chaque bloc lu dans sa séance', () => {
    const result = compareBlockSeances(
      executions,
      EXO,
      { block: upperLower, seanceId: 'upper-a' },
      { block: ppl, seanceId: 'push' },
    )
    expect(result.first.pointCount).toBe(3)
    expect(result.second.pointCount).toBe(3)
    expect(result.winner).toBe('second')
  })

  it('compare deux séances d’un même bloc sans les mêler', () => {
    const result = compareBlockSeances(
      executions,
      EXO,
      { block: upperLower, seanceId: 'upper-a' },
      { block: upperLower, seanceId: 'upper-b' },
    )
    expect(result.first.curve.every((p) => p.e1rm > 100)).toBe(true)
    expect(result.second.weeklyRate).toBe(0)
    expect(result.winner).toBe('first')
  })
})

describe('defaultComparisonPair', () => {
  const b1 = block('b1', '2026-01-01', '2026-02-01')
  const b2 = block('b2', '2026-02-01', null)
  const opt = (b: Block, seanceId: string) => ({ block: b, seanceId })

  it('la plus récente, face à la plus récente d’un autre bloc', () => {
    const options = [opt(b1, 'upper-a'), opt(b1, 'upper-b'), opt(b2, 'push'), opt(b2, 'pull')]
    expect(defaultComparisonPair(options)).toEqual([1, 3])
  })

  it('tout dans un même bloc : les deux plus récentes', () => {
    const options = [opt(b1, 'upper-a'), opt(b1, 'upper-b'), opt(b1, 'full')]
    expect(defaultComparisonPair(options)).toEqual([1, 2])
  })

  it('moins de deux options : rien à pré-sélectionner', () => {
    expect(defaultComparisonPair([opt(b1, 'upper-a')])).toBeNull()
    expect(defaultComparisonPair([])).toBeNull()
  })
})
