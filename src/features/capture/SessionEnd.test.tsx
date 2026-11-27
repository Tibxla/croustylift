// L'ordre de la fin de séance, rendu en HTML statique. Demande du 25/11 : la
// saisie du BPM moyen (et la durée, du même groupe) vient en tête, sous le
// titre, avant le récap ; on ne descend pas tout l'écran pour la noter.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionEnd } from './SessionEnd';
import type { SessionRecap } from './session-recap';

const noop = () => {};

const recap: SessionRecap = {
  sessionName: 'Upper A',
  exercises: [],
  counts: { fait: 0, 'en-cours': 0, passe: 0, 'pas-fait': 0 },
  setsLogged: 3,
  beaten: 0,
  records: [],
  liftedKg: 1200,
};

describe('fin de séance', () => {
  it('place la durée et le BPM moyen avant le récap', () => {
    const html = renderToStaticMarkup(
      <SessionEnd
        recap={recap}
        today={[]}
        planned={[]}
        dateIso="2026-11-25"
        startedAt={Date.UTC(2026, 10, 25, 17)}
        durationMin={62}
        onSave={noop}
        onBack={noop}
        onNewSession={noop}
      />,
    );
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const bpm = at('Ajouter le BPM moyen');
    expect(at('Fin de séance')).toBeLessThan(at('Durée et cardio'));
    expect(at('Durée et cardio')).toBeLessThan(bpm);
    expect(bpm).toBeLessThan(at('kg soulevés'));
    expect(bpm).toBeLessThan(at('Exercices de la séance'));
  });

  it('séries par muscle : la séance contre son propre prévu, sans la semaine (27/11)', () => {
    const html = renderToStaticMarkup(
      <SessionEnd
        recap={{ ...recap, sessionName: 'FB' }}
        today={[{ unilateral: false, primaryMuscles: ['pectoraux'], sets: [{ order: 1, weightKg: 80, reps: 10, rir: 2 }] }]}
        planned={[{ unilateral: false, primaryMuscles: ['pectoraux'], sets: { min: 1, max: 1 }, reps: { min: 8, max: 12 } }]}
        dateIso="2026-11-27"
        startedAt={Date.UTC(2026, 10, 27, 12)}
        durationMin={62}
        onSave={noop}
        onBack={noop}
        onNewSession={noop}
      />,
    );
    expect(html).toContain('Prévu : la séance FB.');
    expect(html).toContain('dans le prévu');
    expect(html).not.toContain('semaine');
    expect(html).not.toContain('plus tôt');
  });
});
