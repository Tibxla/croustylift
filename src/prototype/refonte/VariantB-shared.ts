// PROTOTYPE JETABLE · variante B « Carnet » : helpers partagés (formatage,
// écart à la Référence). L'écart suit la règle réelle de set-badges.ts : e1RM
// strict, même rang de série. On le recalcule partout (séries saisies dans le
// prototype comprises) plutôt que de lire `vsReference` des fixtures.
import { e1rm, kg } from './fixtures';

export interface SetVals {
  weightKg: number;
  reps: number;
  rir: number;
}

/** Signe moins typographique (U+2212), jamais le trait d'union. */
export const MINUS = '−';

export function dec1(n: number): string {
  return Math.abs(n).toFixed(1).replace('.', ',');
}

export function signed1(n: number): string {
  if (n === 0) return '0';
  return `${n > 0 ? '+' : MINUS}${dec1(n)}`;
}

export function setE1rm(s: SetVals): number {
  return e1rm(s.weightKg, s.reps, s.rir);
}

/** Écart d'e1RM face à la Référence du même rang, null si pas de Référence. */
export function deltaVsRef(s: SetVals, ref: SetVals | undefined): number | null {
  if (!ref) return null;
  return Math.round((setE1rm(s) - setE1rm(ref)) * 10) / 10;
}

export type Trend = 'up' | 'flat' | 'down';

export function trendOf(n: number, flatBand: number): Trend {
  if (n > flatBand) return 'up';
  if (n < -flatBand) return 'down';
  return 'flat';
}

export const TREND_SIGN: Record<Trend, string> = { up: '▲', flat: '▬', down: '▼' };
export const TREND_CLASS: Record<Trend, string> = {
  up: 'text-good',
  flat: 'text-ink-muted',
  down: 'text-warn',
};

/** « 80×8 @1 » : poids × reps, RIR après l'arobase. */
export function fmtSet(s: SetVals): string {
  return `${kg(s.weightKg)}×${s.reps} @${s.rir}`;
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(`${iso}T12:00:00`));
}
