// Marquage « nouveau record » des séries du jour (issue #34), logique pure.
import { describe, it, expect } from 'vitest';
import { estimateE1rm } from '../../domain/e1rm';
import type { PerformedSet } from '../../domain/types';
import type { PersonalRecord } from '../../domain/pr';
import { computeRecordFlags } from './record-flags';

const set = (weightKg: number, reps: number, rir: number, order: number): PerformedSet => ({
  weightKg,
  reps,
  rir,
  order,
});

describe('computeRecordFlags', () => {
  it('aucun marqueur quand aucune série du jour ne bat le record historique', () => {
    const record: PersonalRecord = { bestE1rm: 130, bestE1rmSet: null, bestWeightReps: { weightKg: 110, reps: 5 } };
    const sets = [set(100, 5, 1, 1), set(100, 4, 1, 2)];
    expect(computeRecordFlags(sets, record)).toEqual([null, null]);
  });

  it('marque "both" une série qui bat à la fois l’e1RM et la charge', () => {
    // record bas : 50x5@1 → e1RM 60, charge 50x5
    const record: PersonalRecord = { bestE1rm: 60, bestE1rmSet: null, bestWeightReps: { weightKg: 50, reps: 5 } };
    // 100x5@1 → e1RM 120 (>60) et charge 100 (>50) : les deux.
    expect(computeRecordFlags([set(100, 5, 1, 1)], record)).toEqual(['both']);
  });

  it('marque "weight-reps" un record de charge sans record d’e1RM', () => {
    // e1RM déjà très haut (jamais battu ici), charge basse (battue).
    const record: PersonalRecord = { bestE1rm: 500, bestE1rmSet: null, bestWeightReps: { weightKg: 50, reps: 5 } };
    // 100x3@0 → e1RM 110 (<500, pas de record e1RM) mais charge 100 (>50).
    expect(computeRecordFlags([set(100, 3, 0, 1)], record)).toEqual(['weight-reps']);
  });

  it('marque "e1rm" un record d’e1RM sans record de charge', () => {
    // charge déjà très lourde (jamais battue), e1RM bas (battu).
    const record: PersonalRecord = { bestE1rm: 50, bestE1rmSet: null, bestWeightReps: { weightKg: 300, reps: 1 } };
    // 100x5@1 → e1RM 120 (>50) mais charge 100 (<300).
    expect(computeRecordFlags([set(100, 5, 1, 1)], record)).toEqual(['e1rm']);
  });

  it('un seul marqueur par mesure : la 1ʳᵉ série du jour à dépasser, pas les suivantes', () => {
    // record bas ; deux séries du jour le battent, mais seule la 1ʳᵉ est marquée
    // (la 2ᵉ ne dépasse plus le record COURANT, déjà avancé par la 1ʳᵉ).
    const record: PersonalRecord = { bestE1rm: 60, bestE1rmSet: null, bestWeightReps: { weightKg: 50, reps: 5 } };
    const sets = [set(100, 5, 1, 1), set(100, 5, 1, 2)];
    expect(computeRecordFlags(sets, record)).toEqual(['both', null]);
  });

  it('une série encore plus haute après un 1ᵉʳ record re-marque le dépassement', () => {
    const record: PersonalRecord = { bestE1rm: 60, bestE1rmSet: null, bestWeightReps: { weightKg: 50, reps: 5 } };
    // 1ʳᵉ bat le record ; 2ᵉ plus lourde encore bat le record courant → re-marquée.
    const sets = [set(100, 5, 1, 1), set(110, 5, 1, 2)];
    expect(computeRecordFlags(sets, record)).toEqual(['both', 'both']);
  });

  it('un autre couple poids/reps de même e1RM que le record n’est pas un record d’e1RM', () => {
    // 85 × 6 et 87,5 × 5 valent le même e1RM (99,1666… kg) à un bit flottant près.
    const record: PersonalRecord = {
      bestE1rm: estimateE1rm(85, 6, 0),
      bestE1rmSet: { weightKg: 85, reps: 6 },
      bestWeightReps: { weightKg: 90, reps: 3 },
    };
    expect(computeRecordFlags([set(87.5, 5, 0, 1)], record)).toEqual([null]);
    const inverse: PersonalRecord = { ...record, bestE1rm: estimateE1rm(87.5, 5, 0) };
    expect(computeRecordFlags([set(85, 6, 0, 1)], inverse)).toEqual([null]);
  });

  it('le record courant du jour ne se fait pas « battre » par une égalité', () => {
    // La 1ʳᵉ série pose le record du jour ; la 2ᵉ et la 3ᵉ l'égalent seulement.
    const record: PersonalRecord = { bestE1rm: 60, bestE1rmSet: null, bestWeightReps: { weightKg: 200, reps: 1 } };
    const sets = [set(85, 6, 0, 1), set(87.5, 5, 0, 2), set(85, 6, 0, 3)];
    expect(computeRecordFlags(sets, record)).toEqual(['e1rm', null, null]);
  });

  it('un dépassement sous le centième de kg reste un record d’e1RM', () => {
    // 28,75 × 9 = 36,4166… ; 23,25 × 18 = 36,425.
    const record: PersonalRecord = {
      bestE1rm: estimateE1rm(28.75, 9, 0),
      bestE1rmSet: null,
      bestWeightReps: { weightKg: 200, reps: 1 },
    };
    expect(computeRecordFlags([set(23.25, 18, 0, 1)], record)).toEqual(['e1rm']);
  });

  it('premier passage (record null) : jamais de marqueur, même si la série progresse', () => {
    const sets = [set(40, 10, 2, 1), set(60, 10, 2, 2)];
    expect(computeRecordFlags(sets, null)).toEqual([null, null]);
  });

  it('aucune série du jour → tableau vide', () => {
    const record: PersonalRecord = { bestE1rm: 100, bestE1rmSet: null, bestWeightReps: { weightKg: 80, reps: 5 } };
    expect(computeRecordFlags([], record)).toEqual([]);
  });
});
