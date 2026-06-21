// Données MOCKÉES de la séance « Upper A ».
//
// N'EST PLUS sur le chemin réel de l'app : la capture charge sa séance depuis
// Supabase (cf. data.ts + CaptureScreen.tsx). Conservé comme fixture pour les
// tests et les screenshots de revue design, et comme contrat de FORME : `Session`
// / `SessionExercise` ci-dessous définissent ce que l'UI consomme, que la source
// soit la fixture ou Supabase.
import type { Prescription, PerformedSet } from '../../domain/types';
import type { PersonalRecord, PersonalRecordBySide } from '../../domain/pr';

/**
 * Provenance d'un exo DANS l'exécution courante (issue #36) :
 *   - 'template' (ou absent) : vient du template versionné de la séance ;
 *   - 'added'                : ajouté à la volée, hors template ;
 *   - 'swapped'              : remplace un exo du template (cf. `swappedFrom`).
 * Sert à signaler sobrement l'écart en Capture et à dériver les déviations
 * d'exo par diff (cf. ADR 0002). N'altère jamais le template versionné.
 */
export type ExerciseOrigin = 'template' | 'added' | 'swapped';

/** Un exercice de la séance courante, avec son plan cible et sa référence (dernière fois). */
export interface SessionExercise {
  exerciseId: string;
  name: string;
  /**
   * Exo UNILATÉRAL (issue #33/#46) : mouvement exécuté un côté à la fois. En
   * Capture, une série se logge côté gauche PUIS droite (valeurs distinctes
   * possibles). Absent/`false` = bilatéral (une saisie par série). Défaut sûr
   * `false` pour la rétrocompat des fixtures et d'un chargement partiel.
   */
  unilateral?: boolean;
  /**
   * Muscles principaux de l'exo (LISTE, issue #33), vocabulaire canonique.
   * Alimente le décompte RÉEL des séries par muscle en fin de séance (issue #37).
   * Absent/vide = exo legacy sans `primary_muscles` : il compte au total mais pour
   * aucun muscle. Défaut sûr pour la rétrocompat des fixtures et d'un chargement partiel.
   */
  primaryMuscles?: string[];
  /** Le plan cible : séries / reps / RIR. */
  prescription: Prescription;
  /**
   * La Référence : les séries réellement faites la dernière fois, par position.
   * Dérivée de l'historique (jamais saisie). `null` = jamais fait → rien à battre.
   */
  reference: PerformedSet[] | null;
  /**
   * Les records personnels de l'exo (issue #34), dérivés de l'historique : sert
   * à signaler en Capture qu'une série loggée bat un record. `null` = pas encore
   * chargé / aucun historique (premier passage). Distinct de la `reference`
   * (dernière fois) : le record est le meilleur de TOUT l'historique.
   */
  personalRecord?: PersonalRecord | null;
  /**
   * Records PAR CÔTÉ d'un exo unilatéral (ADR 0010) : en salle, chaque bras est sa
   * propre piste (badge « Record » par côté). Dérivé de l'historique. `null`/absent
   * = bilatéral ou pas encore chargé. Le `personalRecord` côté faible reste, lui,
   * pour l'analyse (courbe). N'a de sens que si `unilateral`.
   */
  personalRecordBySide?: PersonalRecordBySide | null;
  /**
   * La note datée la PLUS RÉCENTE des séances passées sur cet exo (ADR « Note
   * datée » du glossaire), ressortie en REPÈRE lecture seule (« Dernière fois tu
   * notais : … »). Vide = aucune note antérieure. Distincte de la note du jour
   * (saisissable) et de la note d'instructions (persistante).
   */
  previousDatedNote?: string;
  /**
   * Note d'INSTRUCTIONS persistante de l'exo (issue #26), chargée depuis
   * `exercise_notes`. Affichée en RÉFÉRENCE (lecture seule) pendant la série, pas
   * éditée ici (l'édition vit dans l'authoring). Chaîne vide = aucune instruction.
   */
  perExerciseNote: string;
  /**
   * Provenance de l'exo (issue #36). Absent = exo du template (défaut, pour
   * rétrocompatibilité des fixtures et du chargement Supabase). Posé par
   * `addExercise`/`swapExercise` quand l'exo est ajouté/échangé à la volée.
   */
  origin?: ExerciseOrigin;
  /**
   * Pour un exo `swapped` : l'exerciseId de l'exo du template qu'il remplace.
   * Permet de tracer la déviation « exo remplacé » (cf. ADR 0002).
   */
  swappedFrom?: string;
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
      perExerciseNote: 'Omoplates rétractées, pieds bien ancrés. Barre au sternum.',
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
      perExerciseNote: '',
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
      perExerciseNote: '',
    },
    {
      // Premier passage sur cet exo : aucune référence à battre (un trou, pas un zéro).
      exerciseId: 'biceps-curl',
      name: 'Curl biceps haltères',
      prescription: { sets: r(3, 4), reps: r(10, 15), rir: r(0, 1) },
      reference: null,
      perExerciseNote: '',
    },
  ],
};
