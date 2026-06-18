import { describe, it, expect } from 'vitest';
import { decideCaptureSource, type SeanceChoice } from './data';

// Logique PURE de sélection de la séance en Capture (issue #1).
//
// La capture ne charge plus « la 1ʳᵉ séance de la 1ʳᵉ routine » : elle respecte
// la ROUTINE COURANTE (getCurrentRoutineId) et présente ses séances. La fixture
// de démo ne sert plus que de FALLBACK (user sans routine exploitable).
//
// `decideCaptureSource` tranche cette décision à partir de deux entrées déjà
// lues côté Supabase (id de routine courante + séances de cette routine), pour
// la garder testable sans toucher la base.

const seance = (id: string, name: string): SeanceChoice => ({ id, name });

describe('decideCaptureSource', () => {
  it('aucune routine courante -> fallback démo', () => {
    expect(decideCaptureSource(null, [])).toEqual({ kind: 'demo' });
  });

  it('routine courante mais sans séance -> fallback démo (rien à choisir)', () => {
    expect(decideCaptureSource('routine-1', [])).toEqual({ kind: 'demo' });
  });

  it('routine courante avec séances -> choix parmi ces séances', () => {
    const seances = [seance('s-1', 'Upper'), seance('s-2', 'Lower')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });

  it('une seule séance reste un choix (pas un raccourci automatique ici)', () => {
    const seances = [seance('s-1', 'Full body')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });
});
