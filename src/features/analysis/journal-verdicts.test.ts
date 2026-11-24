// Le statut de chaque série du Journal face à sa Référence (▲ battue, ▬ égalée,
// ▼ en deçà, ▲ record), recalculé sur l'historique comme en salle : même
// Référence (la dernière exécution de l'exo DANS LA MÊME SÉANCE), mêmes badges
// (Record > battue > égalée, ADR 0010). e1RM = w × (1 + (reps + rir) / 30).
import { describe, expect, it } from 'vitest';
import type { RawLogEntry, RawLogSet } from './raw-log';
import { journalVerdicts } from './journal-verdicts';

const set = (weightKg: number, reps: number, rir: number, order: number, side?: 'left' | 'right'): RawLogSet => ({
  weightKg,
  reps,
  rir,
  order,
  side,
});

/** Une séance du journal : un exo par entrée de `exercises`. */
const entry = (
  executionId: string,
  date: string,
  seanceId: string | null,
  exercises: Record<string, RawLogSet[]>,
): RawLogEntry => ({
  executionId,
  date,
  seanceId,
  sessionName: seanceId,
  routineName: 'PPL',
  bpmAvg: null,
  durationMin: null,
  exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({ exerciseId, name: exerciseId, sets })),
});

/** `buildRawLog` rend la plus récente en tête : on suit le même ordre. */
const recentFirst = (...entries: RawLogEntry[]) => [...entries].reverse();

describe('journalVerdicts', () => {
  it('première fois dans la séance : aucun statut, rien de battu', () => {
    const v = journalVerdicts([entry('e1', '2026-01-01', 'push', { bench: [set(100, 5, 1, 1)] })]);
    expect(v.get('e1')!.sets.get('bench')).toEqual([null]);
    expect(v.get('e1')!.beaten).toBe(0);
  });

  it('battue, égalée, en deçà : chaque série face à la série de même rang la dernière fois', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'push', { bench: [set(100, 5, 1, 1), set(100, 5, 1, 2), set(100, 5, 1, 3)] }),
        // Rang 1 : la même série, au record sans le battre ; rang 4 : rien à cette place la dernière fois.
        entry('e2', '2026-01-08', 'push', { bench: [set(100, 5, 1, 1), set(95, 5, 1, 2), set(100, 5, 1, 3), set(80, 5, 1, 4)] }),
      ),
    );
    expect(v.get('e2')!.sets.get('bench')).toEqual(['egalee', 'en-deca', 'egalee', null]);
    expect(v.get('e2')!.beaten).toBe(0);
  });

  it('une série qui bat le record se dit « record », pas aussi « battue » (comme en salle)', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'push', { bench: [set(100, 5, 1, 1), set(90, 5, 1, 2)] }),
        entry('e2', '2026-01-08', 'push', { bench: [set(105, 5, 1, 1), set(95, 5, 1, 2)] }),
      ),
    );
    expect(v.get('e2')!.sets.get('bench')).toEqual(['record', 'battue']);
    expect(v.get('e2')!.beaten).toBe(1);
    expect(v.get('e2')!.records).toBe(1);
  });

  it('un record de charge seul se dit « record charge »', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'push', { bench: [set(100, 8, 1, 1)] }), // e1RM 130
        entry('e2', '2026-01-08', 'push', { bench: [set(105, 3, 1, 1)] }), // e1RM 119, mais 105 kg
      ),
    );
    expect(v.get('e2')!.sets.get('bench')).toEqual(['record-charge']);
  });

  it('la Référence est la même séance : le même exo fait ailleurs ne compte pas', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'push', { bench: [set(100, 5, 1, 1)] }),
        entry('e2', '2026-01-03', 'upper', { bench: [set(90, 5, 1, 1)] }),
      ),
    );
    // Rien à battre dans Upper (première fois), et pas de record (100 kg avant).
    expect(v.get('e2')!.sets.get('bench')).toEqual([null]);
  });

  it('la Référence est la DERNIÈRE fois dans la séance, pas la meilleure', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'push', { bench: [set(110, 5, 1, 1)] }),
        entry('e2', '2026-01-08', 'push', { bench: [set(90, 5, 1, 1)] }),
        entry('e3', '2026-01-15', 'push', { bench: [set(95, 5, 1, 1)] }),
      ),
    );
    expect(v.get('e3')!.sets.get('bench')).toEqual(['battue']);
  });

  it('une séance hors plan (sans séance) n’a pas de Référence', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', null, { bench: [set(100, 5, 1, 1)] }),
        entry('e2', '2026-01-08', null, { bench: [set(90, 5, 1, 1)] }),
      ),
    );
    expect(v.get('e2')!.sets.get('bench')).toEqual([null]);
  });

  it('unilatéral : chaque côté contre son propre côté la dernière fois', () => {
    const v = journalVerdicts(
      recentFirst(
        entry('e1', '2026-01-01', 'pull', { curl: [set(20, 10, 1, 1, 'left'), set(20, 10, 1, 1, 'right'), set(20, 8, 1, 2, 'left'), set(20, 8, 1, 2, 'right')] }),
        entry('e2', '2026-01-08', 'pull', { curl: [set(20, 8, 1, 1, 'left'), set(20, 10, 1, 1, 'right'), set(20, 9, 1, 2, 'left'), set(20, 7, 1, 2, 'right')] }),
      ),
    );
    expect(v.get('e2')!.sets.get('curl')).toEqual(['en-deca', 'egalee', 'battue', 'en-deca']);
    expect(v.get('e2')!.beaten).toBe(1);
  });
});
