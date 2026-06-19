import { describe, it, expect } from 'vitest'
import {
  mergeExerciseOverride,
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
