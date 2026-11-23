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
  networkFirstRead,
  refreshRead,
  revalidateReadCache,
  stableKeyOf,
  tolerantRead,
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

describe('tolerantRead', () => {
  it('rend le repli quand il n’y a ni copie ni réseau', async () => {
    await expect(
      tolerantRead(
        'k',
        async () => {
          throw new Error('offline');
        },
        null,
      ),
    ).resolves.toBeNull();
  });

  it('sert la copie plutôt que le repli quand elle existe', async () => {
    await tolerantRead('k', async () => 'valeur', null);
    await expect(
      tolerantRead(
        'k',
        async () => {
          throw new Error('offline');
        },
        null,
      ),
    ).resolves.toBe('valeur');
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

describe('stableKeyOf', () => {
  it('est stable et insensible à l’ordre', () => {
    expect(stableKeyOf(['a', 'b', 'c'])).toBe(stableKeyOf(['c', 'a', 'b']));
    expect(stableKeyOf(['a', 'b'])).not.toBe(stableKeyOf(['a', 'c']));
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
