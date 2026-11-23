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
//   - Sauf REJET DÉFINITIF de la base (contrainte, RLS) : l'op fautive part en
//     QUARANTAINE (conservée à part, jamais rejouée seule) et la file continue.
//
// Cette couche est de la DURABILITÉ sous l'UI : le flux de log reste piloté par
// le reducer local (UI immédiate), l'outbox synchronise en fond.

// --- Types d'opérations -------------------------------------------------------
// Chaque op est un FAIT à rejouer, portant l'`id` de la ligne concernée (UUID
// client) pour rester idempotente. Discriminées par `type`.
import type { Side } from '../../domain/types';
import { loadLocalAccount } from '../../lib/local-account';
import { writeMakingRoom } from './cache-eviction';

/** Crée l'exécution du jour. Insertion seule par id : la réaffirmer ne réécrit rien. */
export interface UpsertExecutionOp {
  type: 'upsertExecution';
  id: string;
  seanceVersionId: string;
  /** Date ISO 'YYYY-MM-DD' de l'exécution. */
  performedOn: string;
  /**
   * Horodatage du LANCEMENT (ISO), ADR 0011 : la valeur du chrono « lancement →
   * clôture », posée au 1er set (la ligne naît alors). Absent = legacy (pas de
   * chrono durable). Écrit à la naissance de la ligne seulement : une
   * réaffirmation ne touche pas le started_at déjà en base (ADR 0021).
   */
  startedAt?: string;
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
  /**
   * Exos dont l'historique est touché par cette suppression, quand l'émetteur
   * les connaît (annulation en Capture, éditeur de séance passée). L'op ne porte
   * sinon que l'id de sa ligne : ce champ dit quelles copies locales relire à
   * l'acquittement (cf. sync.ts), même si la ligne n'y figure pas encore. Jamais
   * envoyé en base (le delete ne prend que l'id). Absent sur une op ancienne :
   * seules les copies qui contiennent la ligne sont alors relues.
   */
  exerciseIds?: string[];
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
 * #26). Idempotent : rejouer pose le même corps sur la même ligne. La ligne
 * écrite est celle du COUPLE (exécution, exercice) si la base en a déjà une,
 * quel que soit son id ; `id` (UUID déterministe du couple) ne sert qu'à en
 * créer une (cf. `upsertDatedNote`, features/notes/data.ts).
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

/**
 * Efface la note datée d'un exo dans une exécution (corps vidé). L'identité
 * d'une note datée est son COUPLE (exécution, exercice) : l'effacement vise le
 * couple, donc aussi une note née sous un autre id (ancien client, autre
 * appareil). Idempotent.
 *
 * `executionId` et `exerciseId` sont absents d'une op enfilée par un bundle
 * antérieur : elle n'efface alors que la ligne `id`, comme avant. `id` reste
 * l'identité de l'op dans la file et dans l'état local.
 */
export interface DeleteDatedNoteOp {
  type: 'deleteDatedNote';
  id: string;
  executionId?: string;
  exerciseId?: string;
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
  /**
   * Exos dont l'historique est touché par cette suppression, quand l'émetteur
   * les connaît (annulation en Capture, éditeur de séance passée). L'op ne porte
   * sinon que l'id de sa ligne : ce champ dit quelles copies locales relire à
   * l'acquittement (cf. sync.ts), même si la ligne n'y figure pas encore. Jamais
   * envoyé en base (le delete ne prend que l'id). Absent sur une op ancienne :
   * seules les copies qui contiennent la ligne sont alors relues.
   */
  exerciseIds?: string[];
}

// `_uid` : identité interne UNIQUE d'une op en file, un UUID posé par `enqueue`.
// Sert à retirer SANS ambiguïté l'op traitée après l'await du flush, et à
// retrouver ses propres ops après une passe (`flushOps`) : la paire (type,id)
// n'est PAS unique (updateExecution / upsertExerciseNote peuvent être ré-enfilés
// sur le même id). Un UUID et non un compteur : la file est commune aux onglets
// de l'appareil, et un compteur tenu par onglet pouvait donner le même numéro à
// deux ops, l'une étant alors retirée à la place de l'autre sans avoir été
// envoyée (audit sync, constat 11).
//
// `_seq` : l'ancien compteur, encore posé (ordre d'enfilement lisible au
// diagnostic) et seule identité des ops enfilées par un bundle antérieur, sans
// `_uid`. Une op sans l'un ni l'autre ne se reconnaît qu'en tête par (type,id).
//
// `_owner` : id du COMPTE reconnu sur l'appareil à l'enfilement (marqueur
// local-account), posé par `enqueue`. La file est commune à l'appareil ; sous
// une session vérifiée, le flush ne rejoue que les ops du compte connecté : les
// saisies de A ne remontent jamais sous B (audit sécurité, constat 1). Une op
// sans `_owner` vient d'un bundle antérieur : `adoptLegacyOps` l'attribue au
// compte reconnu au démarrage.
//
// `_at` : instant de l'enfilement (epoch ms, horloge de l'appareil, donc
// comparable entre ses onglets). Il ne sert qu'à replacer dans la file les
// écritures tenues en mémoire quand le stockage est plein (cf. `readQueue`).
type Sequenced = { _seq?: number; _owner?: string; _uid?: string; _at?: number };

export type OutboxOp = (
  | UpsertExecutionOp
  | InsertSetOp
  | DeleteSetOp
  | UpdateExecutionOp
  | UpsertDatedNoteOp
  | DeleteDatedNoteOp
  | UpsertExerciseNoteOp
  | DeleteExerciseNoteOp
  | DeleteExecutionOp
) &
  Sequenced;

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

/**
 * Lecteur de session passé à `flush` : l'id du compte CONNECTÉ, vérifié à
 * l'instant (jeton présent et non expiré, ou rafraîchi avec succès). Toute autre
 * valeur (`null` : pas de session ; `undefined` : aucun lecteur posé) veut dire
 * « personne de vérifiable » et arrête la passe.
 */
export type SessionReader = () => Promise<string | null | undefined>;

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

// REPLI MÉMOIRE de la file, engagé quand le stockage refuse de l'écrire (quota
// plein, mode privé). Avant, l'écriture refusée était seulement signalée en
// console : l'op enfilée n'existait nulle part (chaque lecture repartait du
// stockage, resté à l'état d'avant), elle était perdue sur-le-champ, et la
// bannière disait « Synchronisé ».
//
// Le repli ne tient PAS une copie de la file : la file est commune aux onglets,
// et réécrire le stockage depuis une copie en mémoire effaçait ce qu'un autre
// onglet y avait écrit entre-temps (sa série n'était jamais envoyée). Il tient
// seulement l'ÉCART entre la file voulue et la file persistée, par identité
// d'enfilement : les ops ajoutées qui n'ont pas pu être écrites (`adds`) et
// celles retirées dont le retrait n'a pas pu l'être (`removals`). La file LUE
// est toujours la file persistée, relue à l'instant, sur laquelle cet écart est
// rejoué : ce qu'un autre onglet a écrit ou retiré y est donc toujours. Chaque
// écriture retente le stockage ; dès qu'une passe, l'écart est résorbé et rendu.
//
// Ce que le repli ne sauve pas : la page fermée avant le retour du stockage, ce
// qui n'y a pas été écrit est perdu, et la file persistée, en retard, peut
// rejouer une insertion dont la suppression n'était qu'en mémoire (cf.
// `removeFromQueue`). `storageFailing` le dit à la bannière. Lié à l'objet
// `localStorage` qui a refusé (il ne survit pas à son remplacement).
let volatile: { storage: Storage; adds: OutboxOp[]; removals: Set<string> } | null = null;

/** Identité d'une op en file : son UUID d'enfilement, à défaut son contenu. */
function opKey(op: OutboxOp): string {
  return op._uid ?? JSON.stringify(op);
}

/** L'écart tenu en mémoire, s'il est engagé pour le stockage courant. */
function activeVolatile(): { adds: OutboxOp[]; removals: Set<string> } | null {
  if (volatile === null || typeof localStorage === 'undefined') return null;
  return volatile.storage === localStorage ? volatile : null;
}

/**
 * Vrai tant qu'une partie de la file ne tient qu'en mémoire : le stockage de
 * l'appareil a refusé sa dernière écriture. Les saisies en attente ne
 * survivraient pas à la fermeture de l'app.
 */
export function storageFailing(): boolean {
  return activeVolatile() !== null;
}

/**
 * Vrai tant que des ops ENFILÉES ne sont écrites nulle part ailleurs qu'en
 * mémoire : recharger la page les détruirait (séries, clôture). Plus étroit que
 * `storageFailing`, qui reste vrai pour un écart vide ou fait de seuls retraits :
 * ici, seulement les ajouts non persistés. Faux dès qu'ils sont écrits sur
 * l'appareil (le stockage accepte de nouveau) ou acquittés par la base (retirés
 * de la file). C'est ce que lit l'autorisation de recharger (pwa/reload-guards).
 */
export function hasUnpersistedOps(): boolean {
  const gap = activeVolatile();
  return gap !== null && gap.adds.length > 0;
}

/**
 * Lit la file persistée, telle qu'elle est dans le stockage à l'instant (vide si
 * rien / illisible).
 *
 * Si le blob est présent mais ILLISIBLE (JSON cassé) ou de forme invalide (pas un
 * tableau), on le SAUVEGARDE sous `CORRUPT_KEY` et on `console.warn` une fois avant
 * de renvoyer `[]` : la file repart vide mais le blob fautif n'est pas perdu, la
 * prochaine écriture l'aurait sinon écrasé sans laisser de trace.
 */
function readPersistedQueue(): OutboxOp[] {
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

/**
 * Lit la file : la file persistée, relue à l'instant, sur laquelle est rejoué
 * l'écart tenu en mémoire quand le stockage a refusé une écriture (cf.
 * `volatile`). Les écritures d'un autre onglet y figurent donc toujours.
 */
export function readQueue(): OutboxOp[] {
  const persisted = readPersistedQueue();
  const gap = activeVolatile();
  if (gap === null) return persisted;
  const present = new Set(persisted.map(opKey));
  return mergeByEnqueueTime(
    persisted.filter((op) => !gap.removals.has(opKey(op))),
    gap.adds.filter((op) => !present.has(opKey(op))),
  );
}

/**
 * Replace les écritures tenues en mémoire (`adds`) dans la file persistée, à
 * leur instant d'enfilement (`_at`). Avant, elles partaient toutes APRÈS la file
 * persistée : stockage plein, deux onglets, l'un garde en mémoire une note
 * d'instructions, l'autre persiste ensuite sa correction ; le premier envoyait
 * la correction puis l'ancienne note, qui gagnait en base.
 *
 * Fusion stable : l'ordre de chaque liste est conservé, une écriture en mémoire
 * passe avant la première écriture persistée STRICTEMENT plus récente qu'elle
 * (à instant égal, la persistée d'abord). Une op sans `_at` (bundle antérieur)
 * ne déplace rien : persistée, elle est tenue pour plus ancienne que tout ; en
 * mémoire, elle reste en fin de file, comme avant. Pur.
 */
export function mergeByEnqueueTime(persisted: OutboxOp[], adds: OutboxOp[]): OutboxOp[] {
  if (adds.length === 0) return persisted;
  const out: OutboxOp[] = [];
  let next = 0;
  for (const op of persisted) {
    const at = op._at;
    if (at !== undefined) {
      while (next < adds.length) {
        const addAt = adds[next]!._at;
        if (addAt === undefined || addAt >= at) break;
        out.push(adds[next]!);
        next += 1;
      }
    }
    out.push(op);
  }
  return [...out, ...adds.slice(next)];
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

/**
 * Écrit la file. `queue` vient d'une lecture faite à l'instant (`readQueue`),
 * donc de la file persistée du moment : ce n'est jamais une réécriture depuis
 * une copie ancienne. Si le stockage refuse (quota plein / mode privé), les
 * copies de lecture NON ESSENTIELLES cèdent d'abord la place (cf.
 * cache-eviction : jamais celles du chemin d'ouverture de la Capture). Si
 * l'écriture ne passe toujours pas, l'ÉCART avec la file persistée est tenu en
 * mémoire (cf. `volatile`) et le refus est signalé (console, bannière).
 *
 * Rend faux quand la file n'a pas pu être PERSISTÉE : elle n'en est pas moins à
 * jour pour la page en cours, par l'écart tenu en mémoire.
 */
function writeQueue(queue: OutboxOp[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  const persist = (): boolean => {
    try {
      if (queue.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
      return true;
    } catch {
      return false;
    }
  };
  if (writeMakingRoom(persist)) {
    volatile = null;
    return true;
  }
  if (!storageFailing()) {
    console.warn(
      '[outbox] écriture localStorage refusée (quota plein / mode privé) : ' +
        'les saisies sont tenues en mémoire pour la session mais ne survivront pas à un reload.',
    );
  }
  // L'écart entre la file voulue et la file persistée, par identité.
  const persisted = readPersistedQueue();
  const wanted = new Set(queue.map(opKey));
  const present = new Set(persisted.map(opKey));
  volatile = {
    storage: localStorage,
    adds: queue.filter((op) => !present.has(opKey(op))),
    removals: new Set(persisted.map(opKey).filter((key) => !wanted.has(key))),
  };
  return false;
}

/**
 * Retente d'écrire sur l'appareil ce que la file ne tient qu'en mémoire. Sans
 * cela, le repli mémoire n'était résorbé que par la prochaine écriture de la
 * file (enfilement ou acquittement) : stockage plein, place libérée, réseau
 * coupé, plus rien ne retentait, et l'écart restait en mémoire alors que
 * l'appareil l'aurait accepté. Rend vrai si la file est persistée en sortie
 * (elle l'était déjà, ou l'écriture vient de passer). Sans effet de bord sinon :
 * l'écart reste tenu en mémoire, tel quel.
 */
export function retryPersistQueue(): boolean {
  if (activeVolatile() === null) return true;
  return writeQueue(readQueue());
}

/**
 * Les ops en file du compte local reconnu (marqueur), pour ce qui AFFICHE des
 * écritures en attente (Référence fusionnée, ADR 0014) : les séries d'un autre
 * compte restées en file n'entrent pas dans les repères de celui-ci. Une op
 * sans compte (bundle antérieur) est tenue pour celle du compte reconnu.
 */
export function readOwnQueue(): OutboxOp[] {
  const owner = loadLocalAccount()?.userId;
  return readQueue().filter((op) => op._owner === undefined || op._owner === owner);
}

/**
 * Migration douce des ops enfilées par un bundle antérieur : complète les
 * effacements de note datée (cf. `completeLegacyNoteDeletes`, pour toute la
 * file), et attribue au compte local reconnu les ops sans `_owner`. À appeler AU
 * DÉMARRAGE, avant tout envoi et avant que la couche
 * d'auth ne réécrive le marqueur : faite au flush, elle donnerait les ops de A
 * au compte B arrivé entre-temps. Sans marqueur, rien n'est attribué : ces ops
 * restent en file et ne partent sous aucun compte (on ne devine pas).
 */
export function adoptLegacyOps(): void {
  const queue = readQueue();
  // Les effacements de notes hérités d'abord (cf. `completeLegacyNoteDeletes`).
  let next = completeLegacyNoteDeletes(queue);
  const owner = loadLocalAccount()?.userId;
  if (owner && next.some((op) => op._owner === undefined)) {
    next = next.map((op) => (op._owner === undefined ? { ...op, _owner: owner } : op));
  }
  if (next !== queue) writeQueue(next);
}

/**
 * Complète les EFFACEMENTS de note datée enfilés par un bundle antérieur, qui ne
 * portent que l'id de la note, avec le couple (exécution, exercice) de
 * l'écriture de la même note encore en file (même id, même compte).
 *
 * Pourquoi : l'écriture d'une note vise désormais la ligne de son COUPLE, quel
 * que soit son id (`upsertDatedNote`, features/notes/data.ts). Si la base tient
 * la note sous un autre id (écrite ailleurs, ou par un client plus ancien),
 * l'écriture en file atterrit sur cette ligne-là ; l'effacement qui la suivait,
 * resté sur l'id d'origine, ne touchait alors aucune ligne et sortait de la
 * file comme un succès. La note saisie puis effacée restait en base. Avec son
 * couple, l'effacement vise la même ligne que l'écriture.
 *
 * Un effacement sans écriture de la même note en file garde son seul id : le
 * couple est inconnu, et la note visée existe sous cet id (il vient de l'état
 * de capture qui l'avait lue). Rend `queue` lui-même si rien ne change. Pur.
 */
export function completeLegacyNoteDeletes(queue: OutboxOp[]): OutboxOp[] {
  let changed = false;
  const next = queue.map((op) => {
    if (op.type !== 'deleteDatedNote') return op;
    if (op.executionId !== undefined && op.exerciseId !== undefined) return op;
    const write = queue.find(
      (other) =>
        other.type === 'upsertDatedNote' && other.id === op.id && other._owner === op._owner,
    );
    if (write === undefined || write.type !== 'upsertDatedNote') return op;
    changed = true;
    return { ...op, executionId: write.executionId, exerciseId: write.exerciseId };
  });
  return changed ? next : queue;
}

/** Longueur courante de la file (pilote l'indicateur de sync). */
export function pendingCount(): number {
  return readQueue().length;
}

// --- Quarantaine des ops rejetées par la base ---------------------------------
//
// Une op que la base refuse DÉFINITIVEMENT (violation de contrainte, RLS) échoue
// à l'identique à chaque passe. Laissée en tête, elle bloquait toute la file
// derrière elle, sans autre issue que la purge totale (audit sync, constat 6).
// Elle est mise de côté ici : conservée telle quelle avec la raison du rejet,
// JAMAIS rejouée automatiquement, comptée à part (`quarantineCount`) pour que
// l'UI puisse la signaler. Elle n'en sort que par un geste : renvoi ou abandon
// de la saisie (`retryRefused`, `abandonRefused`), annulation de sa séance
// (`purgeByExecution`), ou `clearQueue` (Déconnexion forcée, forçage de purge).
// Les gardes d'auth la comptent via `heldCount`.

const QUARANTINE_KEY = `${STORAGE_KEY}:quarantine`;

/** Une op mise de côté : l'op telle qu'elle était en file, et pourquoi. */
export interface QuarantinedOp {
  op: OutboxOp;
  /** Raison lisible : le rejet de la base, ou l'op en quarantaine dont elle dépend. */
  reason: string;
  /** Horodatage ISO de la mise en quarantaine. */
  at: string;
  /**
   * Vrai pour un `upsertExecution` refusé puis ré-affirmé AVEC SUCCÈS depuis :
   * l'exécution existe en base, ses ops filles ne sont plus retenues.
   */
  superseded?: boolean;
}

/** Les ops en quarantaine (vide si rien / illisible). */
export function readQuarantine(): QuarantinedOp[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUARANTINE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as QuarantinedOp[]) : [];
  } catch {
    return [];
  }
}

/** Nombre d'ops en quarantaine : le compteur à exposer à l'utilisateur. */
export function quarantineCount(): number {
  return readQuarantine().length;
}

/**
 * Tout ce que l'appareil retient d'écritures non remontées : la file ET la
 * quarantaine. C'est ce que protègent les gardes d'auth (ADR 0012 : rien ne se
 * perd sans geste explicite). L'indicateur de synchro, lui, reste sur
 * `pendingCount` : une op en quarantaine n'est plus « en attente d'envoi ».
 */
export function heldCount(): number {
  return pendingCount() + quarantineCount();
}

/**
 * Ce que l'appareil retient, PAR COMPTE (ADR 0019) : la file est commune, mais
 * les écritures d'un compte absent ne sont pas celles du compte présent. `own` :
 * file et quarantaine du compte reconnu (une op sans compte, d'un bundle
 * antérieur, est tenue pour la sienne) ; `ownRefused` : la part en quarantaine ;
 * `foreign` : ce que retiennent d'autres comptes. Avant, `heldCount` comptait
 * tout ensemble : le compte présent ne pouvait se déconnecter qu'en forçant, ce
 * qui jetait les saisies de l'autre.
 */
export function heldCounts(): { own: number; ownRefused: number; foreign: number } {
  const owner = loadLocalAccount()?.userId;
  const isOwn = (op: OutboxOp) => op._owner === undefined || op._owner === owner;
  const queue = readQueue();
  const quarantine = readQuarantine();
  const ownPending = queue.filter(isOwn).length;
  const ownRefused = quarantine.filter((q) => isOwn(q.op)).length;
  return {
    own: ownPending + ownRefused,
    ownRefused,
    foreign: queue.length + quarantine.length - ownPending - ownRefused,
  };
}

/**
 * Retire de la file et de la quarantaine les écritures du compte reconnu (et
 * celles sans compte), et elles seules : celles d'un AUTRE compte restent, à
 * leur place, pour remonter quand il reviendra. C'est la purge de la
 * Déconnexion : on n'y jette que ce qui est à soi. Le blob de file illisible
 * (`CORRUPT_KEY`), dont on ne sait pas l'auteur, part avec elle.
 */
export function clearOwnQueue(): void {
  if (typeof localStorage === 'undefined') return;
  const owner = loadLocalAccount()?.userId;
  const isForeign = (op: OutboxOp) => op._owner !== undefined && op._owner !== owner;
  const queue = readQueue().filter(isForeign);
  const quarantine = readQuarantine().filter((q) => isForeign(q.op));
  writeQueue(queue);
  try {
    if (quarantine.length > 0) localStorage.setItem(QUARANTINE_KEY, JSON.stringify(quarantine));
    else localStorage.removeItem(QUARANTINE_KEY);
    localStorage.removeItem(CORRUPT_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Vrai si l'erreur est un REJET DÉFINITIF de la base : rejouer l'op telle quelle
 * échouera à l'identique. Les fonctions de sync relancent l'objet d'erreur de
 * PostgREST, sans statut HTTP ; seul son `code` (SQLSTATE) est fiable. Liste
 * BLANCHE, tout le reste est tenu pour transitoire (arrêt, nouvel essai) :
 *   - classe 22 (donnée invalide) et classe 23 (violation de contrainte : clé
 *     étrangère, unicité, check, not null) ;
 *   - 42501 (refus RLS / privilège insuffisant).
 * Hors liste donc : erreur réseau (code vide ou absent), 401 jeton (PGRST3xx),
 * 5xx, 408, 429, annulation, conflit de sérialisation, erreur locale.
 */
export function isPermanentRejection(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (/^2[23][0-9A-Z]{3}$/.test(code) || code === '42501');
}

/** L'id de l'exécution dont l'op a BESOIN en base (FK ou update par id), sinon null. */
function requiredExecution(op: OutboxOp): string | null {
  switch (op.type) {
    case 'insertSet':
    case 'upsertDatedNote':
      return op.executionId;
    case 'updateExecution':
      return op.id;
    default:
      return null;
  }
}

/**
 * L'op dépend-elle d'une exécution dont la création est en quarantaine ? Elle
 * échouerait alors à son tour (clé étrangère), ou pire « réussirait » à vide
 * (clôture d'une exécution absente) : elle rejoint la quarantaine sans être
 * envoyée.
 */
function blockedByQuarantine(op: OutboxOp, quarantine: QuarantinedOp[]): boolean {
  const executionId = requiredExecution(op);
  if (executionId === null) return false;
  return quarantine.some(
    (q) => q.op.type === 'upsertExecution' && q.op.id === executionId && !q.superseded,
  );
}

/** Position de l'op `op` ELLE-MÊME dans `queue` (cf. `removeFromQueue`), -1 si absente. */
function indexInQueue(queue: OutboxOp[], op: OutboxOp): number {
  if (op._uid !== undefined) return queue.findIndex((o) => o._uid === op._uid);
  if (op._seq !== undefined) {
    return queue.findIndex((o) => o._seq === op._seq && o.type === op.type && o.id === op.id);
  }
  return queue[0]?.type === op.type && queue[0]?.id === op.id ? 0 : -1;
}

/** L'op est-elle encore dans la file persistée ? */
function isQueued(op: OutboxOp): boolean {
  return indexInQueue(readQueue(), op) !== -1;
}

/**
 * Retire de la file l'op `op` ELLE-MÊME, où qu'elle soit. Identité par `_uid`
 * (UUID posé à l'enqueue) ; à défaut (op d'un bundle antérieur) par `_seq`, type
 * et id à l'appui ; à défaut encore, en TÊTE seulement par (type, id), le temps
 * qu'elle soit drainée.
 *
 * Rend `'removed'`, `'absent'` (elle n'y était plus : purgée entre-temps), ou
 * `'unwritable'` : le retrait n'a pu être ni persisté ni tenu en mémoire, l'op
 * est donc TOUJOURS dans la file. L'appelant doit alors arrêter sa passe, sinon
 * il la relirait et la rejouerait sans fin. Un retrait que le stockage refuse
 * mais que le miroir mémoire tient vaut `'removed'` : la file persistée garde
 * alors une op déjà passée en base, qui serait rejouée après un rechargement.
 * Rejouer une op est sans effet (idempotence par id), SAUF dans un cas : une
 * insertion restée persistée alors que la suppression de la même ligne n'a
 * existé qu'en mémoire recrée la ligne. Limite du stockage plein, bornée à la
 * fenêtre où la file en mémoire dépasse la file persistée.
 */
function removeFromQueue(op: OutboxOp): 'removed' | 'absent' | 'unwritable' {
  const current = readQueue();
  const at = indexInQueue(current, op);
  if (at === -1) return 'absent';
  current.splice(at, 1);
  // Retrait non persisté mais tenu en mémoire : pour la page en cours l'op
  // n'est plus en file, la passe peut continuer sans la relire.
  return writeQueue(current) || storageFailing() ? 'removed' : 'unwritable';
}

/**
 * Déplace `op` de la file vers la quarantaine. La quarantaine est écrite AVANT
 * le retrait de la file : si une des deux écritures échoue (quota plein), l'op
 * reste en file et l'appelant arrête la passe (conserver plutôt que perdre).
 * Rend faux dans ce cas.
 */
function moveToQuarantine(op: OutboxOp, reason: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  // L'op a pu être retirée de la file pendant sa requête (« Annuler la séance »,
  // `purgeByExecution`) : l'utilisateur l'a abandonnée, la réponse tardive de la
  // base ne la remet pas en quarantaine. Rien à déplacer, la passe continue.
  if (!isQueued(op)) return true;
  try {
    const entry: QuarantinedOp = { op, reason, at: new Date().toISOString() };
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify([...readQuarantine(), entry]));
  } catch {
    return false;
  }
  return removeFromQueue(op) !== 'unwritable';
}

/**
 * Une exécution vient d'être (ré-)affirmée AVEC SUCCÈS : un ancien refus de sa
 * création ne retient plus ses ops filles (cf. `blockedByQuarantine`). L'op
 * refusée, elle, reste conservée en quarantaine.
 */
function liftExecutionBlock(executionId: string): void {
  const quarantine = readQuarantine();
  const concerns = (q: QuarantinedOp) =>
    q.op.type === 'upsertExecution' && q.op.id === executionId && !q.superseded;
  if (!quarantine.some(concerns)) return;
  try {
    localStorage.setItem(
      QUARANTINE_KEY,
      JSON.stringify(quarantine.map((q) => (concerns(q) ? { ...q, superseded: true } : q))),
    );
  } catch {
    // Quota plein : le blocage reste, les ops filles iront en quarantaine au lieu
    // de passer. Rien n'est perdu.
  }
}

// --- Saisies refusées : lister, renvoyer, abandonner --------------------------
//
// La quarantaine n'avait qu'une sortie, la purge. Ces trois fonctions donnent à
// l'utilisateur la main sur CHAQUE saisie refusée : la voir avec sa raison, la
// renvoyer (la cause a pu être levée : contrainte relâchée, exo recréé), ou
// l'abandonner. Elles ne portent que sur les saisies du compte reconnu (ou sans
// compte) : celles d'un autre compte ne se voient ni ne se touchent d'ici.
// L'écran qui les appelle se pose avec la refonte ; la logique est là.

/** Une saisie refusée, avec l'identité par laquelle la renvoyer ou l'abandonner. */
export interface RefusedWrite extends QuarantinedOp {
  /** Identité stable de l'entrée (l'UUID d'enfilement de l'op quand elle en a un). */
  refusalId: string;
}

function refusalIdOf(entry: QuarantinedOp): string {
  return entry.op._uid ?? `${entry.at}:${entry.op.type}:${entry.op.id}:${entry.op._seq ?? ''}`;
}

/** L'entrée est-elle au compte reconnu (ou sans compte, bundle antérieur) ? */
function isOwnEntry(entry: QuarantinedOp): boolean {
  return entry.op._owner === undefined || entry.op._owner === loadLocalAccount()?.userId;
}

/** Les saisies refusées du compte reconnu, dans l'ordre de leur refus. */
export function listRefused(): RefusedWrite[] {
  return readQuarantine()
    .filter(isOwnEntry)
    .map((entry) => ({ ...entry, refusalId: refusalIdOf(entry) }));
}

/**
 * Remet une saisie refusée en fin de file : elle sera retentée au prochain flush
 * (et reviendra en quarantaine si la base la refuse encore). Renvoyer la création
 * d'une exécution renvoie avec elle, à sa suite et dans leur ordre, les saisies
 * qui n'avaient été retenues que parce qu'elles en dépendaient. Rend faux si
 * l'entrée est introuvable ou si le stockage refuse l'écriture (rien ne bouge).
 */
export function retryRefused(refusalId: string): boolean {
  const quarantine = readQuarantine();
  const target = quarantine.find((q) => isOwnEntry(q) && refusalIdOf(q) === refusalId);
  if (!target) return false;
  const leaves = (q: QuarantinedOp): boolean =>
    q === target ||
    (target.op.type === 'upsertExecution' &&
      isOwnEntry(q) &&
      requiredExecution(q.op) === target.op.id);
  const resent = quarantine.filter(leaves).map((q) => q.op);
  // La file d'abord : si la seconde écriture échoue, l'op est à deux endroits
  // (renvoyée ET listée), jamais nulle part.
  if (!writeQueue([...readQueue(), ...resent])) return false;
  return writeQuarantine(quarantine.filter((q) => !leaves(q)));
}

/**
 * Abandonne une saisie refusée : elle quitte la quarantaine et ne sera jamais
 * envoyée. Geste explicite de l'utilisateur, sur UNE saisie (ADR 0012). Rend
 * faux si l'entrée est introuvable ou si le stockage refuse l'écriture.
 */
export function abandonRefused(refusalId: string): boolean {
  const quarantine = readQuarantine();
  const kept = quarantine.filter((q) => !(isOwnEntry(q) && refusalIdOf(q) === refusalId));
  if (kept.length === quarantine.length) return false;
  return writeQuarantine(kept);
}

function writeQuarantine(entries: QuarantinedOp[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/**
 * Vide entièrement la file (sert à la déconnexion / aux tests). Supprime AUSSI le
 * blob de QUARANTAINE (`CORRUPT_KEY`) : à la déconnexion sur un appareil partagé,
 * il contient du réalisé en clair (issue F11) et ne doit pas survivre au départ de
 * l'utilisateur entre deux comptes — le retirer ferme cette fuite (BUG M5). Même
 * raison pour les ops en quarantaine (`QUARANTINE_KEY`).
 */
export function clearQueue(): void {
  volatile = null;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CORRUPT_KEY);
    localStorage.removeItem(QUARANTINE_KEY);
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
  const kept = queue.filter((op) => !belongsToExecution(op, executionId));
  if (kept.length !== queue.length) writeQueue(kept);
  purgeQuarantineByExecution(executionId);
}

/**
 * L'op crée-t-elle ou ré-affirme-t-elle l'exécution `executionId` ou une de ses
 * lignes filles ? (Critère de `purgeByExecution`, cf. son en-tête.)
 */
function belongsToExecution(op: OutboxOp, executionId: string): boolean {
  switch (op.type) {
    case 'upsertExecution':
    case 'updateExecution':
      return op.id === executionId;
    case 'insertSet':
    case 'upsertDatedNote':
      return op.executionId === executionId;
    default:
      // deleteSet / deleteDatedNote / deleteExecution : ne portent que l'id de
      // la ligne (pas d'executionId rattachable) et sont idempotents par id
      // (sans effet si la ligne n'existe pas) → on les laisse.
      // upsertExerciseNote / deleteExerciseNote : la note d'instructions vit sur
      // la DÉFINITION de l'exo, jamais sur l'exécution abandonnée → elle survit
      // au « Réinitialiser » (sinon une instruction tapée juste avant le reset
      // serait perdue). Pas d'executionId, donc rien à rattacher de toute façon.
      return false;
  }
}

/**
 * Pendant de `purgeByExecution` côté QUARANTAINE : les ops refusées de
 * l'exécution abandonnée n'ont plus d'objet, et les garder bloquerait la
 * Déconnexion (`heldCount`) pour une séance que l'utilisateur a lui-même
 * annulée. Seulement celles du compte reconnu (ou sans compte) : la quarantaine
 * d'un autre compte ne se purge pas d'ici.
 */
function purgeQuarantineByExecution(executionId: string): void {
  const owner = loadLocalAccount()?.userId;
  const quarantine = readQuarantine();
  const kept = quarantine.filter(
    (q) =>
      !belongsToExecution(q.op, executionId) ||
      (q.op._owner !== undefined && q.op._owner !== owner),
  );
  if (kept.length === quarantine.length) return;
  try {
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(kept));
  } catch {
    // Quota plein : les entrées restent, rien n'est perdu ni faussé.
  }
}

// --- Enfilement ---------------------------------------------------------------

let seqCounter = 0;

/** UUID d'enfilement (cf. `_uid`). Repli non cryptographique sur un très vieux runtime. */
function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Ajoute une op en queue de file et persiste immédiatement. L'op est durable
 * dès cet instant : même si l'app meurt avant le flush, elle remontera au
 * prochain montage. Rend l'identité d'enfilement de l'op (`_uid`), par laquelle
 * l'appelant peut la retrouver après une passe (cf. `isPending`, `isRefused`).
 */
export function enqueueTracked(op: OutboxOp): string {
  const queue = readQueue();
  // Compteur d'ordre, ré-amorcé sur le max déjà persisté. Il n'identifie plus
  // l'op (deux onglets peuvent donner le même numéro) : c'est le rôle de `_uid`.
  const maxSeq = queue.reduce((m, o) => (o._seq !== undefined && o._seq > m ? o._seq : m), 0);
  seqCounter = Math.max(seqCounter, maxSeq) + 1;
  // Étiquette de compte : celui que l'appareil reconnaît à cet instant.
  const owner = loadLocalAccount()?.userId;
  const uid = newUid();
  queue.push({
    ...op,
    _seq: seqCounter,
    _uid: uid,
    _at: Date.now(),
    ...(owner ? { _owner: owner } : {}),
  });
  writeQueue(queue);
  return uid;
}

/** Enfile une op (cf. `enqueueTracked`) et renvoie la nouvelle longueur de file. */
export function enqueue(op: OutboxOp): number {
  enqueueTracked(op);
  return readQueue().length;
}

/** Combien des ops enfilées sous ces identités attendent encore en file ? */
export function pendingAmong(uids: readonly string[]): number {
  const ours = new Set(uids);
  return readQueue().filter((op) => op._uid !== undefined && ours.has(op._uid)).length;
}

/** Combien des ops enfilées sous ces identités la base a-t-elle refusées (quarantaine) ? */
export function refusedAmong(uids: readonly string[]): number {
  const ours = new Set(uids);
  return readQuarantine().filter((q) => q.op._uid !== undefined && ours.has(q.op._uid)).length;
}

// --- Flush --------------------------------------------------------------------

/** Retire les champs internes `_seq`, `_uid`, `_owner` et `_at` (mécanique de file) : la
 *  couche sync reçoit l'op DOMAINE, jamais l'identité de queue. Générique →
 *  préserve le type narrowé. */
function stripSeq<T extends Sequenced>(op: T): Omit<T, '_seq' | '_owner' | '_uid' | '_at'> {
  const { _seq: _ignored, _owner: _alsoIgnored, _uid: _ignoredToo, _at: _ignoredAsWell, ...rest } = op;
  return rest;
}

/** Aiguille une op vers sa fonction de sync. */
function runOp(op: OutboxOp, fns: SyncFns): Promise<void> {
  switch (op.type) {
    case 'upsertExecution':
      return fns.upsertExecution(stripSeq(op));
    case 'insertSet':
      return fns.insertSet(stripSeq(op));
    case 'deleteSet':
      return fns.deleteSet(stripSeq(op));
    case 'updateExecution':
      return fns.updateExecution(stripSeq(op));
    case 'upsertDatedNote':
      return fns.upsertDatedNote(stripSeq(op));
    case 'deleteDatedNote':
      return fns.deleteDatedNote(stripSeq(op));
    case 'upsertExerciseNote':
      return fns.upsertExerciseNote(stripSeq(op));
    case 'deleteExerciseNote':
      return fns.deleteExerciseNote(stripSeq(op));
    case 'deleteExecution':
      return fns.deleteExecution(stripSeq(op));
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

// ENTRE ONGLETS, la promesse mémoïsée ne suffit pas : chaque onglet a la sienne,
// sur la même file. Deux passes simultanées pouvaient croiser leurs envois : un
// onglet envoie puis retire « insertSet X » et « deleteSet X » pendant que
// l'insertion de l'autre, partie avant, arrive après la suppression et fait
// revenir la série. Un verrou du navigateur (`navigator.locks`) ne laisse donc
// flusher qu'un onglet à la fois.
//
// Le verrou n'est jamais ATTENDU, et jamais REPRIS à un autre onglet : s'il est
// pris, un autre onglet flushe cette même file (et relit la file entre deux
// ops, donc voit ce qu'on vient d'enfiler) ; la passe d'ici ne fait rien, le dit
// par son `remaining`, et un nouvel essai est reprogrammé tant que la file n'est
// pas vide (cf. `scheduleLockRetry`). Reprendre le verrou d'un onglet dont la
// passe dure laisserait deux onglets écrire en même temps, ce que le verrou
// existe pour empêcher. Un onglet figé par le système en pleine passe garde
// donc le verrou jusqu'à son réveil ; les essais continuent, espacés. Sans
// l'API (vieux navigateur, tests), la passe tourne sans verrou, comme avant.
const FLUSH_LOCK = 'croustylift:outbox:flush';

// NOUVEL ESSAI après un verrou occupé. Ne pas attendre le verrou ne doit pas
// vouloir dire « ne plus jamais essayer » : si la passe de l'autre onglet
// s'arrête sur un échec transitoire juste après notre refus, il libère le
// verrou et plus rien ne réveillait notre file, qui attendait la prochaine
// saisie ou le prochain remontage. Tant que le verrou a été refusé, que la file
// n'est pas vide et que l'appareil est en ligne, un essai est donc reprogrammé,
// avec des attentes qui s'allongent (0,5 s, puis le double, plafonné à 30 s).
// Un seul minuteur à la fois ; il s'éteint dès que le verrou est obtenu ou que
// la file est vide. Hors ligne, rien n'est reprogrammé : le retour du réseau
// relance la synchro par ailleurs.
const LOCK_RETRY_FIRST_MS = 500;
const LOCK_RETRY_MAX_MS = 30_000;
let flushLockBusy = false;
let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;
let lockRetryAttempt = 0;
/** Ce que le nouvel essai lance : par défaut la même passe, sinon le flush de l'app. */
let lockRetryRunner: (() => Promise<unknown>) | null = null;

/**
 * Fait passer les nouveaux essais par le flush de l'app (`flushOutbox`, qui
 * relit aussi les copies d'historique acquittées) plutôt que par la passe nue.
 */
export function setFlushRetryRunner(run: (() => Promise<unknown>) | null): void {
  lockRetryRunner = run;
}

function scheduleLockRetry(fns: SyncFns, who?: SessionReader): void {
  if (lockRetryTimer !== null) return;
  const delay = Math.min(LOCK_RETRY_FIRST_MS * 2 ** lockRetryAttempt, LOCK_RETRY_MAX_MS);
  lockRetryAttempt += 1;
  lockRetryTimer = setTimeout(() => {
    lockRetryTimer = null;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline || readQueue().length === 0) {
      lockRetryAttempt = 0;
      return;
    }
    void (lockRetryRunner ? lockRetryRunner() : flush(fns, who))
      .catch(() => {})
      .finally(() => {
        // L'écran suit la file (bannière de synchro) sans attendre un geste.
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
        }
      });
  }, delay);
}

/** Événement `window` émis quand la file a bougé sans geste de l'écran (nouvel essai). */
export const OUTBOX_CHANGED_EVENT = 'croustylift:outbox-changed';

async function underFlushLock(run: () => Promise<FlushResult>): Promise<FlushResult> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') return run();
  return locks.request(FLUSH_LOCK, { ifAvailable: true }, (lock) => {
    if (lock === null) {
      flushLockBusy = true;
      return { remaining: readQueue().length, flushed: 0 };
    }
    flushLockBusy = false;
    return run();
  });
}

/**
 * Synchronise la file vers Supabase et renvoie l'état après la passe.
 *
 * Traite DANS L'ORDRE (cf. `runFlushOnce`) : chaque op réussie est retirée et le
 * progrès persisté, on S'ARRÊTE à la première qui échoue (offline) en gardant l'op
 * + la suite. L'ordre exécution→séries (et insert→delete) est une dépendance, pas
 * une préférence : une op n'est jamais dépassée par une op du MÊME compte qui la
 * suit. Deux exceptions, qui ne cassent pas cette dépendance : une op REJETÉE
 * définitivement par la base quitte la file pour la quarantaine (ses ops filles
 * avec elle), et les ops d'un AUTRE compte que celui de `who` sont laissées en
 * file sans être jouées. Une op enfilée en cours de flush est rattrapée
 * (ré-armement, cf. `runFlush`) — le `FlushResult` reflète l'état réel.
 *
 * `who` : lecteur de la session vérifiée. Fourni, rien ne part sans compte
 * connecté. Absent (tests de la file seule), aucun contrôle de session ni de compte.
 *
 * Concurrent-safe : un flush déjà en vol est réutilisé plutôt que doublé, et un
 * seul onglet flushe à la fois (cf. `underFlushLock`).
 */
export function flush(fns: SyncFns, who?: SessionReader): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = underFlushLock(() => runFlush(fns, who))
    .then((result) => {
      // Verrou pris par un autre onglet et file non vide : un essai est
      // reprogrammé (cf. `scheduleLockRetry`). Verrou obtenu : les attentes
      // repartent de zéro.
      if (flushLockBusy && result.remaining > 0) scheduleLockRetry(fns, who);
      else if (!flushLockBusy) lockRetryAttempt = 0;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runFlush(fns: SyncFns, who?: SessionReader): Promise<FlushResult> {
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
    const { flushed, drained } = await runFlushOnce(fns, who);
    totalFlushed += flushed;
    const remaining = readQueue().length;
    // Arrêt sur échec (pas drainé), file vide, passe sans progrès (il ne reste
    // que des ops d'un autre compte, qu'une nouvelle passe ne jouerait pas
    // davantage), ou garde-fou de convergence atteint.
    if (!drained || remaining === 0 || flushed === 0 || --budget <= 0) {
      return { remaining, flushed: totalFlushed };
    }
    // Drainé mais la file s'est re-remplie (enqueue concurrent en fin de passe) :
    // on relance pour traiter la nouvelle op.
  }
}

/**
 * UNE passe : traite la file DANS L'ORDRE, retire chaque op réussie et persiste le
 * progrès, S'ARRÊTE à la première op qui échoue (offline, session absente) en
 * gardant l'op + le reste ; une op rejetée définitivement part en quarantaine et
 * la passe continue. `drained` = true s'il ne reste plus rien à jouer pour ce
 * compte, false si on s'est arrêté sur un échec (la distinction pilote le
 * ré-armement, cf. `runFlush`).
 */
async function runFlushOnce(
  fns: SyncFns,
  who?: SessionReader,
): Promise<{ flushed: number; drained: boolean }> {
  let queue = readQueue();
  let flushed = 0;

  while (queue.length > 0) {
    // SESSION VÉRIFIÉE avant chaque op (audit sync, constat 4). Sans session,
    // supabase-js envoie la requête sous la clé publique : la RLS fait alors
    // toucher 0 ligne à un `update` ou un `delete` SANS erreur, et l'op serait
    // retirée comme acquittée (clôture, annulation, suppression perdues). On
    // s'arrête donc comme hors ligne : rien n'est tenté, tout reste en file.
    // Sans lecteur (tests de la file seule), rien n'est vérifié.
    let user: string | undefined;
    if (who) {
      const connected = await who();
      if (typeof connected !== 'string') return { flushed, drained: false };
      user = connected;
      // La file a pu bouger pendant la lecture de la session.
      queue = readQueue();
    }
    // L'op à jouer : la première de la file ; sous une session vérifiée, la
    // première du compte CONNECTÉ. Celles d'un autre compte sont sautées et
    // restent en file, à leur place : elles ne partent que sous leur compte.
    // L'ordre FIFO vaut entre les ops d'un même compte (dépendance
    // exécution→séries), il n'y a aucune dépendance d'un compte à l'autre.
    const op = who ? queue.find((candidate) => candidate._owner === user) : queue[0];
    // Plus rien à jouer pour ce compte : la passe est finie.
    if (!op) break;
    // Op fille d'une exécution dont la création est en quarantaine : elle la
    // rejoint sans être envoyée, et la file continue.
    if (blockedByQuarantine(op, readQuarantine())) {
      const moved = moveToQuarantine(
        op,
        `dépend de l'exécution ${requiredExecution(op) ?? ''}, en quarantaine`,
      );
      if (!moved) return { flushed, drained: false };
      queue = readQueue();
      continue;
    }
    try {
      await runOp(op, fns);
    } catch (err) {
      // REJET DÉFINITIF de la base (cf. `isPermanentRejection`) : rejouer l'op
      // échouerait à l'identique et bloquerait tout ce qui suit. Elle part en
      // quarantaine et la file continue. Sous une session vérifiée, on REVÉRIFIE
      // d'abord la session : si elle vient de tomber, la requête a pu partir sous
      // la clé publique et le refus (RLS) ne dit rien de l'op, qui reste en file.
      if (isPermanentRejection(err) && (!who || (await who()) === user)) {
        const code = (err as { code: string }).code;
        const message = (err as { message?: unknown }).message;
        if (moveToQuarantine(op, `${code} : ${typeof message === 'string' ? message : ''}`)) {
          console.error(
            `[outbox] « ${op.type} » (id ${op.id}) rejetée par la base, mise en quarantaine :`,
            err,
          );
          queue = readQueue();
          continue;
        }
      }
      // Échec (réseau coupé le plus souvent) : on garde l'op et tout le reste,
      // dans l'ordre. La file persistée n'a pas bougé pour cette op → rejouée
      // telle quelle au prochain flush. Pas drainé → pas de ré-armement.
      // LOGGÉ, pas avalé (incident 2026-07-30) : une op rejetée par la base
      // (contrainte, RLS) échoue à l'IDENTIQUE à chaque passe et bloque la file
      // en silence — la console doit dire QUELLE op et POURQUOI, sinon le
      // diagnostic se fait à l'aveugle depuis les logs serveur.
      console.error(
        `[outbox] flush arrêté sur « ${op.type} » (id ${op.id}), ` +
          `${queue.length} op(s) en attente :`,
        err,
      );
      return { flushed, drained: false };
    }
    // La session a pu tomber PENDANT la requête (jeton expiré, refresh en échec) :
    // elle est alors peut-être partie sous la clé publique et a « réussi » à vide.
    // Dans le doute l'op n'est pas acquittée : elle reste en file, et la rejouer
    // est sans risque (idempotente par id). Même arrêt que hors ligne.
    if (who && (await who()) !== user) return { flushed, drained: false };
    // Succès : on relit la file (un enqueue concurrent a pu s'y ajouter) puis on
    // retire l'op qu'on vient de traiter, OÙ QU'ELLE SOIT (des ops d'un autre
    // compte peuvent la précéder). Mais la file a pu CHANGER pendant l'`await` :
    // un « Réinitialiser » (`purgeByExecution`) ou un `clearQueue` peut avoir
    // retiré l'op traitée, voire toute la file. On ne retire que l'op ELLE-MÊME
    // (cf. `removeFromQueue`) : si elle n'y est plus, elle a déjà été purgée → on
    // ne retire rien (retirer la tête à l'aveugle perdrait une op d'une nouvelle
    // exécution) et on reprend la boucle sur la file courante.
    if (op.type === 'upsertExecution') liftExecutionBlock(op.id);
    const removal = removeFromQueue(op);
    // Retrait impossible à persister (quota plein) : l'op, passée en base, est
    // encore dans la file. On arrête la passe (elle sera rejouée sans effet au
    // prochain flush) plutôt que de la relire et de la renvoyer sans fin.
    if (removal === 'unwritable') return { flushed, drained: false };
    if (removal === 'removed') flushed += 1;
    queue = readQueue();
  }

  return { flushed, drained: true };
}
