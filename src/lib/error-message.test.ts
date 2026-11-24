import { describe, expect, it } from 'vitest'
import { translateConstraintError } from './db-errors'
import { isPermanentRejection } from '../features/capture/outbox'
import { errorMessage, networkErrorMessage } from './error-message'

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

// U18b : un refus de droits et une coupure réseau s'affichaient tels quels.
describe('errorMessage : refus de droits (42501)', () => {
  const rls = {
    code: '42501',
    message: 'new row violates row-level security policy for table "exercises"',
    details: null,
    hint: null,
  }

  it('refus RLS intégré : message français, sans le nom de la table', () => {
    const message = errorMessage(rls)
    expect(message).toMatch(/^Action refusée/)
    expect(message).not.toMatch(/row-level|exercises|policy/)
    expect(errorMessage({ code: '42501', message: 'permission denied for table routines' })).toBe(
      message,
    )
  })

  it('l’objet relancé garde son SQLSTATE brut : la file le lit pour la quarantaine', () => {
    errorMessage(rls)
    expect(rls.code).toBe('42501')
    expect(isPermanentRejection(rls)).toBe(true)
    // La traduction des écritures directes ne le réemballe pas non plus.
    expect(translateConstraintError(rls)).toBe(rls)
  })

  it('un motif écrit par la base sous ce code garde son texte', () => {
    const motif = { code: '42501', message: 'Cette routine appartient à un autre compte.' }
    expect(errorMessage(motif)).toBe(motif.message)
  })

  it('un refus de contrainte intégré jamais traduit en amont l’est à l’affichage', () => {
    expect(
      errorMessage({ code: '23503', message: 'update violates foreign key constraint "x_fkey"' }),
    ).toMatch(/^Enregistrement refusé/)
  })
})

describe('errorMessage : coupure réseau et délai dépassé', () => {
  const COUPURE = 'Connexion impossible. Vérifie le réseau puis réessaie.'
  const DELAI = 'Le serveur ne répond pas. Vérifie le réseau puis réessaie.'

  it('TypeError du navigateur : Chrome, Safari (iPhone), Firefox', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(COUPURE)
    expect(errorMessage(new TypeError('Load failed'))).toBe(COUPURE)
    expect(
      errorMessage(new TypeError('NetworkError when attempting to fetch resource.')),
    ).toBe(COUPURE)
  })

  it('la forme objet que postgrest-js en tire', () => {
    const objet = (message: string) => ({ message, details: 'pile…', hint: '', code: '' })
    expect(errorMessage(objet('TypeError: Failed to fetch'))).toBe(COUPURE)
    expect(errorMessage(objet('TypeError: Load failed'))).toBe(COUPURE)
    expect(
      errorMessage(objet('TimeoutError: Pas de réponse du serveur sous 20000 ms.')),
    ).toBe(DELAI)
    expect(errorMessage(objet('AbortError: The operation was aborted.'))).toBe(DELAI)
  })

  it('le délai maximal de fetch-timeout, relancé tel quel', () => {
    expect(
      errorMessage(new DOMException('Pas de réponse du serveur sous 20000 ms.', 'TimeoutError')),
    ).toBe(DELAI)
  })

  it('un message déjà écrit pour l’utilisateur passe sans être touché', () => {
    expect(networkErrorMessage('Cette séance a déjà été faite en salle.')).toBeNull()
    expect(networkErrorMessage('Ce nom est déjà pris.')).toBeNull()
    // Un texte qui cite seulement la panne, sans en être une.
    expect(networkErrorMessage('Import refusé : Failed to fetch le fichier')).toBeNull()
    // Chunk introuvable : une autre panne, reprise par pwa/update.ts.
    expect(
      networkErrorMessage('Failed to fetch dynamically imported module: https://x/assets/A-1.js'),
    ).toBeNull()
  })
})

describe('erreurs intégrées de Postgres et PostgREST', () => {
  it('22P02 et les autres codes connus : un message français, jamais le texte anglais', () => {
    const uuid = { code: '22P02', message: 'invalid input syntax for type uuid: "squat"', details: null, hint: null }
    expect(errorMessage(uuid)).toMatch(/^Le serveur a refusé une donnée mal formée/)
    expect(errorMessage({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toMatch(
      /^Élément introuvable/,
    )
  })
  it('un code inconnu : un repli français qui garde le code', () => {
    expect(errorMessage({ code: '42P01', message: 'relation "x" does not exist' })).toBe(
      'Le serveur a refusé la demande (code 42P01). Réessaie ; si l’erreur revient, signale-la.',
    )
  })
  it('un motif écrit par un trigger garde son texte', () => {
    const refus = { code: 'P0001', message: 'Cette séance a déjà été faite en salle.' }
    expect(errorMessage(refus)).toBe(refus.message)
  })
})
