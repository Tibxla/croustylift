// Le brouillon face à la Référence et au Record, en direct (amendement du
// 2026-11-25 de l'ADR 0010) : même juge que les badges, des mots de position,
// un écart signé, jamais « battue » avant le log.
import { describe, expect, it } from 'vitest';
import type { PersonalRecord } from '../../domain/pr';
import { draftScore, standingVs } from './draft-score';

describe('standingVs : le brouillon face à un repère', () => {
  it('au-dessus : ▲, l’écart d’e1RM signé au dixième', () => {
    // 173,75 × 8 @1 = 220,08 ; 171,25 × 8 @1 = 216,92 : +3,2
    expect(standingVs({ weightKg: 173.75, reps: 8, rir: 1 }, { weightKg: 171.25, reps: 8, rir: 1 })).toEqual({
      v: 'up',
      word: 'au-dessus',
      gap: '+3,2',
    });
  });

  it('en dessous : ▼, l’écart négatif au signe moins typographique', () => {
    // 100 × 5 @1 = 116,67 ; 105 × 5 @1 = 122,5 : −5,8
    expect(standingVs({ weightKg: 100, reps: 5, rir: 1 }, { weightKg: 105, reps: 5, rir: 1 })).toEqual({
      v: 'down',
      word: 'en dessous',
      gap: '−5,8',
    });
  });

  it('égalité STRICTE : deux couples différents de même e1RM sont à égalité, sans chiffre', () => {
    // 100 × 5 @1 et 87,5 × 10 @1 : 116,67 tous deux, exactement (ADR 0010).
    expect(standingVs({ weightKg: 87.5, reps: 10, rir: 1 }, { weightKg: 100, reps: 5, rir: 1 })).toEqual({
      v: 'eq',
      word: 'à égalité',
      gap: null,
    });
  });

  it('un dépassement réel sous le dixième reste au-dessus, sans écrire « +0 »', () => {
    // 80,75 × 11 @1 = 110,358 ; 82,75 × 10 @1 = 110,333 : 0,025 de plus.
    expect(standingVs({ weightKg: 80.75, reps: 11, rir: 1 }, { weightKg: 82.75, reps: 10, rir: 1 })).toEqual({
      v: 'up',
      word: 'au-dessus',
      gap: null,
    });
  });

  it('à 0 kg des deux côtés, les reps effectives jugent et l’écart se lit en reps', () => {
    expect(standingVs({ weightKg: 0, reps: 12, rir: 1 }, { weightKg: 0, reps: 10, rir: 2 })).toEqual({
      v: 'up',
      word: 'au-dessus',
      gap: '+1',
    });
    expect(standingVs({ weightKg: 0, reps: 10, rir: 1 }, { weightKg: 0, reps: 9, rir: 2 })).toEqual({
      v: 'eq',
      word: 'à égalité',
      gap: null,
    });
  });

  it('mesures mêlées (0 kg face à une série chargée) : le signe et le mot, sans chiffre', () => {
    // Toute série chargée passe devant toute série à 0 kg (comparePerformance).
    expect(standingVs({ weightKg: 0, reps: 20, rir: 3 }, { weightKg: 10, reps: 8, rir: 1 })).toEqual({
      v: 'down',
      word: 'en dessous',
      gap: null,
    });
    expect(standingVs({ weightKg: 5, reps: 8, rir: 1 }, { weightKg: 0, reps: 20, rir: 3 })).toEqual({
      v: 'up',
      word: 'au-dessus',
      gap: null,
    });
  });

  it('un brouillon invalide n’a pas de position', () => {
    expect(standingVs({ weightKg: Number.NaN, reps: 8, rir: 1 }, { weightKg: 100, reps: 8, rir: 1 })).toBeNull();
    expect(standingVs({ weightKg: 100, reps: 0, rir: 1 }, { weightKg: 100, reps: 8, rir: 1 })).toBeNull();
  });
});

const record = (weightKg: number, reps: number, rir: number): PersonalRecord => ({
  bestE1rm: weightKg * (1 + (reps + rir - 1) / 30),
  bestE1rmSet: { weightKg, reps, rir },
  bestWeightReps: { weightKg, reps },
});

describe('draftScore : « Cette série », « Dernière fois », « Record »', () => {
  const draft = { weightKg: 173.75, reps: 8, rir: 1 };

  it('avec une Référence et un record : la mesure en direct et deux positions', () => {
    const score = draftScore({
      draft,
      refSet: { order: 1, weightKg: 171.25, reps: 8, rir: 1 },
      hasReference: true,
      record: record(170, 7, 1),
    });
    expect(score.live).toEqual({ label: 'e1RM', value: '220', unit: 'kg' });
    expect(score.last).toEqual({
      kind: 'set',
      set: { order: 1, weightKg: 171.25, reps: 8, rir: 1 },
      standing: { v: 'up', word: 'au-dessus', gap: '+3,2' },
    });
    // 170 × 7 @1 = 209,67, affiché au demi-kilo ; écart +10,4.
    expect(score.record).toEqual({
      kind: 'record',
      label: 'e1RM',
      value: '209,5',
      standing: { v: 'up', word: 'au-dessus', gap: '+10,4' },
    });
  });

  it('une Référence sans série à ce rang : « rien à cette série », sans position', () => {
    const score = draftScore({ draft, refSet: null, hasReference: true, record: null });
    expect(score.last).toEqual({ kind: 'none', word: 'rien à cette série' });
  });

  it('premier passage : « pas encore » de Référence, « aucun encore » de record', () => {
    const score = draftScore({ draft, refSet: null, hasReference: false, record: null });
    expect(score.last).toEqual({ kind: 'none', word: 'pas encore' });
    expect(score.record).toEqual({ kind: 'none', word: 'aucun encore' });
  });

  it('un record vierge (les deux mesures nulles) se lit « aucun encore »', () => {
    const score = draftScore({ draft, refSet: null, hasReference: false, record: { bestE1rm: null, bestE1rmSet: null, bestWeightReps: null } });
    expect(score.record).toEqual({ kind: 'none', word: 'aucun encore' });
  });

  it('égalité stricte avec le record : à égalité, jamais « record »', () => {
    const score = draftScore({ draft: { weightKg: 87.5, reps: 10, rir: 1 }, refSet: null, hasReference: false, record: record(100, 5, 1) });
    expect(score.record).toMatchObject({ kind: 'record', standing: { v: 'eq', word: 'à égalité', gap: null } });
  });

  it('record tenu à 0 kg : il se lit en reps effectives, le brouillon à 0 kg s’y compare en reps', () => {
    const score = draftScore({ draft: { weightKg: 0, reps: 15, rir: 1 }, refSet: null, hasReference: true, record: record(0, 12, 2) });
    expect(score.live).toEqual({ label: 'reps eff.', value: '16', unit: null });
    expect(score.record).toEqual({ kind: 'record', label: 'reps eff.', value: '14', standing: { v: 'up', word: 'au-dessus', gap: '+2' } });
  });

  it('record connu sans sa série (ancien format) : la position se juge sur l’e1RM seul', () => {
    const score = draftScore({
      draft: { weightKg: 100, reps: 5, rir: 1 },
      refSet: null,
      hasReference: true,
      record: { bestE1rm: 130, bestE1rmSet: null, bestWeightReps: null },
    });
    expect(score.record).toEqual({ kind: 'record', label: 'e1RM', value: '130', standing: { v: 'down', word: 'en dessous', gap: '−13,3' } });
  });

  it('record chargé dont la série n’a pas de RIR : jugé sur l’e1RM du record, celui des badges', () => {
    // bestE1rm = 100 × 5 @2 = 120 ; la série porteuse a perdu son RIR. Relue à
    // RIR 0, elle vaudrait 116,7 et le brouillon à 120 se dirait « au-dessus ».
    const score = draftScore({
      draft: { weightKg: 100, reps: 5, rir: 2 },
      refSet: null,
      hasReference: true,
      record: { bestE1rm: 120, bestE1rmSet: { weightKg: 100, reps: 5 }, bestWeightReps: { weightKg: 100, reps: 5 } },
    });
    expect(score.record).toEqual({ kind: 'record', label: 'e1RM', value: '120', standing: { v: 'eq', word: 'à égalité', gap: null } });
  });

  it('brouillon invalide : la mesure manque, les repères restent, sans position', () => {
    const score = draftScore({
      draft: { weightKg: 100, reps: 0, rir: 1 },
      refSet: { order: 1, weightKg: 100, reps: 5, rir: 1 },
      hasReference: true,
      record: record(100, 5, 1),
    });
    expect(score.live).toBeNull();
    expect(score.last).toMatchObject({ kind: 'set', standing: null });
    expect(score.record).toMatchObject({ kind: 'record', standing: null });
  });
});
