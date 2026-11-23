import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFields, moveRow, toggleMode, type EditorRow } from './prescription-edit'
import { hasPrescriptionChanges, requestLeave, setLeaveGuard } from './seance-dirty'

const row = (over: Partial<EditorRow> = {}): EditorRow => ({
  rowId: 'r1',
  exerciseId: 'bench',
  exerciseName: 'Développé couché',
  muscleGroup: 'pectoraux',
  primaryMuscles: ['pectoraux'],
  unilateral: false,
  ...defaultFields(),
  ...over,
})

// « Enregistrer » sans rien changer créait une version identique, donc coupait
// un bloc pour rien (ADR 0001). L'éditeur n'enregistre que ce qui a changé.
describe('hasPrescriptionChanges', () => {
  const saved = [row({ rowId: 'a', exerciseId: 'bench' }), row({ rowId: 'b', exerciseId: 'squat' })]

  it('rien touché : aucune modification', () => {
    expect(hasPrescriptionChanges(saved, saved)).toBe(false)
    // Une copie de même contenu non plus (deux versions identiques).
    expect(hasPrescriptionChanges(saved, saved.map((r) => ({ ...r })))).toBe(false)
  })

  it('une valeur prescrite changée : modifié', () => {
    const edited = [
      { ...saved[0]!, sets: { mode: 'fixe' as const, min: 4, max: 4 } },
      saved[1]!,
    ]
    expect(hasPrescriptionChanges(saved, edited)).toBe(true)
  })

  it('changée puis remise à sa valeur : plus de modification', () => {
    const back = [{ ...saved[0]!, sets: { ...saved[0]!.sets } }, saved[1]!]
    expect(hasPrescriptionChanges(saved, back)).toBe(false)
  })

  it('exo ajouté, retiré ou déplacé : modifié', () => {
    expect(hasPrescriptionChanges(saved, [...saved, row({ rowId: 'c', exerciseId: 'curl' })])).toBe(true)
    expect(hasPrescriptionChanges(saved, [saved[0]!])).toBe(true)
    expect(hasPrescriptionChanges(saved, moveRow(saved, 0, 1))).toBe(true)
  })

  it('ce qui ne s’enregistre pas ne compte pas : identité de ligne, bascule fixe/fourchette sans écart', () => {
    const renamed = [{ ...saved[0]!, rowId: 'autre' }, saved[1]!]
    expect(hasPrescriptionChanges(saved, renamed)).toBe(false)
    // RIR fixe 2 basculé en fourchette 2-2 : même prescription en base.
    const toggled = [{ ...saved[0]!, rir: toggleMode(saved[0]!.rir) }, saved[1]!]
    expect(hasPrescriptionChanges(saved, toggled)).toBe(false)
  })
})

// Garde de sortie : un écran aux modifications non enregistrées s'interpose
// avant qu'on le quitte (retour, changement d'onglet).
describe('garde de sortie', () => {
  afterEach(() => setLeaveGuard(null))

  it('sans garde, on sort tout de suite', () => {
    const proceed = vi.fn()
    requestLeave(proceed)
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('avec une garde, c’est elle qui décide de laisser sortir', () => {
    const proceed = vi.fn()
    let pending: (() => void) | null = null
    setLeaveGuard((go) => {
      pending = go
    })
    requestLeave(proceed)
    expect(proceed).not.toHaveBeenCalled()
    pending!()
    expect(proceed).toHaveBeenCalledOnce()
  })

  it('la garde retirée, on sort de nouveau tout de suite', () => {
    setLeaveGuard(() => {})
    setLeaveGuard(null)
    const proceed = vi.fn()
    requestLeave(proceed)
    expect(proceed).toHaveBeenCalledOnce()
  })
})
