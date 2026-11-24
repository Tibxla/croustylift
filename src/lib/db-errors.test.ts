import { describe, expect, it } from 'vitest'
import { constraintErrorMessage, translateConstraintError } from './db-errors'

/** La forme d'une erreur relancée par PostgREST. */
const pg = (code: string, message: string) => ({ code, message, details: null, hint: null })

describe('constraintErrorMessage', () => {
  it('clé étrangère (23503) : message français, sans le nom de la contrainte', () => {
    const message = constraintErrorMessage(
      pg(
        '23503',
        'insert or update on table "prescriptions" violates foreign key constraint "prescriptions_exercise_id_fkey"',
      ),
    )
    expect(message).toMatch(/^Enregistrement refusé/)
    expect(message).toMatch(/supprimé entre-temps|utilisé ailleurs/)
    expect(message).not.toMatch(/fkey|violates/)
  })

  it('contrainte check (23514) : message français, sans le nom de la contrainte', () => {
    const message = constraintErrorMessage(
      pg('23514', 'new row for relation "exercises" violates check constraint "exercises_name_taille_check"'),
    )
    expect(message).toMatch(/limites acceptées/)
    expect(message).not.toMatch(/check constraint|violates/)
  })

  it('un refus de TRIGGER sous le même code garde son message, déjà en français', () => {
    // Migrations 0021, 0020 et 0019b : `raise exception ... using errcode`.
    const archive = pg(
      '23514',
      'La routine courante ne s’archive pas. Définis d’abord une autre routine comme courante.',
    )
    expect(constraintErrorMessage(archive)).toBeNull()
    expect(translateConstraintError(archive)).toBe(archive)
    const lien = pg('23503', 'L’exercice 42 n’est ni un exo de base ni un exo de ce compte.')
    expect(constraintErrorMessage(lien)).toBeNull()
    expect(translateConstraintError(lien)).toBe(lien)
  })

  it('suppression d’une ligne encore référencée (23503) : traduite aussi', () => {
    expect(
      constraintErrorMessage(
        pg(
          '23503',
          'update or delete on table "exercises" violates foreign key constraint "prescriptions_exercise_id_fkey" on table "prescriptions"',
        ),
      ),
    ).toMatch(/utilisé ailleurs/)
  })

  it('toute autre erreur : null (unicité, RLS, réseau, erreur déjà traduite, valeur quelconque)', () => {
    expect(constraintErrorMessage(pg('23505', 'duplicate key'))).toBeNull()
    expect(constraintErrorMessage(pg('42501', 'permission denied'))).toBeNull()
    expect(constraintErrorMessage(new TypeError('Failed to fetch'))).toBeNull()
    expect(constraintErrorMessage(new Error('Cette séance a déjà été faite en salle'))).toBeNull()
    expect(constraintErrorMessage({ code: 23503, message: 'violates foreign key constraint' })).toBeNull()
    expect(constraintErrorMessage({ code: '23503' })).toBeNull()
    expect(constraintErrorMessage(null)).toBeNull()
    expect(constraintErrorMessage('23503')).toBeNull()
  })
})

describe('translateConstraintError', () => {
  it('rend une Error lisible et garde l’erreur d’origine en cause', () => {
    const original = pg('23514', 'violates check constraint "x"')
    const translated = translateConstraintError(original)
    expect(translated).toBeInstanceOf(Error)
    expect((translated as Error).message).toBe(constraintErrorMessage(original))
    expect((translated as Error).cause).toBe(original)
  })

  it('laisse passer toute autre erreur telle quelle (même objet)', () => {
    const network = new TypeError('Failed to fetch')
    expect(translateConstraintError(network)).toBe(network)
    const unique = pg('23505', 'duplicate key')
    expect(translateConstraintError(unique)).toBe(unique)
  })

  it('une erreur déjà traduite par l’écriture ne repasse pas en message générique', () => {
    const specific = new Error('La routine courante ne se supprime pas.')
    expect(translateConstraintError(specific)).toBe(specific)
  })
})
