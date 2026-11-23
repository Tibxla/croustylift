// PROTOTYPE JETABLE · socle E « Signal ». Formateurs français et règles de
// comparaison partagés par toutes les surfaces. Aucune dépendance React.
//
// Règles d'écriture des nombres affichés :
//   - virgule décimale, jamais de point (82,5) ;
//   - signe moins typographique U+2212 (−1,2), jamais le tiret ;
//   - chiffres tabulaires partout (posé une fois sur la racine du shell).
import type { ExercisePlan } from '../fixtures';
import { e1rm } from '../fixtures';

/** Poids français jusqu'à deux décimales : 81,25 ; 82,5 ; 80. */
export function fmtKg(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  const s = Number.isInteger(r * 10) ? r.toFixed(1) : r.toFixed(2);
  return s.replace('.', ',');
}

/** Une décimale fixe, virgule : 107,3. */
export function fmt1(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

/** Écart signé, signe moins typographique. */
export function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${fmt1(Math.abs(n))}`;
}

export function fmtPct(pct: number): string {
  const a = Math.abs(pct).toFixed(1).replace('.', ',');
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${a} %`;
}

/** Fourchette : « 3-4 », ou « 3 » si min = max. */
export function range([a, b]: [number, number]): string {
  return a === b ? String(a) : `${a}-${b}`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « 17 nov. » */
export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function monthLabel(iso: string): string {
  return MONTHS[Number(iso.split('-')[1]) - 1] ?? '';
}

/* ------------------------------------------------------------------------ */
/* Verdicts                                                                   */
/* ------------------------------------------------------------------------ */

/** up = mieux, eq = égal, down = en deçà. Jamais confondus (CONTEXT.md, Référence). */
export type Verdict = 'up' | 'eq' | 'down';

/** Règle de l'app : e1RM strictement supérieur, égal, inférieur. */
export function verdict(now: number, ref: number): Verdict {
  if (now > ref) return 'up';
  if (now === ref) return 'eq';
  return 'down';
}

/** Pente en %/semaine. Sous 0,25 % en valeur absolue : stable. */
export function slopeVerdict(pct: number): Verdict {
  if (pct >= 0.25) return 'up';
  if (pct <= -0.25) return 'down';
  return 'eq';
}

/** Mots par contexte : une série contre sa Référence, un écart, une pente. */
export const WORDS = {
  set: { up: 'battue', eq: 'égalée', down: 'en deçà' },
  gap: { up: 'mieux', eq: 'égal', down: 'en deçà' },
  slope: { up: 'en hausse', eq: 'stable', down: 'en baisse' },
} as const satisfies Record<string, Record<Verdict, string>>;

/* ------------------------------------------------------------------------ */
/* Séries                                                                     */
/* ------------------------------------------------------------------------ */

export interface SetValue {
  weightKg: number;
  reps: number;
  rir: number;
}

export function setE1rm(s: SetValue): number {
  return e1rm(s.weightKg, s.reps, s.rir);
}

/** Référence de la série de rang `rank` (1-based), ou null. */
export function refAt(ex: ExercisePlan, rank: number): SetValue | null {
  return ex.reference?.sets[rank - 1] ?? null;
}

/* ------------------------------------------------------------------------ */
/* Bornes des rangées de numéros                                              */
/* ------------------------------------------------------------------------ */

/** Toute valeur plausible s'atteint au pouce, sans clavier. */
export const REPS_MIN = 1;
export const REPS_MAX = 50;
export const RIR_MIN = 0;
export const RIR_MAX = 10;
