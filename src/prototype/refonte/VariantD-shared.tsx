// PROTOTYPE JETABLE · variante D « Papier » : formateurs, palette et petits
// morceaux partagés entre la Salle et l'Analyse. Même structure que A, rhabillée
// en mode clair : papier blanc cassé, encre quasi noire, aucune couleur d'accent.
// Seuls les statuts ont une couleur (sapin, brun), toujours avec signe et mot.
import type { CSSProperties, ReactNode } from 'react';
import type { ExercisePlan } from './fixtures';
import { e1rm } from './fixtures';

export const STEP_KG = 1.25;

/*
  Palette. Ratios WCAG calculés sur le papier #F3F0E9 :
    encre       #17150F  16,0:1
    gris 2      #5C574F   6,3:1  (secondaire)
    gris 3      #6B665D   5,0:1  (méta, axes)
    sapin       #1E5A3C   7,1:1  (▲)
    brun        #8A4A12   6,0:1  (▼, passé)
    filet fort  #8C877C   3,1:1  (graduations mineures, jauges : graphisme ≥ 3:1)
    filet       #D9D4C9   décoratif
  Papier sur encre (bouton) 16,0:1 ; #CFCAC0 sur encre 11,2:1.
  On réécrit les jetons du thème sur la racine de D : les utilitaires existants
  (text-ink, bg-bg, border-hair…) et le focus clavier prennent l'encre.
*/
export const PAPER = '#F3F0E9';
export const INK = '#17150F';
export const GHOST = '#CFC9BD';

export const PAPER_VARS = {
  '--color-bg': PAPER,
  '--color-surface': '#E8E4DA',
  '--color-surface-2': '#DEDACF',
  '--color-ink': INK,
  '--color-ink-muted': '#5C574F',
  '--color-ink-faint': '#6B665D',
  '--color-hair': '#D9D4C9',
  '--color-hair-strong': '#8C877C',
  '--color-accent': INK,
  '--color-accent-ink': INK,
  '--color-on-accent': PAPER,
  '--color-good': '#1E5A3C',
  '--color-warn': '#8A4A12',
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  fontFeatureSettings: '"tnum" 1',
  colorScheme: 'light',
} as CSSProperties;

/** Poids français jusqu'à deux décimales : 81,25 ; 82,5 ; 80. `kg()` des fixtures arrondit à 0,1. */
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

/** Écart signé, signe moins typographique (U+2212). */
export function fmtSigned(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${fmt1(Math.abs(n))}`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function fmtDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function monthLabel(iso: string): string {
  const m = Number(iso.split('-')[1]);
  return MONTHS[m - 1] ?? '';
}

export type Verdict = 'up' | 'eq' | 'down';

/** Règle unique, celle de l'app (set-badges) : e1RM strictement supérieur, égal, inférieur. */
export function verdict(now: number, ref: number): Verdict {
  if (now > ref) return 'up';
  if (now === ref) return 'eq';
  return 'down';
}

export const SIGN: Record<Verdict, string> = { up: '▲', eq: '▬', down: '▼' };
export const TONE: Record<Verdict, string> = {
  up: 'text-good',
  eq: 'text-ink-muted',
  down: 'text-warn',
};
/** Le mot qui accompagne toujours le signe : la couleur ne porte jamais seule l'info. */
export const WORD: Record<Verdict, string> = { up: 'battue', eq: 'égalée', down: 'en deçà' };
export const SLOPE_WORD: Record<Verdict, string> = { up: 'progresse', eq: 'stagne', down: 'recule' };

/** Pente en %/semaine → verdict. Sous 0,25 % en valeur absolue : stagnation. */
export function slopeVerdict(pct: number): Verdict {
  if (pct >= 0.25) return 'up';
  if (pct <= -0.25) return 'down';
  return 'eq';
}

export function fmtPct(pct: number): string {
  const a = Math.abs(pct).toFixed(1).replace('.', ',');
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${a} %`;
}

export interface SetValue {
  weightKg: number;
  reps: number;
  rir: number;
}

export function setE1rm(s: SetValue): number {
  return e1rm(s.weightKg, s.reps, s.rir);
}

export function refAt(ex: ExercisePlan, rank: number): SetValue | null {
  return ex.reference?.sets[rank - 1] ?? null;
}

export type View = 'salle' | 'analyse';

/** Barre haute commune : contexte à gauche, bascule Salle / Analyse à droite, soulignée à l'encre. */
export function TopBar({
  view,
  onView,
  left,
}: {
  view: View;
  onView: (v: View) => void;
  left: ReactNode;
}) {
  return (
    <header className="flex h-14 flex-none items-center justify-between border-b border-hair pl-5 pr-2">
      <div className="min-w-0 truncate text-[13px] text-ink-muted">{left}</div>
      <nav aria-label="Surfaces" className="flex">
        {(['salle', 'analyse'] as const).map((v) => {
          const active = v === view;
          return (
            <button
              key={v}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onView(v)}
              className={`relative h-11 px-3 text-[15px] ${
                active ? 'font-semibold text-ink' : 'text-ink-muted active:text-ink'
              }`}
            >
              {v === 'salle' ? 'Salle' : 'Analyse'}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-2 h-[2px] ${active ? 'bg-ink' : 'bg-transparent'}`}
              />
            </button>
          );
        })}
      </nav>
    </header>
  );
}
