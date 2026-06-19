// Vocabulaire du domaine Croustylift (cf. CONTEXT.md et docs/adr/).
// Types purs, sans dépendance — partagés par les modules de logique.

/** Fourchette (min, max). Une valeur fixe est représentée par `min === max`. */
export interface Range {
  min: number;
  max: number;
}

/** Le plan cible d'un exercice dans une séance : séries, reps et RIR, chacun en fourchette. */
export interface Prescription {
  sets: Range;
  reps: Range;
  rir: Range;
}

/**
 * Le côté d'une série pour un exo UNILATÉRAL (mouvement exécuté un côté à la
 * fois, cf. issue #33). Une série unilatérale se complète en saisissant le côté
 * gauche PUIS le droit, chacun avec ses propres poids/reps/RIR. Pour un exo
 * BILATÉRAL, le côté est absent (`undefined`) : la série couvre les deux côtés.
 */
export type Side = 'left' | 'right';

/** Une Série de travail réellement effectuée. Aucun échauffement n'est loggé. */
export interface PerformedSet {
  weightKg: number;
  reps: number;
  rir: number;
  /** Rang d'ordre de la série dans l'exécution de l'exo, à partir de 1. */
  order: number;
  /**
   * Côté pour un exo UNILATÉRAL : deux séries (gauche + droite) partagent le même
   * `order`. Absent (`undefined`) pour un exo bilatéral (une série = les deux côtés).
   */
  side?: Side;
}

/** Les séries d'un exercice un jour donné. `sets` vide = exo skippé ce jour (un trou, pas un zéro). */
export interface ExerciseExecution {
  /** Date ISO 'YYYY-MM-DD'. */
  date: string;
  exerciseId: string;
  sets: PerformedSet[];
}

/** Un point de la courbe e1RM : un 1RM estimé à une date. */
export interface E1rmPoint {
  /** Date ISO 'YYYY-MM-DD'. */
  date: string;
  e1rm: number;
}

/** Un changement de configuration de template à une date (cf. ADR 0001). */
export interface ConfigChange {
  /** Date ISO 'YYYY-MM-DD' à partir de laquelle `configId` est la config courante. */
  date: string;
  /** Identité de la configuration de template active (routine + ses séances versionnées). */
  configId: string;
}

/** Un bloc : période continue de configuration inchangée. Dérivé, jamais déclaré. */
export interface Block {
  configId: string;
  /** Date ISO de début (incluse). */
  start: string;
  /** Date ISO de début du bloc suivant, ou `null` si bloc en cours. */
  end: string | null;
}
