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

export type OutboxOp =
  | UpsertExecutionOp
  | InsertSetOp
  | DeleteSetOp
  | UpdateExecutionOp
  | UpsertDatedNoteOp
  | DeleteDatedNoteOp;

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

/** Lit la file persistée (vide si rien / illisible). */
export function readQueue(): OutboxOp[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

/** Écrit la file (dégrade silencieusement si quota plein / mode privé). */
function writeQueue(queue: OutboxOp[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Quota plein / mode privé : la file en mémoire reste correcte pour la
    // session courante, on dégrade sans bloquer la capture.
  }
}

/** Longueur courante de la file (pilote l'indicateur de sync). */
export function pendingCount(): number {
  return readQueue().length;
}

/** Vide entièrement la file (sert au reset d'une nouvelle séance / aux tests). */
export function clearQueue(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
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
  }
}

// Un seul flush à la fois : les déclencheurs (online, montage, post-enqueue)
// peuvent se chevaucher ; deux passes concurrentes rejoueraient les mêmes ops.
// On sérialise via une promesse mémoïsée — les appels en vol partagent le résultat.
let inFlight: Promise<FlushResult> | null = null;

/**
 * Traite la file DANS L'ORDRE. Pour chaque op : appelle la fonction de sync
 * (idempotente), RETIRE l'op de la file si elle réussit, et persiste après
 * chaque retrait (progrès durable même si l'app meurt en cours de flush).
 *
 * À la PREMIÈRE op qui échoue (typiquement offline), on S'ARRÊTE et on GARDE
 * cette op + toutes les suivantes, dans l'ordre, pour la prochaine tentative.
 * On NE saute jamais une op : l'ordre exécution→séries (et insert→delete) est
 * une dépendance, pas une simple préférence.
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
  let queue = readQueue();
  let flushed = 0;

  while (queue.length > 0) {
    const op = queue[0];
    try {
      await runOp(op, fns);
    } catch {
      // Échec (réseau coupé le plus souvent) : on garde l'op et tout le reste,
      // dans l'ordre. La file persistée n'a pas bougé pour cette op → rejouée
      // telle quelle au prochain flush.
      break;
    }
    // Succès : on retire l'op en tête et on persiste le progrès. On relit la
    // file à chaque tour pour absorber un enqueue concurrent arrivé entre-temps.
    const current = readQueue();
    current.shift();
    writeQueue(current);
    queue = current;
    flushed += 1;
  }

  return { remaining: queue.length, flushed };
}
