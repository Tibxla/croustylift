// `fetchWithTimeout` vu À TRAVERS le vrai client Supabase : l'enveloppe rend
// désormais une réponse reconstruite (corps lu sous le minuteur), il faut que
// PostgREST y retrouve tout ce qu'il lit, statut, corps, en-têtes.
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { isPermanentRejection } from '../features/capture/outbox';
import { fetchWithTimeout } from './fetch-timeout';

/** Un client dont chaque requête passe par l'enveloppe, servie par `server`. */
function clientOver(server: typeof fetch, ms = 1000) {
  return createClient('https://banc.supabase.co', 'cle-publique-de-test', {
    global: { fetch: fetchWithTimeout(ms, server) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });

describe('fetchWithTimeout sous le client Supabase', () => {
  it('une lecture rend ses lignes', async () => {
    const supabase = clientOver(async () => json([{ id: 'r1', name: 'PPL' }]));
    const { data, error } = await supabase.from('routines').select('id, name');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'r1', name: 'PPL' }]);
  });

  it('une écriture sans corps de réponse (201, 204) passe sans erreur', async () => {
    const created = clientOver(async () => new Response(null, { status: 201 }));
    expect((await created.from('routines').insert({ name: 'PPL' })).error).toBeNull();
    const deleted = clientOver(async () => new Response(null, { status: 204 }));
    expect((await deleted.from('routines').delete().eq('id', 'r1')).error).toBeNull();
  });

  it('un refus de la base garde son code SQLSTATE et son message', async () => {
    const refus = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "routines_owner_name_unique"',
      details: null,
      hint: null,
    };
    const supabase = clientOver(async () => json(refus, { status: 409 }));
    const { error } = await supabase.from('routines').insert({ name: 'PPL' });
    expect(error).toMatchObject({ code: '23505', message: refus.message });
    expect(isPermanentRejection(error)).toBe(true);
  });

  it('un comptage en-tête seul lit le content-range', async () => {
    const supabase = clientOver(
      async () => new Response(null, { status: 200, headers: { 'content-range': '0-0/7' } }),
    );
    const { count, error } = await supabase
      .from('routines')
      .select('*', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(count).toBe(7);
  });

  it('un appel de fonction rend sa valeur', async () => {
    const supabase = clientOver(async () => json(42));
    const { data, error } = await supabase.rpc('reorder_seances', {});
    expect(error).toBeNull();
    expect(data).toBe(42);
  });

  /** Le serveur répond 200, puis le corps ne se termine jamais. */
  const stalled: typeof fetch = async () =>
    new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('écriture dont le corps se bloque après les en-têtes : rend la main, en échec transitoire', async () => {
    const supabase = clientOver(stalled, 30);
    const { data, error } = await supabase.from('routines').insert({ name: 'PPL' }).select('id');
    expect(data).toBeNull();
    expect(String(error?.message)).toMatch(/Pas de réponse du serveur/);
    // L'outbox doit garder l'op en file et la rejouer, pas la mettre en quarantaine.
    expect(isPermanentRejection(error)).toBe(false);
  });

  it('lecture dont le corps se bloque : rend la main aussi', async () => {
    // `.retry(false)` : PostgREST rejoue de lui-même une lecture échouée, trois
    // fois, avec 1 s, 2 s puis 4 s d'attente. Sans rapport avec l'enveloppe ; on
    // le coupe ici pour ne mesurer qu'elle.
    const supabase = clientOver(stalled, 30);
    const { data, error } = await supabase.from('routines').select('id').retry(false);
    expect(data).toBeNull();
    expect(String(error?.message)).toMatch(/Pas de réponse du serveur/);
    expect(isPermanentRejection(error)).toBe(false);
  });
});
