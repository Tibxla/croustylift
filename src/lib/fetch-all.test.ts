// Tests de la lecture paginée (plafond PostgREST de 1000 lignes).
//
// Le « serveur » est un tableau en mémoire qui applique le curseur, la limite
// ET son propre plafond de lignes, comme PostgREST : on vérifie que la boucle
// ramène tout, sans doublon ni trou, quel que soit le rapport entre la page
// demandée et le plafond réel — y compris quand une écriture arrive entre deux
// pages.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAllRows, inCreationOrder } from './fetch-all';
import { setSessionUserReader } from './session-identity';

afterEach(() => setSessionUserReader(null));

type Row = { id: string };
const id = (n: number) => `id-${String(n).padStart(5, '0')}`;

/** Faux serveur : table triée par id, réponses plafonnées à `maxRows`. */
function fakeServer(total: number, maxRows: number) {
  const table: Row[] = Array.from({ length: total }, (_, i) => ({ id: id(i) }));
  const page = vi.fn(async (after: string | null, limit: number) => ({
    data: table
      .filter((row) => after === null || row.id > after)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(limit, maxRows)),
    error: null,
  }));
  return { table, page };
}

describe('fetchAllRows', () => {
  it('ramène tout au-delà du plafond de 1000 lignes, sans doublon ni trou', async () => {
    const { table, page } = fakeServer(2350, 1000);
    const rows = await fetchAllRows<Row>(page);
    expect(rows).toEqual(table);
    // 3 pages de données ; la 3ᵉ, courte, clôt la lecture (pas de requête de plus).
    expect(page.mock.calls.map(([after]) => after)).toEqual([null, id(999), id(1999)]);
  });

  it('première page courte : rendue SANS requête de plus (un aller-retour coupé ne fait plus échouer une lecture complète)', async () => {
    const { table, page } = fakeServer(12, 1000);
    await expect(fetchAllRows<Row>(page)).resolves.toEqual(table);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('total multiple exact de la page : pas de ligne perdue ni doublée', async () => {
    const { table, page } = fakeServer(2000, 1000);
    await expect(fetchAllRows<Row>(page)).resolves.toEqual(table);
  });

  it('aucune ligne : une seule requête, tableau vide', async () => {
    const { page } = fakeServer(0, 1000);
    await expect(fetchAllRows(page)).resolves.toEqual([]);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('`data` null (réponse vide de supabase-js) vaut fin de lecture', async () => {
    const page = vi.fn(async () => ({ data: null, error: null }));
    await expect(fetchAllRows(page)).resolves.toEqual([]);
  });

  it('ligne SUPPRIMÉE entre deux pages : aucune autre ligne n’est sautée', async () => {
    // Avec un offset, supprimer une ligne déjà lue décale la fenêtre d'un cran et
    // la première ligne de la page suivante disparaît de la lecture.
    const { table, page } = fakeServer(6, 1000);
    let calls = 0;
    const racing = async (after: string | null, limit: number) => {
      const result = await page(after, limit);
      calls += 1;
      if (calls === 1) table.splice(0, 1); // suppression pendant la lecture
      return result;
    };
    const rows = await fetchAllRows<Row>(racing, 2);
    // La ligne supprimée avait déjà été lue ; toutes les autres sont là, une fois.
    expect(rows.map((row) => row.id)).toEqual([0, 1, 2, 3, 4, 5].map(id));
  });

  it('ligne INSÉRÉE avant la fenêtre entre deux pages : aucune ligne n’est lue deux fois', async () => {
    const { table, page } = fakeServer(6, 1000);
    let calls = 0;
    const racing = async (after: string | null, limit: number) => {
      const result = await page(after, limit);
      calls += 1;
      if (calls === 1) table.unshift({ id: 'id-!avant' }); // trie avant tout le reste
      return result;
    };
    const rows = await fetchAllRows<Row>(racing, 2);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([0, 1, 2, 3, 4, 5].map(id));
  });

  it('une erreur est relancée telle quelle, sans résultat partiel', async () => {
    const boom = { message: 'réseau coupé' };
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 'a' }], error: null })
      .mockResolvedValueOnce({ data: null, error: boom });
    await expect(fetchAllRows(page, 1)).rejects.toBe(boom);
  });

  it('serveur qui ignore le curseur (toujours la même page) : la boucle s’arrête en erreur', async () => {
    // Page pleine (taille 1) pour que la boucle continue et bute sur le même id.
    const page = vi.fn(async () => ({ data: [{ id: 'a' }], error: null }));
    await expect(fetchAllRows(page, 1)).rejects.toThrow(/ne progresse pas/);
    expect(page).toHaveBeenCalledTimes(2);
  });
});

describe('fetchAllRows : garde de compte', () => {
  it('compte changé ENTRE deux pages : la lecture lève, aucune ligne mêlée n’est rendue', async () => {
    let user = 'compte-A';
    setSessionUserReader(async () => user);
    const { page } = fakeServer(6, 1000);
    let calls = 0;
    const switching = async (after: string | null, limit: number) => {
      const result = await page(after, limit);
      calls += 1;
      if (calls === 1) user = 'compte-B'; // Déconnexion de A, Connexion de B
      return result;
    };
    await expect(fetchAllRows<Row>(switching, 2)).rejects.toThrow(/compte connecté a changé/);
    // La page suivante (qui aurait lu B avec le curseur de A) n'est jamais demandée.
    expect(calls).toBe(1);
  });

  it('compte changé pendant la DERNIÈRE page : la lecture lève aussi', async () => {
    let user: string | null = 'compte-A';
    setSessionUserReader(async () => user);
    const page = vi.fn(async () => {
      user = null; // session perdue pendant le trajet
      return { data: [], error: null };
    });
    await expect(fetchAllRows<Row>(page)).rejects.toThrow(/compte connecté a changé/);
  });

  it('même compte du début à la fin : lecture normale', async () => {
    setSessionUserReader(async () => 'compte-A');
    const { table, page } = fakeServer(5, 2);
    await expect(fetchAllRows<Row>(page, 2)).resolves.toEqual(table);
  });
});

describe('inCreationOrder', () => {
  it('remet les lignes dans l’ordre de saisie, l’id en départage, sans muter l’entrée', () => {
    const rows = [
      { id: 'b', created_at: '2026-01-02T10:00:00Z' },
      { id: 'c', created_at: '2026-01-01T10:00:00Z' },
      { id: 'a', created_at: '2026-01-02T10:00:00Z' },
    ];
    expect(inCreationOrder(rows).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});
