// Stockage plein : quelles copies de lecture cèdent la place, et lesquelles
// jamais (relecture Codex du lot 3A : vider tout le cache empêchait de rouvrir
// la Capture hors ligne).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../lib/supabase', () => {
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'in', 'gt', 'lt', 'order', 'limit']) query[method] = () => query;
  query.maybeSingle = offline;
  query.then = (_resolve: unknown, reject: (err: unknown) => void) => reject(new TypeError('Failed to fetch'));
  return { supabase: { from: () => query } };
});

import { evictNonEssentialCopies, forgetEntrustedExercises, writeMakingRoom } from './cache-eviction';
import { loadCaptureSource, loadChosenSeance, loadExerciseRows, loadSeanceForCapture } from './data';
import { clearQueue, enqueue, readQueue, storageFailing } from './outbox';
import { capturePersistFailing, initialState, persist } from './state';
import { upperA } from './fixtures';
import { clearReadCache } from '../../lib/read-cache';
import { saveLocalAccount } from '../../lib/local-account';

class MemoryStorage {
  store = new Map<string, string>();
  /** Capacité en caractères ; au-delà, `setItem` est refusé comme un quota plein. */
  capacity = Infinity;
  private used(without: string): number {
    let n = 0;
    for (const [k, v] of this.store) if (k !== without) n += v.length;
    return n;
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    if (this.used(k) + v.length > this.capacity) throw new Error('QuotaExceededError');
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  get length(): number {
    return this.store.size;
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
}

let storage: MemoryStorage;
const put = (key: string, value: unknown) =>
  storage.setItem(`croustylift:readcache:user-1:${key}`, JSON.stringify({ v: 1, value }));
const copies = () =>
  [...storage.store.keys()]
    .filter((k) => k.startsWith('croustylift:readcache:user-1:'))
    .map((k) => k.slice('croustylift:readcache:user-1:'.length))
    .sort();

/** Un téléphone amorcé : plan, séance, historique des exos du plan, et du confort. */
function seedPhone() {
  put('routines-check', [{ id: 'r1' }]);
  put('capture-source', { kind: 'choose', seances: [{ id: 's1', name: 'Upper A' }] });
  put('seance-version:s1', 'v1');
  put('seance-version-ids:s1', ['v1']);
  put('seance-template:v1:s1', {
    id: 's1',
    name: 'Upper A',
    exercises: [{ exerciseId: 'bench', name: 'Développé couché' }],
  });
  put('exo-execs:bench', []);
  put('exo-note:bench', 'Coudes serrés');
  // Non essentiel : repères, catalogue, exos hors plan.
  put('last-exec:s1', { before: '2026-11-23', last: null });
  put('prev-notes:s1', { executionId: 'e0', notes: {} });
  put('exercises', [{ id: 'bench' }, { id: 'curl' }]);
  put('exo-execs:curl', 'x'.repeat(400));
  put('exo-note:curl', 'vieille note');
}

const ESSENTIAL = [
  'capture-source',
  'exo-execs:bench',
  'exo-note:bench',
  'routines-check',
  'seance-template:v1:s1',
  'seance-version-ids:s1',
  'seance-version:s1',
];

beforeEach(() => {
  forgetEntrustedExercises();
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage as unknown as Storage;
  clearReadCache();
  clearQueue();
  saveLocalAccount({ userId: 'user-1', email: 'toi@exemple.com' });
  seedPhone();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('evictNonEssentialCopies', () => {
  it('palier 1 : les repères et le catalogue partent, rien d’autre', () => {
    expect(evictNonEssentialCopies(1)).toBe(3);
    expect(copies()).toEqual([...ESSENTIAL, 'exo-execs:curl', 'exo-note:curl'].sort());
  });

  it('palier 1 : les copies des écrans au calme (Séances, Analyse) partent aussi', () => {
    put('vue:journal', 'x'.repeat(400));
    put('vue:routine:r1', { routines: [] });
    expect(evictNonEssentialCopies(1)).toBe(5);
    expect(copies()).not.toContain('vue:journal');
    expect(copies()).not.toContain('vue:routine:r1');
    expect(copies()).toEqual(expect.arrayContaining(ESSENTIAL));
  });

  it('palier 2 : l’historique et la note des exos hors plan partent, ceux du plan restent', () => {
    expect(evictNonEssentialCopies(2)).toBe(2);
    expect(copies()).not.toContain('exo-execs:curl');
    expect(copies()).toContain('exo-execs:bench');
    expect(copies()).toContain('exo-note:bench');
  });

  it('les deux paliers épuisés : le chemin d’ouverture est intact', () => {
    evictNonEssentialCopies(1);
    evictNonEssentialCopies(2);
    expect(copies()).toEqual(ESSENTIAL);
  });
});

// Un exo AJOUTÉ (ou remplaçant) dans la séance en cours n'est dans aucun
// template : ses copies évincées, la réouverture hors ligne l'ignorait.
describe('exos de la séance en cours', () => {
  const captureState = (over: Record<string, unknown>) =>
    storage.setItem(
      'croustylift:capture:s1:2026-11-24',
      JSON.stringify({ sessionId: 's1', date: '2026-11-24', progress: {}, ...over }),
    );

  it('exo ajouté à la disposition enregistrée : son historique et sa note restent au palier 2', () => {
    captureState({ layout: [{ kind: 'added', exerciseId: 'curl', name: 'Curl' }] });
    expect(evictNonEssentialCopies(2)).toBe(0);
    expect(copies()).toContain('exo-execs:curl');
    expect(copies()).toContain('exo-note:curl');
  });

  it('exo qui a du réalisé, ou exo ouvert, dans un état enregistré : protégés aussi', () => {
    captureState({ progress: { curl: { sets: [], setIds: [], skipped: false } } });
    expect(evictNonEssentialCopies(2)).toBe(0);
    captureState({ activeExerciseId: 'curl' });
    expect(evictNonEssentialCopies(2)).toBe(0);
  });

  it('exo en cours d’ajout, pas encore sur l’appareil : protégé par l’appelant', () => {
    // C'est l'écriture de la disposition elle-même qui déclenche l'éviction.
    expect(evictNonEssentialCopies(2, ['curl'])).toBe(0);
    // Même quand rien n'y fait et que les deux paliers passent.
    expect(writeMakingRoom(() => false, ['curl'])).toBe(false);
    expect(copies()).toContain('exo-execs:curl');
    expect(copies()).toContain('exo-note:curl');
  });

  it('stockage vraiment plein : l’état qui ajoute l’exo n’a pas pu s’écrire, la série enfilée ensuite n’évince pas ses copies', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = {
      ...initialState(upperA, '2026-11-24'),
      layout: [{ kind: 'added' as const, exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] }],
    };
    // Plus aucune place : ni l'état ni la file ne passeront, même après éviction.
    storage.capacity = 0;
    persist(state);
    expect(capturePersistFailing()).toBe(true);
    expect([...storage.store.keys()].some((k) => k.startsWith('croustylift:capture:'))).toBe(false);

    // L'outbox ne connaît pas l'état de capture : son éviction passe quand même.
    enqueue({ type: 'insertSet', id: 's1', executionId: state.executionId, exerciseId: 'curl', setOrder: 1, weightKg: 12, reps: 10, rir: 2 });
    expect(storageFailing()).toBe(true);
    expect(copies()).toContain('exo-execs:curl');
    expect(copies()).toContain('exo-note:curl');
    // Le confort, lui, est bien parti : l'éviction a eu lieu.
    expect(copies()).not.toContain('last-exec:s1');
    clearQueue();
  });

  it('un état de capture illisible ne protège rien et ne casse rien', () => {
    storage.setItem('croustylift:capture:s1:2026-11-24', '{pas du json');
    expect(evictNonEssentialCopies(2)).toBe(2);
  });

  it('sans séance en cours qui le porte, l’exo hors plan part toujours', () => {
    captureState({ layout: [{ kind: 'added', exerciseId: 'dips', name: 'Dips' }] });
    expect(evictNonEssentialCopies(2)).toBe(2);
    expect(copies()).not.toContain('exo-execs:curl');
  });

  it('`persist` d’un état qui ajoute un exo, stockage plein : ses copies survivent à l’éviction', () => {
    // Juste assez de place pour que l'état passe une fois le confort évincé.
    const state = {
      ...initialState(upperA, '2026-11-24'),
      layout: [{ kind: 'added' as const, exerciseId: 'curl', name: 'Curl', unilateral: false, primaryMuscles: [] }],
    };
    const used = [...storage.store.values()].reduce((n, v) => n + v.length, 0);
    storage.capacity = used + 10;
    persist(state);
    expect(copies()).toContain('exo-execs:curl');
    expect(copies()).toContain('exo-note:curl');
    expect(copies()).toContain('exo-execs:bench');
  });
});

describe('writeMakingRoom', () => {
  it('ne retire rien si l’écriture passe d’emblée', () => {
    expect(writeMakingRoom(() => true)).toBe(true);
    expect(copies()).toHaveLength(12);
  });

  it('s’arrête au premier palier qui suffit', () => {
    let attempts = 0;
    expect(writeMakingRoom(() => (attempts += 1) === 2)).toBe(true);
    // Le palier 2 n'a pas été entamé : l'historique hors plan est encore là.
    expect(copies()).toContain('exo-execs:curl');
  });

  it('rend faux quand rien n’y fait, sans jamais toucher au chemin d’ouverture', () => {
    expect(writeMakingRoom(() => false)).toBe(false);
    expect(copies()).toEqual(ESSENTIAL);
  });
});

describe('série loggée hors ligne, stockage plein, puis remontage de la Capture', () => {
  it('la série est persistée grâce à l’éviction, et la Capture se rouvre sans réseau', async () => {
    // Le stockage est plein à ras bord : il ne reste pas la place d'une série.
    storage.capacity = [...storage.store.values()].reduce((n, v) => n + v.length, 0) + 20;

    enqueue({
      type: 'insertSet',
      id: 'set-1',
      executionId: 'exec-1',
      exerciseId: 'bench',
      setOrder: 1,
      weightKg: 80,
      reps: 8,
      rir: 2,
    });

    expect(storageFailing()).toBe(false);
    expect(readQueue()).toHaveLength(1);
    // Aller-retour vers un autre onglet de l'app : la Capture remonte, hors ligne.
    // Avant : tout le cache avait été vidé, `loadCaptureSource` relisait le réseau
    // et l'ouverture échouait jusqu'à la reconnexion.
    const source = await loadCaptureSource();
    expect(source).toEqual({ kind: 'choose', seances: [{ id: 's1', name: 'Upper A' }] });
    const chosen = await loadChosenSeance({ id: 's1', name: 'Upper A' });
    expect(chosen.seanceVersionId).toBe('v1');
    const template = await loadSeanceForCapture(chosen.seance, chosen.seanceVersionId);
    expect(template.exercises.map((e) => e.exerciseId)).toEqual(['bench']);
    // L'historique de l'exo du plan se lit sur sa copie (vide ici), sans erreur.
    await expect(loadExerciseRows('bench')).resolves.toEqual([]);
  });

  it('même quand l’éviction ne suffit pas (repli mémoire), le chemin d’ouverture reste lisible', async () => {
    storage.capacity = 0;

    enqueue({ type: 'deleteSet', id: 'set-1' });

    expect(storageFailing()).toBe(true);
    await expect(loadCaptureSource()).resolves.toMatchObject({ kind: 'choose' });
  });
});
