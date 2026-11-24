// REGISTRE D'ÉCRITURES de l'appareil (« outbox ») : tout ce que l'appareil a
// écrit et que la base n'a pas encore, ou vient juste de recevoir.
//
// PROBLÈME résolu : en salle, le wifi est souvent pourri. Les séries loggées
// hors ligne doivent survivre puis remonter SEULES au retour du réseau, dans
// l'ordre, sans doublon, et sans qu'un refus de la base bloque les suivantes.
//
// INTERFACE (tout le reste du fichier est son implémentation) :
//   - ENFILER  `enqueueAll(ops)` : les écritures d'UN geste, d'un seul tenant ;
//   - ENVOYER  `flush(fns, who)` : rend le SORT de chaque écriture traitée ;
//   - RENVOYER `retryRefused(id)`, ABANDONNER `abandonRefused(id)` : les deux
//     gestes de la feuille des saisies refusées ;
//   - LIRE     `listRefused()`, `pendingCount()`, `heldCounts()`, `fatesOf()`,
//     et pour le réalisé d'une exécution `readStamp()` et `writesSince()`.
//
// MODÈLE (ADR 0003, 0018, 0019) : UUID générés côté client, écritures
// idempotentes par id, last-write-wins par COLONNE, pas de moteur de merge.
// Chaque écriture a un NUMÉRO croissant et un SORT : en attente, refusée (la
// base l'a rejetée pour de bon : contrainte, RLS), ou acquittée récente. Les
// écritures partent dans l'ordre de leur numéro, entre écritures d'un même
// compte ; la passe s'arrête à la première qui échoue sans être refusée
// (réseau, session), une écriture refusée est mise de côté et la suite part.
// La règle « qui dépend de qui » (une série de sa séance, une correction de
// l'insertion qu'elle corrige) est posée à l'enfilement et vit à un seul
// endroit : registry-record.ts.
//
// STOCKAGE : UN enregistrement (`croustylift:registre`), écrit d'un coup, et
// SEULEMENT sous le verrou du navigateur (`navigator.locks`) : la passe d'envoi,
// le renvoi, l'abandon et la reprise d'une ancienne file sont les seules
// lectures-modifications-écritures de l'enregistrement, un onglet à la fois. Il
// n'existe aucun état intermédiaire où une écriture serait à deux endroits, ou
// nulle part. L'enfilement, lui, n'attend jamais le verrou (une passe le tient
// le temps de ses requêtes, et une série doit être durable dès le geste) : il
// écrit les écritures de son geste dans une clé à elles, la BOÎTE D'ENTRÉE,
// que le registre fait entrer sous le verrou. Les gestes synchrones qui
// retirent des écritures (« Annuler la séance », Déconnexion) valent tout de
// suite pour la page et s'écrivent sous le verrou juste après. La passe relit
// l'enregistrement avant chacune de ses écritures, jamais depuis un instantané
// d'avant une requête.
//
// VERSION : l'enregistrement porte la sienne. Une version plus récente (un
// autre onglet a été mis à jour) arrête tout envoi sans rien modifier, et la
// ligne de synchro demande de recharger (`registryOutdated`). Une montée de
// format se fait en une conversion de l'enregistrement entier.
//
// Cette couche est de la DURABILITÉ sous l'UI : le flux de log reste piloté par
// le reducer local (UI immédiate), le registre synchronise en fond.
// --- Types d'opérations -------------------------------------------------------
// Chaque op est un FAIT à rejouer, portant l'`id` de la ligne concernée (UUID
// client) pour rester idempotente. Discriminées par `type`.
import type { Side } from '../../domain/types';
import { loadLocalAccount } from '../../lib/local-account';
import { writeMakingRoom } from './cache-eviction';
import {
  ACKED_MAX,
  Draft,
  abandon,
  acknowledge,
  admit,
  admitLegacy,
  belongsToExecution,
  completeLegacyNoteDeletes,
  dependentsOf,
  effectiveOp,
  emptyRecord,
  fateOf,
  fromLegacy,
  heldBy,
  isExpired,
  LEGACY_MARK_UID,
  legacyIdentity,
  legacyMark,
  parseRecord,
  refuse,
  replay,
  retry,
  type Entry,
  type Fate,
  type LegacyEntry,
  type RegistryRecord,
  type Transition,
} from './registry-record';

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

/** Écrit une série ENTIÈRE : upsert complet par id. Idempotent. */
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

/**
 * Écriture PARTIELLE d'une série qui existe déjà, au lieu de l'upsert complet :
 *   - `only: 'values'` : seuls poids, reps et RIR sont écrits (correction d'une
 *     série) ; son rang en base n'est pas touché ;
 *   - `only: 'rank'` : seul le rang est écrit (remontée après une suppression) ;
 *     ses valeurs en base ne sont pas touchées ;
 *   - `only: 'side'` : seul le côté est écrit (série unilatérale saisie du
 *     mauvais côté) ; ni son rang ni ses valeurs ne sont touchés.
 * Sans cela, deux gestes faits depuis deux onglets s'écrasaient : une remontée
 * de rang réécrivait les valeurs d'avant une correction encore en file, une
 * correction réécrivait le rang d'avant une remontée. Une écriture partielle
 * ne crée jamais la ligne : si la série a été supprimée entre-temps, elle est
 * sans effet (corriger ou renuméroter une série supprimée ne la ressuscite
 * pas). L'op porte quand même la ligne ENTIÈRE, telle que l'émetteur la
 * voyait : elle sert à reconstituer la série si son insertion d'origine a été
 * refusée (cf. `flush`, quarantaine).
 *
 * UN TYPE À PART, et non une `insertSet` marquée : la file est commune aux
 * onglets, et un onglet resté sur un bundle antérieur (celui de main) ne
 * connaît pas `only`. Il rejouait la ligne entière en upsert et pouvait remettre
 * S2 à 80 kg après une correction à 90 kg faite ailleurs. Ce type, il ne sait
 * pas le jouer : sa passe s'ARRÊTE dessus (op de type inconnu, ni quarantaine
 * ni retrait), la file attend que l'onglet se mette à jour. Un blocage vaut
 * mieux qu'un écrasement silencieux. La forme d'avant (une `insertSet` avec
 * `only`), restée dans une file ou une quarantaine, est convertie à la lecture
 * (reprise de l'ancien format, registry-record.ts).
 */
export interface PatchSetOp {
  type: 'patchSet';
  id: string;
  executionId: string;
  exerciseId: string;
  setOrder: number;
  weightKg: number;
  reps: number;
  rir: number;
  side?: Side;
  only: 'values' | 'rank' | 'side';
  /**
   * Pour `only: 'values'` : les colonnes que le geste a CHANGÉES, les seules
   * écrites en base (last-write-wins par colonne, ADR 0003) : corriger le poids
   * ici et les reps ailleurs garde les deux. Absent (op d'avant ce champ) :
   * poids, reps et RIR sont écrits ensemble.
   */
  cols?: SetValueColumn[];
}

/** Une colonne de valeur d'une série, écrite seule par une correction. */
export type SetValueColumn = 'weightKg' | 'reps' | 'rir';

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

/**
 * Supprime une exécution SEULEMENT SI elle est encore ouverte et vide (ni
 * série, ni note datée) : le ménage de « Changer de séance », qui part sans
 * confirmation et ne doit donc rien pouvoir effacer (cf. session-gestures.ts).
 * La base tranche au moment de l'écriture, d'un seul tenant (RPC
 * `delete_execution_if_empty`, migration 0025) : une série arrivée d'un autre
 * onglet ou d'un autre appareil garde l'exécution en vie. Idempotent : sans
 * effet sur une exécution absente, close ou non vide.
 *
 * Un type à part, et non un drapeau sur `deleteExecution` : rien de ce qui lit
 * `deleteExecution` comme une suppression certaine (rejeu sur les lectures
 * locales, exécution « retirée » par la file) ne doit s'y tromper, et un onglet
 * resté sur un ancien bundle refuse le type inconnu au lieu de supprimer sans
 * condition.
 */
export interface DeleteExecutionIfEmptyOp {
  type: 'deleteExecutionIfEmpty';
  id: string;
  /** Comme `DeleteExecutionOp.exerciseIds` : copies locales à relire SI la base a supprimé. */
  exerciseIds?: string[];
}

// Champs de FILE, posés sur les écritures que le registre rend à ses lecteurs
// (`readQueue`, `listRefused`), jamais stockés dans l'op ni envoyés en base :
//   - `_uid` : l'identité de l'écriture (UUID posé à l'enfilement), par laquelle
//     la retrouver après une passe (`fatesOf`) ou la désigner (`retryRefused`) ;
//   - `_owner` : le COMPTE reconnu sur l'appareil à l'enfilement. Le registre
//     est commun à l'appareil ; sous une session vérifiée, la passe ne joue que
//     les écritures du compte connecté (ADR 0019) ;
//   - `_seq` et `_at` : son numéro d'écriture, sous les deux noms de l'ancien
//     format (ordre lisible au diagnostic).
type Sequenced = { _seq?: number; _owner?: string; _uid?: string; _at?: number };

export type OutboxOp = (
  | UpsertExecutionOp
  | InsertSetOp
  | PatchSetOp
  | DeleteSetOp
  | UpdateExecutionOp
  | UpsertDatedNoteOp
  | DeleteDatedNoteOp
  | UpsertExerciseNoteOp
  | DeleteExerciseNoteOp
  | DeleteExecutionOp
  | DeleteExecutionIfEmptyOp
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
  patchSet: (op: PatchSetOp) => Promise<void>;
  deleteSet: (op: DeleteSetOp) => Promise<void>;
  updateExecution: (op: UpdateExecutionOp) => Promise<void>;
  upsertDatedNote: (op: UpsertDatedNoteOp) => Promise<void>;
  deleteDatedNote: (op: DeleteDatedNoteOp) => Promise<void>;
  upsertExerciseNote: (op: UpsertExerciseNoteOp) => Promise<void>;
  deleteExerciseNote: (op: DeleteExerciseNoteOp) => Promise<void>;
  deleteExecution: (op: DeleteExecutionOp) => Promise<void>;
  /** Rend `'kept'` ou `'absent'` quand la base n'a rien supprimé : aucune copie n'est à relire. */
  deleteExecutionIfEmpty: (op: DeleteExecutionIfEmptyOp) => Promise<'deleted' | 'absent' | 'kept' | void>;
}

/**
 * Lecteur de session passé à `flush` : l'id du compte CONNECTÉ, vérifié à
 * l'instant (jeton présent et non expiré, ou rafraîchi avec succès). Toute autre
 * valeur (`null` : pas de session ; `undefined` : aucun lecteur posé) veut dire
 * « personne de vérifiable » et arrête la passe.
 */
export type SessionReader = () => Promise<string | null | undefined>;

/** Ce qu'une passe a fait d'UNE écriture. */
export interface SettledWrite {
  /** Identité de l'écriture (`_uid`). */
  uid: string;
  /** Ce qui est réellement parti (la série entière, pour une correction reconstituée). */
  op: OutboxOp;
  /**
   * `'acked'` : en base ; `'refused'` : rejetée pour de bon, mise de côté ;
   * `'replaced'` : rejetée, mais une écriture plus récente de la même série la
   * suit déjà, elle n'est donc pas gardée (son sort est celui de sa remplaçante).
   */
  fate: 'acked' | 'refused' | 'replaced';
  /** Les exos dont l'historique vient de changer en base (relecture des copies, ADR 0020). */
  touches: string[];
  /** Acquittée SANS effet en base (suppression conditionnelle que la base n'a pas faite). */
  noEffect?: true;
}

/** État rendu par `flush` : le sort de chaque écriture traitée, et ce qui reste. */
export interface FlushResult {
  /** Nombre d'écritures encore en attente d'envoi (0 = tout est synchronisé). */
  remaining: number;
  /** Nombre d'écritures acquittées pendant cette passe. */
  flushed: number;
  /** Le sort de chaque écriture que la passe a réglée, dans l'ordre. */
  settled: SettledWrite[];
}

// --- Stockage : un seul enregistrement, écrit sous le verrou -------------------

const REGISTRY_KEY = 'croustylift:registre';

// BOÎTE D'ENTRÉE. `localStorage` n'a pas de verrou entre onglets, et
// l'enfilement ne peut pas attendre celui du navigateur (une passe le tient le
// temps de ses requêtes). Tant que l'enfilement réécrivait l'enregistrement, un
// acquittement fait au même instant dans un autre onglet pouvait l'écraser avec
// un brouillon d'avant la saisie. Chaque geste écrit donc SES écritures dans
// une clé à lui, que personne d'autre ne réécrit : une seule écriture, jamais
// une lecture-modification-écriture. Le registre les fait entrer SOUS LE
// VERROU (début de chaque passe, renvoi, abandon), puis efface la clé. D'ici là
// toute lecture les voit déjà (`open`), avec le numéro pris à l'enfilement.
const INBOX_PREFIX = `${REGISTRY_KEY}:in:`;

// Blob ILLISIBLE mis de côté (JSON cassé, forme invalide) avant que le registre
// ne reparte vide : sans cela la prochaine écriture l'écraserait et ses
// écritures seraient perdues sans trace (issue F11). Même clé qu'avant le
// registre, pour qu'un blob de l'ancienne file déjà mis de côté y reste.
const CORRUPT_KEY = 'croustylift:outbox:corrupt';

// ANCIEN FORMAT (avant le registre) : une file et une quarantaine, deux clés.
// Converties à la première ouverture, puis REPRISES EN CONTINU : un onglet resté
// sur la version d'avant écrit encore dans ces clés, SANS verrou (son
// enfilement est une lecture-modification-écriture de sa file).
//
// UNE RÈGLE pour tout ce qui touche ces clés (`settleLegacy`), stockage plein
// ou non : on n'en retire que ce que CETTE transition y a lu, par identité, et
// seulement quand le registre n'en a plus besoin (il est écrit sur l'appareil,
// ou l'écriture est réglée : acquittée, abandonnée, purgée). Jamais de
// remplacement en bloc : ce que l'ancien onglet a enfilé depuis la lecture
// reste. Tant que le registre n'est pas écrit, une écriture qu'il retient
// garde sa copie dans ces clés, avec celles qu'elle a écartées (sa lignée) :
// après un rechargement, l'état se reconstruit tel qu'il était.
//
// À RETIRER après le 2026-12-31 (plus aucun onglet de l'ancienne version) :
// ces deux clés, le verrou de l'ancienne file, `readLegacy`, `settleLegacy`,
// `adoptLegacyOps` côté ancien format, et `fromLegacy` /
// `completeLegacyNoteDeletes` (registry-record.ts).
const LEGACY_QUEUE_KEY = 'croustylift:outbox';
const LEGACY_QUARANTINE_KEY = 'croustylift:outbox:quarantine';

// VERROU DE L'ANCIENNE FILE. Un onglet resté sur l'ancienne version envoie
// SA file, sous le même verrou que nous : il pouvait donc envoyer une
// correction récente avant qu'une plus ancienne, déjà au registre, ne parte
// d'ici, et l'ancienne gagnait en base. Tant que le registre est actif,
// l'ancienne file commence donc par une écriture d'un type que l'ancienne
// version ne sait pas jouer : sa passe S'ARRÊTE dessus (règle « type d'op
// inconnu », qu'elle applique déjà) et n'envoie plus rien. Ce qu'elle enfile
// derrière est repris ici, à sa place dans l'ordre d'envoi.
// Sous une session, l'ancienne version ne regarde que les écritures de son
// compte : le verrou est posé pour CHAQUE compte que l'appareil a reconnu
// (complété à chaque passe, donc dès la passe qui suit une connexion), plus un
// sans compte tant qu'aucun n'est connu.
//
// POSE : avant toute autre écriture de la passe (le verrou d'abord, le
// registre ensuite), en faisant de la place au besoin (copies de lecture non
// essentielles). Si l'appareil refuse quand même ces quelques octets, le
// verrou est posé SANS GRANDIR : la première écriture du compte dans
// l'ancienne file change de type sur place (initiale en majuscule, même
// taille, relue telle quelle ici), ce qui arrête l'ancienne version de la même
// façon. S'il n'y a rien à marquer, le compte reste sans verrou : c'est dit
// (`storageFailing`) et retenté à chaque passe.
const STOP = { type: 'registreActif', id: 'registre', _uid: LEGACY_MARK_UID, _at: 0 };
type RawLegacy = { type?: unknown; _owner?: unknown; _at?: unknown } | null;

/** Les comptes pour lesquels l'ancienne file doit être arrêtée : ceux qui le sont déjà, plus le compte reconnu. */
function stopOwners(queue: readonly unknown[]): Set<string> {
  const owners = new Set<string>();
  for (const op of queue) {
    const owner = (op as RawLegacy)?._owner;
    if (legacyMark(op) === 'stop' && typeof owner === 'string') owners.add(owner);
  }
  const current = loadLocalAccount()?.userId;
  if (current) owners.add(current);
  return owners;
}

/** L'écriture arrête-t-elle l'ancienne version sur place (type changé, cf. « POSE ») ? */
const stopsInPlace = (op: unknown): boolean => /^[A-Z]/.test(String((op as RawLegacy)?.type ?? ''));

/** Vrai tant qu'un compte reconnu n'a pas son verrou dans l'ancienne file (appareil plein). */
let legacyUnguarded = false;

function trySet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Règle les clés de l'ancien format (cf. « UNE RÈGLE » plus haut), en UNE
 * écriture par clé, sur leur contenu RELU à l'instant :
 *   - retire les écritures que `read` porte (lues par cette transition) et dont
 *     le registre n'a plus besoin : toutes si `durable` (il est écrit sur
 *     l'appareil), sinon celles que `record` ne retient plus, lignée comprise ;
 *   - garde un REPÈRE à la place d'une écriture datée retirée tant qu'une
 *     écriture sans instant reste dans la file : celle-ci tient son numéro de
 *     sa voisine datée (`fromLegacy`), et ne doit pas changer de place parce
 *     que sa voisine est partie ;
 *   - pose ou complète le verrou de l'ancienne file.
 * `read` nul : le verrou seul. Aucune de ces écritures ne grandit, sauf la pose
 * d'un verrou neuf, qui a son repli (cf. « POSE »).
 */
function settleLegacy(read: ReadonlySet<string> | null, record: RegistryRecord | null, durable: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const retained = new Set((record?.entries ?? []).filter((e) => e.fate !== 'acked').flatMap((e) => [e.uid, ...(e.replaces ?? [])]));
  const settled = (op: unknown): boolean => {
    if (read === null || legacyMark(op) !== null) return false;
    const uid = legacyIdentity(op);
    return read.has(uid) && (durable || !retained.has(uid));
  };
  try {
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY);
    const queue = legacyArray(LEGACY_QUEUE_KEY);
    const undated = queue.some((op) => legacyMark(op) === null && !settled(op) && (op as RawLegacy)?._at === undefined);
    const body = queue.flatMap((op) => {
      const mark = legacyMark(op);
      if (mark === 'stop') return [];
      if (mark === 'anchor') return undated ? [op] : [];
      if (!settled(op)) return [op];
      const at = (op as RawLegacy)?._at;
      return undated && typeof at === 'number' && at > 0 ? [{ ...STOP, _at: at }] : [];
    });
    const owners = stopOwners(queue);
    const stops = owners.size === 0 ? [STOP] : [...owners].map((owner) => ({ ...STOP, _owner: owner }));
    const wanted = JSON.stringify([...stops, ...body]);
    legacyUnguarded = false;
    if (raw !== wanted && !writeMakingRoom(() => trySet(LEGACY_QUEUE_KEY, wanted))) {
      // Pas la place d'un verrou neuf : sans grandir (cf. « POSE »).
      const had = queue.filter((op) => legacyMark(op) === 'stop');
      const covered = new Set(had.map((op) => (op as RawLegacy)?._owner));
      const marked = body.map((op) => {
        const owner = (op as RawLegacy)?._owner;
        if (legacyMark(op) !== null || typeof owner !== 'string' || !owners.has(owner) || covered.has(owner)) return op;
        covered.add(owner);
        const type = String((op as RawLegacy)?.type ?? '');
        return stopsInPlace(op) ? op : { ...(op as object), type: type.charAt(0).toUpperCase() + type.slice(1) };
      });
      const shrunk = JSON.stringify([...had, ...marked]);
      const written = raw === shrunk || (raw !== null && trySet(LEGACY_QUEUE_KEY, shrunk));
      legacyUnguarded = !written || [...owners].some((owner) => !covered.has(owner));
    }
    const quarantine = legacyArray(LEGACY_QUARANTINE_KEY);
    const kept = quarantine.filter((q) => !settled((q as { op?: unknown } | null)?.op));
    if (kept.length === 0) {
      if (localStorage.getItem(LEGACY_QUARANTINE_KEY) !== null) localStorage.removeItem(LEGACY_QUARANTINE_KEY);
    } else if (kept.length !== quarantine.length) localStorage.setItem(LEGACY_QUARANTINE_KEY, JSON.stringify(kept));
  } catch {
    // Elles restent telles quelles : rien n'en est perdu, et tout sera retenté
    // à la transition suivante.
  }
}

// TRANSITIONS EN MÉMOIRE, rejouées sur l'enregistrement relu à chaque lecture
// (jamais une copie du registre : il est commun aux onglets, et le réécrire
// depuis une copie effacerait ce qu'un autre onglet y a écrit entre-temps).
// Deux raisons de tenir une transition en mémoire :
//   - `deferred` : faite HORS du verrou par un geste synchrone (« Annuler la
//     séance », Déconnexion, conversion de démarrage). Elle vaut tout de suite
//     pour cette page, et s'écrit à la prochaine transition sous verrou, qui est
//     demandée aussitôt (`persistSoon`) ;
//   - `volatile` : l'appareil a REFUSÉ l'écriture (quota plein, mode privé), ou
//     une version plus récente a écrit le registre. Chaque écriture retente ;
//     dès qu'une passe, tout est écrit et le repli rendu. `storageFailing` le
//     dit à la ligne de synchro.
// Ce que la mémoire ne sauve pas : la page fermée avant l'écriture.
// L'enregistrement persisté est alors en retard d'un seul tenant (jamais une
// écriture à deux endroits) : ce qui y attend encore repartira, sans effet
// (idempotence par id). Liées à l'objet `localStorage` qui les a vues naître.
//
// `boxes` : les gestes que l'appareil n'a pas pu écrire dans la boîte d'entrée.
// Ils entrent au registre par le MÊME chemin que ceux de la boîte (`open`,
// `admit`) : leur parenté est posée comme pour les autres.
let volatile: { storage: Storage; log: Transition[]; boxes: Entry[][]; outdated: boolean } | null = null;
let deferred: { storage: Storage; log: Transition[] } | null = null;

function activeVolatile(): { log: Transition[]; boxes: Entry[][]; outdated: boolean } | null {
  if (volatile === null || typeof localStorage === 'undefined') return null;
  return volatile.storage === localStorage ? volatile : null;
}

function activeDeferred(): Transition[] {
  if (deferred === null || typeof localStorage === 'undefined') return [];
  return deferred.storage === localStorage ? deferred.log : [];
}

/** Tient en mémoire des transitions, ou le geste `box`, que l'appareil n'a pas pu écrire. */
function holdInMemory(log: Transition[], outdated: boolean, box?: Entry[]): void {
  const gap = activeVolatile();
  if (gap === null && !outdated) {
    console.warn(
      '[outbox] écriture localStorage refusée (quota plein / mode privé) : ' +
        'les saisies sont tenues en mémoire pour la session mais ne survivront pas à un reload.',
    );
  }
  volatile = {
    storage: localStorage,
    log: [...(gap?.log ?? []), ...log],
    boxes: [...(gap?.boxes ?? []), ...(box ? [box] : [])],
    outdated,
  };
}

// Le plus grand numéro que cette page a vu au registre. Une estampille relevée
// ici (lecture en vol, état de la séance, copie de lecture) vaut au plus ce
// numéro : tout numéro pris ensuite doit lui être supérieur, même après une
// purge forcée, une Déconnexion ou un enregistrement illisible mis de côté.
// D'une page à l'autre, c'est l'horloge qui borne (cf. `Draft.next`).
let highestSeq = 0;

/** Le numéro donné par cette page à une écriture de l'ancien format sans instant (cf. `open`). */
let legacyNumbers: { storage: Storage | null; seen: Map<string, number> } = { storage: null, seen: new Map() };

/** Met un blob illisible de côté (une fois) et prévient. Ne touche pas à sa clé d'origine. */
function setAside(raw: string, reason: string): void {
  try {
    if (localStorage.getItem(CORRUPT_KEY) === raw) return;
    localStorage.setItem(CORRUPT_KEY, raw);
  } catch {
    // Même cette écriture peut échouer (quota, mode privé) : on prévient quand même.
  }
  console.warn(
    `[outbox] écritures persistées illisibles (${reason}) : reparti vide, ` +
      `blob conservé sous « ${CORRUPT_KEY} » pour diagnostic.`,
  );
}

/** L'enregistrement tel qu'il est sur l'appareil. `outdated` : écrit par une version plus récente. */
function readPersisted(): { record: RegistryRecord; outdated: boolean } {
  if (typeof localStorage === 'undefined') return { record: emptyRecord(), outdated: false };
  const raw = localStorage.getItem(REGISTRY_KEY);
  if (!raw) return { record: emptyRecord(), outdated: false };
  const parsed = parseRecord(raw);
  if (parsed === 'outdated') return { record: emptyRecord(), outdated: true };
  if (parsed === 'corrupt') {
    // Mis de côté ; la prochaine écriture sous verrou le remplacera.
    setAside(raw, 'registre');
    return { record: emptyRecord(), outdated: false };
  }
  return { record: parsed, outdated: false };
}

/** Les clés de l'appareil qui commencent par `prefix`. */
function keysWith(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/** Ce que porte la boîte d'entrée : ses clés, et leurs écritures. */
function readInbox(): { key: string; entries: Entry[] }[] {
  if (typeof localStorage === 'undefined') return [];
  const out: { key: string; entries: Entry[] }[] = [];
  for (const key of keysWith(INBOX_PREFIX)) {
    // Écrite d'un coup par un seul geste : lisible, ou pas de cette version.
    const parsed = parseRecord(localStorage.getItem(key) ?? '');
    if (typeof parsed === 'object') out.push({ key, entries: parsed.entries });
  }
  return out;
}

/** Le contenu brut d'une clé de l'ancien format, en tableau ; vide s'il est absent ou illisible. */
function legacyArray(key: string): unknown[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    setAside(raw, 'ancienne file, forme invalide');
  } catch {
    setAside(raw, 'ancienne file, JSON illisible');
  }
  return [];
}

/** Les écritures que portent encore les clés de l'ancien format (cf. `LEGACY_QUEUE_KEY`). */
function readLegacy(): LegacyEntry[] {
  if (typeof localStorage === 'undefined') return [];
  if (localStorage.getItem(LEGACY_QUEUE_KEY) === null && localStorage.getItem(LEGACY_QUARANTINE_KEY) === null) {
    return [];
  }
  const queue = legacyArray(LEGACY_QUEUE_KEY).filter((op) => legacyMark(op) !== 'stop');
  return fromLegacy(queue, legacyArray(LEGACY_QUARANTINE_KEY));
}

interface Opened {
  draft: Draft;
  outdated: boolean;
  /** Les clés de la boîte d'entrée lues : à effacer une fois leur contenu écrit au registre. */
  inboxKeys: string[];
  /** Les identités lues dans les clés de l'ancien format : les seules qu'on en retirera. */
  legacyRead: ReadonlySet<string>;
  /** Où finissent, dans le journal du brouillon, les entrées faites par la lecture. */
  admitted: number;
}

/**
 * Le registre tel que cette page doit le voir, prêt à être modifié :
 * l'enregistrement persisté, RELU à l'instant ; ce que la boîte d'entrée et les
 * clés de l'ancien format portent encore ; puis les transitions tenues en
 * mémoire. Ne modifie rien sur l'appareil : c'est aussi la lecture de tous les
 * états rendus à l'UI. Les entrées de la boîte et de l'ancien format sont dans
 * le journal du brouillon : la première écriture sous verrou les persiste.
 */
function open(): Opened {
  // ORDRE DES LECTURES : la boîte d'entrée et les anciennes clés AVANT
  // l'enregistrement. Un autre onglet qui fait entrer une saisie écrit
  // l'enregistrement puis efface la clé : lue dans cet ordre, la saisie est
  // dans l'une des deux lectures, quel que soit l'instant du transfert. Dans
  // l'autre ordre, elle pouvait n'être dans aucune.
  const inbox = readInbox();
  const legacy = readLegacy();
  const { record, outdated } = readPersisted();
  // Le compteur ne recule jamais sous les yeux de cette page, même si
  // l'enregistrement a été purgé ou mis de côté entre-temps (cf. `highestSeq`).
  record.seq = Math.max(record.seq, highestSeq);
  const draft = new Draft(record, Date.now);
  const incoming = [...inbox.flatMap((box) => box.entries), ...(activeVolatile()?.boxes.flat() ?? [])].sort(
    (x, y) => x.n - y.n,
  );
  for (const entry of incoming) admit(draft, entry);
  for (const entry of legacy) {
    // Sans instant d'enfilement : le numéro pris la première fois que cette
    // page l'a vue, pour qu'elle garde sa place d'une lecture à l'autre.
    if (legacyNumbers.storage !== localStorage) legacyNumbers = { storage: localStorage, seen: new Map() };
    let n = entry.n ?? legacyNumbers.seen.get(entry.uid);
    if (n === undefined) {
      n = draft.next();
      legacyNumbers.seen.set(entry.uid, n);
    }
    admitLegacy(draft, { ...entry, n });
  }
  const admitted = draft.log.length;
  // La mémoire en dernier : elle peut retirer ou modifier ce qui vient d'entrer.
  replay(record, activeVolatile()?.log ?? []);
  replay(record, activeDeferred());
  highestSeq = Math.max(highestSeq, record.seq);
  return {
    draft,
    outdated,
    inboxKeys: inbox.map((box) => box.key),
    legacyRead: new Set(legacy.map((entry) => entry.uid)),
    admitted,
  };
}

/** Lecture seule du registre (cf. `open`). */
function view(): RegistryRecord {
  return open().draft.record;
}

/** Retire des clés de l'appareil, sans jamais jeter. */
function removeKeys(keys: readonly string[]): boolean {
  try {
    for (const key of keys) localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Écrit l'enregistrement d'un coup. Faux si l'appareil le refuse. */
function persist(record: RegistryRecord): boolean {
  try {
    // Même vide, l'enregistrement reste : il porte le compteur, qui ne recule jamais.
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Écrit le brouillon. SOUS LE VERROU seulement : c'est la seule
 * lecture-modification-écriture de l'enregistrement. Si l'appareil refuse : les
 * écritures ACQUITTÉES cèdent d'abord la place (elles ne servent qu'aux
 * lectures en vol), puis les copies de lecture non essentielles (cf.
 * cache-eviction : jamais celles du chemin d'ouverture de la Capture). Si rien
 * n'y fait, les transitions sont tenues en mémoire (cf. `volatile`) et le refus
 * est signalé. Sous une version plus récente, RIEN n'est écrit.
 */
function commit(opened: Opened): boolean {
  if (typeof localStorage === 'undefined') return false;
  const { draft, outdated, inboxKeys, admitted } = opened;
  // Le journal de secours ne porte QUE ce qui a suivi les entrées faites par la
  // lecture : les gestes faits hors du verrou, puis cette transition. Les
  // entrées elles-mêmes n'y sont pas : leur source (boîte d'entrée, mémoire,
  // anciennes clés) reste lue à chaque ouverture tant qu'elles ne sont ni
  // écrites au registre ni réglées, et les fait entrer AVANT le rejeu. Notées
  // au journal, elles y revenaient après un retrait : la saisie d'une séance
  // annulée, ou une écriture déjà acquittée, repartait.
  const pending = [...activeDeferred(), ...draft.log.slice(admitted)];
  deferred = null;
  if (outdated) {
    holdInMemory(pending, true);
    return false;
  }
  let written = persist(draft.record);
  if (!written) {
    const acked = draft.record.entries.filter((e) => e.fate === 'acked').map((e) => e.uid);
    if (acked.length > 0) {
      draft.drop(acked);
      pending.push({ t: 'drop', uids: acked });
      written = persist(draft.record);
    }
  }
  if (!written) written = writeMakingRoom(() => persist(draft.record));
  if (!written) {
    // Ce que les clés de l'ancien format portaient et qui est réglé ici n'a
    // plus à y rester : relu, il repartirait à chaque passe. Les réduire libère
    // de la place : l'écriture est retentée.
    settleLegacy(opened.legacyRead, draft.record, false);
    written = persist(draft.record);
  }
  // Plus rien à retenir (tout est acquitté) : retirer l'enregistrement passe
  // même sur un appareil plein, et rien n'est alors en retard sur l'appareil.
  if (!written && draft.record.entries.length === 0) written = removeKeys([REGISTRY_KEY]);
  if (written) {
    volatile = null;
    // Le contenu de ces clés est au registre : elles ont fini de servir. Une
    // clé apparue depuis la lecture (un geste dans un autre onglet) n'est pas
    // dans cette liste, et reste.
    removeKeys(inboxKeys);
    settleLegacy(opened.legacyRead, draft.record, true);
    return true;
  }
  // Pas écrit : une clé de la boîte dont tout le contenu est réglé ne doit
  // pas rentrer de nouveau à la lecture suivante.
  const retained = new Set(draft.record.entries.filter((e) => e.fate !== 'acked').map((e) => e.uid));
  removeKeys(
    readInbox()
      .filter((box) => inboxKeys.includes(box.key) && box.entries.every((e) => !retained.has(e.uid)))
      .map((box) => box.key),
  );
  holdInMemory(pending, false);
  return false;
}

/**
 * UNE transition du registre, SOUS LE VERROU : lecture, modification, écriture,
 * sans rendre la main entre les trois. Ce que la boîte d'entrée et la mémoire
 * portaient est écrit du même coup. `change` rend ce qu'il veut ; rien n'est
 * écrit s'il n'y a rien à écrire (sauf `force`, pour retenter le stockage).
 */
function transact<T>(change: (draft: Draft) => T, force = false): T {
  const opened = open();
  const result = change(opened.draft);
  highestSeq = Math.max(highestSeq, opened.draft.record.seq);
  if (opened.draft.log.length > 0 || activeDeferred().length > 0 || force) commit(opened);
  return result;
}

/**
 * Fait entrer au registre ce qui attend ailleurs, SOUS LE VERROU : la boîte
 * d'entrée, les transitions tenues en mémoire, et ce que portent les clés de
 * l'ancien format. Pour ces dernières : le registre d'abord, les anciennes clés
 * ensuite. Si l'app s'arrête entre les deux, le registre fait foi à l'ouverture
 * suivante (une écriture déjà connue n'entre pas deux fois, cf. `admit`).
 *
 * EN CONTINU : au début de chaque passe d'envoi, parce qu'un onglet resté sur
 * la version d'avant écrit encore dans ses clés. Ce qui en est retiré, et
 * quand : `settleLegacy`.
 */
function absorb(): void {
  if (typeof localStorage === 'undefined') return;
  // Sous une version plus récente, rien n'est écrit ni effacé.
  if (registryOutdated()) return;
  // Le verrou de l'ancienne file AVANT toute autre écriture : c'est lui qui a
  // le plus besoin des derniers octets de l'appareil.
  settleLegacy(null, null, false);
  const opened = open();
  if (opened.outdated) return;
  if (opened.draft.log.length > 0 || activeDeferred().length > 0 || activeVolatile() !== null) commit(opened);
  else settleLegacy(opened.legacyRead, opened.draft.record, true);
}

/**
 * Demande l'écriture, sous le verrou, de ce qui n'est pas encore au registre
 * (mémoire, boîte d'entrée, ancien format). Au tour suivant de la boucle
 * d'événements, pas tout de suite : le geste qui vient de tenir une transition
 * en mémoire lance le plus souvent une passe d'envoi dans la foulée (« Annuler
 * la séance » puis sa suppression), qui l'écrit elle-même en prenant le verrou.
 * S'il ne reste alors rien à écrire, le verrou n'est pas demandé. Sans l'API de
 * verrou (vieux navigateur), l'écriture est faite sur-le-champ.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon(always = false): void {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') {
    absorb();
    return;
  }
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (typeof localStorage === 'undefined') return;
    const waiting =
      activeDeferred().length > 0 || activeVolatile() !== null || readInbox().length > 0 || readLegacy().length > 0;
    // `always` : le démarrage, qui pose aussi le verrou de l'ancienne file.
    if (!waiting && !always) return;
    void Promise.resolve(locks.request(FLUSH_LOCK, () => absorb())).catch(() => {});
  }, 0);
}

/** Applique tout de suite, pour cette page, des transitions faites hors du verrou, et demande leur écriture. */
function defer(log: Transition[]): void {
  if (log.length === 0 || typeof localStorage === 'undefined') return;
  deferred = { storage: localStorage, log: [...activeDeferred(), ...log] };
  persistSoon();
}

/**
 * Vrai quand une version PLUS RÉCENTE de l'app a écrit le registre de l'appareil
 * (un autre onglet a été mis à jour). Cette version ne sait pas le lire : elle
 * n'envoie plus rien et n'y écrit plus rien. Ce qui est saisi d'ici là ne tient
 * qu'en mémoire ; recharger l'app est la seule issue, et la ligne de synchro le
 * demande.
 */
export function registryOutdated(): boolean {
  return readPersisted().outdated;
}

/**
 * Vrai tant qu'une partie du registre ne tient qu'en mémoire parce que le
 * stockage de l'appareil a refusé sa dernière écriture. Les saisies en attente
 * ne survivraient pas à la fermeture de l'app.
 */
export function storageFailing(): boolean {
  const gap = activeVolatile();
  // Aussi quand l'appareil n'a pas pu recevoir le verrou de l'ancienne file.
  return (gap !== null && !gap.outdated) || legacyUnguarded;
}

/** Les écritures enfilées que l'appareil n'a écrites nulle part, et que le registre retient encore. */
function unpersistedAdds(): Entry[] {
  const gap = activeVolatile();
  if (gap === null || gap.outdated || gap.boxes.length === 0) return [];
  const held = new Set(gap.boxes.flat().map((e) => e.uid));
  return view().entries.filter((e) => e.fate !== 'acked' && held.has(e.uid));
}

/**
 * Vrai tant que des écritures ENFILÉES ne sont écrites nulle part ailleurs qu'en
 * mémoire : recharger la page les détruirait (séries, clôture). Plus étroit que
 * `storageFailing` : seulement les écritures enfilées non persistées et pas
 * encore acquittées. C'est ce que lit l'autorisation de recharger
 * (pwa/reload-guards). Faux sous une version plus récente (`registryOutdated`) :
 * recharger y est justement la seule issue, et la ligne de synchro a prévenu.
 */
export function hasUnpersistedOps(): boolean {
  return unpersistedAdds().length > 0;
}

/** Prévient l'écran que le registre a bougé sans geste de sa part. */
function notifyChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
  }
}

/** Écrit les écritures d'UN geste dans sa clé de la boîte d'entrée. Faux si l'appareil refuse. */
function writeInbox(entries: readonly Entry[]): boolean {
  const key = `${INBOX_PREFIX}${newUid()}`;
  const value = JSON.stringify({ v: 1, seq: 0, entries: [...entries] } satisfies RegistryRecord);
  return writeMakingRoom(() => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Retente d'écrire sur l'appareil ce que le registre ne tient qu'en mémoire
 * (place libérée depuis le refus). Synchrone pour ce qui compte au
 * rechargement : les saisies enfilées, écrites dans la boîte d'entrée. Le reste
 * (acquittements, refus) est demandé sous le verrou. Rend vrai si plus rien ne
 * tient en mémoire en sortie.
 */
export function retryPersistQueue(): boolean {
  const gap = activeVolatile();
  if (gap === null) return true;
  if (gap.outdated) return false;
  const adds = unpersistedAdds();
  if (adds.length > 0 && !writeInbox(adds)) return false;
  // Ces gestes sont dans la boîte d'entrée : la mémoire n'a plus à les porter.
  gap.boxes = [];
  if (gap.log.length === 0) {
    // Tout ce que la mémoire tenait est maintenant sur l'appareil.
    volatile = null;
    // La ligne « stockage plein » se relit sur cet événement.
    notifyChanged();
    return true;
  }
  persistSoon();
  return activeVolatile() === null;
}

// --- Lectures ------------------------------------------------------------------

/** L'écriture est-elle au compte reconnu (ou sans compte, bundle antérieur) ? */
function isOwn(entry: Entry): boolean {
  return entry.owner === undefined || entry.owner === loadLocalAccount()?.userId;
}

/** L'op d'une écriture, avec ses champs de file (cf. `Sequenced`). */
function asQueued(entry: Entry): OutboxOp {
  return {
    ...entry.op,
    _seq: entry.n,
    _uid: entry.uid,
    _at: entry.n,
    ...(entry.owner ? { _owner: entry.owner } : {}),
  };
}

/** En attente d'ENVOI : ni refusée, ni retenue par le refus de sa séance. */
function isAwaiting(record: RegistryRecord, entry: Entry): boolean {
  return entry.fate === 'pending' && heldBy(record, entry) === null;
}

/** Les écritures en attente d'envoi, tous comptes confondus, dans l'ordre d'envoi. */
export function readQueue(): OutboxOp[] {
  const record = view();
  return record.entries.filter((e) => isAwaiting(record, e)).map(asQueued);
}

/**
 * Les écritures en attente d'envoi du compte reconnu : celles d'un autre compte
 * restées sur l'appareil n'entrent pas dans ce que celui-ci voit.
 */
export function readOwnQueue(): OutboxOp[] {
  const record = view();
  return record.entries.filter((e) => isAwaiting(record, e) && isOwn(e)).map(asQueued);
}

/** Nombre d'écritures en attente d'envoi (pilote l'indicateur de synchro). */
export function pendingCount(): number {
  return readQueue().length;
}

/**
 * ESTAMPILLE d'une lecture : le numéro du registre à son DÉPART. À relever juste
 * avant de lancer une lecture de la base, et à rendre avec sa réponse : elle dit
 * quelles écritures locales la réponse ne peut pas contenir (`writesSince`).
 */
export type ReadStamp = number;

export function readStamp(): ReadStamp {
  return view().seq;
}

/** Une écriture locale, telle que la lit le réalisé d'une exécution. */
export interface LocalWrite {
  uid: string;
  /** Numéro d'écriture : l'ordre dans lequel les appliquer. */
  n: number;
  /** L'op métier (pour une écriture acquittée ou refusée : ce qui est réellement parti). */
  op: OutboxOp;
  fate: Fate;
}

/**
 * Les écritures du compte reconnu qu'une lecture estampillée `stamp` NE CONTIENT
 * PAS, dans l'ordre où les appliquer par-dessus : celles qui attendent, celles
 * que la base a refusées (l'appareil les retient : elles restent à l'écran), et
 * celles qu'elle a acquittées APRÈS le départ de la lecture. Une écriture
 * enfilée avant le départ mais acquittée après est donc rendue : la réponse,
 * figée à son départ, ne la porte pas.
 *
 * Sans estampille (`null` : hors ligne, copie d'avant ce champ), seules les
 * écritures non acquittées sont rendues.
 */
export function writesSince(stamp: ReadStamp | null | undefined): LocalWrite[] {
  // Une écriture acquittée depuis plus longtemps que sa rétention n'est plus
  // appliquée, même si rien ne l'a encore retirée du registre : elle masquerait
  // sans borne une correction venue d'un autre appareil.
  const now = Date.now();
  return view()
    .entries.filter(
      (e) => isOwn(e) && (e.fate !== 'acked' || (stamp != null && (e.ack ?? 0) > stamp && !isExpired(e, now))),
    )
    .map((e) => ({ uid: e.uid, n: e.n, op: e.op, fate: e.fate }));
}

/**
 * Le sort de chaque écriture enfilée sous ces identités : `'pending'` (elle
 * attend), `'refused'` (rejetée par la base, ou retenue par le refus de sa
 * séance), `'acked'` (en base), `'gone'` (abandonnée ou purgée). Une écriture
 * écartée au profit d'une plus récente de la même série a le sort de sa
 * remplaçante : elle n'est « en base » que quand celle-ci l'est.
 */
export function fatesOf(uids: readonly string[]): (Fate | 'gone')[] {
  const record = view();
  return uids.map((uid) => fateOf(record, uid));
}

/**
 * Ce que l'appareil retient d'écritures non remontées, en attente ET refusées :
 * ce que protègent les gardes d'auth (ADR 0012 : rien ne se perd sans geste
 * explicite). PAR COMPTE (ADR 0019) : `own`, celles du compte reconnu (une
 * écriture sans compte, d'un bundle antérieur, est tenue pour la sienne) ;
 * `ownRefused`, la part refusée ou retenue par un refus ; `foreign`, ce que
 * retiennent d'autres comptes.
 */
export function heldCounts(): { own: number; ownRefused: number; foreign: number } {
  const record = view();
  const held = record.entries.filter((e) => e.fate !== 'acked');
  const own = held.filter(isOwn);
  return {
    own: own.length,
    ownRefused: own.filter((e) => !isAwaiting(record, e)).length,
    foreign: held.length - own.length,
  };
}

// --- Purges ----------------------------------------------------------------------
// Gestes synchrones, hors du verrou : ils ne réécrivent jamais l'enregistrement.
// Ils retirent pour cette page (`defer`), effacent les clés de la boîte d'entrée
// qu'ils vident entièrement, et l'écriture suit sous le verrou.

/** Retire des écritures, par identité : tout de suite pour cette page, sous verrou pour l'appareil. */
function dropNow(doomed: (entry: Entry) => boolean): void {
  if (typeof localStorage === 'undefined') return;
  const uids = new Set(view().entries.filter(doomed).map((e) => e.uid));
  if (uids.size === 0) return;
  // Une clé de la boîte dont toutes les écritures partent peut être effacée
  // tout de suite : ce n'est pas une réécriture.
  removeKeys(
    readInbox()
      .filter((box) => box.entries.every((e) => uids.has(e.uid)))
      .map((box) => box.key),
  );
  defer([{ t: 'drop', uids: [...uids] }]);
}

/**
 * Retire du registre les écritures du compte reconnu (et celles sans compte), et
 * elles seules : celles d'un AUTRE compte restent, à leur place, pour remonter
 * quand il reviendra. C'est la purge de la Déconnexion : on n'y jette que ce qui
 * est à soi. Le blob illisible mis de côté, dont on ne sait pas l'auteur, part
 * avec elle.
 */
export function clearOwnQueue(): void {
  if (typeof localStorage === 'undefined') return;
  dropNow(isOwn);
  removeKeys([CORRUPT_KEY]);
}

/**
 * Vide entièrement le registre, tous comptes confondus (forçage de purge,
 * tests), avec le blob mis de côté : sur un appareil partagé, il contient du
 * réalisé en clair. Rien n'est relu pour être gardé : ce n'est pas une
 * lecture-modification-écriture. Le compteur, lui, ne recule pas.
 */
export function clearQueue(): void {
  const { record, outdated } = readPersisted();
  volatile = null;
  deferred = null;
  legacyUnguarded = false;
  if (typeof localStorage === 'undefined') return;
  removeKeys([LEGACY_QUEUE_KEY, LEGACY_QUARANTINE_KEY, CORRUPT_KEY, ...keysWith(INBOX_PREFIX)]);
  if (outdated) return;
  const seq = Math.max(record.seq, highestSeq);
  if (seq === 0 || !persist({ ...emptyRecord(), seq })) removeKeys([REGISTRY_KEY]);
}

/**
 * Purge CIBLÉE : retire les écritures qui créent ou réaffirment l'exécution
 * `executionId` et ses lignes filles, sans toucher au reste. Sert à « Annuler la
 * séance », qui abandonne l'exécution courante : hors ligne, le registre peut
 * aussi porter les séries d'une AUTRE exécution ou une correction d'historique,
 * qui doivent survivre.
 *
 * Retire `upsertExecution`, `updateExecution`, `insertSet`, `patchSet` et
 * `upsertDatedNote` de cette exécution, en attente (tous comptes) ou refusées
 * (compte reconnu seulement : les refus d'un autre compte ne se purgent pas
 * d'ici). LAISSE les `deleteSet`, `deleteDatedNote` et `deleteExecution`
 * (idempotents par id, sans effet sur une ligne jamais créée), les notes
 * d'instructions (elles vivent sur la définition de l'exo), et toute écriture
 * d'une autre exécution. Une écriture déjà partie quand la purge tombe n'est
 * pas remise au registre par la réponse de la base.
 */
export function purgeByExecution(executionId: string): void {
  dropNow(
    (e) => e.fate !== 'acked' && belongsToExecution(e.op, executionId) && (e.fate === 'pending' || isOwn(e)),
  );
}

// --- Reprise de l'ancien format -----------------------------------------------

/**
 * Conversion de démarrage : fait entrer au registre l'ancienne file et l'ancienne
 * quarantaine (cf. `absorb`), complète les effacements de note datée hérités, et
 * attribue au compte local reconnu les écritures sans compte. À appeler AU
 * DÉMARRAGE, avant tout envoi et avant que la couche d'auth ne réécrive le
 * marqueur : le compte est relevé ICI, pas au moment de l'écriture (faite
 * pendant une passe, l'attribution donnerait les écritures de A au compte B
 * arrivé entre-temps). Sans marqueur, rien n'est attribué : ces écritures
 * restent au registre et ne partent sous aucun compte.
 *
 * Synchrone pour cette page ; l'écriture sur l'appareil suit, sous le verrou.
 */
export function adoptLegacyOps(): void {
  if (typeof localStorage === 'undefined') return;
  const { draft } = open();
  const before = draft.log.length;
  completeLegacyNoteDeletes(draft);
  const owner = loadLocalAccount()?.userId;
  if (owner) {
    for (const e of draft.record.entries) {
      if (e.fate !== 'acked' && e.owner === undefined) draft.patch(e.uid, { owner });
    }
  }
  const adopted = draft.log.slice(before);
  if (adopted.length > 0) deferred = { storage: localStorage, log: [...activeDeferred(), ...adopted] };
  persistSoon(true);
}

// --- Enfilement ---------------------------------------------------------------

/** UUID d'enfilement. Repli non cryptographique sur un très vieux runtime. */
function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Retire les champs de file d'une op rendue par le registre puis réenfilée. */
function stripQueueFields(op: OutboxOp): OutboxOp {
  const { _seq: _a, _owner: _b, _uid: _c, _at: _d, ...rest } = op;
  return rest as OutboxOp;
}

/**
 * ENFILE les écritures d'UN geste comme une seule unité : UNE écriture sur
 * l'appareil, dans une clé à elles (cf. `INBOX_PREFIX`), que personne d'autre
 * ne réécrit. Elles sont toutes écrites, ou toutes tenues en mémoire (repli
 * sous stockage plein), jamais coupées en deux : enfilées une à une, un
 * stockage presque plein écrivait la suppression d'une série sans les remontées
 * de rang qui la suivent.
 *
 * Synchrone, sans attendre aucun verrou, et durable dès le retour : même si
 * l'app meurt avant l'envoi, elles remonteront au prochain démarrage. L'ordre
 * de `ops` est celui de l'envoi. Chaque écriture reçoit son numéro et le compte
 * reconnu à cet instant ; sa parenté est posée à son entrée au registre
 * (registry-record.ts), que toute lecture fait déjà. Rend l'identité de
 * chacune, dans le même ordre ; `[]` pour une liste vide (rien n'est écrit).
 */
export function enqueueAll(ops: readonly OutboxOp[]): string[] {
  if (ops.length === 0 || typeof localStorage === 'undefined') return [];
  // Chaque enfilement retente d'abord ce que l'appareil avait refusé.
  if (storageFailing()) retryPersistQueue();
  const { draft, outdated } = open();
  const owner = loadLocalAccount()?.userId;
  const entries: Entry[] = ops.map((op) => ({
    n: draft.next(),
    uid: newUid(),
    ...(owner ? { owner } : {}),
    op: stripQueueFields(op),
    fate: 'pending',
  }));
  highestSeq = Math.max(highestSeq, draft.record.seq);
  // Sous une version plus récente, rien n'est écrit : la saisie tient en mémoire.
  if (outdated || !writeInbox(entries)) holdInMemory([], outdated, entries);
  return entries.map((entry) => entry.uid);
}

/** Enfile UNE écriture (cf. `enqueueAll`) et rend le nombre d'écritures en attente. */
export function enqueue(op: OutboxOp): number {
  enqueueAll([op]);
  return pendingCount();
}

// --- Saisies refusées : lister, renvoyer, abandonner --------------------------

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

/**
 * Une saisie refusée, telle que la feuille l'affiche : tout ce qu'il faut pour
 * la décrire et la régler, sans rien déduire d'autre.
 */
export interface RefusedWrite {
  /** Identité de la saisie, par laquelle la renvoyer ou l'abandonner. */
  refusalId: string;
  op: OutboxOp;
  /** Le rejet de la base, « <code SQLSTATE> : <message> » ; vide pour une saisie retenue. */
  reason: string;
  /** Horodatage ISO du refus (celui de sa séance, pour une saisie retenue). */
  at: string;
  /** Création de séance refusée, puis réussie depuis : ce refus ne retient plus rien. */
  superseded?: boolean;
  /**
   * La saisie n'a pas été refusée elle-même : elle est RETENUE par le refus de
   * la création de sa séance, dont voici l'identité. Elle repart avec elle.
   */
  heldBy?: string;
  /**
   * Les écritures qui dépendent de celle-ci, dans l'ordre : elles repartent
   * avec elle au renvoi, et sont abandonnées avec elle (saisies retenues par
   * cette séance, correction de cette série).
   */
  dependents: OutboxOp[];
}

/** Les saisies refusées ou retenues du compte reconnu, dans l'ordre de leur saisie. */
export function listRefused(): RefusedWrite[] {
  const record = view();
  const out: RefusedWrite[] = [];
  for (const e of record.entries) {
    if (e.fate === 'acked' || !isOwn(e)) continue;
    const holder = heldBy(record, e);
    if (e.fate !== 'refused' && holder === null) continue;
    out.push({
      refusalId: e.uid,
      op: asQueued(e),
      reason: e.refusal?.reason ?? '',
      at: e.refusal?.at ?? holder?.refusal?.at ?? '',
      ...(e.refusal?.superseded ? { superseded: true } : {}),
      ...(holder ? { heldBy: holder.uid } : {}),
      dependents: dependentsOf(record, e.uid).map(asQueued),
    });
  }
  return out;
}

/**
 * Ce qu'il advient d'un geste de la feuille : `'done'` ; `'gone'`, la saisie
 * n'est plus là (réglée depuis un autre onglet) ; `'busy'`, un envoi tient le
 * verrou trop longtemps (autre onglet figé), rien n'a bougé.
 */
export type GestureOutcome = 'done' | 'gone' | 'busy';

/** Attente maximale du verrou pour un geste de la feuille. */
const GESTURE_LOCK_WAIT_MS = 4000;

/**
 * Exécute `run` SOUS LE VERROU de la passe d'envoi, en l'attendant un temps
 * borné : un renvoi ou un abandon ne croise jamais une passe, ici ou dans un
 * autre onglet. Sans l'API (vieux navigateur, tests), `run` tourne sans verrou.
 */
async function underGestureLock(run: () => GestureOutcome): Promise<GestureOutcome> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') return run();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GESTURE_LOCK_WAIT_MS);
  try {
    return await locks.request(FLUSH_LOCK, { signal: controller.signal }, (lock) =>
      lock === null ? 'busy' : run(),
    );
  } catch (err) {
    if (controller.signal.aborted) return 'busy';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** La saisie `refusalId` du compte reconnu, refusée ou retenue. */
function ownRefusal(record: RegistryRecord, refusalId: string): Entry | undefined {
  const entry = record.entries.find((e) => e.uid === refusalId);
  if (!entry || entry.fate === 'acked' || !isOwn(entry)) return undefined;
  return entry.fate === 'refused' || heldBy(record, entry) !== null ? entry : undefined;
}

/**
 * RENVOIE une saisie refusée : elle redevient une écriture en attente, À SA
 * PLACE d'origine dans l'ordre d'envoi, et sera retentée à la prochaine passe
 * (elle reviendra parmi les refus si la base la refuse encore). Renvoyer la
 * création d'une séance libère du même coup les saisies qu'elle retenait. Parce
 * qu'elle garde sa place, une correction ou une suppression plus récente de la
 * même série passe toujours APRÈS elle : renvoyer ne ressuscite ni n'écrase rien.
 */
export function retryRefused(refusalId: string): Promise<GestureOutcome> {
  return underGestureLock(() =>
    transact((draft) => {
      const entry = ownRefusal(draft.record, refusalId);
      if (!entry || entry.fate !== 'refused') return 'gone';
      return retry(draft, refusalId) === 'done' ? 'done' : 'gone';
    }),
  );
}

/**
 * ABANDONNE une saisie refusée ou retenue : elle quitte l'appareil et ne sera
 * jamais envoyée, AVEC tout ce qui en dépend (`RefusedWrite.dependents` : les
 * saisies retenues par cette séance, la correction de cette série). Geste
 * explicite de l'utilisateur (ADR 0012).
 */
export function abandonRefused(refusalId: string): Promise<GestureOutcome> {
  return underGestureLock(() =>
    transact((draft) => {
      if (!ownRefusal(draft.record, refusalId)) return 'gone';
      return abandon(draft, refusalId).length > 0 ? 'done' : 'gone';
    }),
  );
}

// --- Envoi ----------------------------------------------------------------------

/** Aiguille une op vers sa fonction de sync. */
function runOp(op: OutboxOp, fns: SyncFns): Promise<unknown> {
  switch (op.type) {
    case 'upsertExecution':
      return fns.upsertExecution(op);
    case 'insertSet':
      return fns.insertSet(op);
    case 'patchSet':
      return fns.patchSet(op);
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
    case 'deleteExecutionIfEmpty':
      return fns.deleteExecutionIfEmpty(op);
    default:
      // Type inconnu (écriture d'une version future, ou blob trafiqué) : aucune
      // SyncFn ne sait la jouer. On JETTE plutôt que de la tenir pour acquittée
      // (perte silencieuse) : la passe s'arrête sur elle, elle reste au registre.
      // Bloquant tant que le type reste inconnu, mais préserver vaut mieux que perdre.
      return Promise.reject(
        new Error(`[outbox] op de type inconnu, non synchronisable : ${JSON.stringify(op)}`),
      );
  }
}

// Un seul flush à la fois : les déclencheurs (online, montage, post-enqueue)
// peuvent se chevaucher ; deux passes concurrentes rejoueraient les mêmes ops.
// On sérialise via une promesse mémoïsée : les appels en vol partagent le résultat.
let inFlight: Promise<FlushResult> | null = null;

// ENTRE ONGLETS, la promesse mémoïsée ne suffit pas : chaque onglet a la sienne,
// sur le même registre. Un verrou du navigateur (`navigator.locks`) ne laisse
// donc envoyer qu'un onglet à la fois. Son nom est celui d'avant le registre :
// un onglet resté sur l'ancienne version prend le même, et n'envoie donc jamais
// en même temps qu'un onglet à jour.
//
// Pour la passe, le verrou n'est jamais ATTENDU, et jamais REPRIS à un autre
// onglet : s'il est pris, un autre onglet envoie ce même registre (et le relit
// entre deux écritures, donc voit ce qu'on vient d'enfiler) ; la passe d'ici ne
// fait rien, le dit par son `remaining`, et un nouvel essai est reprogrammé tant
// qu'il reste à envoyer (cf. `scheduleLockRetry`). Un onglet figé par le système
// en pleine passe garde le verrou jusqu'à son réveil ; les essais continuent,
// espacés. Sans l'API (vieux navigateur, tests), la passe tourne sans verrou.
const FLUSH_LOCK = 'croustylift:outbox:flush';

// NOUVEL ESSAI après un verrou occupé. Tant que le verrou a été refusé, qu'il
// reste à envoyer et que l'appareil est en ligne, un essai est reprogrammé, avec
// des attentes qui s'allongent (0,5 s, puis le double, plafonné à 30 s). Un seul
// minuteur à la fois ; il s'éteint dès que le verrou est obtenu ou qu'il n'y a
// plus rien. Hors ligne, rien n'est reprogrammé : le retour du réseau relance
// la synchro par ailleurs.
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
    if (offline || pendingCount() === 0) {
      lockRetryAttempt = 0;
      return;
    }
    void (lockRetryRunner ? lockRetryRunner() : flush(fns, who))
      .catch(() => {})
      // L'écran suit le registre (ligne de synchro) sans attendre un geste.
      .finally(notifyChanged);
  }, delay);
}

/** Événement `window` émis quand le registre a bougé sans geste de l'écran (nouvel essai). */
export const OUTBOX_CHANGED_EVENT = 'croustylift:outbox-changed';

async function underFlushLock(run: () => Promise<FlushResult>): Promise<FlushResult> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== 'function') return run();
  return locks.request(FLUSH_LOCK, { ifAvailable: true }, (lock) => {
    if (lock === null) {
      flushLockBusy = true;
      return { remaining: pendingCount(), flushed: 0, settled: [] };
    }
    flushLockBusy = false;
    return run();
  });
}

/**
 * ENVOIE le registre vers la base et rend le sort de chaque écriture traitée.
 *
 * Dans l'ordre des numéros : chaque écriture acquittée change de sort et le
 * progrès est écrit ; la passe S'ARRÊTE à la première qui échoue (hors ligne,
 * session absente), elle et les suivantes restent en attente. L'ordre
 * exécution puis séries (et insertion puis suppression) est une dépendance, pas
 * une préférence : une écriture n'est jamais dépassée par une écriture du MÊME
 * compte qui la suit. Deux exceptions, qui ne cassent pas cette dépendance : une
 * écriture REJETÉE définitivement par la base est mise de côté (celles qui
 * dépendent d'elle sont retenues), et les écritures d'un AUTRE compte que celui
 * de `who` sont laissées, sans être jouées. Une écriture enfilée pendant la
 * passe est rattrapée : le registre est relu avant chaque envoi.
 *
 * `who` : lecteur de la session vérifiée. Fourni, rien ne part sans compte
 * connecté. Absent (tests du registre seul), aucun contrôle de session ni de compte.
 *
 * Concurrent-safe : une passe déjà en vol est réutilisée plutôt que doublée, et
 * un seul onglet envoie à la fois (cf. `underFlushLock`).
 */
export function flush(fns: SyncFns, who?: SessionReader): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = underFlushLock(() => runFlush(fns, who))
    .then((result) => {
      // Verrou pris par un autre onglet et reste à envoyer : un essai est
      // reprogrammé. Verrou obtenu : les attentes repartent de zéro.
      if (flushLockBusy && result.remaining > 0) scheduleLockRetry(fns, who);
      else if (!flushLockBusy) lockRetryAttempt = 0;
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** La prochaine écriture à envoyer : la première en attente, du compte connecté s'il est vérifié. */
function nextToSend(record: RegistryRecord, user: string | undefined, checked: boolean): Entry | undefined {
  return record.entries.find(
    (e) => isAwaiting(record, e) && (!checked || e.owner === user),
  );
}

async function runFlush(fns: SyncFns, who?: SessionReader): Promise<FlushResult> {
  const settled: SettledWrite[] = [];
  let flushed = 0;
  const done = (): FlushResult => ({ remaining: pendingCount(), flushed, settled });

  // Sous le verrou : la boîte d'entrée, la mémoire, et ce qu'un onglet de
  // l'ancienne version a laissé dans ses clés entrent au registre avant tout
  // envoi (cf. `absorb`).
  absorb();

  // Garde-fou de convergence : chaque tour règle une écriture ou arrête la passe.
  let budget = view().entries.length * 2 + ACKED_MAX;
  while (budget-- > 0) {
    // SESSION VÉRIFIÉE avant chaque envoi (audit sync, constat 4). Sans session,
    // supabase-js envoie la requête sous la clé publique : la RLS fait alors
    // toucher 0 ligne à un `update` ou un `delete` SANS erreur, et l'écriture
    // serait tenue pour acquittée. On s'arrête donc comme hors ligne.
    let user: string | undefined;
    if (who) {
      const connected = await who();
      if (typeof connected !== 'string') return done();
      user = connected;
    }
    // Une version plus récente a écrit le registre : plus rien ne part d'ici.
    if (registryOutdated()) return done();
    // Le registre est relu À CHAQUE tour : il a pu bouger pendant la requête
    // précédente (enfilement, purge, abandon, autre onglet).
    const record = view();
    const entry = nextToSend(record, user, who !== undefined);
    // Plus rien à jouer pour ce compte : la passe est finie.
    if (!entry) return done();
    // Écriture partielle d'une série dont l'insertion a été refusée : c'est la
    // série entière qui part (cf. `effectiveOp`, registry-record.ts).
    const sent = effectiveOp(record, entry);
    let effect: unknown;
    try {
      effect = await runOp(sent, fns);
    } catch (err) {
      // REJET DÉFINITIF de la base : rejouer l'écriture échouerait à l'identique
      // et bloquerait tout ce qui suit. Elle est mise de côté et la passe
      // continue. Sous une session vérifiée, on REVÉRIFIE d'abord la session :
      // si elle vient de tomber, la requête a pu partir sous la clé publique et
      // le refus (RLS) ne dit rien de l'écriture, qui reste en attente.
      if (isPermanentRejection(err) && (!who || (await who()) === user)) {
        const code = (err as { code: string }).code;
        const message = (err as { message?: unknown }).message;
        const outcome = transact((draft) =>
          refuse(
            draft,
            entry.uid,
            `${code} : ${typeof message === 'string' ? message : ''}`,
            sent,
            new Date().toISOString(),
          ),
        );
        if (outcome === 'done') {
          console.error(
            `[outbox] « ${entry.op.type} » (id ${entry.op.id}) rejetée par la base, mise de côté :`,
            err,
          );
        }
        if (outcome !== 'gone') {
          settled.push({ uid: entry.uid, op: sent, fate: outcome === 'done' ? 'refused' : 'replaced', touches: [] });
        }
        continue;
      }
      // Échec (réseau coupé le plus souvent) : l'écriture et toutes les
      // suivantes restent en attente, dans l'ordre. LOGGÉ, pas avalé (incident
      // 2026-07-30) : la console doit dire QUELLE écriture et POURQUOI.
      console.error(
        `[outbox] flush arrêté sur « ${entry.op.type} » (id ${entry.op.id}), ` +
          `${pendingCount()} op(s) en attente :`,
        err,
      );
      return done();
    }
    // La session a pu tomber PENDANT la requête : elle est alors peut-être
    // partie sous la clé publique et a « réussi » à vide. Dans le doute
    // l'écriture n'est pas acquittée ; la rejouer est sans risque.
    if (who && (await who()) !== user) return done();
    // Succès : l'écriture est acquittée, si elle est encore là (un « Annuler la
    // séance » ou une purge a pu la retirer pendant la requête : rien à faire).
    const noEffect = effect === 'kept' || effect === 'absent';
    const acked = transact((draft) => acknowledge(draft, entry.uid, sent, noEffect ? 'none' : 'applied'));
    if (acked) {
      flushed += 1;
      settled.push({
        uid: entry.uid,
        op: sent,
        fate: 'acked',
        touches: acked.touches,
        ...(noEffect ? { noEffect: true as const } : {}),
      });
    }
  }
  return done();
}

// RÉVEIL par un autre onglet. Un onglet resté sur l'ancienne version, arrêté
// par le verrou de l'ancienne file, n'envoie plus ce qu'il enfile : c'est ici
// que ça part. Son écriture dans l'ancienne clé (ou un geste d'un autre onglet
// dans la boîte d'entrée) relance donc la passe de l'app, sans attendre une
// saisie, un remontage ou le retour du réseau. L'événement `storage` ne vient
// que des AUTRES onglets.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    const key = (event as StorageEvent).key;
    if (key === null) return;
    const legacy = key === LEGACY_QUEUE_KEY || key === LEGACY_QUARANTINE_KEY;
    if (!legacy && !key.startsWith(INBOX_PREFIX)) return;
    if (lockRetryRunner === null || pendingCount() === 0) return;
    void lockRetryRunner()
      .catch(() => {})
      .finally(notifyChanged);
  });
}
