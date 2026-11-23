// PROTOTYPE JETABLE · socle E, briques communes de la surface Analyse :
// lecture du journal, pente en clair (signe + mot + couleur), verdict de
// comparaison, dates longues.
import { useMemo, type ReactNode } from 'react';
import { journalOf, useAnalyseStore, type Execution } from './fixtures-analyse';
import { fmtPct, slopeVerdict, WORDS, type Verdict } from './format';
import { Screen, Status } from './kit';
import { useProto } from './shell';

/** Le journal tel que l'Analyse le lit : corrections comprises, plus
 *  l'Exécution en cours si elle a des séries. */
export function useJournal(): Execution[] {
  const s = useAnalyseStore();
  const { seance } = useProto();
  return useMemo(() => journalOf(s.base, seance.state, s.empty), [s.base, s.empty, seance.state]);
}

/** « ▲ en hausse · +1,2 %/sem ». null : pas de pente, dit en clair. */
export function SlopeStatus({
  slope,
  points,
  size = 11,
  className = '',
  short = false,
}: {
  slope: number | null;
  points: number;
  size?: number;
  className?: string;
  /** Sans le mot (quand il est dit ailleurs). */
  short?: boolean;
}) {
  if (slope === null) {
    return (
      <span className={`text-(--muted) ${className}`}>
        {points === 0 ? 'aucune séance' : `${points} séance${points > 1 ? 's' : ''}, pas encore de pente`}
      </span>
    );
  }
  const v = slopeVerdict(slope);
  return <Status v={v} size={size} className={className} word={short ? `${fmtPct(slope)}/sem` : `${WORDS.slope[v]} · ${fmtPct(slope)}/sem`} />;
}

/* ------------------------------------------------------------------------ */
/* Verdict de comparaison                                                     */
/* ------------------------------------------------------------------------ */

export type Compare =
  | { kind: 'none'; missing: ('a' | 'b')[] }
  | { kind: 'tie' }
  | { kind: 'both-down'; lessBad: 'a' | 'b' | null }
  | { kind: 'win'; side: 'a' | 'b'; winnerVerdict: Verdict };

/** Écart sous lequel deux pentes vont à la même vitesse (%/sem). */
const TIE = 0.25;

/** Pas de verdict sans deux pentes ; pas de gagnant quand les deux reculent. */
export function compare(a: number | null, b: number | null): Compare {
  if (a === null || b === null) return { kind: 'none', missing: [...(a === null ? ['a' as const] : []), ...(b === null ? ['b' as const] : [])] };
  if (slopeVerdict(a) === 'down' && slopeVerdict(b) === 'down') {
    return { kind: 'both-down', lessBad: Math.abs(a - b) < TIE ? null : a > b ? 'a' : 'b' };
  }
  if (Math.abs(a - b) < TIE) return { kind: 'tie' };
  const side = a > b ? 'a' : 'b';
  return { kind: 'win', side, winnerVerdict: slopeVerdict(side === 'a' ? a : b) };
}

/** Mot court pour une ligne de liste. */
export function compareWord(c: Compare): string {
  switch (c.kind) {
    case 'none':
      return 'pas de verdict';
    case 'tie':
      return 'même vitesse';
    case 'both-down':
      return 'pas de gagnant';
    case 'win':
      return c.winnerVerdict === 'up' ? `${c.side.toUpperCase()} plus vite` : `${c.side.toUpperCase()} tient mieux`;
  }
}

/* ------------------------------------------------------------------------ */
/* Dates                                                                      */
/* ------------------------------------------------------------------------ */

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function parts(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return { wd: d.getUTCDay(), day: d.getUTCDate(), m: d.getUTCMonth(), y: d.getUTCFullYear() };
}

/** « mardi 17 novembre » */
export function fmtDateLong(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.wd]} ${p.day === 1 ? '1er' : p.day} ${MONTHS_LONG[p.m]}`;
}

/** « mardi » */
export function fmtWeekday(iso: string): string {
  return DAYS[parts(iso).wd]!;
}

/** « Novembre 2026 » */
export function fmtMonthTitle(iso: string): string {
  const p = parts(iso);
  const m = MONTHS_LONG[p.m]!;
  return `${m[0]!.toUpperCase()}${m.slice(1)} ${p.y}`;
}

/** Entier avec espace fine insécable des milliers : 3 420. */
export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** « 1 h 05 » au-delà de l'heure, « 58 min » en deçà. */
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Écran de l'Analyse : un écran du kit sans barre d'action, avec le
 *  dégagement du bas (indicateur d'accueil, barre du prototype). */
export function Page({ children }: { children: ReactNode }) {
  return (
    <Screen>
      {children}
      <div aria-hidden className="h-(--pad-bottom) pt-8" />
    </Screen>
  );
}
