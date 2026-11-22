// PROTOTYPE JETABLE · variante A « Cadran » : formateurs et petits morceaux
// partagés entre la Salle et l'Analyse.
import type { ExercisePlan } from './fixtures';
import { e1rm } from './fixtures';

export const STEP_KG = 1.25;

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

/** Barre haute commune : contexte à gauche, bascule Salle / Analyse à droite. */
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
              className={`relative h-11 px-3 text-[15px] transition-colors ${
                active ? 'font-semibold text-ink' : 'text-ink-muted active:text-ink'
              }`}
            >
              {v === 'salle' ? 'Salle' : 'Analyse'}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-1.5 h-[2px] ${active ? 'bg-accent' : 'bg-transparent'}`}
              />
            </button>
          );
        })}
      </nav>
    </header>
  );
}
