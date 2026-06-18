// Données MOCKÉES de la séance « Upper A ».
//
// N'EST PLUS sur le chemin réel de l'app : la capture charge sa séance depuis
// Supabase (cf. data.ts + CaptureScreen.tsx). Conservé comme fixture pour les
// tests et les screenshots de revue design, et comme contrat de FORME : `Session`
// / `SessionExercise` ci-dessous définissent ce que l'UI consomme, que la source
// soit la fixture ou Supabase.
import type { Prescription, PerformedSet } from '../../domain/types';

/** Un exercice de la séance courante, avec son plan cible et sa référence (dernière fois). */
export interface SessionExercise {
  exerciseId: string;
  name: string;
  /** Le plan cible : séries / reps / RIR. */
  prescription: Prescription;
  /**
   * La Référence : les séries réellement faites la dernière fois, par position.
   * Dérivée de l'historique (jamais saisie). `null` = jamais fait → rien à battre.
   */
  reference: PerformedSet[] | null;
}

/** Une Séance : template = liste ordonnée d'exercices, chacun avec sa prescription. */
export interface Session {
  id: string;
  name: string;
  exercises: SessionExercise[];
}

const r = (min: number, max: number): { min: number; max: number } => ({ min, max });

export const upperA: Session = {
  id: 'session-upper-a',
  name: 'Upper A',
  exercises: [
    {
      exerciseId: 'bench-press',
      name: 'Développé couché',
      prescription: { sets: r(3, 4), reps: r(8, 12), rir: r(1, 2) },
      reference: [
        { weightKg: 82.5, reps: 8, rir: 2, order: 1 },
        { weightKg: 82.5, reps: 7, rir: 1, order: 2 },
        { weightKg: 80, reps: 8, rir: 1, order: 3 },
      ],
    },
    {
      exerciseId: 'seated-row',
      name: 'Tirage horizontal',
      prescription: { sets: r(3, 4), reps: r(10, 12), rir: r(1, 2) },
      reference: [
        { weightKg: 70, reps: 11, rir: 2, order: 1 },
        { weightKg: 70, reps: 10, rir: 1, order: 2 },
        { weightKg: 67.5, reps: 11, rir: 1, order: 3 },
        { weightKg: 67.5, reps: 10, rir: 1, order: 4 },
      ],
    },
    {
      exerciseId: 'overhead-press',
      name: 'Développé militaire',
      prescription: { sets: r(3, 3), reps: r(6, 8), rir: r(2, 2) },
      reference: [
        { weightKg: 47.5, reps: 7, rir: 2, order: 1 },
        { weightKg: 47.5, reps: 6, rir: 1, order: 2 },
        { weightKg: 45, reps: 7, rir: 2, order: 3 },
      ],
    },
    {
      // Premier passage sur cet exo : aucune référence à battre (un trou, pas un zéro).
      exerciseId: 'biceps-curl',
      name: 'Curl biceps haltères',
      prescription: { sets: r(3, 4), reps: r(10, 15), rir: r(0, 1) },
      reference: null,
    },
  ],
};
