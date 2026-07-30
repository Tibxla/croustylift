import { describe, it, expect } from 'vitest'
import type { ExerciseExecution, PerformedSet, Side } from './types'
import {
  personalRecord,
  personalRecordBySide,
  isE1rmRecord,
  isWeightRepsRecord,
  type PersonalRecord,
} from './pr'

// Helpers de lisibilité des cas.
const set = (weightKg: number, reps: number, rir: number, order = 1): PerformedSet => ({
  weightKg,
  reps,
  rir,
  order,
})

// Série unilatérale : porte un `side` (les deux côtés d'une série partagent l'order).
const sideSet = (
  side: Side,
  weightKg: number,
  reps: number,
  rir: number,
  order = 1,
): PerformedSet => ({ weightKg, reps, rir, order, side })

describe('personalRecord', () => {
  it('renvoie un record nul (tout à null) sans aucun historique', () => {
    expect(personalRecord([], 'squat')).toEqual({
      bestE1rm: null,
      bestE1rmSet: null,
      bestWeightReps: null,
    })
  })

  it('renvoie un record nul si l’exo n’a que des exécutions vides (trous, pas des zéros)', () => {
    const onlyHoles: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [] },
      { date: '2026-01-17', exerciseId: 'squat', sets: [] },
    ]
    expect(personalRecord(onlyHoles, 'squat')).toEqual({
      bestE1rm: null,
      bestE1rmSet: null,
      bestWeightReps: null,
    })
  })

  it('filtre par exerciseId : ignore les séries des autres exos', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'squat', sets: [set(100, 5, 1)] },
      { date: '2026-01-10', exerciseId: 'bench', sets: [set(200, 5, 0)] },
    ]
    const pr = personalRecord(executions, 'squat')
    // 100 * (1 + (5+1)/30) = 120
    expect(pr.bestE1rm).toBeCloseTo(120, 6)
    expect(pr.bestE1rmSet).toEqual({ weightKg: 100, reps: 5 })
    expect(pr.bestWeightReps).toEqual({ weightKg: 100, reps: 5 })
  })

  it('e1RM : balaie TOUTES les séries, pas seulement la 1ʳᵉ de chaque exécution', () => {
    const executions: ExerciseExecution[] = [
      {
        // 1ʳᵉ série faible, 2ᵉ série plus forte : la 2ᵉ compte AUSSI (un record est
        // une perf démontrée, quel que soit le rang de la série — cf. CONTEXT.md).
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(100, 5, 1, 1), set(120, 5, 1, 2)],
      },
      {
        date: '2026-01-17',
        exerciseId: 'squat',
        sets: [set(105, 5, 1, 1)],
      },
    ]
    const pr = personalRecord(executions, 'squat')
    // meilleur toutes séries : 120x5@1 = 120 * (1 + 6/30) = 144 (série 2 du jour 1)
    expect(pr.bestE1rm).toBeCloseTo(144, 6)
    expect(pr.bestE1rmSet).toEqual({ weightKg: 120, reps: 5 })
  })

  it('e1RM : une série tardive all-out peut porter le record (fix du badge qui se rallumait)', () => {
    const executions: ExerciseExecution[] = [
      {
        // Série 1 : 100x6@1 = 123,33. Série 3 : 95x10@0 = 126,67 — c'est ELLE le
        // record. Avant (1ʳᵉ série seule), le badge « Record e1RM » du jour se
        // déclenchait sur la série 3 mais le record rechargé restait à 123,33 :
        // le même « record » se rebattait indéfiniment.
        date: '2026-01-10',
        exerciseId: 'bench',
        sets: [set(100, 6, 1, 1), set(97.5, 7, 0, 2), set(95, 10, 0, 3)],
      },
    ]
    const pr = personalRecord(executions, 'bench')
    expect(pr.bestE1rm).toBeCloseTo(95 * (1 + 10 / 30), 6)
    expect(pr.bestE1rmSet).toEqual({ weightKg: 95, reps: 10 })
  })

  it('e1RM unilatéral : chaque série vaut son CÔTÉ FAIBLE (pas le côté fort)', () => {
    const executions: ExerciseExecution[] = [
      {
        // Série déséquilibrée : G fort (120), D faible (96). Les deux côtés
        // partagent l'order 1. Le record e1RM doit valoir le côté faible (96),
        // pas le 1er élément du tableau (G, le côté fort) — cf. ADR 0005.
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [sideSet('left', 100, 5, 1, 1), sideSet('right', 80, 5, 1, 1)],
      },
    ]
    const pr = personalRecord(executions, 'curl')
    // côté faible : 80x5@1 = 80 * (1 + 6/30) = 96 (et NON 100x5@1 = 120)
    expect(pr.bestE1rm).toBeCloseTo(96, 6)
    // La perf porteuse est la LIGNE du côté faible.
    expect(pr.bestE1rmSet).toEqual({ weightKg: 80, reps: 5 })
  })

  it('e1RM unilatéral : insensible à l’ordre de saisie (droite saisie d’abord)', () => {
    const executions: ExerciseExecution[] = [
      {
        // Même série, mais le côté FAIBLE (D) est saisi en 1er dans le tableau :
        // le record doit rester le côté faible, l'appariement étant par order.
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [sideSet('right', 80, 5, 1, 1), sideSet('left', 100, 5, 1, 1)],
      },
    ]
    expect(personalRecord(executions, 'curl').bestE1rm).toBeCloseTo(96, 6)
  })

  it('e1RM unilatéral : toutes les séries logiques comptent, chacune à son côté faible', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [
          // 1ʳᵉ série : faible = D à 90x5@1 = 108.
          sideSet('left', 100, 5, 1, 1),
          sideSet('right', 90, 5, 1, 1),
          // 2ᵉ série plus lourde : faible = D à 110x5@1 = 132 → c'est le record.
          sideSet('left', 120, 5, 1, 2),
          sideSet('right', 110, 5, 1, 2),
        ],
      },
    ]
    const pr = personalRecord(executions, 'curl')
    expect(pr.bestE1rm).toBeCloseTo(132, 6)
    expect(pr.bestE1rmSet).toEqual({ weightKg: 110, reps: 5 })
  })

  it('e1RM unilatéral : un côté manquant (série incomplète) retombe sur le côté présent', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'curl',
        sets: [sideSet('left', 100, 5, 1, 1)],
      },
    ]
    const pr = personalRecord(executions, 'curl')
    expect(pr.bestE1rm).toBeCloseTo(120, 6)
    expect(pr.bestE1rmSet).toEqual({ weightKg: 100, reps: 5 })
  })

  it('poids×reps : balaie TOUTES les séries (pas seulement la 1ʳᵉ)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        // La charge max (130) est sur la 2ᵉ série.
        sets: [set(100, 8, 1, 1), set(130, 3, 0, 2)],
      },
    ]
    const pr = personalRecord(executions, 'squat')
    expect(pr.bestWeightReps).toEqual({ weightKg: 130, reps: 3 })
  })

  it('poids×reps : à poids égal, départage par les reps les plus hautes', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(100, 5, 1, 1), set(100, 8, 1, 2)],
      },
    ]
    expect(personalRecord(executions, 'squat').bestWeightReps).toEqual({
      weightKg: 100,
      reps: 8,
    })
  })

  it('poids×reps : le poids le plus lourd prime sur des reps plus hautes à charge moindre', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'squat',
        sets: [set(120, 3, 0, 1), set(100, 12, 1, 2)],
      },
    ]
    expect(personalRecord(executions, 'squat').bestWeightReps).toEqual({
      weightKg: 120,
      reps: 3,
    })
  })
})

describe('isE1rmRecord', () => {
  const record: PersonalRecord = {
    bestE1rm: 120, // p. ex. 100x5@1
    bestE1rmSet: { weightKg: 100, reps: 5 },
    bestWeightReps: { weightKg: 100, reps: 5 },
  }

  it('vrai quand l’e1RM de la série dépasse STRICTEMENT le record', () => {
    // 105x5@1 = 126 > 120
    expect(isE1rmRecord(record, set(105, 5, 1))).toBe(true)
  })

  it('faux à égalité : un record égalé n’est pas un nouveau record', () => {
    // 100x5@1 = 120 == 120
    expect(isE1rmRecord(record, set(100, 5, 1))).toBe(false)
  })

  it('faux quand l’e1RM est sous le record', () => {
    // 90x5@1 = 108 < 120
    expect(isE1rmRecord(record, set(90, 5, 1))).toBe(false)
  })

  it('vrai contre un record vierge (premier passage, bestE1rm null)', () => {
    const blank: PersonalRecord = { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null }
    expect(isE1rmRecord(blank, set(50, 5, 1))).toBe(true)
  })
})

describe('isWeightRepsRecord', () => {
  const record: PersonalRecord = {
    bestE1rm: 120,
    bestE1rmSet: { weightKg: 100, reps: 5 },
    bestWeightReps: { weightKg: 100, reps: 5 },
  }

  it('vrai quand le poids dépasse strictement le record (peu importe les reps)', () => {
    expect(isWeightRepsRecord(record, set(102.5, 1, 0))).toBe(true)
  })

  it('vrai à poids égal quand les reps dépassent strictement le record', () => {
    expect(isWeightRepsRecord(record, set(100, 6, 1))).toBe(true)
  })

  it('faux à poids et reps égaux : record égalé, pas battu', () => {
    expect(isWeightRepsRecord(record, set(100, 5, 1))).toBe(false)
  })

  it('faux à poids égal mais reps inférieures', () => {
    expect(isWeightRepsRecord(record, set(100, 4, 1))).toBe(false)
  })

  it('faux quand le poids est inférieur, même avec beaucoup plus de reps', () => {
    expect(isWeightRepsRecord(record, set(95, 20, 3))).toBe(false)
  })

  it('vrai contre un record vierge (premier passage, bestWeightReps null)', () => {
    const blank: PersonalRecord = { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null }
    expect(isWeightRepsRecord(blank, set(40, 10, 2))).toBe(true)
  })
})

describe('personalRecordBySide', () => {
  it('tient un record SÉPARÉ par côté (ADR 0010)', () => {
    // 2 jours. Gauche progresse, droite est plus lourde mais stagne.
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'db-press',
        sets: [sideSet('left', 20, 10, 0, 1), sideSet('right', 24, 10, 0, 1)],
      },
      {
        date: '2026-01-17',
        exerciseId: 'db-press',
        sets: [sideSet('left', 22, 10, 0, 1), sideSet('right', 24, 8, 0, 1)],
      },
    ]
    const { left, right } = personalRecordBySide(executions, 'db-press')
    // Gauche : meilleur e1RM = 22×10 (jour 2), charge max 22×10.
    expect(left.bestWeightReps).toEqual({ weightKg: 22, reps: 10 })
    expect(left.bestE1rm).toBeCloseTo(22 * (1 + 10 / 30))
    expect(left.bestE1rmSet).toEqual({ weightKg: 22, reps: 10 })
    // Droite : meilleur e1RM = 24×10 (jour 1), charge max 24×10.
    expect(right.bestWeightReps).toEqual({ weightKg: 24, reps: 10 })
    expect(right.bestE1rm).toBeCloseTo(24 * (1 + 10 / 30))
    expect(right.bestE1rmSet).toEqual({ weightKg: 24, reps: 10 })
  })

  it('le record d’un côté balaie TOUTES les séries de ce côté (pas seulement la 1ʳᵉ)', () => {
    const executions: ExerciseExecution[] = [
      {
        date: '2026-01-10',
        exerciseId: 'db-press',
        // Série 2 du gauche plus forte que sa série 1 : c'est elle le record du côté.
        sets: [
          sideSet('left', 20, 10, 0, 1),
          sideSet('right', 24, 10, 0, 1),
          sideSet('left', 24, 10, 0, 2),
          sideSet('right', 22, 8, 0, 2),
        ],
      },
    ]
    const { left } = personalRecordBySide(executions, 'db-press')
    expect(left.bestE1rm).toBeCloseTo(24 * (1 + 10 / 30))
    expect(left.bestE1rmSet).toEqual({ weightKg: 24, reps: 10 })
  })

  it('records nuls pour un côté jamais travaillé', () => {
    const executions: ExerciseExecution[] = [
      { date: '2026-01-10', exerciseId: 'db-press', sets: [sideSet('left', 20, 10, 0, 1)] },
    ]
    const { right } = personalRecordBySide(executions, 'db-press')
    expect(right).toEqual({ bestE1rm: null, bestE1rmSet: null, bestWeightReps: null })
  })
})
