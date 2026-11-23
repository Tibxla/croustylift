import { describe, it, expect } from 'vitest';
import { arrivalFromHash } from './arrival-link';

describe('arrivalFromHash', () => {
  it("reconnaît un lien d'invitation", () => {
    expect(arrivalFromHash('#access_token=abc&refresh_token=def&type=invite')).toEqual({
      kind: 'invite',
      failed: false,
    });
  });

  it('reconnaît un lien de récupération', () => {
    expect(arrivalFromHash('#access_token=abc&type=recovery')).toEqual({
      kind: 'recovery',
      failed: false,
    });
  });

  it("une URL sans fragment, ou d'un autre type, ne demande rien", () => {
    expect(arrivalFromHash('')).toEqual({ kind: null, failed: false });
    expect(arrivalFromHash('#access_token=abc&type=magiclink')).toEqual({
      kind: null,
      failed: false,
    });
  });

  it('un lien expiré est signalé et ne demande pas de mot de passe', () => {
    expect(
      arrivalFromHash(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid&type=invite',
      ),
    ).toEqual({ kind: null, failed: true });
  });
});
