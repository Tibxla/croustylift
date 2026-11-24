// Lecture réseau de la méta de « Quelle séance ? » (cf. seance-meta.ts), dans
// son propre chunk, chargé à la demande par l'écran : elle n'alourdit pas le
// chunk principal, et son absence (chunk introuvable après une mise à jour) ne
// coûte que la ligne de méta.
import { supabase } from '../../lib/supabase';
import { cachedRead, onReadWritten } from '../../lib/read-cache';
import { peekSeancesMeta, SEANCES_META_KEY, type StoredMap } from './seance-meta';

/** Lecture réseau : versions, exos de la version courante, dernière exécution. */
async function fetchSeancesMeta(seanceIds: readonly string[]): Promise<StoredMap> {
  if (seanceIds.length === 0) return {};
  const { data: versions, error } = await supabase
    .from('seance_versions')
    .select('id, seance_id, version')
    .in('seance_id', [...seanceIds]);
  if (error) throw error;
  const bySeance = new Map<string, { ids: string[]; current: { id: string; version: number } | null }>();
  for (const v of versions ?? []) {
    const entry = bySeance.get(v.seance_id) ?? { ids: [], current: null };
    entry.ids.push(v.id);
    if (!entry.current || v.version > entry.current.version) entry.current = { id: v.id, version: v.version };
    bySeance.set(v.seance_id, entry);
  }
  const currentIds = [...bySeance.values()].flatMap((e) => (e.current ? [e.current.id] : []));
  const counts = new Map<string, number>();
  if (currentIds.length > 0) {
    const { data: rows, error: pErr } = await supabase
      .from('prescriptions')
      .select('seance_version_id')
      .in('seance_version_id', currentIds);
    if (pErr) throw pErr;
    for (const r of rows ?? []) counts.set(r.seance_version_id, (counts.get(r.seance_version_id) ?? 0) + 1);
  }
  // Une requête par séance (quelques-unes par routine), la plus récente seule :
  // exact, là où une liste bornée de toutes les exécutions pourrait en oublier.
  const lasts = await Promise.all(
    seanceIds.map(async (seanceId) => {
      const { data, error: eErr } = await supabase
        .from('executions')
        .select('id, performed_on, seance_versions!inner(seance_id)')
        .eq('seance_versions.seance_id', seanceId)
        .order('performed_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (eErr) throw eErr;
      return [seanceId, data ? { id: data.id, on: data.performed_on } : null] as const;
    }),
  );
  const out: StoredMap = {};
  for (const [seanceId, last] of lasts) {
    const entry = bySeance.get(seanceId);
    out[seanceId] = {
      lastOn: last?.on ?? null,
      lastExecutionId: last?.id ?? null,
      exerciseCount: entry?.current ? (counts.get(entry.current.id) ?? 0) : 0,
      versionIds: entry?.ids ?? [],
    };
  }
  return out;
}

/**
 * Lit la méta (copie d'abord, revalidée en fond) et appelle `onChange` à chaque
 * nouvelle copie, y compris celle de la revalidation. Tolérant : une méta est un
 * confort, son échec ne dit rien. Rend la fonction de désabonnement.
 *
 * Hors du rejeu global (`replay: false`) : rejouée après chaque flush, elle
 * relisait versions, prescriptions et dernière exécution de chaque séance pour
 * un sélecteur fermé, en plein exercice. Elle se revalide sur les événements
 * `revalidateOn` de `events` (le retour du réseau, et la file qui change : une
 * exécution acquittée quitte la file, sa date doit venir de la base), tant que
 * le sélecteur est monté. `fetcher` et `events` sont injectables pour les tests.
 */
export function watchSeancesMeta(
  seanceIds: readonly string[],
  onChange: (stored: StoredMap) => void,
  {
    fetcher = () => fetchSeancesMeta(seanceIds),
    events = typeof window === 'undefined' ? null : window,
    revalidateOn = ['online'],
  }: { fetcher?: () => Promise<StoredMap>; events?: EventTarget | null; revalidateOn?: readonly string[] } = {},
): () => void {
  let alive = true;
  const off = onReadWritten((key) => {
    if (alive && key === SEANCES_META_KEY) onChange(peekSeancesMeta());
  });
  const read = () => cachedRead(SEANCES_META_KEY, fetcher, { replay: false });
  void read().then(
    (stored) => alive && onChange(stored),
    () => {},
  );
  // Au retour du réseau (ou la file changée), seule la revalidation compte : elle arrive par
  // `onReadWritten` (la copie, déjà montrée, ne repasse pas après elle).
  const revalidate = () => void read().catch(() => {});
  for (const name of revalidateOn) events?.addEventListener(name, revalidate);
  return () => {
    alive = false;
    off();
    for (const name of revalidateOn) events?.removeEventListener(name, revalidate);
  };
}
