import { describe, it, expect } from 'vitest';
import {
  isFirstLaunch,
  STARTER_TEMPLATE,
  resolveStarterPrescriptions,
} from './template';

describe('isFirstLaunch', () => {
  it('aucune routine -> premier lancement', () => {
    expect(isFirstLaunch(0)).toBe(true);
  });

  it('au moins une routine -> pas un premier lancement', () => {
    expect(isFirstLaunch(1)).toBe(false);
    expect(isFirstLaunch(5)).toBe(false);
  });
});

describe('STARTER_TEMPLATE (modèle de départ renommable)', () => {
  it('propose un nom de séance par défaut, modifiable par l utilisateur', () => {
    expect(STARTER_TEMPLATE.seanceName).toBeTruthy();
    expect(typeof STARTER_TEMPLATE.seanceName).toBe('string');
  });

  it('liste des exercices de base avec leur prescription, ordonnés', () => {
    expect(STARTER_TEMPLATE.exercises.length).toBeGreaterThan(0);
    for (const ex of STARTER_TEMPLATE.exercises) {
      expect(ex.name).toBeTruthy();
      expect(ex.prescription.sets.min).toBeGreaterThan(0);
      expect(ex.prescription.reps.min).toBeGreaterThan(0);
    }
  });
});

describe('resolveStarterPrescriptions', () => {
  it('résout les noms d exos en exerciseId et produit des PrescriptionInput positionnés', () => {
    const idByName = new Map(
      STARTER_TEMPLATE.exercises.map((e, i) => [e.name, `ex-${i}`]),
    );

    const out = resolveStarterPrescriptions(STARTER_TEMPLATE, idByName);

    expect(out).toHaveLength(STARTER_TEMPLATE.exercises.length);
    out.forEach((p, i) => {
      expect(p.exerciseId).toBe(`ex-${i}`);
      expect(p.position).toBe(i);
      expect(p.sets).toEqual(STARTER_TEMPLATE.exercises[i].prescription.sets);
      expect(p.reps).toEqual(STARTER_TEMPLATE.exercises[i].prescription.reps);
      expect(p.rir).toEqual(STARTER_TEMPLATE.exercises[i].prescription.rir);
    });
  });

  it('exo de base introuvable -> lève une erreur explicite (catalogue incomplet)', () => {
    const idByName = new Map<string, string>(); // aucun exo résolu
    expect(() => resolveStarterPrescriptions(STARTER_TEMPLATE, idByName)).toThrow(
      /introuvable/i,
    );
  });
});
