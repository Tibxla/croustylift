// La méta de « Quelle séance ? » : sous chaque séance, quand elle a été faite
// pour la dernière fois et combien d'exos elle compte (« dernière fois mardi ·
// 6 exos », « jamais faite · 5 exos »). Avec une routine A/B, il faut sinon se
// souvenir de laquelle est à faire ; un mauvais choix compare toute la séance à
// la mauvaise Référence. Pas d'ordre imposé ni de « séance suivante » devinée :
// le repère suffit.
//
// SOURCE. Les copies déjà en cache ne suffisent pas : `last-exec:<séance>` est
// « la dernière AVANT le jour où elle a été lue » (elle oublie la séance faite ce
// jour-là), et le template n'est en copie que pour les séances déjà ouvertes sur
// cet appareil. D'où UNE copie de plus, `salle-seances-meta`, une seule par
// compte (bornée, rien à évincer), servie cache d'abord comme le reste de la
// Salle (ADR 0012) : la liste s'affiche tout de suite, sans attendre le réseau.
// Sa revalidation de fond prévient l'écran monté (`onReadWritten`).
//
// HORS LIGNE. Une séance faite sans réseau n'est pas encore en base : les
// exécutions qui attendent dans la file (`upsertExecution`) avancent la date de
// leur séance (`mergePendingExecutions`), toutes versions de la séance
// comprises. Une exécution annulée dans la file ne compte pas ; si c'est la
// dernière lue en base qu'on a supprimée, la date n'est plus sûre et la ligne
// ne la dit pas.
//
// « Pas de copie ni de réseau » n'est pas « jamais faite » : sans donnée, la
// ligne reste vide (sa hauteur est réservée, rien ne saute à l'arrivée).
import { supabase } from '../../lib/supabase';
import { cachedRead, onReadWritten, peekRead } from '../../lib/read-cache';
import { daysBetween } from './format';
import type { OutboxOp } from './outbox';

/** Ce que dit la ligne d'une séance. */
export interface SeanceMeta {
  /** Date ISO de la dernière exécution, `null` si jamais faite. */
  lastOn: string | null;
  /** Exos de la version courante. */
  exerciseCount: number;
}

/** La copie : la méta et de quoi la fusionner avec la file. */
interface StoredMeta extends SeanceMeta {
  /** Toutes les versions de la séance : une exécution en file en porte une. */
  versionIds: string[];
  /** L'exécution qui donne `lastOn`, pour savoir si la file l'a supprimée. */
  lastExecutionId: string | null;
}

type StoredMap = Record<string, StoredMeta>;

export const SEANCES_META_KEY = 'salle-seances-meta';

const localDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

/** « aujourd'hui », « hier », le jour de la semaine, puis la date (et l'année si autre). */
function lastWord(lastOn: string, todayIso: string): string {
  const days = daysBetween(lastOn, todayIso);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  const date = localDate(lastOn);
  if (days < 7) return date.toLocaleDateString('fr-FR', { weekday: 'long' });
  const sameYear = lastOn.slice(0, 4) === todayIso.slice(0, 4);
  return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

/** La ligne sous le nom de la séance, ou `null` quand rien n'est connu. Pur. */
export function seanceMetaLine(meta: SeanceMeta | null, todayIso: string): string | null {
  if (!meta) return null;
  const when = meta.lastOn === null ? 'jamais faite' : `dernière fois ${lastWord(meta.lastOn, todayIso)}`;
  const n = meta.exerciseCount;
  const exos = n === 0 ? 'aucun exo' : `${n} exo${n > 1 ? 's' : ''}`;
  return `${when} · ${exos}`;
}

/**
 * La méta lue en base, fusionnée avec les exécutions qui attendent dans la file
 * (cf. en-tête). `null` pour une séance dont la date n'est plus sûre. Pur.
 */
export function mergePendingExecutions(stored: StoredMap, ops: readonly OutboxOp[]): Record<string, SeanceMeta | null> {
  const deleted = new Set(
    ops.flatMap((op) => (op.type === 'deleteExecution' || op.type === 'deleteExecutionIfEmpty' ? [op.id] : [])),
  );
  const out: Record<string, SeanceMeta | null> = {};
  for (const [seanceId, meta] of Object.entries(stored)) {
    if (meta.lastExecutionId !== null && deleted.has(meta.lastExecutionId)) {
      out[seanceId] = null;
      continue;
    }
    let lastOn = meta.lastOn;
    for (const op of ops) {
      if (op.type !== 'upsertExecution' || deleted.has(op.id)) continue;
      if (!meta.versionIds.includes(op.seanceVersionId)) continue;
      if (lastOn === null || op.performedOn > lastOn) lastOn = op.performedOn;
    }
    out[seanceId] = { lastOn, exerciseCount: meta.exerciseCount };
  }
  return out;
}

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

/** La copie locale telle quelle (synchrone), pour le premier rendu. */
export function peekSeancesMeta(): StoredMap {
  return peekRead<StoredMap>(SEANCES_META_KEY) ?? {};
}

/**
 * Lit la méta (copie d'abord, revalidée en fond) et appelle `onChange` à chaque
 * nouvelle copie, y compris celle de la revalidation. Tolérant : une méta est un
 * confort, son échec ne dit rien. Rend la fonction de désabonnement.
 */
export function watchSeancesMeta(seanceIds: readonly string[], onChange: (stored: StoredMap) => void): () => void {
  let alive = true;
  const off = onReadWritten((key) => {
    if (alive && key === SEANCES_META_KEY) onChange(peekSeancesMeta());
  });
  void cachedRead(SEANCES_META_KEY, () => fetchSeancesMeta(seanceIds)).then(
    (stored) => alive && onChange(stored),
    () => {},
  );
  return () => {
    alive = false;
    off();
  };
}
