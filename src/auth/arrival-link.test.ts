import { describe, it, expect, beforeEach } from 'vitest';
import {
  arrivalFromHash,
  clearPasswordSetup,
  passwordSetupRequired,
  requirePasswordSetup,
} from './arrival-link';

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

// Recharger l'écran d'invitation avant d'avoir défini son mot de passe ne doit
// pas faire entrer sans mot de passe (relecture Codex du lot 3A).
describe('obligation de définir son mot de passe', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
  });

  it('posée à l’arrivée par invitation, elle survit au rechargement de la page', () => {
    requirePasswordSetup('user-invite');
    // Rechargement : plus de fragment dans l'URL, seule la session est restaurée.
    expect(arrivalFromHash('').kind).toBeNull();
    expect(passwordSetupRequired('user-invite')).toBe(true);
  });

  it('elle n’est levée qu’après l’enregistrement du mot de passe', () => {
    requirePasswordSetup('user-invite');
    clearPasswordSetup('user-invite');
    expect(passwordSetupRequired('user-invite')).toBe(false);
  });

  it('elle est propre à un compte', () => {
    requirePasswordSetup('user-invite');
    expect(passwordSetupRequired('autre-compte')).toBe(false);
  });
});
