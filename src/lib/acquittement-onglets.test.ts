// Deux onglets, deux instances des modules, UN stockage partagé (comme
// localStorage entre onglets). L'onglet B acquitte un DELETE et relit le
// Journal ; l'onglet A avait une lecture partie AVANT le DELETE, dont la
// réponse arrive avant que le message de B ne soit traité. Elle ne doit pas
// écraser la copie fraîche écrite par B : la génération d'acquittement est
// partagée dans le stockage et vérifiée juste avant d'écrire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type Tab = typeof import('./dated-read') & { cache: typeof import('./read-cache') };

/** Une instance neuve des modules : un onglet. */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const dated = await import('./dated-read');
  const cache = await import('./read-cache');
  return { ...dated, cache };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let tabs: Tab[] = [];

beforeEach(async () => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage() as unknown as Storage;
  const { saveLocalAccount } = await import('./local-account');
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
});

afterEach(() => {
  for (const tab of tabs) tab.closeAckChannel();
  tabs = [];
});

describe('acquittement entre onglets', () => {
  it('la réponse ancienne de l’onglet A, livrée avant le message de B, n’écrase pas la copie fraîche', async () => {
    const a = await openTab();
    const b = await openTab();
    tabs = [a, b];
    const journal = a.JOURNAL_VIEW;
    await a.loadDated(journal, async () => ['exec-supprimee', 'exec-gardee'], { offline: false, now: () => 1000 });

    // A relit (retour du réseau), sa lecture atteint la base avant le DELETE.
    let answer: (v: string[]) => void = () => {};
    const late = a.loadDated(journal, () => new Promise<string[]>((ok) => (answer = ok)), { offline: false, now: () => 1500 });

    // B acquitte le DELETE, puis relit et écrit la copie fraîche.
    b.viewsAcknowledged(b.REALISED_VIEWS);
    await b.loadDated(journal, async () => ['exec-gardee'], { offline: false, now: () => 2000 });
    await settle();
    expect(b.peekDated(journal)?.value).toEqual(['exec-gardee']);

    // La réponse ancienne de A arrive AVANT que A n'ait traité le message.
    answer(['exec-supprimee', 'exec-gardee']);
    await late;
    await settle();
    expect(a.peekDated(journal)?.value).toEqual(['exec-gardee']);
  });

  it('une lecture partie après l’acquittement écrit normalement', async () => {
    const a = await openTab();
    const b = await openTab();
    tabs = [a, b];
    b.viewsAcknowledged(b.REALISED_VIEWS);
    await a.loadDated(a.JOURNAL_VIEW, async () => ['exec-gardee'], { offline: false, now: () => 3000 });
    expect(b.peekDated(b.JOURNAL_VIEW)).toEqual({ at: 3000, value: ['exec-gardee'] });
  });
});

describe('isolation entre fichiers de test (src/test/broadcast-isolation.ts)', () => {
  it('un canal resté ouvert par un fichier PRÉCÉDENT (nom brut) ne reçoit pas les acquittements de ce fichier', async () => {
    const globals = globalThis as unknown as { __nativeBroadcastChannel?: typeof BroadcastChannel };
    const Native = globals.__nativeBroadcastChannel ?? BroadcastChannel;
    const a = await openTab();
    tabs = [a];
    const leftover = new Native(a.ACK_CHANNEL);
    const received = vi.fn();
    leftover.onmessage = received;
    a.mountView(a.JOURNAL_VIEW, () => {})();
    a.viewsAcknowledged(a.REALISED_VIEWS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).not.toHaveBeenCalled();
    leftover.close();
  });
});
