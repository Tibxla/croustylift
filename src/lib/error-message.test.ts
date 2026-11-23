import { describe, expect, it } from 'vitest'
import { translateConstraintError } from './db-errors'
import { errorMessage } from './error-message'

describe('errorMessage', () => {
  it('une Error : son message', () => {
    expect(errorMessage(new Error('Cette séance a déjà été faite en salle.'))).toBe(
      'Cette séance a déjà été faite en salle.',
    )
  })

  it('un objet d’erreur PostgREST : son champ message, jamais « [object Object] »', () => {
    // Refus du trigger de la migration 0021, relancé tel quel par la couche data.
    const refus = {
      code: '23514',
      message:
        'Une routine archivée ne peut pas être la routine courante. Désarchive-la d’abord, ou définis une autre routine comme courante.',
      details: null,
      hint: null,
    }
    expect(errorMessage(refus)).toBe(refus.message)
    // Tel qu'il sort d'une écriture directe : le motif français n'est pas traduit
    // (lib/db-errors), l'objet passe intact, et l'écran lit quand même son texte.
    const sorti = translateConstraintError(refus)
    expect(sorti).toBe(refus)
    expect(errorMessage(sorti)).toBe(refus.message)
    expect((sorti as { code: string }).code).toBe('23514')
  })

  it('un refus de contrainte traduit garde son texte français', () => {
    const brut = { code: '23514', message: 'new row violates check constraint "x"' }
    expect(errorMessage(translateConstraintError(brut))).toMatch(/^Enregistrement refusé/)
  })

  it('sans message exploitable : la valeur en chaîne', () => {
    expect(errorMessage('hors ligne')).toBe('hors ligne')
    expect(errorMessage({ message: '' })).toBe('[object Object]')
    expect(errorMessage({ message: 42 })).toBe('[object Object]')
    expect(errorMessage(null)).toBe('null')
    expect(errorMessage(undefined)).toBe('undefined')
  })
})
