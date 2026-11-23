// Éviction des copies de lecture quand le stockage de l'appareil est plein.
//
// Les copies de lecture partagent le quota de la file d'écritures et de la
// séance en cours. Quand une écriture est refusée, elles cèdent la place : une
// copie se relit sur le réseau, pas une saisie. Mais PAS toutes : vider tout le
// cache empêchait de rouvrir la Capture hors ligne (routine, séances, template
// et historique des exos du plan se relisaient sur le réseau), alors que
// l'utilisateur est justement en salle, hors ligne, en train de saisir.
//
// Deux paliers, du moins utile au plus utile, et un plancher :
//   1. les repères « tu notais » et le catalogue d'exos (confort : le repère est
//      tolérant, le catalogue ne sert qu'à ajouter un exo) ;
//   2. l'historique et la note des exos qui ne sont dans AUCUN template en copie
//      (exos d'anciens plans, exos ajoutés un jour à la volée) ;
//   - JAMAIS le chemin d'ouverture : `capture-source`, versions et templates des
//     séances, contrôle de premier lancement, historique et note des exos des
//     templates en copie.
// Si cela ne suffit pas, la file tient en mémoire (cf. outbox, `writeQueue`).
//
// Module sans dépendance vers les couches d'accès : l'outbox et l'état de
// capture l'appellent, et les couches d'accès importent l'outbox.
import { cachedKeys, dropRead, peekRead } from '../../lib/read-cache';
import { EXERCISE_NOTE_PREFIX, EXERCISES_KEY, SEANCE_TEMPLATE_PREFIX } from './plan-copies';

const EXERCISE_ROWS_PREFIX = 'exo-execs:';
const COMFORT_PREFIXES = ['last-exec:', 'prev-notes:'];

/** Les exos des templates en copie : leurs lectures sont sur le chemin d'ouverture. */
function plannedExerciseIds(): Set<string> {
  const ids = new Set<string>();
  for (const key of cachedKeys(SEANCE_TEMPLATE_PREFIX)) {
    const template = peekRead<{ exercises?: { exerciseId?: unknown }[] }>(key);
    for (const exercise of template?.exercises ?? []) {
      if (typeof exercise.exerciseId === 'string') ids.add(exercise.exerciseId);
    }
  }
  return ids;
}

/**
 * Retire les copies NON ESSENTIELLES du palier demandé (cf. en-tête) et rend le
 * nombre de copies retirées. Les copies du chemin d'ouverture ne sont jamais
 * touchées, quel que soit le palier.
 */
export function evictNonEssentialCopies(tier: 1 | 2): number {
  let dropped = 0;
  const drop = (key: string) => {
    dropRead(key);
    dropped += 1;
  };
  if (tier === 1) {
    for (const prefix of COMFORT_PREFIXES) cachedKeys(prefix).forEach(drop);
    // `exercises` tout court : pas les clés qui commencent par lui.
    cachedKeys(EXERCISES_KEY)
      .filter((key) => key === EXERCISES_KEY)
      .forEach(drop);
    return dropped;
  }
  const planned = plannedExerciseIds();
  for (const prefix of [EXERCISE_ROWS_PREFIX, EXERCISE_NOTE_PREFIX]) {
    for (const key of cachedKeys(prefix)) {
      if (!planned.has(key.slice(prefix.length))) drop(key);
    }
  }
  return dropped;
}

/**
 * Tente `write` ; s'il est refusé (stockage plein), fait céder les copies non
 * essentielles, palier par palier, en retentant après chacun. Rend vrai dès que
 * l'écriture passe, faux si elle est toujours refusée une fois les deux paliers
 * épuisés.
 */
export function writeMakingRoom(write: () => boolean): boolean {
  if (write()) return true;
  for (const tier of [1, 2] as const) {
    if (evictNonEssentialCopies(tier) > 0 && write()) return true;
  }
  return false;
}
