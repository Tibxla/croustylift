// Tests pour le préremplissage du brouillon de série (issue #58). Fonction pure,
// testable sans DOM (environment: 'node').

import { describe, expect, it } from 'vitest';
import { seedDraft } from './capture-seed';
import type { Prescription, PerformedSet } from '../../domain/types';

const range = (min: number, max: number) => ({ min, max });

const prescription: Prescription = {
  sets: range(3, 4),
  reps: range(8, 12),
  rir: range(1, 2),
};

const reference: PerformedSet[] = [
  { weightKg: 82.5, reps: 8, rir: 2, order: 1 },
  { weightKg: 82.5, reps: 7, rir: 1, order: 2 },
  { weightKg: 80, reps: 8, rir: 1, order: 3 },
];

describe('seedDraft — reps préremplies (point 2 #58)', () => {
  it('prend la borne basse de la fourchette de reps prescrite', () => {
    const seed = seedDraft({ prescription, reference, loggedSets: [] });
    expect(seed.reps).toBe(8); // reps.min de [8, 12]
  });

  it('prend la valeur fixe quand la prescription de reps est un singleton', () => {
    const fixed: Prescription = { sets: range(3, 3), reps: range(6, 6), rir: range(2, 2) };
    const seed = seedDraft({ prescription: fixed, reference: null, loggedSets: [] });
    expect(seed.reps).toBe(6);
  });

  it('garde reps = reps_min même après des séries loggées (pas de report)', () => {
    const loggedSets: PerformedSet[] = [{ weightKg: 80, reps: 11, rir: 0, order: 1 }];
    const seed = seedDraft({ prescription, reference, loggedSets });
    expect(seed.reps).toBe(8); // reste reps.min, ne reporte pas les 11 reps faites
  });
});

describe('seedDraft — poids prérempli (point 1 #58)', () => {
  it('1re série sans référence : point de départ neutre', () => {
    const seed = seedDraft({ prescription, reference: null, loggedSets: [] });
    expect(seed.weightKg).toBe(20);
  });

  it('1re série avec référence : reprend le poids de la référence à la position 1', () => {
    const seed = seedDraft({ prescription, reference, loggedSets: [] });
    expect(seed.weightKg).toBe(82.5); // reference order=1
  });

  it('2e série : reprend le poids de la dernière série loggée (pas la référence)', () => {
    const loggedSets: PerformedSet[] = [{ weightKg: 77.5, reps: 8, rir: 1, order: 1 }];
    const seed = seedDraft({ prescription, reference, loggedSets });
    expect(seed.weightKg).toBe(77.5);
  });

  it('3e série : reprend le poids de la 2e série loggée', () => {
    const loggedSets: PerformedSet[] = [
      { weightKg: 77.5, reps: 8, rir: 1, order: 1 },
      { weightKg: 75, reps: 7, rir: 0, order: 2 },
    ];
    const seed = seedDraft({ prescription, reference, loggedSets });
    expect(seed.weightKg).toBe(75); // dernière loggée
  });
});

describe('seedDraft — unilatéral (côté visé, issue #46/#63)', () => {
  // Référence G/D : chaque rang porte DEUX lignes (un côté chacune). G plus léger
  // que D pour qu'un mauvais côté pioché soit détectable par la valeur.
  const refUni: PerformedSet[] = [
    { weightKg: 30, reps: 8, rir: 2, order: 1, side: 'left' },
    { weightKg: 34, reps: 8, rir: 1, order: 1, side: 'right' },
    { weightKg: 30, reps: 8, rir: 1, order: 2, side: 'left' },
    { weightKg: 34, reps: 7, rir: 0, order: 2, side: 'right' },
  ];

  it('1re série, côté gauche : pioche la ligne de réf order=1 side=left', () => {
    const seed = seedDraft({ prescription, reference: refUni, loggedSets: [], side: 'left' });
    expect(seed.weightKg).toBe(30); // pas 34 (le droit)
    expect(seed.rir).toBe(2); // rir du gauche order=1
  });

  it('1re série, côté droite : pioche la ligne de réf order=1 side=right', () => {
    const seed = seedDraft({ prescription, reference: refUni, loggedSets: [], side: 'right' });
    expect(seed.weightKg).toBe(34); // pas 30 (le gauche)
    expect(seed.rir).toBe(1); // rir du droit order=1
  });

  it('2e série, côté gauche : vise order=2 side=left (pas la dérive length+1 → order 3)', () => {
    // Série 1 complète (G+D) déjà loggée : 2 lignes. Sans le fix, length+1 = 3
    // viserait un order inexistant et le report tomberait sur la dernière ligne (D).
    const loggedSets: PerformedSet[] = [
      { weightKg: 30, reps: 8, rir: 2, order: 1, side: 'left' },
      { weightKg: 34, reps: 8, rir: 1, order: 1, side: 'right' },
    ];
    const seed = seedDraft({ prescription, reference: refUni, loggedSets, side: 'left' });
    // 2e série côté gauche : report de la dernière loggée du MÊME côté (le G de la
    // série 1, à 30), pas de la dernière ligne tous côtés confondus (le D à 34).
    expect(seed.weightKg).toBe(30);
  });

  it('2e série, côté droite : report de la dernière loggée du côté droit', () => {
    const loggedSets: PerformedSet[] = [
      { weightKg: 30, reps: 8, rir: 2, order: 1, side: 'left' },
      { weightKg: 36, reps: 8, rir: 1, order: 1, side: 'right' }, // D loggé à 36
    ];
    const seed = seedDraft({ prescription, reference: refUni, loggedSets, side: 'right' });
    expect(seed.weightKg).toBe(36); // dernière loggée du droit, pas le gauche (30)
  });

  it('2e côté de la 1re série (G fait, on saisit D) : report de la réf order=1 side=right, pas du G saisi', () => {
    // Série 1 entamée côté gauche seulement (1 ligne). On vise maintenant le droit
    // de la MÊME série (order 1) : aucune saisie droite encore → on retombe sur la
    // référence du côté droit à order 1 (34), pas sur le poids du gauche saisi (30).
    const loggedSets: PerformedSet[] = [
      { weightKg: 30, reps: 9, rir: 1, order: 1, side: 'left' },
    ];
    const seed = seedDraft({ prescription, reference: refUni, loggedSets, side: 'right' });
    expect(seed.weightKg).toBe(34); // réf droit order=1, pas le 30 du gauche
  });

  it('côté sans référence ni saisie : point de départ neutre', () => {
    const seed = seedDraft({ prescription, reference: null, loggedSets: [], side: 'left' });
    expect(seed.weightKg).toBe(20);
    expect(seed.rir).toBe(1);
  });

  it('reps reste la borne basse prescrite, indépendamment du côté', () => {
    const seed = seedDraft({ prescription, reference: refUni, loggedSets: [], side: 'right' });
    expect(seed.reps).toBe(8); // reps.min de [8, 12]
  });
});

describe('seedDraft — rir prérempli (comportement préservé)', () => {
  it('1re série : prend le rir de la référence à la position courante', () => {
    const seed = seedDraft({ prescription, reference, loggedSets: [] });
    expect(seed.rir).toBe(2); // reference order=1
  });

  it('1re série sans référence : point de départ neutre', () => {
    const seed = seedDraft({ prescription, reference: null, loggedSets: [] });
    expect(seed.rir).toBe(1);
  });

  it('série suivante : reporte le rir de la dernière série loggée si la référence ne couvre pas la position', () => {
    // 4e série loggée alors que la référence n'a que 3 positions.
    const loggedSets: PerformedSet[] = [
      { weightKg: 82.5, reps: 8, rir: 2, order: 1 },
      { weightKg: 82.5, reps: 7, rir: 1, order: 2 },
      { weightKg: 80, reps: 8, rir: 1, order: 3 },
    ];
    const seed = seedDraft({ prescription, reference, loggedSets });
    expect(seed.rir).toBe(1); // report de la dernière loggée (ref épuisée)
  });
});
