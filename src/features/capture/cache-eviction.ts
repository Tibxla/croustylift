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
//   1. les repères « tu notais », le catalogue d'exos et les copies des écrans
//      au calme, Séances et Analyse (confort : le repère est tolérant, le
//      catalogue ne sert qu'à ajouter un exo, les écrans au calme se relisent) ;
//   2. l'historique et la note des exos qui ne sont dans AUCUN template en copie
//      NI dans une séance en cours (exos d'anciens plans, exos ajoutés un autre
//      jour à la volée) ;
//   - JAMAIS le chemin d'ouverture : `capture-source`, versions et templates des
//     séances, contrôle de premier lancement, historique et note des exos des
//     templates en copie et des séances en cours. Une séance en cours porte
//     parfois un exo AJOUTÉ ou remplaçant, absent de tout template : ses copies
//     évincées, la réouverture hors ligne l'ignorait, avec ses séries.
// Si cela ne suffit pas : une saisie neuve tient en mémoire, une transition du
// registre s'écrit sans grandir ou n'a pas lieu (cf. outbox, `commit`).
//
// Module sans dépendance vers les couches d'accès : l'outbox et l'état de
// capture l'appellent, et les couches d'accès importent l'outbox.
import { cachedKeys, dropRead, peekRead } from '../../lib/read-cache';
import { VIEW_PREFIX } from '../../lib/dated-read';
import { EXERCISE_NOTE_PREFIX, EXERCISES_KEY, SEANCE_TEMPLATE_PREFIX } from './plan-copies';
import { CAPTURE_STATE_PREFIX } from './storage-keys';

const EXERCISE_ROWS_PREFIX = 'exo-execs:';
// Les copies des écrans au calme (Séances, Analyse, `VIEW_PREFIX`) partent avec
// le confort : elles se relisent au retour du réseau, et le Journal peut peser.
const COMFORT_PREFIXES = ['last-exec:', 'prev-notes:', VIEW_PREFIX];

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
 * Les exos des séances EN COURS sur l'appareil, lus dans leurs états de capture
 * enregistrés : exos de la disposition (ajoutés ou remplaçants), exos qui ont du
 * réalisé, exo ouvert. Lecture brute et tolérante du stockage (ce module ne peut
 * pas importer `state.ts`, qui l'importe) ; un état illisible ne protège rien.
 * Tous comptes confondus : dans le doute, on garde.
 */
function inProgressExerciseIds(): Set<string> {
  const ids = new Set<string>();
  if (typeof localStorage === 'undefined') return ids;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(CAPTURE_STATE_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let state: { layout?: unknown; progress?: unknown; activeExerciseId?: unknown };
      try {
        state = JSON.parse(raw) as typeof state;
      } catch {
        continue;
      }
      if (typeof state !== 'object' || state === null) continue;
      if (Array.isArray(state.layout)) {
        for (const edit of state.layout as { exerciseId?: unknown }[]) {
          if (typeof edit?.exerciseId === 'string') ids.add(edit.exerciseId);
        }
      }
      if (typeof state.progress === 'object' && state.progress !== null) {
        for (const exerciseId of Object.keys(state.progress)) ids.add(exerciseId);
      }
      if (typeof state.activeExerciseId === 'string') ids.add(state.activeExerciseId);
    }
  } catch {
    /* stockage inaccessible : rien à protéger de plus */
  }
  return ids;
}

/**
 * Les exos du dernier état de capture confié par `persist`, retenus en mémoire.
 * Stockage vraiment plein, l'écriture de cet état échoue : il n'est pas sur
 * l'appareil, `inProgressExerciseIds` ne le voit pas, et c'est l'écriture
 * suivante (une série enfilée par l'outbox, qui ne connaît pas l'état) qui
 * aurait évincé les copies de l'exo qu'il vient d'ajouter.
 */
let lastEntrustedExerciseIds: readonly string[] = [];

/** La séance dont l'état avait été confié est close ou abandonnée : plus rien à retenir. */
export function forgetEntrustedExercises(): void {
  lastEntrustedExerciseIds = [];
}

/**
 * Retire les copies NON ESSENTIELLES du palier demandé (cf. en-tête) et rend le
 * nombre de copies retirées. Les copies du chemin d'ouverture ne sont jamais
 * touchées, quel que soit le palier. `keepExerciseIds` : des exos à protéger en
 * plus, que le stockage ne connaît pas encore (l'état de capture en train
 * d'être écrit, cf. `persist`, state.ts).
 */
export function evictNonEssentialCopies(
  tier: 1 | 2,
  keepExerciseIds: readonly string[] = [],
): number {
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
  const kept = new Set([
    ...plannedExerciseIds(),
    ...inProgressExerciseIds(),
    ...lastEntrustedExerciseIds,
    ...keepExerciseIds,
  ]);
  for (const prefix of [EXERCISE_ROWS_PREFIX, EXERCISE_NOTE_PREFIX]) {
    for (const key of cachedKeys(prefix)) {
      if (!kept.has(key.slice(prefix.length))) drop(key);
    }
  }
  return dropped;
}

/**
 * Tente `write` ; s'il est refusé (stockage plein), fait céder les copies non
 * essentielles, palier par palier, en retentant après chacun. Rend vrai dès que
 * l'écriture passe, faux si elle est toujours refusée une fois les deux paliers
 * épuisés. `keepExerciseIds` : les exos de l'état de capture en cours d'écriture
 * (cf. `evictNonEssentialCopies`). Fournis, ils sont retenus AVANT le premier
 * essai, et protégés aussi des évictions suivantes, d'où qu'elles viennent,
 * jusqu'au prochain état confié ; sans eux (appel de l'outbox), la retenue
 * précédente vaut toujours.
 */
export function writeMakingRoom(
  write: () => boolean,
  keepExerciseIds?: readonly string[],
): boolean {
  if (keepExerciseIds !== undefined) lastEntrustedExerciseIds = [...keepExerciseIds];
  if (write()) return true;
  for (const tier of [1, 2] as const) {
    if (evictNonEssentialCopies(tier) > 0 && write()) return true;
  }
  return false;
}
