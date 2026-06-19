// Tests de la logique unilatérale (issue #46) : appariement gauche/droite par
// `order` et sélection du CÔTÉ FAIBLE (e1RM le plus bas) pour la courbe primaire.
// Logique PURE, aucun Supabase.
import { describe, it, expect } from 'vitest'
import {
  pairSidesByOrder,
  weakSideE1rm,
  sidesDoneAt,
  isSetComplete,
  currentSetOrder,
  defaultSide,
  nextOrderForSide,
} from './unilateral'
import { estimateE1rm } from './e1rm'
import type { PerformedSet } from './types'

describe('pairSidesByOrder', () => {
  it('apparie gauche et droite d’un même order en une paire', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].order).toBe(1)
    expect(pairs[0].left).toMatchObject({ weightKg: 30, side: 'left' })
    expect(pairs[0].right).toMatchObject({ weightKg: 32, side: 'right' })
  })

  it('renvoie les paires triées par order, plusieurs séries appariées', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 2, side: 'right' },
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 30, reps: 9, rir: 1, order: 2, side: 'left' },
      { weightKg: 32, reps: 11, rir: 2, order: 1, side: 'right' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs.map((p) => p.order)).toEqual([1, 2])
  })

  it('tolère un côté manquant (paire incomplète) sans le fabriquer', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]

    const pairs = pairSidesByOrder(sets)

    expect(pairs).toHaveLength(1)
    expect(pairs[0].left).toMatchObject({ side: 'left' })
    expect(pairs[0].right).toBeNull()
  })

  it('renvoie [] pour une entrée vide', () => {
    expect(pairSidesByOrder([])).toEqual([])
  })
})

describe('weakSideE1rm', () => {
  it('bilatéral (aucun side) : e1RM de la 1ʳᵉ série, inchangé', () => {
    const sets: PerformedSet[] = [
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
      { weightKg: 95, reps: 6, rir: 1, order: 2 },
    ]

    expect(weakSideE1rm(sets)).toBeCloseTo(estimateE1rm(100, 5, 2))
  })

  it('unilatéral : prend le côté FAIBLE (e1RM le plus bas) de la 1ʳᵉ série', () => {
    // Gauche plus faible que droite à la 1ʳᵉ série -> c'est gauche qui compte.
    const sets: PerformedSet[] = [
      { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]

    const left = estimateE1rm(28, 10, 2)
    const right = estimateE1rm(32, 10, 2)
    expect(weakSideE1rm(sets)).toBeCloseTo(Math.min(left, right))
    expect(weakSideE1rm(sets)).toBeCloseTo(left)
  })

  it('unilatéral : le côté faible n’est pas toujours le plus léger (reps/RIR comptent)', () => {
    // Droite plus lourde mais à RIR plus haut/reps plus hautes -> e1RM peut basculer.
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 8, rir: 0, order: 1, side: 'left' },
      { weightKg: 30, reps: 12, rir: 3, order: 1, side: 'right' },
    ]

    const left = estimateE1rm(30, 8, 0)
    const right = estimateE1rm(30, 12, 3)
    // gauche (moins de reps/RIR) a l'e1RM le plus bas -> côté faible
    expect(left).toBeLessThan(right)
    expect(weakSideE1rm(sets)).toBeCloseTo(left)
  })

  it('unilatéral : ne regarde QUE la 1ʳᵉ série (order min), pas les suivantes', () => {
    const sets: PerformedSet[] = [
      // 1ʳᵉ série
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 31, reps: 10, rir: 2, order: 1, side: 'right' },
      // 2ᵉ série (plus faible) : ne doit PAS influencer le point
      { weightKg: 20, reps: 6, rir: 0, order: 2, side: 'left' },
      { weightKg: 21, reps: 6, rir: 0, order: 2, side: 'right' },
    ]

    const left1 = estimateE1rm(30, 10, 2)
    const right1 = estimateE1rm(31, 10, 2)
    expect(weakSideE1rm(sets)).toBeCloseTo(Math.min(left1, right1))
  })

  it('unilatéral incomplet (un seul côté loggé) : utilise le côté présent', () => {
    const sets: PerformedSet[] = [
      { weightKg: 28, reps: 10, rir: 2, order: 1, side: 'left' },
    ]

    expect(weakSideE1rm(sets)).toBeCloseTo(estimateE1rm(28, 10, 2))
  })

  it('bilatéral : deux séries au même order (anomalie) départagent de façon déterministe (plus petit e1RM), stable', () => {
    // Anomalie : un exo bilatéral a normalement UNE série par order. Si deux
    // existent au même order 1, le résultat ne doit pas dépendre de l'ordre du
    // tableau. On retient le plus petit e1RM (lecture « côté faible »).
    const strongFirst: PerformedSet[] = [
      { weightKg: 110, reps: 5, rir: 2, order: 1 },
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
    ]
    const weakFirst: PerformedSet[] = [
      { weightKg: 100, reps: 5, rir: 2, order: 1 },
      { weightKg: 110, reps: 5, rir: 2, order: 1 },
    ]
    const expected = estimateE1rm(100, 5, 2)
    expect(weakSideE1rm(strongFirst)).toBeCloseTo(expected)
    expect(weakSideE1rm(weakFirst)).toBeCloseTo(expected)
    // Même valeur quel que soit l'ordre d'entrée : déterministe.
    expect(weakSideE1rm(strongFirst)).toBeCloseTo(weakSideE1rm(weakFirst) as number)
  })

  it('renvoie null pour une exécution sans série', () => {
    expect(weakSideE1rm([])).toBeNull()
  })
})

// --- Appariement agnostique de l'ordre (issue #63) --------------------------
// Le logging unilatéral ne suppose plus « gauche d'abord » : l'utilisateur
// choisit le côté. Une série logique se complète quand les DEUX côtés du même
// set_order sont loggés, peu importe l'ordre de saisie.

describe('sidesDoneAt', () => {
  it('renvoie l’ensemble vide quand aucun côté n’est loggé à cet order', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]
    expect(sidesDoneAt(sets, 2)).toEqual([])
  })

  it('renvoie le seul côté loggé à cet order', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(sidesDoneAt(sets, 1)).toEqual(['right'])
  })

  it('renvoie les deux côtés quand la série est complète', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]
    expect(sidesDoneAt(sets, 1).sort()).toEqual(['left', 'right'])
  })

  it('ignore les séries d’un autre order', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'right' },
      { weightKg: 28, reps: 9, rir: 1, order: 2, side: 'right' },
    ]
    expect(sidesDoneAt(sets, 2)).toEqual(['right'])
  })
})

describe('isSetComplete', () => {
  it('vrai quand G et D du même order sont loggés', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(isSetComplete(sets, 1)).toBe(true)
  })

  it('vrai même si on a commencé par la droite (ordre de saisie indifférent)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]
    expect(isSetComplete(sets, 1)).toBe(true)
  })

  it('faux quand un seul côté est loggé', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(isSetComplete(sets, 1)).toBe(false)
  })
})

describe('currentSetOrder', () => {
  it('vaut 1 pour une exécution sans série (la 1ʳᵉ série à venir)', () => {
    expect(currentSetOrder([])).toBe(1)
  })

  it('reste sur l’order de la série EN COURS tant qu’un côté manque', () => {
    // Droite loggée à l'order 1, gauche manque -> on est toujours sur la série 1.
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(currentSetOrder(sets)).toBe(1)
  })

  it('passe à l’order suivant quand la série courante est complète', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(currentSetOrder(sets)).toBe(2)
  })

  it('suit la dernière série incomplète sur plusieurs séries', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      { weightKg: 30, reps: 9, rir: 1, order: 2, side: 'left' },
    ]
    expect(currentSetOrder(sets)).toBe(2)
  })
})

describe('defaultSide', () => {
  it('propose gauche par défaut quand aucune série n’est entamée (mais libre)', () => {
    expect(defaultSide([])).toBe('left')
  })

  it('propose le côté MANQUANT de la série en cours (droite déjà faite -> gauche)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(defaultSide(sets)).toBe('left')
  })

  it('propose le côté MANQUANT (gauche déjà faite -> droite)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]
    expect(defaultSide(sets)).toBe('right')
  })

  it('repart sur gauche après une série complète (nouvelle série, libre)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(defaultSide(sets)).toBe('left')
  })
})

describe('nextOrderForSide', () => {
  it('1ʳᵉ saisie, n’importe quel côté : ouvre l’order 1', () => {
    expect(nextOrderForSide([], 'left')).toBe(1)
    expect(nextOrderForSide([], 'right')).toBe(1)
  })

  it('on commence par la DROITE : la gauche complète la même série (même order)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    // Choisir gauche complète la série 1 entamée par la droite.
    expect(nextOrderForSide(sets, 'left')).toBe(1)
  })

  it('on commence par la GAUCHE : la droite complète la même série (même order)', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
    ]
    expect(nextOrderForSide(sets, 'right')).toBe(1)
  })

  it('re-logger le MÊME côté déjà fait ouvre une nouvelle série (pas d’écrasement)', () => {
    // Droite déjà loggée à l'order 1 ; re-choisir droite ne doit pas viser l'order 1.
    const sets: PerformedSet[] = [
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(nextOrderForSide(sets, 'right')).toBe(2)
  })

  it('série complète : le côté suivant ouvre la série suivante', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
    ]
    expect(nextOrderForSide(sets, 'left')).toBe(2)
    expect(nextOrderForSide(sets, 'right')).toBe(2)
  })

  it('multi-sets : complète la dernière série incomplète au bon order', () => {
    const sets: PerformedSet[] = [
      { weightKg: 30, reps: 10, rir: 2, order: 1, side: 'left' },
      { weightKg: 32, reps: 10, rir: 2, order: 1, side: 'right' },
      { weightKg: 30, reps: 9, rir: 1, order: 2, side: 'right' },
    ]
    // série 2 entamée par la droite ; gauche la complète à l'order 2.
    expect(nextOrderForSide(sets, 'left')).toBe(2)
    // re-droite à l'order 2 (déjà fait) ouvrirait la série 3.
    expect(nextOrderForSide(sets, 'right')).toBe(3)
  })
})
