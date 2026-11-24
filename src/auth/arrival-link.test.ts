import { describe, it, expect, beforeEach } from 'vitest';
import {
  arrivalFromHash,
  clearPasswordSetup,
  definePassword,
  hasPasswordProof,
  INVITATIONS_SINCE,
  invitedWithoutPassword,
  offlineStartSetupOwed,
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
  return { access_token, user: { id: 'invite', invited_at: APRES, ...over } };
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

  it('un marqueur écrit par le client dans user_metadata ne lève RIEN', () => {
    // Le titulaire d'une session invitée peut écrire ses métadonnées sans définir
    // de mot de passe (relecture du second tour) : ce n'est pas une preuve.
    const session = invite({ user_metadata: { password_set: true } } as never);
    expect(hasPasswordProof(session)).toBe(false);
    expect(invitedWithoutPassword(session)).toBe(true);
    expect(syncPasswordSetup(session, false)).toBe(true);
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
    // `definePassword` ouvre une session avec le mot de passe : elle porte la preuve.
    const apres = invite({}, parMotDePasse);
    expect(syncPasswordSetup(apres, false)).toBe(false);
    expect(passwordSetupRequired('invite')).toBe(false);
  });

  it('aucun faux positif : compte ordinaire, session par lien de récupération', () => {
    const ordinaire: SetupSession = {
      access_token: parLien,
      user: { id: 'habitue' },
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

describe('definePassword : enregistrer, puis prouver par une connexion', () => {
  const MEME = { code: 'same_password', message: 'New password should be different from the old password.' };
  function auth(over: { update?: unknown; signIn?: unknown } = {}) {
    const calls: string[] = [];
    return {
      calls,
      updateUser: async (attributes: { password: string }) => {
        calls.push(`update:${Object.keys(attributes).join(',')}`);
        return { error: over.update ?? null };
      },
      signInWithPassword: async (c: { email: string; password: string }) => {
        calls.push(`signIn:${c.email}:${c.password}`);
        return { error: over.signIn ?? null };
      },
    };
  }

  const INVITE = { email: 'invite@example.com' };

  it('invité : enregistre le mot de passe seul, puis ouvre une session avec lui', async () => {
    const a = auth();
    await definePassword(a, 'un-mot-de-passe', INVITE);
    expect(a.calls).toEqual(['update:password', 'signIn:invite@example.com:un-mot-de-passe']);
  });

  it('invité : enregistrement refusé, pas de connexion, l’erreur remonte', async () => {
    const refus = { code: 'weak_password', message: 'Password should be at least 10 characters.' };
    const a = auth({ update: refus });
    await expect(definePassword(a, 'court', INVITE)).rejects.toBe(refus);
    expect(a.calls).toEqual(['update:password']);
  });

  it('invité : coupure entre les deux étapes, l’erreur remonte et l’obligation reste', async () => {
    const coupure = new TypeError('Failed to fetch');
    const a = auth({ signIn: coupure });
    await expect(definePassword(a, 'un-mot-de-passe', INVITE)).rejects.toBe(coupure);
    expect(a.calls).toEqual(['update:password', 'signIn:invite@example.com:un-mot-de-passe']);
  });

  it('invité : nouvelle tentative après cette coupure, « même mot de passe » est franchi', async () => {
    const a = auth({ update: MEME });
    await definePassword(a, 'un-mot-de-passe', INVITE);
    expect(a.calls).toEqual(['update:password', 'signIn:invite@example.com:un-mot-de-passe']);
  });

  it('invité sans adresse : rien ne peut être prouvé, erreur', async () => {
    await expect(definePassword(auth(), 'un-mot-de-passe', { email: null })).rejects.toThrow(
      /adresse/,
    );
  });

  // Relecture du second tour : la récupération ordinaire dépendait d'une seconde
  // connexion. Mot de passe changé, connexion en échec : l'écran affichait un
  // échec et restait en récupération.
  it('récupération : terminée dès l’enregistrement, aucune connexion n’est tentée', async () => {
    // Une connexion qui échouerait : elle n'a pas lieu, l'écran sort quand même.
    const a = auth({ signIn: new TypeError('Failed to fetch') });
    await expect(definePassword(a, 'un-mot-de-passe', null)).resolves.toBeUndefined();
    expect(a.calls).toEqual(['update:password']);
  });

  it('récupération : « même mot de passe » reste un refus', async () => {
    const a = auth({ update: MEME });
    await expect(definePassword(a, 'un-mot-de-passe', null)).rejects.toBe(MEME);
    expect(a.calls).toEqual(['update:password']);
  });

  it('récupération : tout autre refus du serveur remonte', async () => {
    const coupure = new TypeError('Failed to fetch');
    await expect(definePassword(auth({ update: coupure }), 'x', null)).rejects.toBe(coupure);
  });
});
