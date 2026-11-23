import { describe, expect, it } from 'vitest'
import { isRecoveryUrl, recoveryLinkOutcome } from './recovery'

describe('isRecoveryUrl', () => {
  it('lien de récupération Supabase, jetons dans le fragment', () => {
    expect(
      isRecoveryUrl('https://app.example/#access_token=abc&refresh_token=def&expires_in=3600&type=recovery'),
    ).toBe(true)
  })

  it('variante avec le type dans la requête', () => {
    expect(isRecoveryUrl('https://app.example/?token_hash=abc&type=recovery')).toBe(true)
  })

  it("une ouverture ordinaire, une confirmation d'inscription ou ?diag=1 ne bloquent rien", () => {
    expect(isRecoveryUrl('https://app.example/')).toBe(false)
    expect(isRecoveryUrl('https://app.example/#access_token=abc&type=signup')).toBe(false)
    expect(isRecoveryUrl('https://app.example/?diag=1')).toBe(false)
    expect(isRecoveryUrl('pas une adresse')).toBe(false)
  })
})

describe('recoveryLinkOutcome', () => {
  it("tant que le client d'authentification s'initialise, on ne lève rien", () => {
    expect(recoveryLinkOutcome({ initialized: false, recoverySeen: false })).toBe('wait')
  })

  it("lien accepté (PASSWORD_RECOVERY) : l'écran de nouveau mot de passe prend le relais", () => {
    expect(recoveryLinkOutcome({ initialized: true, recoverySeen: true })).toBe('handover')
    expect(recoveryLinkOutcome({ initialized: false, recoverySeen: true })).toBe('handover')
  })

  it('lien rejeté ou expiré (initialisation finie, sans PASSWORD_RECOVERY) : blocage levé', () => {
    expect(recoveryLinkOutcome({ initialized: true, recoverySeen: false })).toBe('release')
  })
})
