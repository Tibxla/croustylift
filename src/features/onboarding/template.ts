// Modèle de départ du premier lancement + détection — logique PURE.
//
// Ce fichier n'importe RIEN de Supabase : il reste testable sans réseau ni .env
// (cf. onboarding.test.ts). L'orchestration des inserts vit dans data.ts.
import type { Prescription } from '../../domain/types';
import type { PrescriptionInput } from '../authoring/data';

// =====================================================================
// Détection du premier lancement
// =====================================================================

/**
 * Premier lancement = l'utilisateur n'a AUCUNE routine. Dans ce cas on affiche
 * l'écran de premier lancement plutôt qu'une routine auto-créée. Dès qu'une
 * routine existe (même créée ailleurs), ce n'est plus un premier lancement.
 */
export function isFirstLaunch(routineCount: number): boolean {
  return routineCount === 0;
}

// =====================================================================
// Modèle de départ
// =====================================================================

/** Un exercice du modèle, par NOM (les UUID des exos de base sont résolus à l'exécution). */
export interface StarterExercise {
  name: string;
  prescription: Prescription;
}

/** Le modèle de départ proposé au premier lancement : un nom de séance + des exos prescrits. */
export interface StarterTemplate {
  /** Nom de séance par défaut, librement renommable par l'utilisateur. */
  seanceName: string;
  /** Exos de base pré-prescrits, dans l'ordre (la position suit l'index). */
  exercises: StarterExercise[];
}

/**
 * Modèle « Upper » proposé par défaut : 4 exos de base courants déjà prescrits,
 * pour qu'un débutant ait une séance jouable en salle dès le premier jour. Tous
 * les noms doivent exister dans le catalogue de base (migration 0002). Le nom de
 * la séance ET celui de la routine sont renommables avant validation.
 */
export const STARTER_TEMPLATE: StarterTemplate = {
  seanceName: 'Upper A',
  exercises: [
    {
      name: 'Développé couché',
      prescription: { sets: { min: 3, max: 4 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
    },
    {
      name: 'Tirage horizontal',
      prescription: { sets: { min: 3, max: 4 }, reps: { min: 10, max: 12 }, rir: { min: 1, max: 2 } },
    },
    {
      name: 'Développé militaire',
      prescription: { sets: { min: 3, max: 3 }, reps: { min: 6, max: 8 }, rir: { min: 2, max: 2 } },
    },
    {
      name: 'Curl biceps haltères',
      prescription: { sets: { min: 3, max: 4 }, reps: { min: 10, max: 15 }, rir: { min: 0, max: 1 } },
    },
  ],
};

/** Nom de routine proposé par défaut au premier lancement, renommable. */
export const DEFAULT_ROUTINE_NAME = 'Ma routine';

/**
 * Mappe les exos d'un modèle (par nom) vers des `PrescriptionInput` positionnés
 * (position = index), en résolvant chaque nom via `idByName`. Pur : la résolution
 * des UUID est faite en amont. Un nom absent de la map lève une erreur explicite
 * (catalogue de base incomplet) plutôt que d'insérer une prescription orpheline.
 */
export function resolveStarterPrescriptions(
  template: StarterTemplate,
  idByName: Map<string, string>,
): PrescriptionInput[] {
  return template.exercises.map((ex, index) => {
    const exerciseId = idByName.get(ex.name);
    if (!exerciseId) {
      throw new Error(
        `Exercice de base introuvable pour le modèle de départ : « ${ex.name} ». ` +
          'Vérifie le catalogue de base (migration 0002).',
      );
    }
    return {
      exerciseId,
      position: index,
      sets: ex.prescription.sets,
      reps: ex.prescription.reps,
      rir: ex.prescription.rir,
    };
  });
}
