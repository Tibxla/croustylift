// Vocabulaire du domaine Croustylift (cf. GLOSSARY.md et docs/adr/).
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
  /**
   * Timestamp ISO de création de l'exécution. Départage de façon déterministe
   * deux exécutions à `date` égale (reprise après clôture, ou 2 séances le même
   * jour — `performed_on` est à la granularité du jour). Optionnel : seules les
   * dérivées sensibles aux égalités (cf. `lastReference`) le portent ; les
   * consommateurs qui n'en ont pas besoin construisent l'objet sans.
   */
  createdAt?: string;
  /**
   * Id de l'exécution (UUID client, cf. ADR 0003). Tie-break FINAL des dérivées
   * sensibles aux égalités (`lastReference`, les courbes) : à `date` ET
   * `createdAt` égaux (timestamps tronqués, import groupé, horloge imprécise),
   * il départage de façon stable plutôt que de laisser l'ordre du tableau —
   * non garanti côté data — trancher. Optionnel comme `createdAt` : seuls ces
   * consommateurs le portent.
   */
  id?: string;
  /**
   * Timestamp ISO du LANCEMENT de la séance (`executions.started_at`, ADR 0011).
   * C'est l'instant qui rattache l'exécution à son bloc (ADR 0001) : posé par
   * l'appareil au lancement, il ne dépend pas du moment où la ligne atteint la
   * base (`createdAt`, plus tardif après une séance hors ligne). Absent sur les
   * exécutions d'avant la colonne : `createdAt` sert alors de repli.
   */
  startedAt?: string;
  /**
   * Id de la SÉANCE (le template, à travers toutes ses versions) dont cette
   * exécution est le déroulé. Porte le scope « même séance » des dérivées :
   * Référence en Capture, courbes e1RM par séance en Analyse (un même exo n'a
   * pas la même perf selon le contexte de fatigue de la séance, cf. GLOSSARY.md
   * « Référence »). Optionnel : seuls les consommateurs scopés le portent ;
   * absent quand la séance n'est plus résoluble (jointure manquante).
   */
  seanceId?: string;
}

/** Un point de la courbe e1RM : un 1RM estimé à une date. */
export interface E1rmPoint {
  /** Date ISO 'YYYY-MM-DD'. */
  date: string;
  e1rm: number;
}

/** Un changement de configuration de template à un instant (cf. ADR 0001). */
export interface ConfigChange {
  /** Jour ISO 'YYYY-MM-DD' (heure locale) du changement : libellé et repli sans instant. */
  date: string;
  /**
   * Instant ISO du changement. C'est LUI qui borne les blocs : une séance faite
   * le même jour mais avant lui reste dans le bloc précédent. Absent seulement
   * quand la source n'a qu'un jour (bloc implicite d'avant toute activation).
   */
  at?: string;
  /** Identité de la configuration de template active (routine + ses séances versionnées). */
  configId: string;
}

/** Un bloc : période continue de configuration inchangée. Dérivé, jamais déclaré. */
export interface Block {
  configId: string;
  /** Jour ISO de début (heure locale) : libellé, et borne au jour faute d'instant. */
  start: string;
  /** Jour ISO de début du bloc suivant, ou `null` si bloc en cours. */
  end: string | null;
  /** Instant ISO de début (inclus), quand le changement de plan en porte un. */
  startAt?: string;
  /** Instant ISO de début du bloc suivant (exclu). Absent si en cours ou sans instant. */
  endAt?: string;
}
