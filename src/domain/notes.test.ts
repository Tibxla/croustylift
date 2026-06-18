import { describe, it, expect } from 'vitest'
import {
  normalizeNoteBody,
  isBlankNote,
  describeNoteKind,
  type NoteKind,
} from './notes'

describe('normalizeNoteBody', () => {
  it('retire les espaces de bord sans toucher au texte interne', () => {
    expect(normalizeNoteBody('  garde les coudes serrés  ')).toBe(
      'garde les coudes serrés',
    )
  })

  it('préserve les retours à la ligne internes (une note peut être multi-lignes)', () => {
    expect(normalizeNoteBody('  ligne 1\nligne 2\n')).toBe('ligne 1\nligne 2')
  })

  it('normalise les fins de ligne Windows en \\n (saisie cross-device)', () => {
    expect(normalizeNoteBody('a\r\nb')).toBe('a\nb')
  })

  it('une saisie vide ou blanche devient la chaîne vide (rien à persister)', () => {
    expect(normalizeNoteBody('')).toBe('')
    expect(normalizeNoteBody('   ')).toBe('')
    expect(normalizeNoteBody('\n\t ')).toBe('')
  })
})

describe('isBlankNote', () => {
  it('vrai pour une note vide ou seulement blanche', () => {
    expect(isBlankNote('')).toBe(true)
    expect(isBlankNote('   ')).toBe(true)
    expect(isBlankNote('\n  \t')).toBe(true)
  })

  it('faux dès qu il y a du contenu réel', () => {
    expect(isBlankNote('prise serrée')).toBe(false)
    expect(isBlankNote('  x  ')).toBe(false)
  })
})

describe('describeNoteKind', () => {
  it('distingue les deux types de notes du modèle (cf. brainstorm §4)', () => {
    const perExercise: NoteKind = 'per-exercise'
    const dated: NoteKind = 'dated'

    expect(describeNoteKind(perExercise)).toBe('Note de l’exercice')
    expect(describeNoteKind(dated)).toBe('Note du jour')
  })
})
