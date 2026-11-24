// L'identité d'une note datée est son couple (exécution, exercice), pas son id.
//
// Une note écrite par un ancien client porte un id aléatoire ; le client actuel
// calcule un id déterministe pour le même couple. Écrire sous cet id sans
// regarder créait une seconde ligne (avant la migration 0018) ou était refusé
// par son index unique (après : 23505, saisie en quarantaine). Les deux états
// du schéma sont rejoués ici sur une table en mémoire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface NoteRow {
  id: string;
  execution_id: string;
  exercise_id: string;
  body: string;
  created_at: number;
}

const server = vi.hoisted(() => ({
  rows: [] as NoteRow[],
  /** L'index unique de la migration 0018 est-il posé ? */
  uniqueCouple: false,
  clock: 0,
  /** Appelé après chaque LECTURE du couple (pour simuler un autre appareil). */
  afterRead: null as (() => void) | null,
  /** Erreur forcée de la prochaine écriture. */
  writeError: null as { code: string; message: string } | null,
}));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table !== 'dated_notes') throw new Error(`table inattendue dans ce test : ${table}`);
    return {
      select: () => {
        const filters: [keyof NoteRow, unknown][] = [];
        const query = {
          eq: (column: keyof NoteRow, value: unknown) => (filters.push([column, value]), query),
          order: () => query,
          limit: () => query,
          maybeSingle: () => {
            const found = server.rows
              .filter((row) => filters.every(([column, value]) => row[column] === value))
              .sort((a, b) => b.created_at - a.created_at)[0];
            const result = { data: found ? { id: found.id, body: found.body } : null, error: null };
            server.afterRead?.();
            return Promise.resolve(result);
          },
        };
        return query;
      },
      upsert: (row: Omit<NoteRow, 'created_at'>) => {
        if (server.writeError) {
          const error = server.writeError;
          server.writeError = null;
          return Promise.resolve({ error });
        }
        const same = server.rows.find((r) => r.id === row.id);
        const couple = server.rows.find(
          (r) => r.id !== row.id && r.execution_id === row.execution_id && r.exercise_id === row.exercise_id,
        );
        if (server.uniqueCouple && couple) {
          return Promise.resolve({
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "dated_notes_execution_exercise_unique"',
            },
          });
        }
        if (same) Object.assign(same, row);
        else server.rows.push({ ...row, created_at: ++server.clock });
        return Promise.resolve({ error: null });
      },
      delete: () => {
        const filters: [keyof NoteRow, unknown][] = [];
        const query = {
          eq: (column: keyof NoteRow, value: unknown) => (filters.push([column, value]), query),
          select: () => {
            const hit = (row: NoteRow) => filters.every(([column, value]) => row[column] === value);
            const touched = server.rows.filter(hit);
            server.rows = server.rows.filter((row) => !hit(row));
            return Promise.resolve({ data: touched.map((row) => ({ id: row.id })), error: null });
          },
        };
        return query;
      },
    };
  };
  return { supabase: { from } };
});

import { adoptLegacyOps, clearQueue, flush, listRefused, readQueue } from '../capture/outbox';
import { REGISTRY_KEY, storedWrites } from '../../test/registry';
import { syncFns } from '../capture/sync';
import { datedNoteId } from './dated-note-id';
import {
  datedNoteOutboxOp,
  deleteDatedNoteByCouple,
  deleteDatedNoteById,
  upsertDatedNote,
} from './data';

const EXEC = '11111111-1111-4111-8111-111111111111';
const EXO = '22222222-2222-4222-8222-222222222222';
/** Id aléatoire d'une note écrite par l'ancien client. */
const HISTORIQUE = '99999999-9999-4999-8999-999999999999';
const DETERMINISTE = datedNoteId(EXEC, EXO);

const historique = (body = 'ancienne note'): NoteRow => ({
  id: HISTORIQUE,
  execution_id: EXEC,
  exercise_id: EXO,
  body,
  created_at: ++server.clock,
});
const write = (body: string) =>
  upsertDatedNote({ id: DETERMINISTE, executionId: EXEC, exerciseId: EXO, body });

beforeEach(() => {
  server.rows = [];
  server.uniqueCouple = false;
  server.clock = 0;
  server.afterRead = null;
  server.writeError = null;
});

describe.each([
  { etat: 'avant la migration 0018 (pas d’index unique)', uniqueCouple: false },
  { etat: 'après la migration 0018 (index unique sur le couple)', uniqueCouple: true },
])('note datée, $etat', ({ uniqueCouple }) => {
  beforeEach(() => {
    server.uniqueCouple = uniqueCouple;
  });

  it('aucune note pour le couple : créée sous l’id déterministe', async () => {
    await write('première');
    expect(server.rows).toMatchObject([{ id: DETERMINISTE, body: 'première' }]);
  });

  it('note à id historique : réécrite sur SA ligne, jamais de seconde ligne ni de refus', async () => {
    server.rows = [historique()];
    await write('modifiée');
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0]).toMatchObject({ id: HISTORIQUE, body: 'modifiée' });
  });

  it('modifier, vider, réécrire une note historique : une seule ligne au bout', async () => {
    server.rows = [historique()];
    await write('modifiée');
    expect(await deleteDatedNoteByCouple(EXEC, EXO)).toBe(1);
    expect(server.rows).toEqual([]);
    await write('réécrite');
    expect(server.rows).toMatchObject([{ id: DETERMINISTE, body: 'réécrite' }]);
    await write('réécrite encore');
    expect(server.rows).toHaveLength(1);
  });

  it('effacer vise le couple : la note à id historique part', async () => {
    server.rows = [historique()];
    const op = datedNoteOutboxOp({ id: DETERMINISTE, executionId: EXEC, exerciseId: EXO, body: '  ' });
    expect(op).toEqual({ type: 'deleteDatedNote', id: DETERMINISTE, executionId: EXEC, exerciseId: EXO });
    expect(await deleteDatedNoteByCouple(EXEC, EXO)).toBe(1);
    expect(server.rows).toEqual([]);
    // Déjà absente : toujours un succès.
    expect(await deleteDatedNoteByCouple(EXEC, EXO)).toBe(0);
  });

  it('la note d’un autre exo ou d’une autre exécution n’est pas touchée', async () => {
    const autreExo = { ...historique('autre exo'), id: 'autre-exo', exercise_id: 'exo-b' };
    const autreExec = { ...historique('autre séance'), id: 'autre-exec', execution_id: 'exec-b' };
    server.rows = [autreExo, autreExec];
    await write('la mienne');
    expect(server.rows).toHaveLength(3);
    await deleteDatedNoteByCouple(EXEC, EXO);
    expect(server.rows.map((r) => r.id).sort()).toEqual(['autre-exec', 'autre-exo']);
  });

  it('une erreur qui n’est pas un conflit d’unicité remonte telle quelle', async () => {
    const refus = { code: '23503', message: 'violates foreign key constraint' };
    server.writeError = refus;
    await expect(write('x')).rejects.toBe(refus);
  });
});

describe('note datée, cas propres à un état du schéma', () => {
  it('avant 0018, doublons déjà en base : la plus récente est réécrite (celle que l’app affiche)', async () => {
    const ancienne = { ...historique('la plus ancienne'), id: 'doublon-ancien' };
    const recente = { ...historique('la plus récente'), id: 'doublon-recent' };
    server.rows = [ancienne, recente];
    await write('modifiée');
    expect(server.rows).toHaveLength(2);
    expect(server.rows.find((r) => r.id === 'doublon-recent')?.body).toBe('modifiée');
    // L'effacement, lui, emporte tout le couple.
    expect(await deleteDatedNoteByCouple(EXEC, EXO)).toBe(2);
  });

  it('après 0018, course : un autre appareil crée la note entre la lecture et l’écriture', async () => {
    server.uniqueCouple = true;
    let once = true;
    server.afterRead = () => {
      if (!once) return;
      once = false;
      server.rows.push(historique('écrite ailleurs à l’instant'));
    };
    await write('la mienne');
    // 23505 sur l'id déterministe, puis réécriture sur la ligne de l'autre appareil.
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0]).toMatchObject({ id: HISTORIQUE, body: 'la mienne' });
  });

  it('après 0018, un 23505 que la relecture n’explique pas remonte (rien à réécrire)', async () => {
    server.uniqueCouple = true;
    const refus = { code: '23505', message: 'duplicate key value' };
    server.writeError = refus;
    await expect(write('x')).rejects.toBe(refus);
    expect(server.rows).toEqual([]);
  });

  it('op d’effacement d’un bundle antérieur (id seul) : efface encore par id', async () => {
    server.rows = [historique()];
    expect(await deleteDatedNoteById(HISTORIQUE)).toBe(1);
    expect(server.rows).toEqual([]);
  });
});

// Une file enfilée par un bundle antérieur : l'effacement ne porte que l'id de la
// note. Rejouée telle quelle, l'écriture atterrissait sur la ligne du couple (id
// historique) et l'effacement, resté sur l'autre id, ne touchait rien.
describe('rejeu d’une file héritée : écriture puis effacement de la même note', () => {
  class MemoryStorage {
    private store = new Map<string, string>();
    getItem(k: string): string | null {
      return this.store.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
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

  /** Id sous lequel l'ancien client a enfilé ses deux ops (aléatoire ou déterministe). */
  const EN_FILE = '77777777-7777-4777-8777-777777777777';
  const legacyQueue = (ops: Record<string, unknown>[]) =>
    localStorage.setItem('croustylift:outbox', JSON.stringify(ops));
  const legacyWrite = { type: 'upsertDatedNote', id: EN_FILE, executionId: EXEC, exerciseId: EXO, body: 'saisie puis effacée', _seq: 1 };
  const legacyDelete = { type: 'deleteDatedNote', id: EN_FILE, _seq: 2 };

  // Le verrou d'ambiance de Node, gardé pour jouer un détenteur extérieur.
  const ambientLocks = navigator.locks;

  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new MemoryStorage() as unknown as Storage;
    clearQueue();
    // Ce bloc vérifie le rejeu, pas le verrou entre onglets (outbox-onglets.test.ts,
    // outbox.test.ts) : sans l'API, la passe tourne sans verrou (`underFlushLock`),
    // et rien hors du test ne peut la bloquer.
    vi.stubGlobal('navigator', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { etat: 'avant 0018', uniqueCouple: false },
    { etat: 'après 0018', uniqueCouple: true },
  ])('$etat : la note sous id historique est bien effacée, rien ne reste en file', async ({ uniqueCouple }) => {
    server.uniqueCouple = uniqueCouple;
    server.rows = [historique('texte d’avant')];
    legacyQueue([legacyWrite, legacyDelete]);

    adoptLegacyOps();
    // L'effacement hérité a reçu le couple de l'écriture, et c'est persisté.
    expect(readQueue()[1]).toMatchObject({ type: 'deleteDatedNote', id: EN_FILE, executionId: EXEC, exerciseId: EXO });
    expect(storedWrites()[1]?.op).toMatchObject({ executionId: EXEC, exerciseId: EXO });
    // L'ancienne file a quitté l'appareil : le registre fait foi.
    expect(localStorage.getItem('croustylift:outbox')).toBeNull();

    const result = await flush(syncFns);
    expect(result.remaining).toBe(0);
    expect(server.rows).toEqual([]);
    expect(listRefused()).toEqual([]);
  });

  it('stockage plein au démarrage : le complément, qui ne peut pas s’écrire, tient en mémoire et part quand même', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    server.rows = [historique('texte d’avant')];
    // Ops d'un bundle qui posait déjà `_uid` : le complément garde cette identité.
    legacyQueue([
      { ...legacyWrite, _uid: 'uid-ecriture' },
      { ...legacyDelete, _uid: 'uid-effacement' },
    ]);
    const before = localStorage.getItem('croustylift:outbox');
    // Le stockage refuse toute écriture du registre : la conversion ne peut pas s'écrire.
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    adoptLegacyOps();
    // L'ancienne file reste la seule trace sur l'appareil : elle n'est pas effacée.
    expect(localStorage.getItem('croustylift:outbox')).toBe(before);
    // La file LUE porte bien l'effacement complété, une seule fois, après l'écriture.
    expect(readQueue().map((op) => op.type)).toEqual(['upsertDatedNote', 'deleteDatedNote']);
    expect(readQueue()[1]).toMatchObject({ _uid: 'uid-effacement', executionId: EXEC, exerciseId: EXO });

    const result = await flush(syncFns);
    expect(result.remaining).toBe(0);
    // Avant : le repli ne comparait que les identités, jetait le complément, et
    // l'effacement, resté sur l'id de la file, laissait la note en base.
    expect(server.rows).toEqual([]);
    vi.restoreAllMocks();
  });

  it('stockage plein, file héritée « écrire, effacer, réécrire » : l’effacement complété garde sa place, le dernier texte subsiste', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    server.rows = [historique('texte d’avant')];
    legacyQueue([
      { ...legacyWrite, _uid: 'uid-ecrire' },
      { ...legacyDelete, _uid: 'uid-effacer' },
      { ...legacyWrite, body: 'réécrite après l’effacement', _seq: 3, _uid: 'uid-reecrire' },
    ]);
    const setItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      if (k === REGISTRY_KEY) throw new Error('QuotaExceededError');
      setItem(k, v);
    };

    adoptLegacyOps();
    // L'effacement complété reste ENTRE les deux écritures.
    expect(readQueue().map((op) => op._uid)).toEqual(['uid-ecrire', 'uid-effacer', 'uid-reecrire']);
    expect(readQueue()[1]).toMatchObject({ executionId: EXEC, exerciseId: EXO });

    const result = await flush(syncFns);
    expect(result.remaining).toBe(0);
    // Avant : il était replacé après les ops déjà vues, partait en dernier, et
    // supprimait la note réécrite.
    expect(server.rows).toHaveLength(1);
    expect(server.rows[0]).toMatchObject({ body: 'réécrite après l’effacement' });
    vi.restoreAllMocks();
  });

  // Ce bloc ne doit dépendre que de la file et du serveur simulé. Or `flush` passe
  // par `navigator.locks`, que Node 24 fournit : un verrou d'ambiance que tout
  // code du même fil peut tenir. Tenu ailleurs, la passe ne jouait rien et
  // rendait `remaining: 2` sans erreur.
  it('le verrou de flush tenu hors du test ne fait pas manquer le rejeu', async () => {
    let release!: () => void;
    await new Promise<void>((tenu) => {
      void ambientLocks.request('croustylift:outbox:flush', () => {
        tenu();
        return new Promise<void>((resolve) => (release = resolve));
      });
    });
    try {
      server.rows = [historique('texte d’avant')];
      legacyQueue([legacyWrite, legacyDelete]);
      adoptLegacyOps();
      const result = await flush(syncFns);
      expect(result.remaining).toBe(0);
      expect(server.rows).toEqual([]);
    } finally {
      release();
    }
  });

  it('sans complément, le défaut est bien là : l’effacement par id laisse la note', async () => {
    server.rows = [historique('texte d’avant')];
    legacyQueue([legacyWrite, legacyDelete]);
    // Pas d'`adoptLegacyOps` : la file part telle que l'ancien client l'a laissée.
    await flush(syncFns);
    expect(server.rows).toMatchObject([{ id: HISTORIQUE, body: 'saisie puis effacée' }]);
  });

  it('effacement hérité sans écriture en file : il garde son id, et efface la ligne de cet id', async () => {
    server.rows = [historique()];
    legacyQueue([{ type: 'deleteDatedNote', id: HISTORIQUE, _seq: 1 }]);
    adoptLegacyOps();
    expect(readQueue()[0]).not.toHaveProperty('executionId');
    await flush(syncFns);
    expect(server.rows).toEqual([]);
  });

  it('l’écriture d’un AUTRE compte, ou d’une autre note, ne prête pas son couple', () => {
    legacyQueue([
      { ...legacyWrite, _owner: 'compte-a' },
      { ...legacyDelete, _owner: 'compte-b' },
      { type: 'upsertDatedNote', id: 'autre-note', executionId: 'exec-x', exerciseId: 'exo-x', body: 'y', _owner: 'compte-b' },
    ]);
    adoptLegacyOps();
    expect(readQueue()[1]).not.toHaveProperty('executionId');
  });

  it('une file déjà complète entre au registre telle quelle', () => {
    legacyQueue([legacyWrite, { ...legacyDelete, executionId: EXEC, exerciseId: EXO }]);
    adoptLegacyOps();
    expect(readQueue().map((op) => op.type)).toEqual(['upsertDatedNote', 'deleteDatedNote']);
    expect(readQueue()[1]).toMatchObject({ id: EN_FILE, executionId: EXEC, exerciseId: EXO });
  });
});
