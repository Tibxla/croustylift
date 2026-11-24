// Tests du cache de lecture « cache d'abord » (ADR 0012).
//
// Env node : polyfill localStorage mémoire réinitialisé avant chaque test.
// AUCUN vrai réseau : les fetchers sont des vi.fn contrôlables — on observe ce
// qui est servi (copie vs frais), ce qui est écrit, et les replis en échec.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cachedKeys,
  cachedRead,
  clearReadCache,
  invalidateReads,
  networkFirstRead,
  onReadWritten,
  setReadStamper,
  refreshRead,
  revalidateReadCache,
  seedRead,
} from './read-cache';
import { clearLocalAccount, saveLocalAccount } from './local-account';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

/** Laisse s'écouler la revalidation d'arrière-plan (microtâches + macro-tick). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  clearReadCache();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cachedRead', () => {
  it('sans marqueur local : passe en direct et ne persiste rien', async () => {
    clearLocalAccount();
    const fetcher = vi.fn(async () => 'frais');
    await expect(cachedRead('k', fetcher)).resolves.toBe('frais');
    expect(localStorage.length).toBe(0);
  });

  it('sans copie : attend le réseau et sème la copie', async () => {
    const fetcher = vi.fn(async () => ['a', 'b']);
    await expect(cachedRead('k', fetcher)).resolves.toEqual(['a', 'b']);
    // Relecture avec un fetcher qui échoue : la copie semée fait foi.
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(cachedRead('k', down)).resolves.toEqual(['a', 'b']);
  });

  it('avec copie : sert la copie immédiatement PUIS revalide en arrière-plan', async () => {
    await cachedRead('k', async () => 'v1');
    const fetcher = vi.fn(async () => 'v2');
    // La copie (v1) est servie sans attendre le réseau…
    await expect(cachedRead('k', fetcher)).resolves.toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await settle();
    // …et la revalidation a mis la copie à jour pour la prochaine lecture.
    await expect(
      cachedRead('k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('v2');
  });

  it('sans copie ni réseau : l’échec remonte à l’appelant', async () => {
    await expect(
      cachedRead('k', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
  });

  it('scope par utilisateur : la copie d’un compte n’est jamais servie à un autre', async () => {
    await cachedRead('k', async () => 'de-user-1');
    saveLocalAccount({ userId: 'user-2', email: 'lui@exemple.com' });
    const fetcher = vi.fn(async () => 'de-user-2');
    await expect(cachedRead('k', fetcher)).resolves.toBe('de-user-2');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('networkFirstRead', () => {
  it('en ligne : rend le frais (jamais la copie) et met la copie à jour', async () => {
    await cachedRead('k', async () => 'périmé');
    await expect(networkFirstRead('k', async () => 'frais')).resolves.toBe('frais');
    await settle();
    await expect(
      cachedRead('k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('frais');
  });

  it('en échec réseau : retombe sur la copie', async () => {
    await cachedRead('k', async () => 'copie');
    await expect(
      networkFirstRead('k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('copie');
  });

  it('en échec réseau SANS copie : l’échec remonte', async () => {
    await expect(
      networkFirstRead('k', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
  });

  it('borne l’attente (wifi zombie) et retombe sur la copie', async () => {
    await cachedRead('k', async () => 'copie');
    vi.useFakeTimers();
    // Un fetch qui ne répond JAMAIS (portail captif) : sans la borne, on
    // attendrait pour l'éternité — c'est le spinner infini d'avant l'ADR 0012.
    const zombie = () => new Promise<string>(() => {});
    const read = networkFirstRead('k', zombie, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(read).resolves.toBe('copie');
  });
});

describe('revalidateReadCache', () => {
  it('rejoue les lectures connues de la session et rafraîchit leurs copies', async () => {
    let value = 'v1';
    const fetcher = vi.fn(async () => value);
    await cachedRead('k', fetcher);
    value = 'v2';
    revalidateReadCache();
    await settle();
    await expect(
      cachedRead('k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('v2');
  });
});

describe('clearReadCache', () => {
  it('purge toutes les copies, tous comptes confondus, sans toucher au reste', async () => {
    await cachedRead('k', async () => 'de-user-1');
    saveLocalAccount({ userId: 'user-2', email: null });
    await cachedRead('k', async () => 'de-user-2');
    localStorage.setItem('croustylift:outbox', '[]');

    clearReadCache();

    const rest: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) rest.push(key);
    }
    expect(rest.some((k) => k.startsWith('croustylift:readcache:'))).toBe(false);
    expect(rest).toContain('croustylift:outbox');
  });
});

/** Une promesse résolue à la main, pour choisir l'ordre d'arrivée des réponses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ordre des réponses et garde de compte', () => {
  it('deux réponses arrivées dans l’ordre inverse : la plus ancienne n’écrase pas la plus récente', async () => {
    await cachedRead('k', async () => 'copie');
    const ancienne = deferred<string>();
    const recente = deferred<string>();
    // Revalidation de fond partie AVANT (ex. avant l'acquittement d'une écriture)…
    await cachedRead('k', () => ancienne.promise);
    // … puis relecture partie APRÈS, qui répond la première.
    const relecture = refreshRead('k', () => recente.promise);
    recente.resolve('récent');
    await relecture;
    ancienne.resolve('ancien');
    await settle();

    await expect(cachedRead('k', async () => 'récent')).resolves.toBe('récent');
  });

  it('une relance qui ÉCHOUE n’empêche pas la réponse tardive de la lecture précédente de semer la copie', async () => {
    // Premier démarrage, réseau lent : la lecture à froid dépasse son délai,
    // l'utilisateur relance, la relance échoue, puis la première répond.
    const lente = deferred<string>();
    const premiere = cachedRead('k', () => lente.promise);
    // « Réessayer » passe par networkFirstRead (App.tsx) : réseau d'abord, en échec.
    await networkFirstRead('k', async () => {
      throw new Error('réseau coupé');
    }).catch(() => {});
    lente.resolve('routine');
    await premiere;

    // La copie existe : hors ligne, elle est servie au lieu d'une erreur.
    await expect(
      cachedRead('k', async () => {
        throw new Error('hors ligne');
      }),
    ).resolves.toBe('routine');
  });

  it('relecture après acquittement qui ÉCHOUE : une réponse partie AVANT ne réécrit pas la copie', async () => {
    await cachedRead('k', async () => 'copie');
    const avant = deferred<string>();
    // Revalidation partie avant l'acquittement d'une suppression…
    await cachedRead('k', () => avant.promise);
    // … relecture lancée après l'acquittement, qui échoue.
    await refreshRead('k', async () => {
      throw new Error('réseau coupé');
    });
    avant.resolve('avec la séance supprimée');
    await settle();

    await expect(
      cachedRead('k', async () => {
        throw new Error('hors ligne');
      }),
    ).resolves.toBe('copie');
  });

  it('la réponse dépassée est quand même rendue à son appelant', async () => {
    const ancienne = deferred<string>();
    const lecture = cachedRead('k', () => ancienne.promise); // à froid : attend le réseau
    await refreshRead('k', async () => 'récent');
    ancienne.resolve('ancien');

    await expect(lecture).resolves.toBe('ancien');
    await expect(cachedRead('k', async () => 'récent')).resolves.toBe('récent');
  });

  it('registre de revalidation après un changement de compte SANS purge : rien ne s’écrit sous la clé de l’un ni de l’autre', async () => {
    // user-1 a lu « k » : sa revalidation est au registre. Un autre compte est
    // reconnu sans purge (l'ancien a des écritures en attente) : rejouer le
    // registre lit sous la session du nouveau, donc SES données.
    let reponse = 'données de user-1';
    await cachedRead('k', async () => reponse);
    await settle();
    saveLocalAccount({ userId: 'user-2', email: null });
    reponse = 'données de user-2';

    revalidateReadCache();
    await settle();

    expect(localStorage.getItem('croustylift:readcache:user-1:k')).toBe(
      JSON.stringify({ v: 1, value: 'données de user-1' }),
    );
    expect(localStorage.getItem('croustylift:readcache:user-2:k')).toBeNull();
  });

  it('compte changé pendant la lecture : la réponse ne s’écrit nulle part', async () => {
    const lente = deferred<string>();
    const relecture = refreshRead('k', () => lente.promise);
    saveLocalAccount({ userId: 'user-2', email: null });
    lente.resolve('données de user-1');
    await relecture;

    expect(localStorage.getItem('croustylift:readcache:user-1:k')).toBeNull();
    expect(localStorage.getItem('croustylift:readcache:user-2:k')).toBeNull();
  });

  it('refreshRead : remplace la copie ; en échec réseau la garde, sans jeter', async () => {
    await cachedRead('k', async () => 'v1');
    await refreshRead('k', async () => 'v2');
    await expect(
      refreshRead('k', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeUndefined();

    const fetcher = vi.fn(async () => 'v2');
    await expect(cachedRead('k', fetcher)).resolves.toBe('v2');
  });

  it('cachedKeys : les copies du compte courant sous un préfixe, sans l’étiquette', async () => {
    await cachedRead('exo-execs:a', async () => 1);
    await cachedRead('exo-execs:b', async () => 2);
    await cachedRead('exercises', async () => 3);
    saveLocalAccount({ userId: 'user-2', email: null });
    await cachedRead('exo-execs:c', async () => 4);

    expect(cachedKeys('exo-execs:')).toEqual(['exo-execs:c']);
    saveLocalAccount({ userId: 'user-1', email: null });
    expect(cachedKeys('exo-execs:').sort()).toEqual(['exo-execs:a', 'exo-execs:b']);
  });
});

// Une écriture faite depuis l'app (plan édité, exo renommé) rend des copies
// périmées. Elles ne sont pas jetées (hors ligne, la Capture doit s'ouvrir) mais
// marquées : la lecture suivante passe par le réseau, la copie en secours.
describe('invalidateReads', () => {
  const key = (k: string) => `croustylift:readcache:user-1:${k}`;

  it('une copie invalidée n’est plus servie d’abord : le réseau passe avant', async () => {
    await cachedRead('capture-source', async () => 'ancien plan');
    invalidateReads(['capture-source']);

    await expect(cachedRead('capture-source', async () => 'nouveau plan')).resolves.toBe(
      'nouveau plan',
    );
    // La copie est de nouveau fraîche : servie d'abord à la lecture suivante.
    await expect(
      cachedRead('capture-source', () => new Promise<string>(() => {})),
    ).resolves.toBe('nouveau plan');
  });

  it('hors ligne, la copie invalidée sert de secours (la Capture s’ouvre quand même)', async () => {
    await cachedRead('capture-source', async () => 'ancien plan');
    invalidateReads(['capture-source']);

    await expect(
      cachedRead('capture-source', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).resolves.toBe('ancien plan');
    // Toujours périmée : la lecture suivante retente le réseau.
    await expect(cachedRead('capture-source', async () => 'nouveau plan')).resolves.toBe(
      'nouveau plan',
    );
  });

  it('réseau qui pend : la copie invalidée est servie après le délai borné', async () => {
    await cachedRead('capture-source', async () => 'ancien plan');
    invalidateReads(['capture-source']);
    vi.useFakeTimers();

    const read = cachedRead('capture-source', () => new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(3000);

    await expect(read).resolves.toBe('ancien plan');
  });

  it('le marquage survit au rechargement de l’app (il est dans la copie)', async () => {
    await cachedRead('capture-source', async () => 'ancien plan');
    invalidateReads(['capture-source']);

    expect(JSON.parse(localStorage.getItem(key('capture-source')) ?? '{}')).toMatchObject({
      value: 'ancien plan',
      stale: true,
    });
  });

  it('vaut pour un préfixe : toutes les copies qui commencent par lui', async () => {
    await cachedRead('seance-template:v1:s1', async () => 'A');
    await cachedRead('seance-template:v1:s2', async () => 'B');
    await cachedRead('exo-execs:e1', async () => 'historique');
    invalidateReads(['seance-template:']);

    await expect(cachedRead('seance-template:v1:s1', async () => 'A2')).resolves.toBe('A2');
    await expect(cachedRead('seance-template:v1:s2', async () => 'B2')).resolves.toBe('B2');
    // Hors préfixe : toujours servie d'abord.
    await expect(cachedRead('exo-execs:e1', async () => 'autre')).resolves.toBe('historique');
  });

  it('une réponse partie avant l’invalidation ne remet pas la copie à neuf', async () => {
    await cachedRead('capture-source', async () => 'ancien plan');
    let answer!: (value: string) => void;
    // Revalidation de fond, encore en vol au moment de l'écriture du plan.
    void cachedRead('capture-source', () => new Promise<string>((resolve) => (answer = resolve)));
    invalidateReads(['capture-source']);
    answer('ancien plan');
    await settle();

    await expect(cachedRead('capture-source', async () => 'nouveau plan')).resolves.toBe(
      'nouveau plan',
    );
  });

  it('une première lecture encore en vol à l’invalidation ne sème pas de copie', async () => {
    let answer!: (value: string) => void;
    const first = cachedRead('exercises', () => new Promise<string>((resolve) => (answer = resolve)));
    invalidateReads(['exercises']);
    answer('ancien catalogue');
    await first;

    expect(localStorage.getItem(key('exercises'))).toBeNull();
  });

  it('n’écarte que les clés invalidées : une autre lecture en vol sème sa copie', async () => {
    let answer!: (value: string) => void;
    const note = cachedRead('exo-note:e1', () => new Promise<string>((resolve) => (answer = resolve)));
    invalidateReads(['capture-source', 'seance-template:']);
    answer('note de l’exo');
    await note;

    expect(JSON.parse(localStorage.getItem(key('exo-note:e1')) ?? '{}')).toMatchObject({
      value: 'note de l’exo',
    });
  });
});

// Valeur d'une écriture acquittée, posée dans la copie sans relecture réseau.
describe('seedRead', () => {
  it('la valeur posée est servie d’abord à la lecture suivante', async () => {
    await cachedRead('exo-note:e1', async () => 'ancienne note');
    seedRead('exo-note:e1', 'note corrigée');

    await expect(cachedRead('exo-note:e1', () => new Promise<string>(() => {}))).resolves.toBe(
      'note corrigée',
    );
  });

  it('une lecture partie avant ne remet pas l’ancienne valeur', async () => {
    await cachedRead('exo-note:e1', async () => 'ancienne note');
    let answer!: (value: string) => void;
    // Revalidation de fond partie AVANT l'écriture, qui répondra après.
    void cachedRead('exo-note:e1', () => new Promise<string>((resolve) => (answer = resolve)));
    seedRead('exo-note:e1', 'note corrigée');
    answer('ancienne note');
    await settle();

    await expect(cachedRead('exo-note:e1', () => new Promise<string>(() => {}))).resolves.toBe(
      'note corrigée',
    );
  });

  it('une lecture partie après, elle, écrit la copie', async () => {
    seedRead('exo-note:e1', 'note corrigée');
    await cachedRead('exo-note:e1', async () => 'note éditée ailleurs');
    await settle();

    await expect(cachedRead('exo-note:e1', () => new Promise<string>(() => {}))).resolves.toBe(
      'note éditée ailleurs',
    );
  });

  it('n’écrit rien sous un autre compte que celui de l’écriture', () => {
    seedRead('exo-note:e1', 'note du compte A', 'user-a');

    expect(localStorage.getItem('croustylift:readcache:user-1:exo-note:e1')).toBeNull();
  });

  it('écrit sous le compte de l’écriture quand c’est bien lui qui est reconnu', () => {
    seedRead('exo-note:e1', 'ma note', 'user-1');

    expect(localStorage.getItem('croustylift:readcache:user-1:exo-note:e1')).not.toBeNull();
  });
});

// Abonnement aux copies dont le contenu change (Référence suivie en direct).
describe('onReadWritten', () => {
  it('prévient quand une revalidation écrit une valeur différente, avec la clé sans compte', async () => {
    await cachedRead('exo-execs:e1', async () => ['a']);
    const written: string[] = [];
    const off = onReadWritten((key) => written.push(key));

    await cachedRead('exo-execs:e1', async () => ['a', 'b']);
    await settle();

    expect(written).toEqual(['exo-execs:e1']);
    off();
  });

  it('une copie réécrite à l’identique ne prévient personne', async () => {
    await cachedRead('exo-execs:e1', async () => ['a']);
    const written: string[] = [];
    const off = onReadWritten((key) => written.push(key));

    await cachedRead('exo-execs:e1', async () => ['a']);
    await settle();

    expect(written).toEqual([]);
    off();
  });

  it('relue à l’identique sous une AUTRE estampille : prévient, ce que les écritures locales y ajoutent a pu changer', async () => {
    let seq = 10;
    setReadStamper(() => seq);
    await cachedRead('exo-execs:e1', async () => ['a']);
    const written: string[] = [];
    const off = onReadWritten((key) => written.push(key));

    // Même estampille (aucune écriture locale entre les deux lectures) : rien.
    await cachedRead('exo-execs:e1', async () => ['a']);
    await settle();
    expect(written).toEqual([]);
    // Une écriture locale a été enfilée ou acquittée entre-temps.
    seq = 11;
    await cachedRead('exo-execs:e1', async () => ['a']);
    await settle();

    expect(written).toEqual(['exo-execs:e1']);
    off();
    setReadStamper(null);
  });

  it('copie réécrite par un AUTRE onglet (événement storage) : les abonnés d’ici sont prévenus', async () => {
    await cachedRead('exo-execs:e1', async () => ['a']);
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const written: string[] = [];
    const off = onReadWritten((key) => written.push(key));
    const storageEvent = (key: string | null, newValue: string | null) =>
      target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));

    storageEvent('croustylift:readcache:user-1:exo-execs:e1', '{"v":1,"value":["a"],"stamp":11}');
    // Ni une autre clé, ni la copie d'un autre compte, ni une purge.
    storageEvent('croustylift:registre', '{}');
    storageEvent('croustylift:readcache:user-2:exo-execs:e1', '{"v":1,"value":["z"]}');
    storageEvent('croustylift:readcache:user-1:exo-execs:e1', null);

    expect(written).toEqual(['exo-execs:e1']);
    off();
    storageEvent('croustylift:readcache:user-1:exo-execs:e1', '{"v":1,"value":["b"]}');
    expect(written).toEqual(['exo-execs:e1']);
    vi.unstubAllGlobals();
  });

  it('une réponse supplantée (non écrite) ne prévient pas : l’écran ne recule pas', async () => {
    await cachedRead('exo-execs:e1', async () => ['a', 'supprimée']);
    let answer!: (value: string[]) => void;
    // Revalidation partie AVANT la relecture d'après acquittement.
    void cachedRead('exo-execs:e1', () => new Promise<string[]>((resolve) => (answer = resolve)));
    const written: string[][] = [];
    const off = onReadWritten(() =>
      written.push(JSON.parse(localStorage.getItem('croustylift:readcache:user-1:exo-execs:e1')!).value),
    );
    await refreshRead('exo-execs:e1', async () => ['a']);
    answer(['a', 'supprimée']);
    await settle();

    expect(written).toEqual([['a']]);
    off();
  });

  it('une purge ou une invalidation ne sont pas des écritures', async () => {
    await cachedRead('exo-execs:e1', async () => ['a']);
    const written: string[] = [];
    const off = onReadWritten((key) => written.push(key));

    invalidateReads(['exo-execs:']);
    clearReadCache();

    expect(written).toEqual([]);
    off();
  });

  it('après désabonnement, plus de notification', async () => {
    const written: string[] = [];
    onReadWritten((key) => written.push(key))();

    await cachedRead('exo-execs:e1', async () => ['a']);

    expect(written).toEqual([]);
  });
});
