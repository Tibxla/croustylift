// Badge unique par série (ADR 0010) : deux axes (référence / record), trois états
// (battu / égalisé / record), priorité Record > battu > égalisé, par côté en
// unilatéral. e1RM = w × (1 + (reps+rir)/30).
import { describe, it, expect } from 'vitest';
import type { PerformedSet, Side } from '../../domain/types';
import type { PersonalRecord, PersonalRecordBySide } from '../../domain/pr';
import {
  computeSetBadges,
  computeSetBadgesBySide,
  referenceVerdict,
  summarizeBadges,
} from './set-badges';

const set = (
  weightKg: number,
  reps: number,
  rir: number,
  order: number,
  side?: Side,
): PerformedSet => ({ weightKg, reps, rir, order, side });

const NO_RECORD: PersonalRecord = { bestE1rm: null, bestWeightReps: null };

describe('referenceVerdict', () => {
  it('battu quand l’e1RM dépasse strictement la référence à la même position', () => {
    const ref = [set(100, 5, 1, 1)]; // e1RM 120
    expect(referenceVerdict(set(100, 6, 1, 1), ref)).toBe('battu'); // e1RM 123,33
  });

  it('égalisé quand l’e1RM est exactement celui de la référence', () => {
    const ref = [set(100, 5, 1, 1)];
    expect(referenceVerdict(set(100, 5, 1, 1), ref)).toBe('egalise');
  });

  it('rien quand l’e1RM est inférieur (perf en deçà de la dernière fois)', () => {
    const ref = [set(100, 5, 1, 1)]; // e1RM 120
    expect(referenceVerdict(set(90, 5, 1, 1), ref)).toBeNull(); // e1RM 108
  });

  it('rien sans référence à cette position (série en plus, premier passage)', () => {
    expect(referenceVerdict(set(100, 5, 1, 3), [set(100, 5, 1, 1)])).toBeNull();
    expect(referenceVerdict(set(100, 5, 1, 1), null)).toBeNull();
  });

  it('apparie la référence par CÔTÉ en unilatéral (chaque bras vs son historique)', () => {
    const ref = [set(20, 10, 0, 1, 'left'), set(22, 10, 0, 1, 'right')];
    // bras gauche : 22×10 (e1RM 29,33) > 20×10 (26,67) → battu
    expect(referenceVerdict(set(22, 10, 0, 1, 'left'), ref)).toBe('battu');
    // bras droit : 22×10 = 22×10 → égalisé
    expect(referenceVerdict(set(22, 10, 0, 1, 'right'), ref)).toBe('egalise');
  });
});

describe('computeSetBadges (bilatéral)', () => {
  it('verdict de référence quand aucun record n’est battu', () => {
    const ref = [set(100, 5, 1, 1)];
    expect(computeSetBadges([set(100, 6, 1, 1)], ref, NO_RECORD)).toEqual([
      { axis: 'reference', verdict: 'battu' },
    ]);
  });

  it('le Record prime sur le verdict de référence (un seul badge)', () => {
    // record bas : battu en e1RM ET en charge ; vs la dernière fois ce serait « égalisé »
    const record: PersonalRecord = { bestE1rm: 60, bestWeightReps: { weightKg: 50, reps: 5 } };
    const ref = [set(100, 5, 1, 1)]; // même série → égalisé sur l’axe référence
    expect(computeSetBadges([set(100, 5, 1, 1)], ref, record)).toEqual([
      { axis: 'record', record: 'both' },
    ]);
  });

  it('aucun badge quand la série est en deçà et ne bat aucun record', () => {
    const record: PersonalRecord = { bestE1rm: 200, bestWeightReps: { weightKg: 200, reps: 5 } };
    const ref = [set(100, 5, 1, 1)];
    expect(computeSetBadges([set(80, 5, 1, 1)], ref, record)).toEqual([null]);
  });
});

describe('computeSetBadgesBySide (unilatéral)', () => {
  it('compare chaque côté à SA dernière fois (référence appariée par côté)', () => {
    const ref = [set(20, 10, 0, 1, 'left'), set(22, 10, 0, 1, 'right')];
    const records: PersonalRecordBySide = { left: NO_RECORD, right: NO_RECORD };
    const sets = [set(22, 10, 0, 1, 'left'), set(22, 10, 0, 1, 'right')];
    expect(computeSetBadgesBySide(sets, ref, records)).toEqual([
      { axis: 'reference', verdict: 'battu' }, // gauche : 29,33 > 26,67
      { axis: 'reference', verdict: 'egalise' }, // droite : 29,33 = 29,33
    ]);
  });

  it('un record de côté prime, indépendamment de l’autre bras', () => {
    const ref = [set(20, 10, 0, 1, 'left'), set(20, 10, 0, 1, 'right')];
    const records: PersonalRecordBySide = {
      left: { bestE1rm: 1000, bestWeightReps: { weightKg: 1000, reps: 1 } }, // jamais battu
      right: { bestE1rm: 26, bestWeightReps: { weightKg: 21, reps: 1 } }, // battu par 22×10
    };
    const sets = [set(22, 10, 0, 1, 'left'), set(22, 10, 0, 1, 'right')];
    const out = computeSetBadgesBySide(sets, ref, records);
    expect(out[0]).toEqual({ axis: 'reference', verdict: 'battu' }); // gauche : pas de record, mais battu vs dernière fois
    expect(out[1]).toEqual({ axis: 'record', record: 'both' }); // droite : record de côté
  });
});

describe('summarizeBadges', () => {
  it('compte les verdicts au total ET par côté', () => {
    const sets = [
      set(100, 5, 1, 1, 'left'),
      set(100, 5, 1, 1, 'right'),
      set(100, 5, 1, 2, 'left'),
    ];
    const badges = [
      { axis: 'reference', verdict: 'battu' } as const,
      { axis: 'record', record: 'both' } as const,
      { axis: 'reference', verdict: 'egalise' } as const,
    ];
    const s = summarizeBadges(sets, badges);
    expect(s.total).toEqual({ battu: 1, egalise: 1, record: 1 });
    expect(s.left).toEqual({ battu: 1, egalise: 1, record: 0 });
    expect(s.right).toEqual({ battu: 0, egalise: 0, record: 1 });
  });

  it('ignore les séries sans badge', () => {
    const s = summarizeBadges([set(50, 5, 1, 1)], [null]);
    expect(s.total).toEqual({ battu: 0, egalise: 0, record: 0 });
  });
});
