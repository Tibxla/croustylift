// PROTOTYPE JETABLE · variante E « Signal » : la structure de A « Cadran »,
// rhabillée en monochrome chaud. Formateurs, palette et petits morceaux
// partagés entre la Salle et l'Analyse.
//
// Palette (ratios WCAG sur le fond #100e0c, calculés) :
//   ink   #f4f0e7  16,9:1   texte principal, bouton plein
//   muted #b5b0a9   8,9:1   libellés secondaires, ▼ en deçà
//   faint #8f8c85   5,7:1   méta discrète
//   dim   #6b6761   3,4:1   repères non textuels (graduations fines), nom
//                           fantôme de l'exo suivant (≥ 24 px, seuil 3:1)
//   line  #3a3733   1,6:1   filets décoratifs seulement, jamais porteurs de sens
//   sig   #f6d236  13,0:1   jaune de signalisation : aiguille de la règle et ▲
//   on-ink #4a463f  8,3:1   texte secondaire posé sur le bouton blanc cassé
// Le jaune ne touche jamais le blanc cassé (1,3:1).
import type { CSSProperties } from 'react';
import type { ExercisePlan } from './fixtures';
import { e1rm } from './fixtures';

export const STEP_KG = 1.25;

export const PALETTE = {
  '--e-bg': '#100e0c',
  '--e-ink': '#f4f0e7',
  '--e-muted': '#b5b0a9',
  '--e-faint': '#8f8c85',
  '--e-dim': '#6b6761',
  '--e-line': '#3a3733',
  '--e-sig': '#f6d236',
  '--e-on-ink': '#4a463f',
  // Le contour de focus global lit --color-accent : on le repasse en blanc cassé.
  '--color-accent': '#f4f0e7',
} as CSSProperties;

/** Inter à chiffres tabulaires : des colonnes de chiffres qui ne dansent pas,
 *  sans l'air de terminal d'une mono. */
export const FONT = '"Inter Variable", system-ui, sans-serif';

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

/** Seul « mieux » prend le signal. Égalé reste blanc cassé, en deçà gris. */
export const TONE: Record<Verdict, string> = {
  up: 'text-(--e-sig)',
  eq: 'text-(--e-ink)',
  down: 'text-(--e-muted)',
};

/** ▲ ▬ ▼ dessinés en SVG : les glyphes varient d'une police à l'autre. */
export function Sign({ v, size = 11 }: { v: Verdict; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden fill="currentColor" className="inline-block flex-none">
      {v === 'up' && <path d="M6 1.5 11 10.5H1z" />}
      {v === 'eq' && <rect x="0.5" y="3.5" width="11" height="5" />}
      {v === 'down' && <path d="M6 10.5 1 1.5h10z" />}
    </svg>
  );
}

/** Pente en %/semaine → verdict. Sous 0,25 % en valeur absolue : stagnation. */
export function slopeVerdict(pct: number): Verdict {
  if (pct >= 0.25) return 'up';
  if (pct <= -0.25) return 'down';
  return 'eq';
}

export const SLOPE_WORD: Record<Verdict, string> = { up: 'en hausse', eq: 'stable', down: 'en baisse' };

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

/** Barre haute commune : contexte à gauche, bascule Salle / Analyse à droite.
 *  La vue active est soulignée en blanc cassé, l'autre reste en gris. */
export function TopBar({
  view,
  onView,
  left,
}: {
  view: View;
  onView: (v: View) => void;
  left: React.ReactNode;
}) {
  return (
    <header className="flex h-14 flex-none items-center justify-between pl-5 pr-2">
      <div className="min-w-0 truncate text-[14px] text-(--e-muted)">{left}</div>
      <nav aria-label="Surfaces" className="flex">
        {(['salle', 'analyse'] as const).map((v) => {
          const active = v === view;
          return (
            <button
              key={v}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onView(v)}
              className={`h-11 px-3 text-[16px] ${
                active
                  ? 'font-semibold text-(--e-ink) underline decoration-2 underline-offset-[7px]'
                  : 'text-(--e-muted) active:text-(--e-ink)'
              }`}
            >
              {v === 'salle' ? 'Salle' : 'Analyse'}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
