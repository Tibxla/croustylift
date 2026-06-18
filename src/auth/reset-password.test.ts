import { describe, it, expect } from 'vitest'

// Logique de validation du reset — pure, sans dépendance externe.
// Ces règles doivent rester alignées avec la politique Supabase (MIN 8 chars)
// et avec les messages affichés dans ResetPasswordScreen.

const MIN_PASSWORD_LENGTH = 8

type ValidationResult =
  | { ok: true }
  | { ok: false; error: string }

function validateNewPassword(password: string, confirm: string): ValidationResult {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Le mot de passe est trop court (${MIN_PASSWORD_LENGTH} caracteres minimum).`,
    }
  }
  if (password !== confirm) {
    return { ok: false, error: 'Les deux mots de passe ne correspondent pas.' }
  }
  return { ok: true }
}

describe('validateNewPassword', () => {
  it('accepte un mot de passe valide identique dans les deux champs', () => {
    expect(validateNewPassword('motdepasse123', 'motdepasse123')).toEqual({ ok: true })
  })

  it('refuse si le mot de passe est trop court (< 8 chars)', () => {
    const result = validateNewPassword('court', 'court')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('trop court')
      expect(result.error).toContain('8')
    }
  })

  it('refuse exactement 7 caracteres', () => {
    expect(validateNewPassword('1234567', '1234567').ok).toBe(false)
  })

  it('accepte exactement 8 caracteres', () => {
    expect(validateNewPassword('12345678', '12345678')).toEqual({ ok: true })
  })

  it('refuse si les deux champs ne correspondent pas', () => {
    const result = validateNewPassword('motdepasse123', 'motdepasse456')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('ne correspondent pas')
    }
  })

  it('verifie la longueur avant la correspondance (longueur prioritaire)', () => {
    // Les deux sont differents ET trop courts — on remonte l'erreur longueur
    const result = validateNewPassword('abc', 'xyz')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('trop court')
    }
  })

  it('refuse un mot de passe vide', () => {
    expect(validateNewPassword('', '').ok).toBe(false)
  })

  it('accepte des caracteres speciaux', () => {
    const pwd = 'P@ssw0rd!'
    expect(validateNewPassword(pwd, pwd)).toEqual({ ok: true })
  })
})
