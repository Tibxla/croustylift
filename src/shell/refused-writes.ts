// Les saisies refusées par le serveur (quarantaine de la file, ADR 0018), lues
// par un humain : quoi, quand, pourquoi. Pur, testé, sauf `resendBlock` qui lit
// la file ; l'écran est RefusedWritesSheet.tsx.
//
// La file ne porte que des identifiants : le nom de l'exo vient du catalogue
// local (lu par l'appelant, hors ligne compris), la date d'une séance de son op
// de création quand elle est connue. La raison est la chaîne stockée par la
// file : « <code SQLSTATE> : <message> » pour un refus de la base (traduite
// par `errorMessage`, comme partout), ou la dépendance à une séance refusée.
import { isSetWrite, readQueue, setWriteQueued, type RefusedWrite } from '../features/capture/outbox';
import { errorMessage } from '../lib/error-message';

export interface RefusalText {
  /** Ce qui a été refusé, en une ligne (« Série 3 · Développé couché »). */
  what: string;
  /** Le détail utile (« 80 kg × 8 · RIR 2 »), ou vide. */
  detail: string;
  /** Pourquoi, en français. */
  reason: string;
  /** La renvoyer peut-il servir ? Faux pour une création de séance dépassée. */
  retryable: boolean;
}

export interface RefusalLookup {
  /** Nom d'un exo par son id, s'il est connu sur l'appareil. */
  exerciseName: (id: string) => string | undefined;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 24 nov. » depuis une date ISO 'AAAA-MM-JJ' (jour calendaire, sans fuseau). */
export function fmtDay(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  if (!m || !d) return isoDate;
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
}

/** « le 24 nov. à 14 h 05 », en heure locale. */
export function fmtWhen(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const hh = String(t.getHours());
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `le ${t.getDate()} ${MONTHS[t.getMonth()]} à ${hh} h ${mm}`;
}

/** Un poids à virgule : « 82,5 ». */
function kg(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Refus d'une valeur : la renvoyer telle quelle échouera à l'identique. */
const VALUE_REFUSALS = new Set(['23514', '22003', '22001', '23502']);
/**
 * Donnée mal formée : toute la classe 22 de Postgres (« data exception » :
 * 22P02 texte illisible pour son type, 22007 date invalide, 22023 paramètre
 * invalide…), hors les dépassements déjà dans `VALUE_REFUSALS`. La file la met
 * en quarantaine (`isPermanentRejection`, outbox.ts) ; la renvoyer échouera à
 * l'identique, et recharger l'écran n'y change rien.
 */
const isMalformed = (code: string) => /^22[0-9A-Z]{3}$/.test(code) && !VALUE_REFUSALS.has(code);
/** Refus que renvoyer ne lèvera pas : valeur, donnée mal formée, élément lié supprimé. */
const isValueRefusal = (code: string) => VALUE_REFUSALS.has(code) || isMalformed(code) || code === '23503';
const SILENT = 'Le serveur l’a refusée sans dire pourquoi.';
/** Message intégré de Postgres ou PostgREST (anglais), par opposition au motif
 *  français écrit par un trigger, qui passe tel quel (cf. lib/error-message). */
const isBuiltIn = (message: string) => /^([a-z]|JSON )/.test(message);

/**
 * La raison stockée, en français, et propre à cette feuille : elle ne dit
 * jamais de corriger ou de recharger, ce que la feuille ne permet pas. Elle dit
 * si renvoyer peut servir, sinon d'abandonner. Le code SQLSTATE ne s'affiche
 * pas (il reste dans le relevé de diagnostic).
 */
export function refusalReason(entry: Pick<RefusedWrite, 'reason' | 'superseded' | 'op'>): string {
  if (entry.superseded) return 'La séance a été créée depuis : ce refus n’a plus d’effet.';
  const reason = entry.reason ?? '';
  if (isDependent(entry)) return 'Elle repart avec sa séance.';
  const m = /^([0-9A-Z]{5}) : ([\s\S]*)$/.exec(reason);
  if (m) {
    const [, code = '', message = ''] = m;
    if (isBuiltIn(message) && VALUE_REFUSALS.has(code)) {
      return 'Une valeur dépasse ce que le serveur accepte : la renvoyer échouera encore. Abandonne-la et ressaisis-la.';
    }
    if (isBuiltIn(message) && isMalformed(code)) {
      return 'Une donnée est mal formée : la renvoyer échouera encore. Abandonne-la et ressaisis-la.';
    }
    if (isBuiltIn(message) && code === '23503') return 'Elle visait un élément supprimé depuis un autre appareil. Abandonne-la.';
    const text = errorMessage({ code, message }).trim();
    if (text === '' || /\(code [0-9A-Z]+\)/.test(text)) return SILENT;
    return text;
  }
  return reason.trim() === '' ? SILENT : reason;
}

/**
 * Renvoyer telle quelle peut-il aboutir ? Non pour une création de séance
 * dépassée, une saisie retenue par sa séance (elle repart avec elle), une valeur
 * refusée, une donnée mal formée ou un élément lié supprimé : le serveur
 * refuserait à l'identique.
 */
export function canRetry(entry: Pick<RefusedWrite, 'reason' | 'superseded'>): boolean {
  if (entry.superseded || isDependent(entry)) return false;
  const m = /^([0-9A-Z]{5}) : ([\s\S]*)$/.exec(entry.reason ?? '');
  if (!m) return true;
  const [, code = '', message = ''] = m;
  return !(isBuiltIn(message) && isValueRefusal(code));
}

/** Retenue seulement parce que la création de sa séance a été refusée. */
export function isDependent(entry: Pick<RefusedWrite, 'reason'>): boolean {
  return (entry.reason ?? '').startsWith('dépend de l');
}

/** Les saisies retenues par la création refusée de cette séance (même exécution). */
export function dependentsOf(execution: RefusedWrite, entries: readonly RefusedWrite[]): RefusedWrite[] {
  if (execution.op.type !== 'upsertExecution') return [];
  const id = execution.op.id;
  return entries.filter((e) => e !== execution && isDependent(e) && e.reason.includes(id));
}

/** Une note tronquée pour la liste. */
function excerpt(body: string): string {
  const one = body.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 59)}…` : one;
}

export function describeRefusal(entry: RefusedWrite, lookup: RefusalLookup): RefusalText {
  const op = entry.op;
  const exo = (id: string | undefined) => (id ? lookup.exerciseName(id) : undefined);
  const withExo = (head: string, id: string | undefined) => {
    const name = exo(id);
    return name ? `${head} · ${name}` : head;
  };
  const reason = refusalReason(entry);
  const base = { reason, retryable: canRetry(entry) };
  switch (op.type) {
    case 'upsertExecution':
      return { ...base, what: `Début de la séance du ${fmtDay(op.performedOn)}`, detail: 'sans lui, ses séries ne peuvent pas partir' };
    case 'insertSet':
    case 'patchSet': {
      const side = op.side === 'left' ? ' · gauche' : op.side === 'right' ? ' · droite' : '';
      const values = `${kg(op.weightKg)} kg × ${op.reps} · RIR ${op.rir}${side}`;
      const kind = op.type === 'insertSet' ? null : op.only === 'values' ? 'correction' : 'nouveau rang';
      return { ...base, what: withExo(`Série ${op.setOrder}`, op.exerciseId), detail: kind ? `${kind} · ${values}` : values };
    }
    case 'deleteSet':
      return { ...base, what: withExo('Suppression d’une série', op.exerciseIds?.[0]), detail: '' };
    case 'updateExecution': {
      const parts: string[] = [];
      if (op.closedAt) parts.push('séance rangée');
      if (op.durationMin != null) parts.push(`durée ${op.durationMin} min`);
      if (op.bpmAvg != null) parts.push(`${op.bpmAvg} bpm`);
      return { ...base, what: 'Fin de séance', detail: parts.join(' · ') };
    }
    case 'upsertDatedNote':
      return { ...base, what: withExo('Note de séance', op.exerciseId), detail: excerpt(op.body) };
    case 'deleteDatedNote':
      return { ...base, what: withExo('Effacement d’une note de séance', op.exerciseId), detail: '' };
    case 'upsertExerciseNote':
      return { ...base, what: withExo('Note d’instructions', op.id), detail: excerpt(op.body) };
    case 'deleteExerciseNote':
      return { ...base, what: withExo('Effacement d’une note d’instructions', op.id), detail: '' };
    case 'deleteExecution':
      return { ...base, what: 'Suppression d’une séance', detail: '' };
    case 'deleteExecutionIfEmpty':
      return { ...base, what: 'Retrait d’une séance vide', detail: '' };
  }
}

/** Pourquoi « Renvoyer » n'a rien remis en file (`retryRefused` a rendu faux). */
export type ResendBlock = 'settled' | 'deletion-queued' | 'correction-queued' | 'storage';

/**
 * La cause d'un « Renvoyer » sans effet, `stillThere` disant si l'entrée est
 * encore listée. Une écriture de la même série attend en file, par le prédicat
 * même de `retryRefused` (`setWriteQueued` : insertion, correction ou
 * suppression, du même compte) : une suppression, qui l'emporte si les deux
 * attendent, ou une correction. Sinon c'est le stockage qui a refusé.
 */
export function resendBlock(entry: RefusedWrite, stillThere: boolean): ResendBlock {
  if (!stillThere) return 'settled';
  const op = entry.op;
  if (!isSetWrite(op) || !setWriteQueued(op.id, op._owner)) return 'storage';
  const deleting = readQueue().some((q) => q.type === 'deleteSet' && q.id === op.id && q._owner === op._owner);
  return deleting ? 'deletion-queued' : 'correction-queued';
}

/** Ce que la feuille dit pour chaque cause. */
export const RESEND_BLOCK_TEXT: Record<ResendBlock, string> = {
  settled: 'Cette saisie a déjà été réglée, depuis un autre onglet.',
  'deletion-queued': 'Une suppression de cette série attend déjà l’envoi : ce refus partira avec elle.',
  'correction-queued': 'Une correction de cette série attend déjà l’envoi : elle partira avec. Rien à renvoyer.',
  storage: 'L’appareil n’a pas pu l’enregistrer : son stockage est peut-être plein. Libère de la place puis réessaie.',
};
