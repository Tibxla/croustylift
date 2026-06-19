import { describe, it, expect } from 'vitest'
import {
  mergeExerciseOverride,
  diffExerciseOverride,
  isOverridden,
  type ExerciseShared,
  type ExerciseOverrideValues,
} from './exercise-override'

// Forme de base partagée par toutes les surfaces (catalogue, séance, éditeur,
// onglet) : les seuls champs qu'un override peut personnaliser.
const base: ExerciseShared = {
  name: 'Développé couché',
  unilateral: false,
  primaryMuscles: ['pectoraux'],
}

describe('mergeExerciseOverride', () => {
  it('aucun override (null) : renvoie la base inchangée', () => {
    expect(mergeExerciseOverride(base, null)).toEqual(base)
  })

  it('override vide (tous champs absents) : renvoie la base inchangée', () => {
    expect(mergeExerciseOverride(base, {})).toEqual(base)
  })

  it('override du seul nom : nom gagné, autres champs de la base', () => {
    const merged = mergeExerciseOverride(base, { name: 'DC haltères' })
    expect(merged).toEqual({
      name: 'DC haltères',
      unilateral: false,
      primaryMuscles: ['pectoraux'],
    })
  })

  it('override du seul drapeau unilatéral', () => {
    const merged = mergeExerciseOverride(base, { unilateral: true })
    expect(merged.unilateral).toBe(true)
    expect(merged.name).toBe('Développé couché')
    expect(merged.primaryMuscles).toEqual(['pectoraux'])
  })

  it('override des seuls muscles principaux', () => {
    const merged = mergeExerciseOverride(base, {
      primaryMuscles: ['pectoraux', 'avant épaule'],
    })
    expect(merged.primaryMuscles).toEqual(['pectoraux', 'avant épaule'])
    expect(merged.name).toBe('Développé couché')
  })

  it('override complet : tous les champs gagnent', () => {
    const merged = mergeExerciseOverride(base, {
      name: 'Pompes lestées',
      unilateral: true,
      primaryMuscles: ['pectoraux', 'triceps'],
    })
    expect(merged).toEqual({
      name: 'Pompes lestées',
      unilateral: true,
      primaryMuscles: ['pectoraux', 'triceps'],
    })
  })

  it('champs null de l’override : traités comme absents (base gardée)', () => {
    // La DB stocke NULL pour « pas d'override sur ce champ ».
    const override: ExerciseOverrideValues = {
      name: null,
      unilateral: null,
      primaryMuscles: null,
    }
    expect(mergeExerciseOverride(base, override)).toEqual(base)
  })

  it('nom vide ou blanc : ignoré (la base ne doit jamais perdre son nom)', () => {
    expect(mergeExerciseOverride(base, { name: '' }).name).toBe('Développé couché')
    expect(mergeExerciseOverride(base, { name: '   ' }).name).toBe(
      'Développé couché',
    )
  })

  it('liste de muscles vide : ignorée (la base garde ses muscles)', () => {
    // Un override sans muscle n'a pas de sens : on ne vide jamais la base.
    expect(mergeExerciseOverride(base, { primaryMuscles: [] }).primaryMuscles).toEqual([
      'pectoraux',
    ])
  })

  it('ne mute pas la base ni l’override', () => {
    const baseCopy: ExerciseShared = {
      name: 'Squat',
      unilateral: false,
      primaryMuscles: ['quadriceps'],
    }
    const override: ExerciseOverrideValues = { primaryMuscles: ['fessiers'] }
    mergeExerciseOverride(baseCopy, override)
    expect(baseCopy.primaryMuscles).toEqual(['quadriceps'])
    expect(override.primaryMuscles).toEqual(['fessiers'])
  })
})

describe('diffExerciseOverride', () => {
  // base partagée de référence pour le diff (mêmes valeurs que `base` ci-dessus).
  const ref: ExerciseShared = {
    name: 'Développé couché',
    unilateral: false,
    primaryMuscles: ['pectoraux'],
  }

  it('saisie identique à la base : tous les champs reviennent à null (reset)', () => {
    const diff = diffExerciseOverride(ref, { ...ref })
    expect(diff).toEqual({ name: null, unilateral: null, primaryMuscles: null })
    // Équivalent reset : aucun champ effectif -> pas une personnalisation.
    expect(isOverridden(diff)).toBe(false)
  })

  it('seul le nom diverge : nom persisté, les autres champs à null', () => {
    const diff = diffExerciseOverride(ref, { ...ref, name: 'DC haltères' })
    expect(diff).toEqual({
      name: 'DC haltères',
      unilateral: null,
      primaryMuscles: null,
    })
  })

  it('nom égal à la base (au trim près) : null (pas d override sur le nom)', () => {
    const diff = diffExerciseOverride(ref, { ...ref, name: '  Développé couché  ' })
    expect(diff.name).toBeNull()
  })

  it('seul l unilatéral diverge : drapeau persisté, le reste à null', () => {
    const diff = diffExerciseOverride(ref, { ...ref, unilateral: true })
    expect(diff).toEqual({ name: null, unilateral: true, primaryMuscles: null })
  })

  it('seuls les muscles divergent : liste persistée, le reste à null', () => {
    const diff = diffExerciseOverride(ref, {
      ...ref,
      primaryMuscles: ['pectoraux', 'triceps'],
    })
    expect(diff.primaryMuscles).toEqual(['pectoraux', 'triceps'])
    expect(diff.name).toBeNull()
    expect(diff.unilateral).toBeNull()
  })

  it('mêmes muscles dans un AUTRE ordre : considérés égaux -> null', () => {
    const base: ExerciseShared = {
      name: 'Développé couché',
      unilateral: false,
      primaryMuscles: ['pectoraux', 'triceps'],
    }
    const diff = diffExerciseOverride(base, {
      ...base,
      primaryMuscles: ['triceps', 'pectoraux'],
    })
    expect(diff.primaryMuscles).toBeNull()
  })

  it('muscles différents (ajout) : la liste saisie est persistée', () => {
    const diff = diffExerciseOverride(ref, {
      ...ref,
      primaryMuscles: ['pectoraux', 'avant épaule'],
    })
    expect(diff.primaryMuscles).toEqual(['pectoraux', 'avant épaule'])
  })

  it('plusieurs champs divergent : seuls les divergents sont persistés', () => {
    const diff = diffExerciseOverride(ref, {
      name: 'DC haltères',
      unilateral: true,
      primaryMuscles: ['pectoraux'], // identique à la base -> null
    })
    expect(diff).toEqual({
      name: 'DC haltères',
      unilateral: true,
      primaryMuscles: null,
    })
  })

  it('symétrie : merge(base, diff(base, input)) redonne input (normalisé)', () => {
    const input: ExerciseShared = {
      name: 'DC haltères',
      unilateral: true,
      primaryMuscles: ['pectoraux', 'avant épaule'],
    }
    const diff = diffExerciseOverride(ref, input)
    expect(mergeExerciseOverride(ref, diff)).toEqual(input)
  })

  it('symétrie sur un override partiel : la lecture redonne les champs personnalisés et garde la base ailleurs', () => {
    const input: ExerciseShared = {
      name: 'Développé couché', // = base -> non personnalisé
      unilateral: true, // diverge
      primaryMuscles: ['pectoraux'], // = base -> non personnalisé
    }
    const diff = diffExerciseOverride(ref, input)
    // Seul l'unilatéral est stocké ; à la lecture, nom et muscles suivent la base
    // (donc une correction ultérieure du catalogue de base resterait visible).
    expect(mergeExerciseOverride(ref, diff)).toEqual(input)
  })

  it('ne mute ni la base ni la saisie', () => {
    const base: ExerciseShared = {
      name: 'Squat',
      unilateral: false,
      primaryMuscles: ['quadriceps'],
    }
    const input: ExerciseShared = {
      name: 'Squat',
      unilateral: false,
      primaryMuscles: ['fessiers'],
    }
    diffExerciseOverride(base, input)
    expect(base.primaryMuscles).toEqual(['quadriceps'])
    expect(input.primaryMuscles).toEqual(['fessiers'])
  })
})

describe('isOverridden', () => {
  it('null ou override vide : pas personnalisé', () => {
    expect(isOverridden(null)).toBe(false)
    expect(isOverridden({})).toBe(false)
    expect(isOverridden({ name: null, unilateral: null, primaryMuscles: null })).toBe(
      false,
    )
  })

  it('un nom non vide : personnalisé', () => {
    expect(isOverridden({ name: 'X' })).toBe(true)
  })

  it('nom blanc seul : pas personnalisé (rien d’effectif)', () => {
    expect(isOverridden({ name: '  ' })).toBe(false)
  })

  it('drapeau unilatéral posé : personnalisé', () => {
    expect(isOverridden({ unilateral: true })).toBe(true)
    expect(isOverridden({ unilateral: false })).toBe(true)
  })

  it('muscles non vides : personnalisé ; liste vide : non', () => {
    expect(isOverridden({ primaryMuscles: ['biceps'] })).toBe(true)
    expect(isOverridden({ primaryMuscles: [] })).toBe(false)
  })
})
