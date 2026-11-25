// Copies de lecture du PLAN servies à la Capture (ADR 0012), et leur invalidation.
//
// La Capture lit le plan « cache d'abord » : la routine courante et ses séances,
// la version courante de chaque séance, son template, le catalogue d'exos. Une
// modification du plan faite sur le même appareil (séance éditée, routine
// courante changée, archivage, suppression, exo personnalisé) n'était pas vue à
// la première ouverture suivante de la Capture, qui servait la copie d'avant ;
// une séance supprimée restait proposée. Toute écriture du plan marque donc ces
// copies périmées (cf. `invalidateReads` : la lecture suivante passe par le
// réseau, la copie restant le secours hors ligne).
//
// Module à part, sans dépendance vers les couches d'accès : l'authoring et la
// Capture s'importent déjà l'un l'autre.
import { invalidateReads } from '../../lib/read-cache';
import { markDefinitionsWritten } from './written-elsewhere';

/** La routine courante et ses séances proposées au choix. */
export const CAPTURE_SOURCE_KEY = 'capture-source';
/** Version courante d'une séance : `seance-version:<séance>`. */
export const SEANCE_VERSION_PREFIX = 'seance-version:';
/** Toutes les versions d'une séance : `seance-version-ids:<séance>`. */
export const SEANCE_VERSION_IDS_PREFIX = 'seance-version-ids:';
/** Template d'une version : `seance-template:<version>:<séance>`. */
export const SEANCE_TEMPLATE_PREFIX = 'seance-template:';
/** Catalogue des exos, overrides fusionnés. */
export const EXERCISES_KEY = 'exercises';
/** Note d'instructions d'un exo : `exo-note:<exo>`. */
export const EXERCISE_NOTE_PREFIX = 'exo-note:';

/**
 * Le plan vient d'être modifié depuis cet appareil : ses copies sont périmées.
 * `seance-version:` couvre aussi `seance-version-ids:` (même début de clé), les
 * deux changent ensemble à chaque version créée.
 */
export function invalidatePlanCopies(): void {
  // La Salle, cachée sur une séance ouverte, relira ses définitions à son retour
  // (nom, unilatéral, note des exos ; written-elsewhere.ts).
  markDefinitionsWritten();
  invalidateReads([
    CAPTURE_SOURCE_KEY,
    SEANCE_VERSION_PREFIX,
    SEANCE_VERSION_IDS_PREFIX,
    SEANCE_TEMPLATE_PREFIX,
    EXERCISES_KEY,
  ]);
}

/** La note d'instructions d'un exo vient d'être écrite hors de l'outbox. */
export function invalidateExerciseNoteCopy(exerciseId: string): void {
  markDefinitionsWritten();
  invalidateReads([`${EXERCISE_NOTE_PREFIX}${exerciseId}`]);
}
