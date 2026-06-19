import { describe, it, expect, vi, beforeEach } from 'vitest';

// On mocke UNIQUEMENT les couches réseau (authoring + catalogue) pour tester
// l'ORCHESTRATION de createFirstRoutine sans Supabase. La logique pure (modèle,
// résolution) reste réelle (cf. template.test.ts). Les mocks évitent aussi
// d'importer lib/supabase, qui jette si les env vars manquent (cf. supabase.ts).
vi.mock('../authoring/data', () => ({
  createRoutine: vi.fn(async ({ name }: { name: string }) => ({ id: 'routine-1', name })),
  setCurrentRoutine: vi.fn(async () => undefined),
  createSeance: vi.fn(async (_routineId: string, { name }: { name: string }) => ({
    id: 'seance-1',
    name,
  })),
  saveSeanceVersion: vi.fn(async () => 'version-1'),
}));

vi.mock('../capture/data', () => ({
  listExercises: vi.fn(async () => []),
}));

import { createFirstRoutine } from './data';
import { STARTER_TEMPLATE } from './template';
import {
  createRoutine,
  setCurrentRoutine,
  createSeance,
  saveSeanceVersion,
} from '../authoring/data';
import { listExercises } from '../capture/data';

// Un catalogue complet : un id par nom attendu du modèle de départ.
const FULL_CATALOGUE = STARTER_TEMPLATE.exercises.map((e, i) => ({
  id: `ex-${i}`,
  name: e.name,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createFirstRoutine — atomicité (résolution AVANT écriture)', () => {
  it('catalogue incomplet : jette SANS rien écrire (pas d état à moitié créé)', async () => {
    // Le catalogue ne contient AUCUN exo du modèle : la résolution doit jeter.
    vi.mocked(listExercises).mockResolvedValueOnce([]);

    await expect(
      createFirstRoutine({
        routineName: 'Ma routine',
        seanceName: 'Upper A',
        withTemplate: true,
      }),
    ).rejects.toThrow(/introuvable/i);

    // Le cœur du fix : aucune écriture n'a eu lieu avant l'échec de résolution.
    expect(createRoutine).not.toHaveBeenCalled();
    expect(setCurrentRoutine).not.toHaveBeenCalled();
    expect(createSeance).not.toHaveBeenCalled();
    expect(saveSeanceVersion).not.toHaveBeenCalled();
  });

  it('catalogue complet : crée routine + séance puis enregistre les prescriptions résolues', async () => {
    vi.mocked(listExercises).mockResolvedValueOnce(FULL_CATALOGUE as never);

    const result = await createFirstRoutine({
      routineName: 'Ma routine',
      seanceName: 'Upper A',
      withTemplate: true,
    });

    expect(result).toEqual({ routineId: 'routine-1', seanceId: 'seance-1' });
    expect(createRoutine).toHaveBeenCalledWith({ name: 'Ma routine' });
    expect(setCurrentRoutine).toHaveBeenCalledWith('routine-1');
    expect(createSeance).toHaveBeenCalledWith('routine-1', { name: 'Upper A' });

    // saveSeanceVersion reçoit les prescriptions résolues (une par exo du modèle).
    expect(saveSeanceVersion).toHaveBeenCalledTimes(1);
    const [seanceId, prescriptions] = vi.mocked(saveSeanceVersion).mock.calls[0];
    expect(seanceId).toBe('seance-1');
    expect(prescriptions).toHaveLength(STARTER_TEMPLATE.exercises.length);
  });

  it('sans modèle : crée routine + séance vierge, ne touche ni catalogue ni prescriptions', async () => {
    const result = await createFirstRoutine({
      routineName: 'Ma routine',
      seanceName: 'Push',
      withTemplate: false,
    });

    expect(result).toEqual({ routineId: 'routine-1', seanceId: 'seance-1' });
    expect(createRoutine).toHaveBeenCalledTimes(1);
    expect(createSeance).toHaveBeenCalledTimes(1);
    // Pas de modèle : pas de lecture du catalogue ni de version de prescriptions.
    expect(listExercises).not.toHaveBeenCalled();
    expect(saveSeanceVersion).not.toHaveBeenCalled();
  });
});
