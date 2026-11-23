// Le chiffre de perf affiché en Capture : e1RM, ou reps effectives à 0 kg (ADR
// 0013, amendement du 2026-11-23).
import { describe, expect, it } from 'vitest';
import { formatPerf, perfReadout } from './perf-readout';

describe('perfReadout', () => {
  it('série chargée : son e1RM, en kg', () => {
    // 100 × 5 @ RIR 2 = 120
    expect(perfReadout(100, 5, 2)).toEqual({ label: 'e1RM', value: '120', unit: 'kg' });
  });

  it('série à 0 kg : ses reps effectives, jamais « e1RM 0 »', () => {
    expect(perfReadout(0, 12, 1)).toEqual({ label: 'reps eff.', value: '13', unit: null });
  });

  it('une saisie invalide ne jette jamais : rien à afficher', () => {
    expect(perfReadout(0, 0, 1)).toBeNull();
    expect(perfReadout(0, 5, -1)).toBeNull();
    expect(perfReadout(0, 2.5, 0)).toBeNull();
    expect(perfReadout(100, 0, 1)).toBeNull();
    expect(perfReadout(Number.NaN, 5, 1)).toBeNull();
  });
});

describe('formatPerf', () => {
  it('une ligne de repère : la mesure nommée', () => {
    expect(formatPerf({ weightKg: 82.5, reps: 8, rir: 2 })).toBe('e1RM 107,5');
    expect(formatPerf({ weightKg: 0, reps: 10, rir: 2 })).toBe('reps eff. 12');
  });
});
