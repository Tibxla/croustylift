import { describe, it, expect, beforeEach } from 'vitest';
import {
  arrivalFromHash,
  clearPasswordSetup,
  hasPasswordProof,
  INVITATIONS_SINCE,
  invitedWithoutPassword,
  offlineStartSetupOwed,
  PASSWORD_SET_KEY,
  passwordSetupRequired,
  requirePasswordSetup,
  sessionAuthMethods,
  syncPasswordSetup,
  type SetupSession,
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

// --- Obligation tenue par le serveur --------------------------------------------

/** Un jeton d'accès de forme réelle (en-tête.charge.signature), charge en base64url. */
function jeton(claims: Record<string, unknown>): string {
  const b64 = (value: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.signature`;
}
const parLien = jeton({ sub: 'invite', amr: [{ method: 'otp', timestamp: 1 }] });
const parMotDePasse = jeton({ sub: 'invite', amr: [{ method: 'password', timestamp: 2 }] });
const APRES = new Date(INVITATIONS_SINCE + 3_600_000).toISOString();
const AVANT = new Date(INVITATIONS_SINCE - 86_400_000).toISOString();

/** La session d'un invité, telle que supabase-js la restaure. */
function invite(over: Partial<SetupSession['user']> = {}, access_token = parLien): SetupSession {
  return { access_token, user: { id: 'invite', invited_at: APRES, user_metadata: {}, ...over } };
}

/** Un stockage d'appareil ; `plein` : toute écriture est refusée. */
function appareil(plein = false) {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (plein) throw new DOMException('quota', 'QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage;
  return store;
}

describe('sessionAuthMethods', () => {
  it('lit les méthodes de la revendication amr, sous ses deux formes', () => {
    expect(sessionAuthMethods(parLien)).toEqual(['otp']);
    expect(sessionAuthMethods(parMotDePasse)).toEqual(['password']);
    expect(sessionAuthMethods(jeton({ amr: ['pwd', 'otp'] }))).toEqual(['pwd', 'otp']);
  });

  it('une charge avec des accents se lit quand même', () => {
    expect(
      sessionAuthMethods(jeton({ user_metadata: { nom: 'Zoé Müller' }, amr: [{ method: 'password' }] })),
    ).toEqual(['password']);
  });

  it('jeton illisible ou sans amr : aucune méthode, jamais une erreur', () => {
    expect(sessionAuthMethods('')).toEqual([]);
    expect(sessionAuthMethods('pas-un-jeton')).toEqual([]);
    expect(sessionAuthMethods('a.%%%.c')).toEqual([]);
    expect(sessionAuthMethods(jeton({ sub: 'x' }))).toEqual([]);
  });
});

describe('invitedWithoutPassword : ce que le serveur tient', () => {
  it('invité, session ouverte par le lien, pas de marqueur : obligation', () => {
    expect(invitedWithoutPassword(invite())).toBe(true);
  });

  it('levée par le marqueur écrit avec le mot de passe', () => {
    const session = invite({ user_metadata: { [PASSWORD_SET_KEY]: true } });
    expect(hasPasswordProof(session)).toBe(true);
    expect(invitedWithoutPassword(session)).toBe(false);
  });

  it('levée par une session ouverte par mot de passe (preuve qu’il existe)', () => {
    expect(invitedWithoutPassword(invite({}, parMotDePasse))).toBe(false);
  });

  it('jamais pour un compte qui n’est pas né d’une invitation', () => {
    expect(invitedWithoutPassword(invite({ invited_at: undefined }))).toBe(false);
    expect(invitedWithoutPassword(invite({ invited_at: null }))).toBe(false);
  });

  it('jamais pour un compte invité avant que l’app ne tienne l’obligation', () => {
    // Entré sous l'ancien régime, sans marqueur, parfois avec un mot de passe :
    // l'écran de mot de passe le sortirait de l'app à tort.
    expect(invitedWithoutPassword(invite({ invited_at: AVANT }))).toBe(false);
  });

  it('un marqueur qui n’est pas exactement vrai ne lève rien', () => {
    expect(invitedWithoutPassword(invite({ user_metadata: { [PASSWORD_SET_KEY]: 'true' } }))).toBe(
      true,
    );
  });
});

// Les trois parcours qui laissaient entrer un invité sans mot de passe tant que
// l'obligation n'était écrite que sur l'appareil.
describe('obligation de l’invité : les trois parcours', () => {
  beforeEach(() => void appareil());

  it('garde d’arrivée : retenue, rechargée, puis forcée, l’obligation est entière', () => {
    // Arrivée par le lien : évaluée AVANT la garde, qui retient la session.
    expect(syncPasswordSetup(invite(), true)).toBe(true);
    // Rechargement sous la garde : le fragment n'existe plus.
    expect(arrivalFromHash('').kind).toBeNull();
    expect(syncPasswordSetup(invite(), false)).toBe(true);
    // Forçage : relue sur la session retenue, sans ce que la garde savait.
    expect(syncPasswordSetup(invite(), false)).toBe(true);
  });

  it('garde d’arrivée, invitation d’avant la date : la copie écrite avant la garde suffit', () => {
    const ancien = invite({ invited_at: AVANT });
    expect(syncPasswordSetup(ancien, true)).toBe(true);
    expect(invitedWithoutPassword(ancien)).toBe(false);
    expect(syncPasswordSetup(ancien, false)).toBe(true);
  });

  it('stockage plein à l’arrivée : rien n’est écrit, le serveur la tient au rechargement', () => {
    const store = appareil(true);
    expect(syncPasswordSetup(invite(), true)).toBe(true);
    expect(store.size).toBe(0);
    expect(passwordSetupRequired('invite')).toBe(false);
    // Rechargement : ni fragment ni copie.
    expect(syncPasswordSetup(invite(), false)).toBe(true);
  });

  it('démarrage en session locale : la copie de l’appareil tient sans session', () => {
    expect(syncPasswordSetup(invite(), true)).toBe(true);
    // Hors ligne, session invérifiable : il n'y a que le compte reconnu à lire.
    expect(offlineStartSetupOwed({ userId: 'invite' })).toBe(true);
    // Un autre compte reconnu, ou aucun : rien ne s'impose.
    expect(offlineStartSetupOwed({ userId: 'habitue' })).toBe(false);
    expect(offlineStartSetupOwed(null)).toBe(false);
    // Retour du réseau, session revalidée, toujours sans mot de passe.
    expect(syncPasswordSetup(invite(), false)).toBe(true);
  });

  it('levée partout par l’enregistrement du mot de passe, copie comprise', () => {
    expect(syncPasswordSetup(invite(), true)).toBe(true);
    // Le marqueur revient dans la session après `updateUser({ password, data })`,
    // ici ou sur un autre appareil.
    const apres = invite({ user_metadata: { [PASSWORD_SET_KEY]: true } });
    expect(syncPasswordSetup(apres, false)).toBe(false);
    expect(passwordSetupRequired('invite')).toBe(false);
  });

  it('aucun faux positif : compte ordinaire, session par lien de récupération', () => {
    const ordinaire: SetupSession = {
      access_token: parLien,
      user: { id: 'habitue', user_metadata: {} },
    };
    expect(syncPasswordSetup(ordinaire, false)).toBe(false);
    expect(passwordSetupRequired('habitue')).toBe(false);
  });

  it('une copie périmée tombe dès qu’une session prouve le mot de passe', () => {
    requirePasswordSetup('invite');
    expect(syncPasswordSetup(invite({}, parMotDePasse), false)).toBe(false);
    expect(passwordSetupRequired('invite')).toBe(false);
  });
});
