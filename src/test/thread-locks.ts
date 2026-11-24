// Préparation des tests (Vitest, `setupFiles`) : un `navigator.locks` PROPRE AU
// FIL D'EXÉCUTION.
//
// Node 24 fournit `navigator.locks`, mais ses verrous sont partagés par tous les
// threads du processus. En `--pool=threads`, deux fichiers de test qui flushent
// la file en même temps se disputaient donc le verrou `croustylift:outbox:flush`
// (outbox.ts) : le perdant voyait le verrou « tenu par un autre onglet », ne
// jouait rien et rendait `flushed: 0`. Les tests de gestes échouaient au hasard
// selon le voisinage. Chaque fichier a ici son propre gestionnaire, aussi strict
// que celui du navigateur pour ce que la file en utilise : exclusif, en file
// d'attente par nom, `ifAvailable` qui rend `null` si le verrou est tenu ou
// attendu. Un fichier qui pose son propre faux (`vi.stubGlobal('navigator', …)`)
// le remplace comme avant.

type Grant = { name: string; mode: 'exclusive' | 'shared' };
type Callback = (lock: Grant | null) => unknown;
type Options = { ifAvailable?: boolean; mode?: 'exclusive' | 'shared' };

class ThreadLocks {
  private readonly queues = new Map<string, { tail: Promise<void>; count: number }>();

  async request(name: string, optionsOrCallback: Options | Callback, maybeCallback?: Callback): Promise<unknown> {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    const queue = this.queues.get(name) ?? { tail: Promise.resolve(), count: 0 };
    if (options.ifAvailable && queue.count > 0) return callback(null);
    queue.count += 1;
    this.queues.set(name, queue);
    const previous = queue.tail;
    let release!: () => void;
    queue.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await callback({ name, mode: options.mode ?? 'exclusive' });
    } finally {
      queue.count -= 1;
      if (queue.count === 0) this.queues.delete(name);
      release();
    }
  }

  async query(): Promise<{ held: Grant[]; pending: Grant[] }> {
    return { held: [], pending: [] };
  }
}

if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'locks', { value: new ThreadLocks(), configurable: true });
}
