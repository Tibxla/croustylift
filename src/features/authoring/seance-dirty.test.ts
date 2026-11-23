import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFields, moveRow, toggleMode, type EditorRow } from './prescription-edit'
import {
  editingResumed,
  hasNoteDraftChanges,
  hasPrescriptionChanges,
  hasUnsavedEdits,
  leavePrompt,
  noteDraftExerciseIds,
  requestLeave,
  SAVE_BUSY,
  SAVE_DONE,
  SAVE_IDLE,
  saveControl,
  saveFailed,
  setLeaveGuard,
  type SaveStatus,
} from './seance-dirty'

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

// La note d'instructions se sauve à part, sans nouvelle version. Son brouillon
// vivait dans le champ : le modifier seul, puis changer d'onglet, le perdait
// sans confirmation, et une mise à jour en attente rechargeait par-dessus.
describe('hasNoteDraftChanges', () => {
  const saved = { bench: 'Coudes rentrés.' }
  const inSeance = ['bench', 'squat']

  it('aucun champ touché : rien à perdre', () => {
    expect(hasNoteDraftChanges(saved, {}, inSeance)).toBe(false)
  })

  it('une note modifiée et pas encore enregistrée : brouillon', () => {
    expect(hasNoteDraftChanges(saved, { bench: 'Coudes rentrés, prise serrée.' }, inSeance)).toBe(true)
  })

  it('une première note tapée sur un exo qui n’en avait pas : brouillon', () => {
    expect(hasNoteDraftChanges(saved, { squat: 'Talons au sol.' }, inSeance)).toBe(true)
  })

  it('une note vidée sans enregistrer : brouillon (elle serait effacée)', () => {
    expect(hasNoteDraftChanges(saved, { bench: '' }, inSeance)).toBe(true)
  })

  it('texte remis à l’identique, ou enregistré depuis : plus de brouillon', () => {
    expect(hasNoteDraftChanges(saved, { bench: 'Coudes rentrés.' }, inSeance)).toBe(false)
    expect(hasNoteDraftChanges(saved, { squat: '' }, inSeance)).toBe(false)
    // Après « Enregistrer la note » : la note enregistrée rejoint le brouillon.
    const afterSave = { ...saved, squat: 'Talons au sol.' }
    expect(hasNoteDraftChanges(afterSave, { squat: 'Talons au sol.' }, inSeance)).toBe(false)
  })

  it('le brouillon d’un exo retiré de la séance ne compte plus', () => {
    expect(hasNoteDraftChanges(saved, { squat: 'Talons au sol.' }, ['bench'])).toBe(false)
  })
})

describe('hasUnsavedEdits (garde de sortie et blocage de rechargement)', () => {
  const saved = [row({ rowId: 'a', exerciseId: 'bench' }), row({ rowId: 'b', exerciseId: 'squat' })]
  const clean = { savedRows: saved, rows: saved, savedNotes: {}, noteDrafts: {} }

  it('rien touché : on sort sans demander', () => {
    expect(hasUnsavedEdits(clean)).toBe(false)
  })

  it('SEULE une note est modifiée : la sortie est gardée, sans que la séance soit « modifiée »', () => {
    const editor = { ...clean, noteDrafts: { bench: 'Prise serrée.' } }
    expect(hasUnsavedEdits(editor)).toBe(true)
    // « Enregistrer » ne s'allume pas : pas de version identique de la séance.
    expect(hasPrescriptionChanges(editor.savedRows, editor.rows)).toBe(false)
  })

  it('prescriptions modifiées, notes intactes : gardée aussi', () => {
    const rows = [{ ...saved[0]!, sets: { mode: 'fixe' as const, min: 5, max: 5 } }, saved[1]!]
    expect(hasUnsavedEdits({ ...clean, rows })).toBe(true)
  })

  it('prescriptions enregistrées mais brouillon de note restant : toujours gardée', () => {
    const rows = [{ ...saved[0]!, sets: { mode: 'fixe' as const, min: 5, max: 5 } }, saved[1]!]
    const afterSave = { savedRows: rows, rows, savedNotes: {}, noteDrafts: { squat: 'Talons au sol.' } }
    expect(hasUnsavedEdits(afterSave)).toBe(true)
  })

  it('la note enregistrée à son tour : plus rien à garder', () => {
    expect(
      hasUnsavedEdits({ ...clean, savedNotes: { bench: 'Prise serrée.' }, noteDrafts: { bench: 'Prise serrée.' } }),
    ).toBe(false)
  })

  it('l’exo dont la note est en brouillon est retiré : seule la prescription compte', () => {
    const rows = [saved[0]!]
    const editor = { savedRows: rows, rows, savedNotes: {}, noteDrafts: { squat: 'Talons au sol.' } }
    expect(hasUnsavedEdits(editor)).toBe(false)
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

// U48 : prescriptions enregistrées avec une note encore en brouillon, la garde
// de sortie retient le retour différé. « Continuer l'édition » laissait
// « Séance enregistrée. » à la place du bouton, pour toujours.
describe('bouton « Enregistrer » après un enregistrement réussi', () => {
  const v1 = [row({ rowId: 'a', exerciseId: 'bench' })]
  const v2 = [{ ...v1[0]!, sets: { mode: 'fixe' as const, min: 4, max: 4 } }]
  const v3 = [{ ...v1[0]!, sets: { mode: 'fixe' as const, min: 5, max: 5 } }]
  const noteDrafts = { bench: 'Prise serrée' }

  it('le bandeau ne tient que tant que rien n’a bougé depuis', () => {
    expect(saveControl(SAVE_IDLE, false)).toBe('button')
    expect(saveControl(SAVE_BUSY, true)).toBe('button')
    expect(saveControl(saveFailed('refus'), true)).toBe('button')
    expect(saveControl(SAVE_DONE, false)).toBe('saved')
    // Modifié de nouveau pendant que le bandeau est affiché : le bouton revient.
    expect(saveControl(SAVE_DONE, true)).toBe('button')
  })

  it('« Continuer l’édition » rend le bouton, et une seconde sauvegarde passe', () => {
    // L'écran tel que l'éditeur le tient : lignes enregistrées, lignes en cours,
    // état de l'enregistrement.
    let savedRows = v1
    let rows = v2
    let save: SaveStatus = SAVE_IDLE
    const dirty = () => hasPrescriptionChanges(savedRows, rows)
    const unsaved = () => hasUnsavedEdits({ savedRows, rows, savedNotes: {}, noteDrafts })

    // Premier enregistrement, avec la note de l'exo encore en brouillon.
    expect(saveControl(save, dirty())).toBe('button')
    save = SAVE_BUSY
    expect(save.busy).toBe(true)
    savedRows = rows
    save = SAVE_DONE
    expect(saveControl(save, dirty())).toBe('saved')
    // Le retour différé passe par la garde : la note retient la sortie.
    expect(unsaved()).toBe(true)

    // « Continuer l'édition » : l'éditeur reste monté, le bouton revient.
    save = editingResumed(save)
    expect(saveControl(save, dirty())).toBe('button')
    expect(dirty()).toBe(false) // rien à enregistrer pour l'instant : bouton inactif

    // Nouvelle modification : enregistrable, puis enregistrée une seconde fois.
    rows = v3
    expect(dirty()).toBe(true)
    expect(saveControl(save, dirty())).toBe('button')
    save = SAVE_BUSY
    expect(save.busy).toBe(true)
    savedRows = rows
    save = SAVE_DONE
    expect(saveControl(save, dirty())).toBe('saved')
  })

  it('même sans « Continuer », des prescriptions remodifiées ramènent le bouton', () => {
    expect(saveControl(SAVE_DONE, hasPrescriptionChanges(v2, v3))).toBe('button')
  })

  it('reprendre l’édition ne touche pas un état qui n’est pas « enregistré »', () => {
    const failed = saveFailed('refus')
    expect(editingResumed(failed)).toBe(failed)
    expect(editingResumed(SAVE_IDLE)).toBe(SAVE_IDLE)
    expect(editingResumed(SAVE_DONE)).toEqual(SAVE_IDLE)
  })
})

describe('confirmation de sortie', () => {
  it('prescriptions modifiées : la séance n’est pas enregistrée', () => {
    const prompt = leavePrompt({ prescriptions: true, noteDraftNames: ['Développé couché'] })
    expect(prompt.title).toBe('Quitter sans enregistrer ?')
    expect(prompt.detail).toMatch(/modifications de cette séance/)
  })

  it('note seule (juste après un enregistrement réussi) : c’est la NOTE qui ne l’est pas', () => {
    const prompt = leavePrompt({ prescriptions: false, noteDraftNames: ['Développé couché'] })
    expect(prompt.title).toBe('Quitter sans enregistrer la note ?')
    expect(prompt.detail).toContain('Les prescriptions sont enregistrées.')
    expect(prompt.detail).toContain('« Développé couché »')
    expect(prompt.label).toBe('Note non enregistrée')
  })

  it('plusieurs notes : leur nombre', () => {
    const prompt = leavePrompt({ prescriptions: false, noteDraftNames: ['Squat', 'Curl'] })
    expect(prompt.title).toBe('Quitter sans enregistrer les notes ?')
    expect(prompt.detail).toContain('2 exercices')
  })

  it('les exos au brouillon de note : sans doublon, ceux de la séance seulement', () => {
    const drafts = { bench: 'Prise serrée', squat: '', retire: 'x' }
    expect(noteDraftExerciseIds({ squat: '' }, drafts, ['bench', 'squat', 'bench'])).toEqual(['bench'])
  })
})
