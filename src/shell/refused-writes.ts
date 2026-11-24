// Les saisies refusées par le serveur (quarantaine de la file, ADR 0018), lues
// par un humain : quoi, quand, pourquoi. Pur, testé ; l'écran est
// RefusedWritesSheet.tsx.
//
// La file ne porte que des identifiants : le nom de l'exo vient du catalogue
// local (lu par l'appelant, hors ligne compris), la date d'une séance de son op
// de création quand elle est connue. La raison est la chaîne stockée par la
// file : « <code SQLSTATE> : <message> » pour un refus de la base (traduite
// par `errorMessage`, comme partout), ou la dépendance à une séance refusée.
import type { RefusedWrite } from '../features/capture/outbox';
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

/** La raison stockée, en français. */
export function refusalReason(entry: Pick<RefusedWrite, 'reason' | 'superseded' | 'op'>): string {
  if (entry.superseded) return 'La séance a été créée depuis : ce refus n’a plus d’effet.';
  const reason = entry.reason ?? '';
  if (reason.startsWith('dépend de l')) return 'La séance dont elle dépend a été refusée : elle attend avec elle.';
  const m = /^([0-9A-Z]{5}) : ([\s\S]*)$/.exec(reason);
  if (m) {
    const [, code, message] = m;
    const text = errorMessage({ code, message });
    return text.trim() === '' ? `Refus du serveur (code ${code}).` : text;
  }
  return reason.trim() === '' ? 'Refus du serveur, sans motif donné.' : reason;
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
  const base = { reason, retryable: !entry.superseded };
  switch (op.type) {
    case 'upsertExecution':
      return { ...base, what: `Séance du ${fmtDay(op.performedOn)}`, detail: 'son ouverture' };
    case 'insertSet': {
      const side = op.side === 'left' ? ' · gauche' : op.side === 'right' ? ' · droite' : '';
      const values = `${kg(op.weightKg)} kg × ${op.reps} · RIR ${op.rir}${side}`;
      const kind = op.only === 'values' ? 'correction' : op.only === 'rank' ? 'nouveau rang' : null;
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
