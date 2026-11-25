// Fin de séance enrichie : calculs purs (récap exo par exo, séries battues et
// records, kg soulevés, séries de la semaine par muscle contre le prévu, durée
// corrigeable).
import { describe, expect, it } from 'vitest';
import { estimateE1rm } from '../../domain/e1rm';
import { liftedKg } from '../../domain/lifted';
import { weekStartIso } from '../../domain/week';
import type { PerformedSet } from '../../domain/types';
import type { Session, SessionExercise } from './fixtures';
import { buildSessionRecap, exerciseStatus, nudgeDuration, weekSetsByMuscle } from './session-recap';
import { initialState, type CaptureState } from './state';
import { SESSION_DURATION_MAX_MIN } from './summary';

const ps = (weightKg: number, reps: number, rir: number, order: number, side?: 'left' | 'right'): PerformedSet => ({
  weightKg,
  reps,
  rir,
  order,
  ...(side ? { side } : {}),
});
const r = (min: number, max: number) => ({ min, max });

const bench: SessionExercise = {
  exerciseId: 'bench',
  name: 'Développé couché',
  primaryMuscles: ['pectoraux', 'triceps'],
  prescription: { sets: r(3, 4), reps: r(8, 12), rir: r(1, 2) },
  reference: [ps(80, 8, 2, 1), ps(80, 8, 2, 2), ps(80, 8, 2, 3)],
  personalRecord: {
    bestE1rm: estimateE1rm(82.5, 8, 2),
    bestE1rmSet: { weightKg: 82.5, reps: 8 },
    bestWeightReps: { weightKg: 82.5, reps: 8 },
  },
  perExerciseNote: '',
};
const row: SessionExercise = {
  exerciseId: 'row',
  name: 'Tirage horizontal',
  primaryMuscles: ['dos'],
  prescription: { sets: r(3, 3), reps: r(10, 12), rir: r(1, 2) },
  reference: null,
  perExerciseNote: '',
};
const curl: SessionExercise = {
  exerciseId: 'curl',
  name: 'Curl un bras',
  unilateral: true,
  primaryMuscles: ['biceps'],
  prescription: { sets: r(2, 3), reps: r(10, 12), rir: r(1, 2) },
  reference: [ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right')],
  perExerciseNote: '',
};
const press: SessionExercise = {
  exerciseId: 'press',
  name: 'Développé militaire',
  primaryMuscles: ['épaules'],
  prescription: { sets: r(3, 3), reps: r(6, 8), rir: r(2, 2) },
  reference: null,
  perExerciseNote: '',
};
const session: Session = { id: 'upper', name: 'Upper A', exercises: [bench, row, curl, press] };

const state = (progress: CaptureState['progress']): CaptureState => ({
  ...initialState(session, '2026-11-25'),
  progress,
});
const done = (sets: PerformedSet[], skipped = false) => ({
  sets,
  setIds: sets.map((_, i) => `id-${i}`),
  skipped,
});

describe('liftedKg (kg soulevés)', () => {
  it('somme poids × reps de chaque ligne, les deux côtés d’une série unilatérale compris', () => {
    expect(liftedKg([ps(80, 8, 2, 1), ps(80, 7, 1, 2)])).toBe(1200);
    expect(liftedKg([ps(12, 10, 2, 1, 'left'), ps(12, 9, 2, 1, 'right')])).toBe(228);
    expect(liftedKg([])).toBe(0);
  });

  it('une série au poids du corps (0 kg) ne soulève rien, sans fausser le total', () => {
    expect(liftedKg([ps(0, 12, 1, 1), ps(20, 5, 1, 2)])).toBe(100);
  });
});

describe('exerciseStatus', () => {
  it('pas fait, en cours, fait, selon les séries logiques contre le minimum du plan', () => {
    expect(exerciseStatus(bench, done([]))).toBe('pas-fait');
    expect(exerciseStatus(bench, done([ps(80, 8, 2, 1), ps(80, 8, 2, 2)]))).toBe('en-cours');
    expect(exerciseStatus(bench, done([ps(80, 8, 2, 1), ps(80, 8, 2, 2), ps(80, 8, 2, 3)]))).toBe('fait');
    // Au-delà du minimum : toujours fait (ancien `statusOf`).
    expect(
      exerciseStatus(bench, done([ps(80, 8, 2, 1), ps(80, 8, 2, 2), ps(80, 8, 2, 3), ps(80, 8, 2, 4)])),
    ).toBe('fait');
  });

  it('unilatéral : une série compte quand elle existe, pas une ligne par côté', () => {
    // Deux lignes, mais une seule série (gauche et droite du rang 1) : en cours.
    expect(exerciseStatus(curl, done([ps(12, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right')]))).toBe('en-cours');
  });

  it('passé prime : un exo passé reste « passé » même avec des séries', () => {
    expect(exerciseStatus(bench, done([ps(80, 8, 2, 1)], true))).toBe('passe');
    // Même au minimum du plan atteint (ancien `statusOf`).
    expect(exerciseStatus(bench, done([ps(80, 8, 2, 1), ps(80, 8, 2, 2), ps(80, 8, 2, 3)], true))).toBe('passe');
    expect(exerciseStatus(bench, done([], true))).toBe('passe');
  });
});

describe('buildSessionRecap', () => {
  const recap = buildSessionRecap(
    session,
    state({
      // Série 1 au-dessus du record, série 2 égale à la référence, série 3 en deçà.
      bench: done([ps(85, 8, 2, 1), ps(80, 8, 2, 2), ps(77.5, 8, 2, 3)]),
      // Une seule série sur trois : en cours. Pas de référence : aucun verdict.
      row: done([ps(60, 10, 2, 1)]),
      // Série 1 complète (gauche battue, droite égalée), série 2 entamée à gauche.
      curl: done([ps(13, 10, 2, 1, 'left'), ps(12, 10, 2, 1, 'right'), ps(12, 10, 2, 2, 'left')]),
    }),
  );
  const of = (id: string) => recap.exercises.find((e) => e.exerciseId === id)!;

  it('un exo par ligne, dans l’ordre de la séance, avec son état', () => {
    expect(recap.exercises.map((e) => [e.name, e.status])).toEqual([
      ['Développé couché', 'fait'],
      ['Tirage horizontal', 'en-cours'],
      ['Curl un bras', 'fait'],
      ['Développé militaire', 'pas-fait'],
    ]);
    expect(recap.counts).toEqual({ fait: 2, 'en-cours': 1, passe: 0, 'pas-fait': 1 });
  });

  it('séries faites (séries logiques) contre le prévu, exo par exo', () => {
    expect(of('bench')).toMatchObject({ setsDone: 3, setsPlanned: { min: 3, max: 4 } });
    expect(of('row')).toMatchObject({ setsDone: 1, setsPlanned: { min: 3, max: 3 } });
    // Deux séries logiques (la seconde entamée d'un côté).
    expect(of('curl').setsDone).toBe(2);
    expect(of('press').setsDone).toBe(0);
  });

  it('battues, égalées, records : par exo et au total', () => {
    expect(of('bench')).toMatchObject({ beaten: 0, matched: 1 });
    expect(of('bench').newRecords).toHaveLength(1);
    expect(of('curl')).toMatchObject({ beaten: 1, matched: 1, newRecords: [] });
    expect(of('row')).toMatchObject({ beaten: 0, matched: 0, newRecords: [] });
    expect(recap.beaten).toBe(1);
    expect(recap.records).toHaveLength(1);
  });

  it('nouveaux records : l’exo et son meilleur e1RM du jour parmi les séries qui battent le record', () => {
    const record = {
      exerciseId: 'bench',
      name: 'Développé couché',
      axis: 'e1rm',
      unit: 'kg',
      value: estimateE1rm(85, 8, 2),
      side: null,
      set: { weightKg: 85, reps: 8, rir: 2 },
    };
    expect(recap.records).toEqual([record]);
    expect(of('bench').newRecords).toEqual([record]);
    expect(of('row').newRecords).toEqual([]);
  });

  it('kg soulevés : par exo et au total, les deux côtés comptés', () => {
    expect(of('bench').liftedKg).toBe(85 * 8 + 80 * 8 + 77.5 * 8);
    expect(of('curl').liftedKg).toBe(130 + 120 + 120);
    expect(recap.liftedKg).toBe(of('bench').liftedKg + 600 + of('curl').liftedKg);
  });

  it('séries loggées de la séance : le nombre de séries logiques', () => {
    expect(recap.setsLogged).toBe(3 + 1 + 2);
  });

  it('unilatéral : le côté fait d’une série restée à un côté', () => {
    expect(of('curl').openSide).toBe('left');
    expect(of('bench').openSide).toBeNull();
  });

  it('exo passé : compté à part, ses séries et ses kg restent dans le total', () => {
    const skipped = buildSessionRecap(session, state({ bench: done([ps(80, 8, 2, 1)], true) }));
    expect(skipped.exercises[0]).toMatchObject({ status: 'passe', setsDone: 1 });
    expect(skipped.counts).toEqual({ fait: 0, 'en-cours': 0, passe: 1, 'pas-fait': 3 });
    expect(skipped.liftedKg).toBe(640);
  });

  it('exo remplacé ou ajouté : sa provenance est rendue', () => {
    const edited: Session = {
      ...session,
      exercises: [bench, { ...row, origin: 'swapped', swappedFrom: 'bench' }, { ...press, origin: 'added' }],
    };
    const origins = buildSessionRecap(edited, state({})).exercises.map((e) => e.origin);
    expect(origins).toEqual(['template', 'swapped', 'added']);
  });

  it('séance vide : tout à zéro, aucun record', () => {
    const empty = buildSessionRecap(session, state({}));
    expect(empty).toMatchObject({ setsLogged: 0, beaten: 0, liftedKg: 0, records: [] });
  });
});

// Constat 9 de la relecture du moteur : un record se rend dans son axe, son unité
// et son côté, et chaque record compté figure dans la liste de la séance.
describe('buildSessionRecap : records typés (axe, unité, côté)', () => {
  // Tractions au poids du corps : jamais chargées, le record se lit en reps
  // effectives (ADR 0013, amendement du 2026-11-23). Record : 0 × 10 @ 1.
  const pullup: SessionExercise = {
    exerciseId: 'pullup',
    name: 'Tractions',
    primaryMuscles: ['dos'],
    prescription: { sets: r(3, 3), reps: r(8, 12), rir: r(0, 2) },
    reference: null,
    personalRecord: {
      bestE1rm: 0,
      bestE1rmSet: { weightKg: 0, reps: 10, rir: 1 },
      bestWeightReps: { weightKg: 0, reps: 10 },
    },
    perExerciseNote: '',
  };
  // Squat : record d'e1RM sur 100 × 8 @ 2 (130 kg), record de charge 120 × 3.
  const squat: SessionExercise = {
    exerciseId: 'squat',
    name: 'Squat',
    primaryMuscles: ['quadriceps'],
    prescription: { sets: r(3, 3), reps: r(1, 8), rir: r(0, 2) },
    reference: null,
    personalRecord: {
      bestE1rm: estimateE1rm(100, 8, 2),
      bestE1rmSet: { weightKg: 100, reps: 8, rir: 2 },
      bestWeightReps: { weightKg: 120, reps: 3 },
    },
    perExerciseNote: '',
  };
  const sideRecord = (weightKg: number, reps: number, rir: number) => ({
    bestE1rm: estimateE1rm(weightKg, reps, rir),
    bestE1rmSet: { weightKg, reps, rir },
    bestWeightReps: { weightKg, reps },
  });
  const curlRecords: SessionExercise = {
    ...curl,
    personalRecordBySide: { left: sideRecord(12, 10, 2), right: sideRecord(12, 10, 2) },
  };
  const recordsSession: Session = { id: 'mix', name: 'Mix', exercises: [pullup, squat, curlRecords] };
  const recapOf = (progress: CaptureState['progress']) =>
    buildSessionRecap(recordsSession, { ...initialState(recordsSession, '2026-11-25'), progress });

  it('un record à 0 kg porte les reps effectives, jamais un e1RM nul', () => {
    const recap = recapOf({ pullup: done([ps(0, 12, 1, 1)]) });
    const record = {
      exerciseId: 'pullup',
      name: 'Tractions',
      axis: 'e1rm',
      unit: 'reps',
      value: 13,
      side: null,
      set: { weightKg: 0, reps: 12, rir: 1 },
    };
    expect(recap.records).toEqual([record]);
    const exo = recap.exercises.find((e) => e.exerciseId === 'pullup')!;
    expect(exo.newRecords).toEqual([record]);
  });

  it('à 0 kg, la meilleure série du jour se départage aux reps effectives', () => {
    // 0 × 11 @ 1 bat le record (12 effectives contre 11), puis 0 × 13 @ 0 le rebat (13).
    const recap = recapOf({ pullup: done([ps(0, 11, 1, 1), ps(0, 13, 0, 2)]) });
    expect(recap.records).toMatchObject([{ axis: 'e1rm', unit: 'reps', value: 13, set: { reps: 13, rir: 0 } }]);
    expect(recap.records).toHaveLength(1);
  });

  it('un record de charge seul figure dans la liste de la séance', () => {
    // 125 × 1 @ 0 : e1RM 125, sous les 130 du record, mais plus lourd que 120 × 3.
    const recap = recapOf({ squat: done([ps(125, 1, 0, 1)]) });
    const record = {
      exerciseId: 'squat',
      name: 'Squat',
      axis: 'charge',
      unit: 'kg',
      value: 125,
      side: null,
      set: { weightKg: 125, reps: 1, rir: 0 },
    };
    expect(recap.records).toEqual([record]);
    expect(recap.exercises.find((e) => e.exerciseId === 'squat')!.newRecords).toEqual([record]);
  });

  it('records d’e1RM et de charge tenus par deux séries distinctes : les deux figurent', () => {
    // 100 × 10 @ 2 bat l'e1RM (136,7) sans dépasser 120 kg ; 125 × 1 bat la charge seule.
    const recap = recapOf({ squat: done([ps(100, 10, 2, 1), ps(125, 1, 0, 2)]) });
    expect(recap.records).toMatchObject([
      { axis: 'e1rm', unit: 'kg', value: estimateE1rm(100, 10, 2) },
      { axis: 'charge', unit: 'kg', value: 125 },
    ]);
    expect(recap.records).toHaveLength(2);
  });

  it('une même série qui bat les deux records ne figure qu’une fois, sur l’axe e1RM', () => {
    const recap = recapOf({ squat: done([ps(130, 3, 1, 1)]) });
    expect(recap.records).toMatchObject([{ axis: 'e1rm', unit: 'kg', set: { weightKg: 130, reps: 3, rir: 1 } }]);
    expect(recap.records).toHaveLength(1);
  });

  it('un record de charge seul à 0 kg se rend en reps faites, jamais « 0 kg »', () => {
    // 0 × 11 @ 0 : 11 reps effectives, autant que le record (10 @ 1), donc pas
    // d'e1RM battu ; mais 11 reps contre 10 à poids égal, donc la charge l'est.
    const recap = recapOf({ pullup: done([ps(0, 11, 0, 1)]) });
    expect(recap.records).toEqual([
      {
        exerciseId: 'pullup',
        name: 'Tractions',
        axis: 'charge',
        unit: 'reps',
        value: 11,
        side: null,
        set: { weightKg: 0, reps: 11, rir: 0 },
      },
    ]);
  });

  it('deux records unilatéraux restent deux, chacun avec son côté', () => {
    const recap = recapOf({
      curl: done([ps(14, 10, 2, 1, 'left'), ps(13, 10, 2, 1, 'right')]),
    });
    expect(recap.records).toMatchObject([
      { exerciseId: 'curl', axis: 'e1rm', unit: 'kg', side: 'left', value: estimateE1rm(14, 10, 2) },
      { exerciseId: 'curl', axis: 'e1rm', unit: 'kg', side: 'right', value: estimateE1rm(13, 10, 2) },
    ]);
    expect(recap.records).toHaveLength(2);
  });
});

describe('weekStartIso (semaine civile, du lundi au dimanche)', () => {
  it('rend le lundi de la semaine, en date locale', () => {
    expect(weekStartIso('2026-11-25')).toBe('2026-11-23'); // mercredi
    expect(weekStartIso('2026-11-23')).toBe('2026-11-23'); // lundi
    expect(weekStartIso('2026-11-29')).toBe('2026-11-23'); // dimanche
  });

  it('traverse les mois et les années', () => {
    expect(weekStartIso('2026-12-01')).toBe('2026-11-30');
    expect(weekStartIso('2027-01-01')).toBe('2026-12-28');
  });
});

describe('weekSetsByMuscle (séries de la semaine par muscle, contre le prévu)', () => {
  const full = (n: number, reps = 8) => Array.from({ length: n }, (_, i) => ps(80, reps, 2, i + 1));
  const rows = weekSetsByMuscle({
    // Avant aujourd'hui, cette semaine : 4 séries de pectoraux, 3 de dos.
    before: [
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: full(4) },
      { unilateral: false, primaryMuscles: ['dos'], sets: full(3) },
    ],
    // Aujourd'hui : 3 séries pectoraux et triceps, 2 de mollets (hors plan).
    today: [
      { unilateral: false, primaryMuscles: ['pectoraux', 'triceps'], sets: full(3) },
      { unilateral: false, primaryMuscles: ['mollets'], sets: full(2) },
    ],
    // Prévu de la routine sur la semaine : pectoraux 6 à 8, dos 6 à 6, triceps 2 à 3, épaules 3 à 3.
    planned: [
      { unilateral: false, primaryMuscles: ['pectoraux'], sets: r(6, 8), reps: r(8, 12) },
      { unilateral: false, primaryMuscles: ['dos'], sets: r(6, 6), reps: r(8, 12) },
      { unilateral: false, primaryMuscles: ['triceps'], sets: r(2, 3), reps: r(8, 12) },
      { unilateral: false, primaryMuscles: ['épaules'], sets: r(3, 3), reps: r(8, 12) },
    ],
  });
  const of = (muscle: string) => rows.find((row) => row.muscle === muscle)!;

  it('avant aujourd’hui, aujourd’hui et total, par muscle', () => {
    expect(of('pectoraux')).toMatchObject({ before: 4, today: 3, total: 7 });
    expect(of('dos')).toMatchObject({ before: 3, today: 0, total: 3 });
    expect(of('triceps')).toMatchObject({ before: 0, today: 3, total: 3 });
  });

  it('contre le prévu : sous, dans, au-delà', () => {
    expect(of('pectoraux')).toMatchObject({ planned: { min: 6, max: 8 }, fit: 'dans' });
    expect(of('dos')).toMatchObject({ planned: { min: 6, max: 6 }, fit: 'sous' });
    expect(of('triceps')).toMatchObject({ planned: { min: 2, max: 3 }, fit: 'dans' });
  });

  it('muscle prévu mais pas encore travaillé : présent, à zéro, sous le prévu', () => {
    expect(of('épaules')).toMatchObject({ before: 0, today: 0, total: 0, fit: 'sous' });
  });

  it('muscle travaillé hors du prévu de la routine : présent, sans fourchette ni verdict', () => {
    expect(of('mollets')).toMatchObject({ total: 2, planned: null, fit: null });
  });

  it('au-delà du prévu', () => {
    const over = weekSetsByMuscle({
      before: [{ unilateral: false, primaryMuscles: ['dos'], sets: full(5) }],
      today: [{ unilateral: false, primaryMuscles: ['dos'], sets: full(4) }],
      planned: [{ unilateral: false, primaryMuscles: ['dos'], sets: r(6, 8), reps: r(8, 12) }],
    });
    expect(over[0]).toMatchObject({ total: 9, fit: 'au-dela' });
  });

  it('les décomptes sont pondérés par les reps, comme partout (ADR 0006)', () => {
    const light = weekSetsByMuscle({
      before: [],
      today: [{ unilateral: false, primaryMuscles: ['dos'], sets: [ps(100, 3, 1, 1)] }],
      planned: [],
    });
    expect(light[0]?.today).toBeCloseTo(0.6);
  });

  it('ordre canonique des muscles, les muscles hors vocabulaire en fin', () => {
    expect(rows.map((row) => row.muscle).at(-1)).toBeDefined();
    const known = rows.map((row) => row.muscle);
    expect(known.indexOf('pectoraux')).toBeLessThan(known.indexOf('triceps'));
  });

  it('rien cette semaine, rien de prévu : aucune ligne', () => {
    expect(weekSetsByMuscle({ before: [], today: [], planned: [] })).toEqual([]);
  });
});

describe('nudgeDuration (durée corrigeable par crans de 5 min alignés)', () => {
  it('va au cran aligné le plus proche dans le sens demandé', () => {
    expect(nudgeDuration(27, 1)).toBe(30);
    expect(nudgeDuration(27, -1)).toBe(25);
    expect(nudgeDuration(30, 1)).toBe(35);
    expect(nudgeDuration(30, -1)).toBe(25);
  });

  it('bornée : jamais sous 1 min, jamais au-delà du plafond d’une séance', () => {
    expect(nudgeDuration(3, -1)).toBe(1);
    expect(nudgeDuration(1, -1)).toBe(1);
    expect(nudgeDuration(1, 1)).toBe(5);
    expect(nudgeDuration(SESSION_DURATION_MAX_MIN, 1)).toBe(SESSION_DURATION_MAX_MIN);
    expect(nudgeDuration(SESSION_DURATION_MAX_MIN - 2, 1)).toBe(SESSION_DURATION_MAX_MIN);
  });

  it('durée non mesurée (null) : part d’une heure, sans inventer de valeur avant le geste', () => {
    expect(nudgeDuration(null, 1)).toBe(60);
    expect(nudgeDuration(null, -1)).toBe(60);
  });
});
