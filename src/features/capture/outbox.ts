// File d'écritures offline (« outbox ») de la capture.
//
// PROBLÈME résolu : en salle, le wifi est souvent pourri. Les séries loggées
// hors-ligne doivent survivre puis remonter SEULES au retour du réseau. Avant
// cette couche, l'état local survivait (localStorage) mais aucune reprise
// n'existait : le réalisé offline ne rejoignait jamais la base.
//
// MODÈLE (cf. ADR 0003) : UUID générés CÔTÉ CLIENT + résolution last-write-wins
// par ligne, PAS de moteur de merge. Chaque op porte l'`id` de sa ligne, ce qui
// rend les écritures Supabase idempotentes (upsert/delete/update par id) : rejouer
// une op déjà passée est sans effet. On peut donc retenter sans crainte de doublon.
//
// La file est :
//   - PERSISTÉE en localStorage (clé dédiée) → survit au reload / kill de l'app.
//   - TRAITÉE DANS L'ORDRE d'enfilement (FIFO) → un `insertSet` ne part jamais
//     avant l'`upsertExecution` de son exécution (dépendance FK exécution→séries).
//   - ARRÊTÉE à la première op qui échoue (probable coupure réseau) : on GARDE
//     cette op et toutes les suivantes pour les rejouer au prochain flush.
//
// Cette couche est de la DURABILITÉ sous l'UI : le flux de log reste piloté par
// le reducer local (UI immédiate), l'outbox synchronise en fond.

// --- Types d'opérations -------------------------------------------------------
// Chaque op est un FAIT à rejouer, portant l'`id` de la ligne concernée (UUID
// client) pour rester idempotente. Discriminées par `type`.
import type { Side } from '../../domain/types';

/** Crée (ou ré-affirme) l'exécution du jour. Idempotent via upsert par id. */
export interface UpsertExecutionOp {
  type: 'upsertExecution';
  id: string;
  seanceVersionId: string;
  /** Date ISO 'YYYY-MM-DD' de l'exécution. */
  performedOn: string;
}

/** Insère une série loggée. Idempotent via upsert par id (rejouer = no-op). */
export interface InsertSetOp {
  type: 'insertSet';
  id: string;
  executionId: string;
  exerciseId: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number;
  /**
   * Côté pour un exo UNILATÉRAL (issue #46) : 'left'/'right'. Deux ops d'une même
   * série unilatérale partagent le même `setOrder` et diffèrent par `side`.
   * Absent (`undefined`) pour un exo bilatéral -> écrit `side` null en base.
   */
  side?: Side;
}

/** Supprime une série par son id (« annuler »). Idempotent (delete par id). */
export interface DeleteSetOp {
  type: 'deleteSet';
  id: string;
}

/** Pose les métriques de fin (BPM, durée) sur l'exécution. Update par id. */
export interface UpdateExecutionOp {
  type: 'updateExecution';
  id: string;
  bpmAvg?: number | null;
  durationMin?: number | null;
  /** Horodatage de clôture (ISO) : la séance est « rangée » (ADR 0009), exclue de
   *  la réhydratation. Idempotent (rejouer repose le même closed_at). */
  closedAt?: string | null;
}

/**
 * Crée (ou ré-affirme) la NOTE DATÉE d'un exo pour l'exécution courante (issue
 * #26). Idempotent via upsert par id (UUID client) : rejouer pose le même corps.
 * Comme une série, elle dépend de l'exécution (FK) → enfilée APRÈS l'upsert
 * d'exécution, ordre garanti par le FIFO.
 */
export interface UpsertDatedNoteOp {
  type: 'upsertDatedNote';
  id: string;
  executionId: string;
  exerciseId: string;
  /** Corps normalisé (cf. domain/notes). Vide = la note est effacée via deleteDatedNote. */
  body: string;
}

/** Supprime une note datée par son id (corps vidé). Idempotent (delete par id). */
export interface DeleteDatedNoteOp {
  type: 'deleteDatedNote';
  id: string;
}

/**
 * Crée (ou ré-affirme) la NOTE D'INSTRUCTIONS d'un exo (issue #52, blind F3) :
 * texte persistant attaché à la DÉFINITION de l'exo, pas à l'exécution du jour
 * (table `exercise_notes`, cf. domain/notes). Avant, l'éditeur en Capture
 * écrivait Supabase EN DIRECT (hors outbox) : offline, la modif était perdue au
 * reload. Routée par l'outbox, elle devient durable comme le reste.
 *
 * IDEMPOTENCE — par EXERCICE, pas par UUID de ligne client. Contrairement à une
 * série ou une note datée (lignes créées à la volée, UUID client, ADR 0003), la
 * note d'instructions est un SINGLETON : au plus une ligne par (user, exo),
 * garantie par `unique (user_id, exercise_id)` (migration 0001). L'UI ne connaît
 * d'ailleurs jamais d'id de ligne — elle ne charge que le `body` par exo. La clé
 * idempotente est donc l'`exerciseId` : la sync upsert onConflict (user_id,
 * exercise_id), rejouer écrase la même unique ligne sans doublon ni erreur.
 *
 * Ne dépend PAS de l'exécution (aucune FK vers `executions`) : enfilable seule,
 * indépendamment de tout `upsertExecution`. Le champ `id` porte l'`exerciseId`
 * pour rester homogène avec le mécanisme de l'outbox (shift par (type, id)).
 */
export interface UpsertExerciseNoteOp {
  type: 'upsertExerciseNote';
  /** L'`exerciseId` (clé idempotente : 1 note par user+exo). */
  id: string;
  /** Corps normalisé (cf. domain/notes). Vide → la note est effacée via deleteExerciseNote. */
  body: string;
}

/**
 * Supprime la note d'instructions d'un exo (corps vidé). Idempotent : delete par
 * `exercise_id` (l'`id` de l'op porte l'`exerciseId`), sans effet si aucune ligne.
 */
export interface DeleteExerciseNoteOp {
  type: 'deleteExerciseNote';
  /** L'`exerciseId` dont la note est effacée. */
  id: string;
}

/**
 * Supprime une EXÉCUTION entière par son id (issue #44, ADR 0008) : un jour de
 * séance avec ses séries et ses notes datées. Un unique delete par id ; la
 * CASCADE DB (`performed_sets`/`dated_notes` en on delete cascade, cf. migration
 * 0001) efface les lignes filles. Idempotent : supprimer une exécution déjà
 * absente est sans effet (delete par id ciblé).
 */
export interface DeleteExecutionOp {
  type: 'deleteExecution';
  id: string;
}

export type OutboxOp =
  | UpsertExecutionOp
  | InsertSetOp
  | DeleteSetOp
  | UpdateExecutionOp
  | UpsertDatedNoteOp
  | DeleteDatedNoteOp
  | UpsertExerciseNoteOp
  | DeleteExerciseNoteOp
  | DeleteExecutionOp;

/**
 * Les fonctions de SYNC réelles, une par type d'op (injectées → testable sans
 * Supabase). Chacune DOIT être idempotente : rejouée sur une op déjà passée,
 * elle ne produit aucun effet de bord observable (upsert/delete/update par id).
 */
export interface SyncFns {
  upsertExecution: (op: UpsertExecutionOp) => Promise<void>;
  insertSet: (op: InsertSetOp) => Promise<void>;
  deleteSet: (op: DeleteSetOp) => Promise<void>;
  updateExecution: (op: UpdateExecutionOp) => Promise<void>;
  upsertDatedNote: (op: UpsertDatedNoteOp) => Promise<void>;
  deleteDatedNote: (op: DeleteDatedNoteOp) => Promise<void>;
  upsertExerciseNote: (op: UpsertExerciseNoteOp) => Promise<void>;
  deleteExerciseNote: (op: DeleteExerciseNoteOp) => Promise<void>;
  deleteExecution: (op: DeleteExecutionOp) => Promise<void>;
}

/** État renvoyé par `flush` : combien d'ops restent en file après la passe. */
export interface FlushResult {
  /** Nombre d'ops encore en attente (0 = tout est synchronisé). */
  remaining: number;
  /** Nombre d'ops traitées avec succès et retirées pendant cette passe. */
  flushed: number;
}

// --- Persistance localStorage -------------------------------------------------

const STORAGE_KEY = 'croustylift:outbox';

// Clé de QUARANTAINE : reçoit un blob illisible (JSON cassé / forme invalide)
// AVANT que `readQueue` ne renvoie `[]`. Sans ça, la prochaine écriture écraserait
// le blob fautif et les ops seraient perdues en silence. Conservé, il permet de
// diagnostiquer voire récupérer à la main (issue F11).
const CORRUPT_KEY = `${STORAGE_KEY}:corrupt`;

/**
 * Lit la file persistée (vide si rien / illisible).
 *
 * Si le blob est présent mais ILLISIBLE (JSON cassé) ou de forme invalide (pas un
 * tableau), on le SAUVEGARDE sous `CORRUPT_KEY` et on `console.warn` une fois avant
 * de renvoyer `[]` : la file repart vide mais le blob fautif n'est pas perdu — la
 * prochaine écriture l'aurait sinon écrasé sans laisser de trace.
 */
export function readQueue(): OutboxOp[] {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as OutboxOp[];
    quarantineBlob(raw, 'forme invalide (pas un tableau)');
    return [];
  } catch {
    quarantineBlob(raw, 'JSON illisible');
    return [];
  }
}

/** Met le blob fautif de côté (clé de quarantaine) et prévient une fois. */
function quarantineBlob(raw: string, reason: string): void {
  try {
    localStorage.setItem(CORRUPT_KEY, raw);
  } catch {
    // Même un setItem de quarantaine peut échouer (quota/mode privé) : on ne
    // peut alors rien sauvegarder, mais on prévient quand même ci-dessous.
  }
  console.warn(
    `[outbox] file persistée corrompue (${reason}) : repartie vide, ` +
      `blob conservé sous « ${CORRUPT_KEY} » pour diagnostic.`,
  );
}

/** Écrit la file (dégrade en `console.warn` si quota plein / mode privé). */
function writeQueue(queue: OutboxOp[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Quota plein / mode privé : la file en mémoire reste correcte pour la
    // session courante, on dégrade sans bloquer la capture. On le SIGNALE
    // (au lieu d'un no-op muet) : la persistance ne suit plus, donc un kill de
    // l'app perdrait ce qui n'a pas pu être écrit — autant pouvoir le voir.
    console.warn(
      '[outbox] écriture localStorage refusée (quota plein / mode privé) : ' +
        'la file reste en mémoire pour la session mais ne survivra pas à un reload.',
    );
  }
}

/** Longueur courante de la file (pilote l'indicateur de sync). */
export function pendingCount(): number {
  return readQueue().length;
}

/**
 * Vide entièrement la file (sert à la déconnexion / aux tests). Supprime AUSSI le
 * blob de QUARANTAINE (`CORRUPT_KEY`) : à la déconnexion sur un appareil partagé,
 * il contient du réalisé en clair (issue F11) et ne doit pas survivre au départ de
 * l'utilisateur entre deux comptes — le retirer ferme cette fuite (BUG M5).
 */
export function clearQueue(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CORRUPT_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Purge CIBLÉE : retire de la file les ops qui CRÉENT/RÉ-AFFIRMENT l'exécution
 * `executionId` (et ses lignes filles), sans toucher au reste de la file.
 *
 * Sert au « Réinitialiser » de la capture, qui ABANDONNE l'exécution courante
 * avant tout flush : on ne veut effacer QUE ses ops en attente, pas vider toute
 * la file (`clearQueue`). En offline, la file globale peut aussi porter les
 * séries non synchronisées d'une AUTRE exécution ou une correction d'historique
 * en attente — celles-ci doivent survivre et remonter au retour du réseau.
 *
 * Retire : `upsertExecution` (`id === executionId`), `updateExecution`
 * (`id === executionId`), `insertSet` et `upsertDatedNote`
 * (`executionId === executionId`). L'`updateExecution` doit partir : il porte
 * l'`id` de l'exécution (BPM/durée de fin), donc abandonner l'exécution sans le
 * retirer poserait ces métriques sur une coquille fantôme au prochain flush.
 * LAISSE les `deleteSet` / `deleteDatedNote` : idempotents par id, ils sont sans
 * effet si la ligne n'existe pas (jamais créée parce qu'on a justement retiré son
 * insert), donc inoffensifs ; et ne portent que l'id de la ligne, pas
 * l'`executionId`, donc on ne peut de toute façon pas les rattacher à une
 * exécution. LAISSE aussi `deleteExecution` (idempotent par id : supprimer
 * l'exécution abandonnée est sain) et toute op d'une autre exécution.
 */
export function purgeByExecution(executionId: string): void {
  const queue = readQueue();
  const kept = queue.filter((op) => {
    switch (op.type) {
      case 'upsertExecution':
      case 'updateExecution':
        return op.id !== executionId;
      case 'insertSet':
      case 'upsertDatedNote':
        return op.executionId !== executionId;
      default:
        // deleteSet / deleteDatedNote / deleteExecution : ne portent que l'id de
        // la ligne (pas d'executionId rattachable) et sont idempotents par id
        // (sans effet si la ligne n'existe pas) → on les laisse.
        // upsertExerciseNote / deleteExerciseNote : la note d'instructions vit sur
        // la DÉFINITION de l'exo, jamais sur l'exécution abandonnée → elle survit
        // au « Réinitialiser » (sinon une instruction tapée juste avant le reset
        // serait perdue). Pas d'executionId, donc rien à rattacher de toute façon.
        return true;
    }
  });
  if (kept.length !== queue.length) writeQueue(kept);
}

// --- Enfilement ---------------------------------------------------------------

/**
 * Ajoute une op en queue de file et persiste immédiatement. L'op est durable
 * dès cet instant : même si l'app meurt avant le flush, elle remontera au
 * prochain montage. Renvoie la nouvelle longueur de file.
 */
export function enqueue(op: OutboxOp): number {
  const queue = readQueue();
  queue.push(op);
  writeQueue(queue);
  return queue.length;
}

// --- Flush --------------------------------------------------------------------

/** Aiguille une op vers sa fonction de sync. */
function runOp(op: OutboxOp, fns: SyncFns): Promise<void> {
  switch (op.type) {
    case 'upsertExecution':
      return fns.upsertExecution(op);
    case 'insertSet':
      return fns.insertSet(op);
    case 'deleteSet':
      return fns.deleteSet(op);
    case 'updateExecution':
      return fns.updateExecution(op);
    case 'upsertDatedNote':
      return fns.upsertDatedNote(op);
    case 'deleteDatedNote':
      return fns.deleteDatedNote(op);
    case 'upsertExerciseNote':
      return fns.upsertExerciseNote(op);
    case 'deleteExerciseNote':
      return fns.deleteExerciseNote(op);
    case 'deleteExecution':
      return fns.deleteExecution(op);
    default:
      // Type inconnu (op d'une version future écrite par un autre onglet/appareil,
      // ou blob trafiqué) : aucune SyncFn ne sait la jouer. On JETTE plutôt que de
      // tomber dans un `return undefined` muet — sinon `runFlushOnce` la traiterait
      // comme un succès et la RETIRERAIT (perte silencieuse). Le throw fait échouer
      // la passe à cette op (arrêt-sur-échec) : l'op reste en file, jamais perdue.
      // Les ops valides enfilées AVANT elle sont déjà passées (flush nominal intact).
      // Bloquant tant que le type reste inconnu, mais préserver vaut mieux que perdre.
      return Promise.reject(
        new Error(`[outbox] op de type inconnu, non synchronisable : ${JSON.stringify(op)}`),
      );
  }
}

// Un seul flush à la fois : les déclencheurs (online, montage, post-enqueue)
// peuvent se chevaucher ; deux passes concurrentes rejoueraient les mêmes ops.
// On sérialise via une promesse mémoïsée — les appels en vol partagent le résultat.
let inFlight: Promise<FlushResult> | null = null;

/**
 * Synchronise la file vers Supabase et renvoie l'état après la passe.
 *
 * Traite DANS L'ORDRE (cf. `runFlushOnce`) : chaque op réussie est retirée et le
 * progrès persisté, on S'ARRÊTE à la première qui échoue (offline) en gardant l'op
 * + la suite. On NE saute jamais une op : l'ordre exécution→séries (et insert→delete)
 * est une dépendance, pas une préférence. Une op enfilée en cours de flush est
 * rattrapée (ré-armement, cf. `runFlush`) — le `FlushResult` reflète l'état réel.
 *
 * Concurrent-safe : un flush déjà en vol est réutilisé plutôt que doublé.
 */
export function flush(fns: SyncFns): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = runFlush(fns).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runFlush(fns: SyncFns): Promise<FlushResult> {
  // RÉ-ARMEMENT (issue F12) : une op enfilée DANS la fenêtre étroite entre la fin
  // d'une passe et le `finally` qui remet `inFlight` à null n'est pas traitée par
  // cette passe ; un `flush` concurrent reçoit alors ce résultat périmé
  // (`remaining: 0`) et l'op dort jusqu'au prochain déclencheur. On relance donc
  // une passe SEULEMENT si la précédente a VIDÉ la file (`drained`) ET qu'une
  // nouvelle op est apparue depuis. Une passe qui S'ARRÊTE sur un échec (offline)
  // n'est JAMAIS relancée : son op reste en file pour le prochain déclencheur
  // (comportement offline voulu) — sinon on rejouerait en boucle une op qui
  // échoue. Borné par la longueur de file (chaque passe drainée en retire ≥ 1).
  let totalFlushed = 0;
  let budget = readQueue().length + 1;

  while (true) {
    const { flushed, drained } = await runFlushOnce(fns);
    totalFlushed += flushed;
    const remaining = readQueue().length;
    // Arrêt sur échec (pas drainé), file vide, ou garde-fou de convergence atteint.
    if (!drained || remaining === 0 || --budget <= 0) {
      return { remaining, flushed: totalFlushed };
    }
    // Drainé mais la file s'est re-remplie (enqueue concurrent en fin de passe) :
    // on relance pour traiter la nouvelle op.
  }
}

/**
 * UNE passe : traite la file DANS L'ORDRE, retire chaque op réussie et persiste le
 * progrès, S'ARRÊTE à la première op qui échoue (offline) en gardant l'op + le reste.
 * `drained` = true si la file a été entièrement vidée, false si on s'est arrêté sur
 * un échec (la distinction pilote le ré-armement, cf. `runFlush`).
 */
async function runFlushOnce(fns: SyncFns): Promise<{ flushed: number; drained: boolean }> {
  let queue = readQueue();
  let flushed = 0;

  while (queue.length > 0) {
    const op = queue[0];
    // `queue.length > 0` garantit la tête : on prouve l'index au compilateur sans
    // changer le flux (la file persistée n'est jamais vidée sous nos pieds ici,
    // c'est `current` plus bas qui peut l'être).
    if (!op) break;
    try {
      await runOp(op, fns);
    } catch {
      // Échec (réseau coupé le plus souvent) : on garde l'op et tout le reste,
      // dans l'ordre. La file persistée n'a pas bougé pour cette op → rejouée
      // telle quelle au prochain flush. Pas drainé → pas de ré-armement.
      return { flushed, drained: false };
    }
    // Succès : on relit la file (un enqueue concurrent a pu s'y ajouter) puis on
    // retire l'op qu'on vient de traiter. Mais la tête a pu CHANGER pendant
    // l'`await` : un « Réinitialiser » (`purgeByExecution`) ou un `clearQueue`
    // déclenché par une autre exécution peut avoir retiré l'op traitée, voire
    // toute la file. On ne `shift()` que si la tête est ENCORE l'op traitée
    // (même type + même id) : sinon un shift aveugle retirerait la MAUVAISE op
    // (perte d'une op d'une nouvelle exécution). Si la tête a changé, l'op a déjà
    // été purgée → on ne retire rien et on reprend la boucle sur la file courante.
    const current = readQueue();
    const head = current[0];
    if (head && head.type === op.type && head.id === op.id) {
      current.shift();
      writeQueue(current);
      flushed += 1;
    }
    queue = current;
  }

  return { flushed, drained: true };
}
