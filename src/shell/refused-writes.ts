// Les saisies refusées par le serveur (registre d'écritures, ADR 0018), lues
// par un humain : quoi, quand, pourquoi. Pur, testé ; l'écran est
// RefusedWritesSheet.tsx.
//
// Ce module ne fait qu'AFFICHER ce que le registre rend (`RefusedWrite`,
// outbox.ts) : qui retient une saisie (`heldBy`), ce qui partira avec elle
// (`dependents`). Il ne déduit rien du texte d'un motif, et ne relit pas le
// registre. Le nom de l'exo vient du catalogue local (lu par l'appelant, hors
// ligne compris), la date d'une séance de son op de création. Le motif est la
// chaîne gardée avec le refus : « <code SQLSTATE> : <message> », traduite par
// `errorMessage`, comme partout.
import type { GestureOutcome, RefusedWrite } from '../features/capture/outbox';
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
export function refusalReason(entry: Pick<RefusedWrite, 'reason' | 'superseded' | 'heldBy'>): string {
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
export function canRetry(entry: Pick<RefusedWrite, 'reason' | 'superseded' | 'heldBy'>): boolean {
  if (entry.superseded || isDependent(entry)) return false;
  const m = /^([0-9A-Z]{5}) : ([\s\S]*)$/.exec(entry.reason ?? '');
  if (!m) return true;
  const [, code = '', message = ''] = m;
  return !(isBuiltIn(message) && isValueRefusal(code));
}

/** Retenue seulement parce que la création de sa séance a été refusée. */
export function isDependent(entry: Pick<RefusedWrite, 'heldBy'>): boolean {
  return entry.heldBy !== undefined;
}

/**
 * Ce que l'abandon de cette saisie emporte avec elle, dit dans la confirmation ;
 * vide si rien n'en dépend. Une série refusée emporte sa correction (elle
 * n'aurait plus de ligne à corriger) ; le début d'une séance emporte les
 * saisies qu'il retenait.
 */
export function abandonWarning(entry: Pick<RefusedWrite, 'op' | 'dependents'>): string {
  const deps = entry.dependents;
  if (deps.length === 0) return '';
  const op = entry.op;
  if (op.type === 'insertSet' || op.type === 'patchSet') {
    const corrections = deps.filter(
      (dep) => dep.type === 'patchSet' && dep.id === op.id && dep.only === 'values',
    );
    if (corrections.length === deps.length) {
      return corrections.length > 1
        ? `Tes ${corrections.length} corrections de la série ${op.setOrder} seront aussi abandonnées.`
        : `Ta correction de la série ${op.setOrder} sera aussi abandonnée.`;
    }
  }
  return deps.length > 1
    ? `Les ${deps.length} saisies qui en dépendent partent avec elle.`
    : 'La saisie qui en dépend part avec elle.';
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
      const kind =
        op.type === 'insertSet' ? null : op.only === 'values' ? 'correction' : op.only === 'side' ? 'nouveau côté' : 'nouveau rang';
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

/**
 * Ce que la feuille dit quand un geste n'a rien fait (`retryRefused` ou
 * `abandonRefused` n'a pas rendu `'done'`, outbox.ts).
 */
export const GESTURE_TEXT: Record<Exclude<GestureOutcome, 'done'>, string> = {
  gone: 'Cette saisie a déjà été réglée, depuis un autre onglet.',
  busy: 'Un envoi est en cours dans un autre onglet. Réessaie dans un instant.',
  unsaved: 'Le stockage de l’appareil est plein : rien n’a changé. Libère de la place, puis réessaie.',
};
