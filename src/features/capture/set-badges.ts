// Badge UNIQUE par série loggée (ADR 0010), logique pure extraite de la Capture.
//
// Deux axes de comparaison, distincts (cf. GLOSSARY.md « Référence » / « Record
// personnel ») :
//   - RÉFÉRENCE (« dernière fois ») : la série à la MÊME position (et le même côté
//     en unilatéral) lors de la dernière exécution. Juge = e1RM, seuils STRICTS :
//     e1RM strictement supérieur -> « battu », strictement égal -> « égalisé »,
//     inférieur -> rien. Comparaison exacte (`comparePerformance`), comme pour
//     le Record : 87,5 × 5 et 85 × 6 s'égalisent, aucun ne bat l'autre. Deux
//     séries à 0 kg (poids du corps) se jugent aux reps effectives.
//   - RECORD personnel (all-time) : e1RM et/ou charge, géré par record-flags.
//
// Un seul badge par ligne, hiérarchie RECORD > battu > égalisé : si une série bat
// son record, on montre « Record » (pas aussi « battu », redondant).
import { comparePerformance } from '../../domain/e1rm';
import type { PersonalRecord, PersonalRecordBySide } from '../../domain/pr';
import type { PerformedSet } from '../../domain/types';
import {
  computeRecordFlags,
  computeRecordFlagsBySide,
  type RecordKind,
} from './record-flags';

/** Verdict d'une série face à la référence (dernière fois) : battue, égalisée, ou rien. */
export type RefVerdict = 'battu' | 'egalise' | null;

/** Le badge d'une série : soit un Record (all-time), soit un verdict vs la dernière fois. */
export type SetBadge =
  | { axis: 'record'; record: RecordKind }
  | { axis: 'reference'; verdict: 'battu' | 'egalise' }
  | null;

/**
 * Verdict d'une série face à la référence, à sa position (`order`) ET son côté
 * (`side`, pour l'unilatéral — chaque bras vs sa propre dernière fois). Aucune
 * référence à cette position/côté (premier passage, série en plus) -> `null`.
 */
export function referenceVerdict(
  set: PerformedSet,
  reference: PerformedSet[] | null,
): RefVerdict {
  if (!reference) return null;
  const ref = reference.find((r) => r.order === set.order && r.side === set.side);
  if (!ref) return null;
  // Comparaison EXACTE (cf. domain/e1rm.ts) : ni flottants bruts, qui séparent
  // d'un bit deux e1RM égaux, ni arrondi au centième, qui confond deux e1RM
  // distincts. À 0 kg des deux côtés, l'e1RM est nul et ne dit rien : les reps
  // effectives jugent (`comparePerformance`).
  const order = comparePerformance(set, ref);
  if (order > 0) return 'battu';
  if (order === 0) return 'egalise';
  return null;
}

/** Décompte des verdicts d'une série (pour le mini-récap de fin d'exo). */
export interface VerdictCounts {
  /** Séries strictement meilleures que la dernière fois (axe référence). */
  battu: number;
  /** Séries à égalité avec la dernière fois (axe référence). */
  egalise: number;
  /** Séries qui battent un record all-time (axe record). */
  record: number;
}

/** Comptes des verdicts au total ET par côté (le récap résume par bras en unilatéral). */
export interface BadgeSummary {
  total: VerdictCounts;
  left: VerdictCounts;
  right: VerdictCounts;
}

/**
 * Résume les badges d'une exécution d'exo pour le mini-récap (ADR 0010) : combien
 * de séries battues / égalisées / records, au total et par côté. Aligné par index
 * sur `sets` ; un set sans badge ne compte nulle part.
 */
export function summarizeBadges(sets: PerformedSet[], badges: SetBadge[]): BadgeSummary {
  const blank = (): VerdictCounts => ({ battu: 0, egalise: 0, record: 0 });
  const summary: BadgeSummary = { total: blank(), left: blank(), right: blank() };
  sets.forEach((s, i) => {
    const badge = badges[i];
    if (!badge) return;
    const bucket: keyof VerdictCounts = badge.axis === 'record' ? 'record' : badge.verdict;
    summary.total[bucket] += 1;
    if (s.side === 'left') summary.left[bucket] += 1;
    else if (s.side === 'right') summary.right[bucket] += 1;
  });
  return summary;
}

/**
 * Le mot d'un record selon son type : « record charge » pour un record de charge
 * seule (`weight-reps`), « record » pour un record d'e1RM (seul ou avec la
 * charge). La case « Record » de l'instrument montre le record d'e1RM : un
 * « ▲ record » posé sur une série qui ne bat que la charge laissait croire à une
 * erreur de l'app.
 */
function recordKindWord(kind: RecordKind): 'record' | 'record charge' {
  return kind === 'weight-reps' ? 'record charge' : 'record';
}

/** Le statut d'une série en signe + mot, un seul pour la bande, la feuille de
 *  correction et le bilan : record (signal), battue (signal), égalée. `short` :
 *  le mot dans une case de la bande (66 à 92 px), où « record charge » ne tient
 *  pas : « charge » seul, le nom lu garde le mot entier. */
export function badgeStatus(badge: SetBadge): { v: 'up' | 'eq'; word: string; short: string } | null {
  if (!badge) return null;
  if (badge.axis === 'record') {
    const word = recordKindWord(badge.record);
    return { v: 'up', word, short: word === 'record charge' ? 'charge' : word };
  }
  return badge.verdict === 'battu' ? { v: 'up', word: 'battue', short: 'battue' } : { v: 'eq', word: 'égalée', short: 'égalée' };
}

/** Le mot d'un groupe de records (bilan de l'exo, récap) : « record charge »
 *  seulement quand TOUS ses records sont de charge seule. */
export function recordWord(badges: readonly SetBadge[]): 'record' | 'record charge' {
  const kinds = badges.flatMap((b) => (b?.axis === 'record' ? [b.record] : []));
  return kinds.length > 0 && kinds.every((k) => k === 'weight-reps') ? 'record charge' : 'record';
}

/** Combine les deux axes en un seul badge, priorité Record > battu > égalisé. */
function combine(record: RecordKind | null, ref: RefVerdict): SetBadge {
  if (record) return { axis: 'record', record };
  if (ref) return { axis: 'reference', verdict: ref };
  return null;
}

/**
 * Badge par série pour un exo BILATÉRAL : record vs all-time, sinon verdict vs la
 * dernière fois. `record` = record personnel historique (null = premier passage).
 */
export function computeSetBadges(
  sets: PerformedSet[],
  reference: PerformedSet[] | null,
  record: PersonalRecord | null,
): SetBadge[] {
  // Un record VIERGE (les deux mesures à null, cas d'un exo jamais fait) compte
  // comme « premier passage » : aucun marqueur sur la toute première série jamais
  // faite — on ne bat pas un record qui n'existe pas encore. On le ramène donc à
  // `null` (la branche premier-passage de computeRecordFlags), cohérent avec le
  // côté unilatéral (computeRecordFlagsBySide traite déjà un côté vierge ainsi).
  const seeded = record && (record.bestE1rm !== null || record.bestWeightReps !== null) ? record : null;
  const records = computeRecordFlags(sets, seeded);
  return sets.map((s, i) => combine(records[i] ?? null, referenceVerdict(s, reference)));
}

/**
 * Badge par série pour un exo UNILATÉRAL (ADR 0010) : chaque ligne G/D se compare
 * à l'historique de SON côté — record du côté, sinon verdict vs la dernière fois du
 * côté (référence appariée par (order, side)).
 */
export function computeSetBadgesBySide(
  sets: PerformedSet[],
  reference: PerformedSet[] | null,
  records: PersonalRecordBySide,
): SetBadge[] {
  const recordFlags = computeRecordFlagsBySide(sets, records);
  return sets.map((s, i) => combine(recordFlags[i] ?? null, referenceVerdict(s, reference)));
}
