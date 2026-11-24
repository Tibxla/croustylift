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
// Sa revalidation de fond prévient l'écran monté (`onReadWritten`). La lecture
// réseau vit dans seance-meta-load.ts, chargé à la demande (hors du chunk
// principal, budget de `npm run size`) : s'il manque, la ligne reste vide.
//
// HORS LIGNE. Une séance faite sans réseau n'est pas encore en base : les
// exécutions qui attendent dans la file (`upsertExecution`) avancent la date de
// leur séance (`mergePendingExecutions`), toutes versions de la séance
// comprises. Une exécution annulée dans la file ne compte pas ; si c'est la
// dernière lue en base qu'on a supprimée, la date n'est plus sûre et la ligne
// ne la dit pas.
//
// Une exécution acquittée compte encore jusqu'à la relecture de la méta (voir
// « ACQUITTÉES, PAS ENCORE RELUES » plus bas).
//
// « Pas de copie ni de réseau » n'est pas « jamais faite » : sans donnée, la
// ligne reste vide (sa hauteur est réservée, rien ne saute à l'arrivée).
import { dropRead, peekRead, seedRead } from '../../lib/read-cache';
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
export interface StoredMeta extends SeanceMeta {
  /** Toutes les versions de la séance : une exécution en file en porte une. */
  versionIds: string[];
  /** L'exécution qui donne `lastOn`, pour savoir si la file l'a supprimée. */
  lastExecutionId: string | null;
}

export type StoredMap = Record<string, StoredMeta>;

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

/** La copie locale telle quelle (synchrone), pour le premier rendu. */
export function peekSeancesMeta(): StoredMap {
  return peekRead<StoredMap>(SEANCES_META_KEY) ?? {};
}


// ACQUITTÉES, PAS ENCORE RELUES. Une exécution qui sort de la file (acquittée)
// cessait aussitôt de compter : sa date (séance faite) disparaissait, et celle
// d'une exécution SUPPRIMÉE reparaissait depuis la copie, jusqu'à la relecture.
// Le réseau tombé juste après, la copie restait fausse, au remontage compris.
// Les ops d'exécution acquittées sont donc gardées ici, dans le stockage, et
// fusionnées comme celles de la file, jusqu'à ce qu'une lecture de la méta
// partie APRÈS leur acquittement soit acceptée (seance-meta-load.ts) : la
// génération d'acquittement de la copie, changée à chaque acquittement
// (sync.ts, `markToRefresh`), écarte toute lecture partie avant.
// La mémoire est une copie du cache de lecture (`salle-acquittees`) : rattachée
// au compte reconnu, purgée à la déconnexion avec les autres (`clearReadCache`).
const ACKED_KEY = 'salle-acquittees';
/** Borne : quelques séances entre deux relectures, jamais davantage. */
const ACKED_MAX = 50;

/** Les ops d'exécution acquittées depuis la dernière relecture acceptée. */
export function readAckedExecutions(): OutboxOp[] {
  const stored = peekRead<unknown>(ACKED_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (op): op is OutboxOp =>
      typeof op === 'object' &&
      op !== null &&
      typeof (op as { id?: unknown }).id === 'string' &&
      ((op as OutboxOp).type === 'deleteExecution' ||
        ((op as OutboxOp).type === 'upsertExecution' &&
          typeof (op as { seanceVersionId?: unknown }).seanceVersionId === 'string' &&
          typeof (op as { performedOn?: unknown }).performedOn === 'string')),
  );
}

/**
 * Garde une exécution créée ou supprimée en base, le temps qu'une relecture
 * l'apporte. Dédoublonnée par (type, id) avant la borne : une exécution
 * réaffirmée à chaque remontage ne pousse pas dehors une suppression.
 * Stockage plein : rien n'est gardé, la ligne peut redire une date dépassée
 * jusqu'à la relecture.
 */
export function rememberAckedExecution(
  op: { type: 'upsertExecution'; id: string; seanceVersionId: string; performedOn: string } | { type: 'deleteExecution'; id: string },
): void {
  const others = readAckedExecutions().filter((x) => !(x.type === op.type && x.id === op.id));
  seedRead(ACKED_KEY, [...others, op].slice(-ACKED_MAX));
}

/** Une lecture partie après tous les acquittements gardés vient d'être acceptée ET écrite. */
export function clearAckedExecutions(): void {
  dropRead(ACKED_KEY);
}
