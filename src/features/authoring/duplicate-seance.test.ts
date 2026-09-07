import { describe, it, expect } from 'vitest';
import {
  toDuplicatedPrescriptions,
  buildSeanceCatalog,
  type CatalogSources,
} from './duplicate-seance';
import type { EditablePrescription } from './data';

function presc(over: Partial<EditablePrescription> = {}): EditablePrescription {
  return {
    exerciseId: 'exo-1',
    position: 0,
    sets: { min: 3, max: 4 },
    reps: { min: 8, max: 12 },
    rir: { min: 1, max: 2 },
    exerciseName: 'Développé couché',
    muscleGroup: 'pectoraux',
    primaryMuscles: ['pectoraux'],
    unilateral: false,
    ...over,
  };
}

describe('toDuplicatedPrescriptions', () => {
  it('copie exo et fourchettes à l\'identique', () => {
    const copied = toDuplicatedPrescriptions([
      presc({ exerciseId: 'exo-9', sets: { min: 2, max: 5 }, reps: { min: 6, max: 6 }, rir: { min: 0, max: 3 } }),
    ]);

    expect(copied).toEqual([
      {
        exerciseId: 'exo-9',
        position: 0,
        sets: { min: 2, max: 5 },
        reps: { min: 6, max: 6 },
        rir: { min: 0, max: 3 },
      },
    ]);
  });

  it('ne copie AUCUN champ joint ou surchargé per-user (ADR 0015)', () => {
    const [copied] = toDuplicatedPrescriptions([
      presc({ exerciseName: 'Mon nom surchargé', primaryMuscles: ['triceps'], unilateral: true }),
    ]);

    expect(copied).not.toHaveProperty('exerciseName');
    expect(copied).not.toHaveProperty('muscleGroup');
    expect(copied).not.toHaveProperty('primaryMuscles');
    expect(copied).not.toHaveProperty('unilateral');
  });

  it('renumérote les positions à partir de 0, dans l\'ordre de la source', () => {
    const copied = toDuplicatedPrescriptions([
      presc({ exerciseId: 'c', position: 7 }),
      presc({ exerciseId: 'a', position: 2 }),
      presc({ exerciseId: 'b', position: 5 }),
    ]);

    expect(copied.map((p) => [p.exerciseId, p.position])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('ne mute pas la source', () => {
    const source = [presc({ exerciseId: 'b', position: 3 }), presc({ exerciseId: 'a', position: 1 })];
    toDuplicatedPrescriptions(source);
    expect(source.map((p) => p.exerciseId)).toEqual(['b', 'a']);
  });

  it('une séance source vide donne une copie vide', () => {
    expect(toDuplicatedPrescriptions([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------

function sources(over: Partial<CatalogSources> = {}): CatalogSources {
  return {
    routines: [
      { id: 'r-old', name: 'Ancienne' },
      { id: 'r-cur', name: 'Courante' },
    ],
    seances: [
      { id: 's-old', name: 'Full body', routine_id: 'r-old', position: 0 },
      { id: 's-cur-b', name: 'Lower', routine_id: 'r-cur', position: 1 },
      { id: 's-cur-a', name: 'Upper', routine_id: 'r-cur', position: 0 },
    ],
    versions: [
      { id: 'v-old-1', seance_id: 's-old', version: 1 },
      { id: 'v-cur-a-1', seance_id: 's-cur-a', version: 1 },
      { id: 'v-cur-a-2', seance_id: 's-cur-a', version: 2 },
      { id: 'v-cur-b-1', seance_id: 's-cur-b', version: 1 },
    ],
    prescriptions: [
      { seance_version_id: 'v-old-1' },
      { seance_version_id: 'v-cur-a-1' },
      { seance_version_id: 'v-cur-a-1' },
      { seance_version_id: 'v-cur-a-2' },
      { seance_version_id: 'v-cur-a-2' },
      { seance_version_id: 'v-cur-a-2' },
    ],
    currentRoutineId: 'r-cur',
    ...over,
  };
}

describe('buildSeanceCatalog', () => {
  it('remonte la routine courante en tête, puis trie par position', () => {
    expect(buildSeanceCatalog(sources()).map((e) => e.seanceId)).toEqual([
      's-cur-a',
      's-cur-b',
      's-old',
    ]);
  });

  it('compte les exos de la VERSION COURANTE, pas des versions passées', () => {
    const upper = buildSeanceCatalog(sources()).find((e) => e.seanceId === 's-cur-a');
    // v1 en portait 2, v2 (courante) en porte 3.
    expect(upper?.exerciseCount).toBe(3);
  });

  it('liste une séance vide plutôt que de la masquer', () => {
    const lower = buildSeanceCatalog(sources()).find((e) => e.seanceId === 's-cur-b');
    expect(lower).toBeDefined();
    expect(lower?.exerciseCount).toBe(0);
  });

  it('situe chaque séance dans sa routine', () => {
    const old = buildSeanceCatalog(sources()).find((e) => e.seanceId === 's-old');
    expect(old?.routineName).toBe('Ancienne');
    expect(old?.isCurrentRoutine).toBe(false);
  });

  it('sans routine courante, garde l\'ordre des routines reçu', () => {
    const catalog = buildSeanceCatalog(sources({ currentRoutineId: null }));
    expect(catalog.map((e) => e.seanceId)).toEqual(['s-old', 's-cur-a', 's-cur-b']);
    expect(catalog.every((e) => !e.isCurrentRoutine)).toBe(true);
  });

  it('ignore une séance dont la routine est absente', () => {
    const catalog = buildSeanceCatalog(
      sources({ seances: [{ id: 's-x', name: 'Orpheline', routine_id: 'r-parti', position: 0 }] }),
    );
    expect(catalog).toEqual([]);
  });

  it('une séance sans aucune version compte 0 exo', () => {
    const catalog = buildSeanceCatalog(sources({ versions: [], prescriptions: [] }));
    expect(catalog.every((e) => e.exerciseCount === 0)).toBe(true);
  });

  it('départage deux séances de même position par id, de façon stable', () => {
    const same = sources({
      seances: [
        { id: 's-b', name: 'B', routine_id: 'r-cur', position: 0 },
        { id: 's-a', name: 'A', routine_id: 'r-cur', position: 0 },
      ],
    });
    expect(buildSeanceCatalog(same).map((e) => e.seanceId)).toEqual(['s-a', 's-b']);
  });
});
