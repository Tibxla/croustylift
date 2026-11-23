// Badge unique par série (ADR 0010) : deux axes (référence / record), trois états
// (battu / égalisé / record), priorité Record > battu > égalisé, par côté en
// unilatéral. e1RM = w × (1 + (reps+rir)/30).
import { describe, it, expect } from 'vitest';
import { estimateE1rm } from '../../domain/e1rm';
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

const NO_RECORD: PersonalRecord = { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null };

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

  it('égalisé, pas battu, quand deux couples poids/reps donnent le même e1RM', () => {
    // 87,5 × 5 et 85 × 6 à RIR 0 : 99,1666… kg tous les deux, mais deux
    // flottants distincts à un bit près. Comparaison exacte, dans les deux sens.
    expect(referenceVerdict(set(87.5, 5, 0, 1), [set(85, 6, 0, 1)])).toBe('egalise');
    expect(referenceVerdict(set(85, 6, 0, 1), [set(87.5, 5, 0, 1)])).toBe('egalise');
  });

  it('battu dès que l’e1RM dépasse, même sous le centième de kg', () => {
    // 23,25 × 18 (36,425) contre 28,75 × 9 (36,4166…) : un arrondi au centième
    // les confondait en 36,42 et rendait « égalisé » dans les deux sens.
    expect(referenceVerdict(set(23.25, 18, 0, 1), [set(28.75, 9, 0, 1)])).toBe('battu');
    expect(referenceVerdict(set(28.75, 9, 0, 1), [set(23.25, 18, 0, 1)])).toBeNull();
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
    const record: PersonalRecord = { bestE1rm: 60, bestE1rmSet: null, bestWeightReps: { weightKg: 50, reps: 5 } };
    const ref = [set(100, 5, 1, 1)]; // même série → égalisé sur l’axe référence
    expect(computeSetBadges([set(100, 5, 1, 1)], ref, record)).toEqual([
      { axis: 'record', record: 'both' },
    ]);
  });

  it('même e1RM que le record et que la dernière fois : « égalisé », ni record ni battu', () => {
    // Le record d'e1RM a été posé par 85 × 6, la charge la plus lourde est ailleurs.
    const record: PersonalRecord = {
      bestE1rm: estimateE1rm(85, 6, 0),
      bestE1rmSet: { weightKg: 85, reps: 6 },
      bestWeightReps: { weightKg: 90, reps: 3 },
    };
    expect(computeSetBadges([set(87.5, 5, 0, 1)], [set(85, 6, 0, 1)], record)).toEqual([
      { axis: 'reference', verdict: 'egalise' },
    ]);
  });

  it('même e1RM mais barre plus lourde que jamais : record de CHARGE seulement', () => {
    // 87,5 kg dépasse la charge record de 85 kg : c'est un vrai record de charge,
    // pas un record d'e1RM (ni « e1rm » ni « both »).
    const record: PersonalRecord = {
      bestE1rm: estimateE1rm(85, 6, 0),
      bestE1rmSet: { weightKg: 85, reps: 6 },
      bestWeightReps: { weightKg: 85, reps: 6 },
    };
    expect(computeSetBadges([set(87.5, 5, 0, 1)], [set(85, 6, 0, 1)], record)).toEqual([
      { axis: 'record', record: 'weight-reps' },
    ]);
  });

  it('aucun badge quand la série est en deçà et ne bat aucun record', () => {
    const record: PersonalRecord = { bestE1rm: 200, bestE1rmSet: null, bestWeightReps: { weightKg: 200, reps: 5 } };
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
      left: { bestE1rm: 1000, bestE1rmSet: null, bestWeightReps: { weightKg: 1000, reps: 1 } }, // jamais battu
      right: { bestE1rm: 26, bestE1rmSet: null, bestWeightReps: { weightKg: 21, reps: 1 } }, // battu par 22×10
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

// Constat D8 de l'audit du 2026-11-22 : un exo au poids du corps saisi à 0 kg
// avait un e1RM nul, donc « égalisé » quelle que soit la perf.
describe('exo saisi à 0 kg : la Référence se juge aux reps effectives', () => {
  // Dernière fois : tractions à 0 kg, 12 reps puis 8 reps.
  const ref = [set(0, 12, 0, 1), set(0, 8, 0, 2)];

  it('9 reps après 12 : en deçà, plus « égalisé »', () => {
    expect(referenceVerdict(set(0, 9, 0, 1), ref)).toBeNull();
  });

  it('11 reps après 8 : battu', () => {
    expect(referenceVerdict(set(0, 11, 0, 2), ref)).toBe('battu');
  });

  it('mêmes reps effectives : égalisé, RIR compris (10 @ RIR 2 = 12 @ RIR 0)', () => {
    expect(referenceVerdict(set(0, 12, 0, 1), ref)).toBe('egalise');
    expect(referenceVerdict(set(0, 10, 2, 1), ref)).toBe('egalise');
  });

  it('une série lestée bat la même position faite à 0 kg, et l’inverse reste en deçà', () => {
    expect(referenceVerdict(set(5, 3, 0, 1), ref)).toBe('battu');
    expect(referenceVerdict(set(0, 30, 0, 1), [set(5, 3, 0, 1)])).toBeNull();
  });

  it('par côté en unilatéral : chaque bras face à ses propres reps', () => {
    const sided = [set(0, 10, 0, 1, 'left'), set(0, 12, 0, 1, 'right')];
    expect(referenceVerdict(set(0, 11, 0, 1, 'left'), sided)).toBe('battu');
    expect(referenceVerdict(set(0, 11, 0, 1, 'right'), sided)).toBeNull();
  });

  it('badges : un seul record par mesure, les reps effectives font avancer le record', () => {
    // Historique jamais chargé : record tenu par 0 × 12 @ RIR 0.
    const record: PersonalRecord = {
      bestE1rm: 0,
      bestE1rmSet: { weightKg: 0, reps: 12, rir: 0 },
      bestWeightReps: { weightKg: 0, reps: 12 },
    };
    const badges = computeSetBadges(
      [set(0, 9, 0, 1), set(0, 11, 0, 2), set(0, 13, 0, 3), set(0, 13, 0, 4), set(0, 12, 2, 5)],
      ref,
      record,
    );
    expect(badges).toEqual([
      null, // 9 < 12 : ni record ni Référence
      { axis: 'reference', verdict: 'battu' }, // 11 > 8, mais sous le record
      { axis: 'record', record: 'both' }, // 13 reps : reps effectives et reps faites
      null, // 13 égalé : pas un nouveau record, pas de Référence en position 4
      { axis: 'record', record: 'e1rm' }, // 12 @ RIR 2 = 14 effectives, 12 faites
    ]);
  });

  it('une série chargée après un historique à 0 kg : record des deux mesures', () => {
    const record: PersonalRecord = {
      bestE1rm: 0,
      bestE1rmSet: { weightKg: 0, reps: 12, rir: 0 },
      bestWeightReps: { weightKg: 0, reps: 12 },
    };
    expect(computeSetBadges([set(5, 3, 0, 1)], null, record)).toEqual([
      { axis: 'record', record: 'both' },
    ]);
  });
});
