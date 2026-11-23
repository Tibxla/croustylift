import { describe, expect, it } from 'vitest'
import { isRecoveryUrl } from './recovery'

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
