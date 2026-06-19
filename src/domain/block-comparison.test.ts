import { describe, it, expect } from 'vitest'
import type { ExerciseExecution, Block } from './types'
import { compareBlocks, summarizeBlocks } from './block-comparison'

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
