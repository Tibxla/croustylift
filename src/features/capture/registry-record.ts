// L'ENREGISTREMENT du registre d'écritures : son format (v1), ses transitions et
// la règle « qui dépend de qui ». Pur : ni stockage, ni réseau, ni horloge lue
// ici (l'appelant fournit `now`). C'est l'intérieur du module `outbox.ts`, qui
// est seul à l'importer ; les tests passent par l'interface d'`outbox.ts`.
//
// FORMAT v1 : `{ v: 1, seq, entries }`, un seul enregistrement, écrit d'un coup.
//   - `seq` : le dernier NUMÉRO attribué. Un numéro est pris à chaque
//     enfilement et à chaque acquittement, par `max(seq + 1, horloge)` : il
//     croît toujours, même si l'horloge recule, et ne repart jamais de zéro
//     après une purge ou un blob illisible (une estampille gardée par une
//     lecture en vol ou par une copie resterait sinon au-dessus des nouveaux
//     numéros, et des écritures acquittées seraient tenues pour déjà lues) ;
//   - `entries` : les écritures, triées par numéro d'enfilement (`n`), l'ordre
//     d'envoi. Chacune porte son SORT (`fate`) : en attente, refusée, ou
//     acquittée récente (gardée le temps qu'une lecture partie avant son
//     acquittement puisse encore revenir, cf. `prune`).
//
// PARENTÉ (`parents`), posée à l'enfilement et lue par toutes les règles :
//   - une écriture qui a besoin de son exécution en base (série, note datée,
//     clôture) pointe la CRÉATION de cette exécution, si elle n'est pas encore
//     acquittée. Création refusée : l'écriture est RETENUE (jamais envoyée,
//     comptée parmi les refus), et repart seule quand la création repart ;
//   - une écriture partielle (`patchSet`) pointe l'INSERTION de sa série, si
//     elle n'est pas encore acquittée. Insertion refusée : l'écriture partielle
//     part comme la série entière, reconstituée (`effectiveOp`) ;
//   - abandonner une écriture emporte tout ce qui en dépend (`abandon`).
//
// LIGNÉE d'une série (`replace`) : une écriture écartée au profit d'une autre
// laisse son identité à sa remplaçante (`replaces`), pour que son sort se lise
// encore (`fateOf`). Trois cas, et eux seuls :
//   - une SUPPRESSION enfilée écarte les anciens refus de la même série, et
//     une fois acquittée toute écriture antérieure encore retenue : après
//     elle, rien d'antérieur ne peut repartir ;
//   - une écriture REFUSÉE alors qu'une réécriture complète ou une suppression
//     de la même série la suit déjà n'est pas gardée ;
//   - une écriture complète ou une suppression ACQUITTÉE écarte les anciens
//     refus de la même série.
import type { InsertSetOp, OutboxOp, PatchSetOp } from './outbox';

export const REGISTRY_VERSION = 1;

/** Le sort d'une écriture. « Retenue » n'est pas stocké : il se déduit de la parenté. */
export type Fate = 'pending' | 'refused' | 'acked';

/** Une écriture du registre. `op` est l'op MÉTIER, sans champ de file. */
export interface Entry {
  /** Numéro d'écriture, pris à l'enfilement : l'ordre d'envoi. */
  n: number;
  /** Identité de l'écriture (UUID posé à l'enfilement). */
  uid: string;
  /** Compte reconnu sur l'appareil à l'enfilement (ADR 0019). */
  owner?: string;
  op: OutboxOp;
  fate: Fate;
  /** Les écritures dont celle-ci dépend (cf. en-tête), par identité. */
  parents?: string[];
  /** Pour une écriture refusée : le rejet de la base (« <code> : <message> ») et sa date. */
  refusal?: { reason: string; at: string; superseded?: true };
  /** Pour une écriture acquittée : le numéro pris à l'acquittement. */
  ack?: number;
  /** Pour une écriture acquittée : l'heure de l'appareil à cet instant (rétention, cf. `isExpired`). */
  at?: number;
  /** Les écritures qu'elle a écartées (cf. « LIGNÉE »), par identité. */
  replaces?: string[];
}

export interface RegistryRecord {
  v: typeof REGISTRY_VERSION;
  seq: number;
  entries: Entry[];
}

export function emptyRecord(): RegistryRecord {
  return { v: REGISTRY_VERSION, seq: 0, entries: [] };
}

// --- Transitions ---------------------------------------------------------------
// Toute modification est une suite de transitions rejouables sur un
// enregistrement RELU : c'est ce que le repli mémoire garde quand le stockage
// refuse l'écriture (jamais une copie de l'enregistrement, qui effacerait ce
// qu'un autre onglet y a écrit entre-temps).

export type Transition =
  /** Ajoute une écriture si son identité est inconnue. */
  | { t: 'add'; entry: Entry }
  /**
   * Modifie une écriture si elle est encore là (`undefined` retire le champ), et
   * si son sort est encore `from`, celui qu'elle avait quand la modification a
   * été décidée. Rejouée plus tard sur l'enregistrement relu (journal de
   * secours), elle ne défait donc pas ce qu'un autre onglet a écrit entre-temps :
   * un refus tenu en mémoire ne revient pas sur une écriture acquittée depuis.
   */
  | { t: 'patch'; uid: string; fields: Partial<Entry>; from?: Fate }
  /** Retire des écritures. */
  | { t: 'drop'; uids: string[] };

function insertSorted(entries: Entry[], entry: Entry): void {
  // Après la dernière écriture de numéro inférieur ou égal : à numéro égal,
  // l'ordre d'arrivée est gardé.
  let at = entries.length;
  while (at > 0 && entries[at - 1]!.n > entry.n) at -= 1;
  entries.splice(at, 0, entry);
}

function applyTransition(record: RegistryRecord, transition: Transition): void {
  switch (transition.t) {
    case 'add': {
      const { entry } = transition;
      if (knows(record, entry.uid)) return;
      insertSorted(record.entries, { ...entry });
      record.seq = Math.max(record.seq, entry.n, entry.ack ?? 0);
      return;
    }
    case 'patch': {
      const entry = record.entries.find((e) => e.uid === transition.uid);
      if (!entry || (transition.from !== undefined && entry.fate !== transition.from)) return;
      for (const [key, value] of Object.entries(transition.fields)) {
        if (value === undefined) delete (entry as unknown as Record<string, unknown>)[key];
        else (entry as unknown as Record<string, unknown>)[key] = value;
      }
      record.seq = Math.max(record.seq, entry.ack ?? 0);
      return;
    }
    case 'drop': {
      const gone = new Set(transition.uids);
      record.entries = record.entries.filter((e) => !gone.has(e.uid));
      return;
    }
  }
}

/** Rejoue des transitions sur un enregistrement (modifié en place). */
export function replay(record: RegistryRecord, log: readonly Transition[]): RegistryRecord {
  for (const transition of log) applyTransition(record, transition);
  return record;
}

/** L'identité est-elle connue du registre : écriture présente, ou écartée au profit d'une autre ? */
function knows(record: RegistryRecord, uid: string): boolean {
  return record.entries.some((e) => e.uid === uid || (e.replaces?.includes(uid) ?? false));
}

/**
 * Un enregistrement en cours de modification : chaque geste passe par `add`,
 * `patch` ou `drop`, qui l'appliquent ET le notent (`log`), pour que le repli
 * mémoire puisse le rejouer.
 */
export class Draft {
  readonly log: Transition[] = [];
  constructor(
    readonly record: RegistryRecord,
    private readonly clock: () => number,
  ) {}

  /** Prend le numéro suivant : toujours plus grand que tous ceux déjà pris. */
  next(): number {
    this.record.seq = Math.max(this.record.seq + 1, this.clock());
    return this.record.seq;
  }
  now(): number {
    return this.clock();
  }
  get(uid: string): Entry | undefined {
    return this.record.entries.find((e) => e.uid === uid);
  }
  add(entry: Entry): void {
    this.apply({ t: 'add', entry });
  }
  patch(uid: string, fields: Partial<Entry>): void {
    const from = this.get(uid)?.fate;
    if (from !== undefined) this.apply({ t: 'patch', uid, fields, from });
  }
  drop(uids: readonly string[]): void {
    if (uids.length > 0) this.apply({ t: 'drop', uids: [...uids] });
  }
  private apply(transition: Transition): void {
    applyTransition(this.record, transition);
    this.log.push(transition);
  }
}

// --- Ce que vise une écriture --------------------------------------------------

/** L'op écrit-elle une série, entière (`insertSet`) ou en partie (`patchSet`) ? */
export function isSetWrite(op: OutboxOp): op is InsertSetOp | PatchSetOp {
  return op.type === 'insertSet' || op.type === 'patchSet';
}

/** La série que l'op écrit ou supprime, sinon null. */
function setOf(op: OutboxOp): string | null {
  return isSetWrite(op) || op.type === 'deleteSet' ? op.id : null;
}

/** L'id de l'exécution dont l'op a BESOIN en base (clé étrangère ou update par id), sinon null. */
function requiredExecution(op: OutboxOp): string | null {
  switch (op.type) {
    case 'insertSet':
    case 'patchSet':
    case 'upsertDatedNote':
      return op.executionId;
    case 'updateExecution':
      return op.id;
    default:
      return null;
  }
}

/** L'op crée-t-elle ou réaffirme-t-elle l'exécution `executionId`, ou une de ses lignes filles ? */
export function belongsToExecution(op: OutboxOp, executionId: string): boolean {
  switch (op.type) {
    case 'upsertExecution':
    case 'updateExecution':
      return op.id === executionId;
    case 'insertSet':
    case 'patchSet':
    case 'upsertDatedNote':
      return op.executionId === executionId;
    default:
      // deleteSet, deleteDatedNote, deleteExecution : idempotents par id, sans
      // effet sur une ligne jamais créée. Notes d'instructions : elles vivent
      // sur la définition de l'exo, pas sur l'exécution abandonnée.
      return false;
  }
}

// --- Parenté ---------------------------------------------------------------------

/** La dernière écriture non acquittée, antérieure à `n`, du même compte, qui vérifie `match`. */
function latestBefore(
  record: RegistryRecord,
  n: number,
  owner: string | undefined,
  match: (op: OutboxOp, entry: Entry) => boolean,
): Entry | undefined {
  let found: Entry | undefined;
  for (const e of record.entries) {
    if (e.n > n) break;
    if (e.fate !== 'acked' && e.owner === owner && match(e.op, e)) found = e;
  }
  return found;
}

/** Les écritures dont `entry` dépend, lues dans le registre tel qu'il est (cf. en-tête). */
function parentsOf(record: RegistryRecord, entry: Entry): string[] {
  const parents: string[] = [];
  const executionId = requiredExecution(entry.op);
  if (executionId !== null) {
    const creation = latestBefore(
      record,
      entry.n,
      entry.owner,
      // Un refus de création DÉPASSÉ (l'exécution a été recréée avec succès
      // depuis) ne tient plus rien : personne n'en dépend.
      (op, e) => op.type === 'upsertExecution' && op.id === executionId && !e.refusal?.superseded,
    );
    if (creation && creation.uid !== entry.uid) parents.push(creation.uid);
  }
  if (entry.op.type === 'patchSet') {
    const setId = entry.op.id;
    const insertion = latestBefore(
      record,
      entry.n,
      entry.owner,
      (op) => op.type === 'insertSet' && op.id === setId,
    );
    if (insertion && insertion.uid !== entry.uid) parents.push(insertion.uid);
  }
  return parents;
}

/** `entry` est-elle RETENUE : la création de son exécution est refusée, et rien ne l'a recréée depuis ? */
export function heldBy(record: RegistryRecord, entry: Entry): Entry | null {
  if (entry.fate !== 'pending') return null;
  for (const uid of entry.parents ?? []) {
    const parent = record.entries.find((e) => e.uid === uid);
    if (
      parent &&
      parent.op.type === 'upsertExecution' &&
      parent.fate === 'refused' &&
      !parent.refusal?.superseded
    ) {
      return parent;
    }
  }
  return null;
}

/** Tout ce qui dépend de l'écriture `uid`, de près ou de loin, dans l'ordre du registre. */
export function dependentsOf(record: RegistryRecord, uid: string): Entry[] {
  const reached = new Set([uid]);
  const out: Entry[] = [];
  // Le registre est trié : une écriture suit toujours ses parents.
  for (const e of record.entries) {
    if (e.fate === 'acked' || reached.has(e.uid)) continue;
    if ((e.parents ?? []).some((p) => reached.has(p))) {
      reached.add(e.uid);
      out.push(e);
    }
  }
  return out;
}

/**
 * Ce qu'il faut réellement envoyer pour `entry`. Une écriture partielle dont
 * l'insertion d'origine est refusée devient la série ENTIÈRE : la ligne
 * n'existe pas en base, un `update` ne toucherait rien. Les colonnes que
 * l'écriture partielle porte passent par-dessus celles du refus.
 */
export function effectiveOp(record: RegistryRecord, entry: Entry): OutboxOp {
  const op = entry.op;
  if (op.type !== 'patchSet') return op;
  const refused = refusedInsertionOf(record, entry);
  if (!refused || refused.op.type !== 'insertSet') return op;
  const base = refused.op;
  const { only, cols, ...row } = op;
  if (only === 'rank') {
    return { ...row, type: 'insertSet', weightKg: base.weightKg, reps: base.reps, rir: base.rir, side: base.side };
  }
  if (only === 'side') {
    // Le côté vient de l'écriture partielle (`row.side`), tout le reste du refus.
    return { ...row, type: 'insertSet', setOrder: base.setOrder, weightKg: base.weightKg, reps: base.reps, rir: base.rir };
  }
  const written = new Set(cols ?? ['weightKg', 'reps', 'rir']);
  return {
    ...row,
    type: 'insertSet',
    setOrder: base.setOrder,
    side: base.side,
    weightKg: written.has('weightKg') ? op.weightKg : base.weightKg,
    reps: written.has('reps') ? op.reps : base.reps,
    rir: written.has('rir') ? op.rir : base.rir,
  };
}

function refusedInsertionOf(record: RegistryRecord, entry: Entry): Entry | undefined {
  for (const uid of entry.parents ?? []) {
    const parent = record.entries.find((e) => e.uid === uid);
    if (parent && parent.fate === 'refused' && parent.op.type === 'insertSet') return parent;
  }
  return undefined;
}

// --- Lignée ----------------------------------------------------------------------

/** Écarte `old` au profit de `by` : son identité et ses dépendantes passent à sa remplaçante. */
function replace(draft: Draft, old: Entry, by: Entry): void {
  if (old.uid === by.uid) return;
  const current = draft.get(by.uid);
  if (!current) return;
  const replaces = [...new Set([...(current.replaces ?? []), old.uid, ...(old.replaces ?? [])])];
  const fields: Partial<Entry> = { replaces };
  if (current.parents?.includes(old.uid)) {
    const parents = current.parents.filter((p) => p !== old.uid);
    fields.parents = parents.length > 0 ? parents : undefined;
  }
  draft.patch(by.uid, fields);
  for (const e of draft.record.entries) {
    if (e.uid === by.uid || !e.parents?.includes(old.uid)) continue;
    draft.patch(e.uid, { parents: [...new Set(e.parents.map((p) => (p === old.uid ? by.uid : p)))] });
  }
  draft.drop([old.uid]);
}

// --- Transitions du registre ----------------------------------------------------

/**
 * Fait entrer une écriture : pose sa parenté, et applique la règle de la
 * suppression (une suppression écarte les anciens refus de la même série et
 * du même compte). Sans effet si son identité
 * est déjà connue. Sert à l'enfilement comme à la reprise d'une ancienne file.
 */
export function admit(draft: Draft, entry: Entry): void {
  if (knows(draft.record, entry.uid)) return;
  const parents = parentsOf(draft.record, entry);
  draft.add(parents.length > 0 ? { ...entry, parents } : entry);
  // Une écriture reprise d'une ancienne file peut entrer AVANT des écritures
  // déjà là : celles qui attendaient ce parent sans le connaître le reçoivent.
  for (const later of draft.record.entries) {
    if (later.n <= entry.n || later.uid === entry.uid || later.fate === 'acked') continue;
    const wanted = parentsOf(draft.record, later);
    if (wanted.includes(entry.uid) && !later.parents?.includes(entry.uid)) {
      draft.patch(later.uid, { parents: wanted });
    }
  }
  if (entry.op.type !== 'deleteSet' || entry.fate !== 'pending') return;
  const setId = entry.op.id;
  const at = draft.record.entries.findIndex((e) => e.uid === entry.uid);
  // Les anciens REFUS seulement : une écriture qui attend encore part avant la
  // suppression, dans l'ordre (sa requête est peut-être déjà en vol).
  const earlier = draft.record.entries
    .slice(0, at)
    .filter((e) => e.fate === 'refused' && e.owner === entry.owner && isSetWrite(e.op) && e.op.id === setId);
  for (const old of earlier) replace(draft, old, entry);
}

/** Ce qu'une transition a fait de l'écriture visée. */
export type Outcome = 'done' | 'gone' | 'replaced';

/**
 * La base a refusé `uid` pour de bon. `sent` : ce qui est réellement parti
 * (la série entière reconstituée, cf. `effectiveOp`) ; c'est lui qui est gardé,
 * et il remplace alors l'ancien refus de la même série : une seule saisie reste
 * renvoyable, la plus récente.
 */
export function refuse(draft: Draft, uid: string, reason: string, sent: OutboxOp, at: string): Outcome {
  const entry = draft.get(uid);
  // Retirée pendant sa requête (« Annuler la séance », abandon) : la réponse
  // tardive de la base ne la fait pas revenir.
  if (!entry || entry.fate !== 'pending') return 'gone';
  const setId = setOf(entry.op);
  if (setId !== null && isSetWrite(entry.op)) {
    // Déjà dépassée : une réécriture complète ou une suppression de la même
    // série la suit. La garder permettrait de la « renvoyer » par-dessus.
    const at = draft.record.entries.indexOf(entry);
    const later = draft.record.entries
      .slice(at + 1)
      .find(
        (e) =>
          e.owner === entry.owner &&
          e.fate !== 'acked' &&
          e.op.id === setId &&
          (e.op.type === 'deleteSet' || e.op.type === 'insertSet'),
      );
    if (later) {
      replace(draft, entry, later);
      return 'replaced';
    }
  }
  const previous = sent.type === 'insertSet' && entry.op.type === 'patchSet' ? refusedInsertionOf(draft.record, entry) : undefined;
  draft.patch(uid, { fate: 'refused', refusal: { reason, at }, op: sent });
  if (previous) replace(draft, previous, draft.get(uid)!);
  return 'done';
}

/** Combien de temps une écriture acquittée reste au registre, et combien au plus. */
export const ACKED_RETENTION_MS = 10 * 60 * 1000;
export const ACKED_MAX = 500;

/**
 * La base a acquitté `uid`. Rend les exos dont l'historique vient de changer en
 * base, pour la relecture de leurs copies (ADR 0020), ou `null` si l'écriture
 * n'était plus là (purgée pendant sa requête).
 */
export function acknowledge(
  draft: Draft,
  uid: string,
  sent: OutboxOp,
  effect: 'applied' | 'none',
): { touches: string[] } | null {
  const entry = draft.get(uid);
  if (!entry || entry.fate !== 'pending') return null;
  const touches = effect === 'none' ? [] : touchedExercises(draft.record, sent, entry.owner);
  draft.patch(uid, { fate: 'acked', ack: draft.next(), at: draft.now(), op: sent, parents: undefined });
  const acked = draft.get(uid)!;
  if (sent.type === 'upsertExecution') {
    // L'exécution existe en base : un ancien refus de sa création ne retient
    // plus rien. Il reste listé, jusqu'à son abandon.
    for (const e of draft.record.entries) {
      if (
        e.fate === 'refused' &&
        e.owner === entry.owner &&
        e.op.type === 'upsertExecution' &&
        e.op.id === sent.id &&
        e.refusal &&
        !e.refusal.superseded
      ) {
        draft.patch(e.uid, { refusal: { ...e.refusal, superseded: true } });
        // Et plus rien n'en dépend : ses saisies sont libres, l'abandonner
        // n'emporte qu'elle.
        for (const child of draft.record.entries) {
          if (!child.parents?.includes(e.uid)) continue;
          const parents = child.parents.filter((p) => p !== e.uid);
          draft.patch(child.uid, { parents: parents.length > 0 ? parents : undefined });
        }
      }
    }
  }
  if (sent.type === 'insertSet' || sent.type === 'deleteSet') {
    // La série vient d'être écrite entière, ou supprimée, en base : un ANCIEN
    // refus de la même série n'a plus d'objet. Ancien, par position : un refus
    // qui suit l'écriture acquittée (un vieux refus renvoyé avec succès) reste
    // la dernière saisie de l'utilisateur. Après une SUPPRESSION, plus rien
    // d'antérieur ne doit pouvoir repartir : une écriture encore retenue par le
    // refus de sa séance est écartée aussi (elle recréerait la série au renvoi).
    const at = draft.record.entries.findIndex((e) => e.uid === uid);
    const moot = draft.record.entries.filter(
      (e, index) =>
        index < at &&
        e.owner === entry.owner &&
        isSetWrite(e.op) &&
        e.op.id === sent.id &&
        (e.fate === 'refused' || (sent.type === 'deleteSet' && e.fate === 'pending')),
    );
    for (const old of moot) replace(draft, old, acked);
  }
  if (sent.type === 'patchSet') {
    // Une écriture partielle acquittée DÉPASSE les anciens refus d'écritures
    // partielles de la même série, sur les colonnes qu'elle vient d'écrire :
    // gardés, ils seraient appliqués par-dessus une lecture qui porte déjà la
    // nouvelle valeur, et renvoyables par-dessus elle. Les colonnes qu'elle ne
    // couvre pas restent refusées.
    const covers = columnsOf(sent);
    // Les refus ANTÉRIEURS seulement, par position : un refus plus récent que
    // l'écriture acquittée (un ancien refus renvoyé avec succès) reste la
    // dernière saisie de l'utilisateur.
    const at = draft.record.entries.findIndex((e) => e.uid === uid);
    for (const old of draft.record.entries.slice(0, at)) {
      if (old.fate !== 'refused' || old.owner !== entry.owner || old.op.type !== 'patchSet' || old.op.id !== sent.id) continue;
      if (old.op.only !== sent.only) continue;
      const left = columnsOf(old.op).filter((col) => !covers.includes(col));
      if (left.length === 0) replace(draft, old, acked);
      else if (old.op.only === 'values') draft.patch(old.uid, { op: { ...old.op, cols: left as SetColumn[] } });
    }
  }
  prune(draft);
  return { touches };
}

type SetColumn = 'weightKg' | 'reps' | 'rir';

/** Les colonnes qu'une écriture partielle pose (cf. `PatchSetOp`). */
function columnsOf(op: PatchSetOp): string[] {
  if (op.only === 'rank') return ['setOrder'];
  if (op.only === 'side') return ['side'];
  return op.cols ?? ['weightKg', 'reps', 'rir'];
}

/** Les exos dont l'historique change en base quand `sent` est acquittée. */
function touchedExercises(record: RegistryRecord, sent: OutboxOp, owner: string | undefined): string[] {
  switch (sent.type) {
    case 'insertSet':
    case 'patchSet':
      return [sent.exerciseId];
    case 'deleteSet':
    case 'deleteExecution':
    case 'deleteExecutionIfEmpty': {
      // Une suppression ne porte que l'id de sa ligne : ses exos sont ceux que
      // l'émetteur a nommés, plus ceux des écritures de la même série ou de la
      // même exécution que le registre retient encore.
      const out = new Set(sent.exerciseIds ?? []);
      for (const e of record.entries) {
        if (e.owner !== owner || !isSetWrite(e.op)) continue;
        if (sent.type === 'deleteSet' ? e.op.id === sent.id : e.op.executionId === sent.id) {
          out.add(e.op.exerciseId);
        }
      }
      return [...out];
    }
    default:
      return [];
  }
}

/**
 * Retire les écritures acquittées qui ne servent plus. Une acquittée sert tant
 * qu'une lecture partie AVANT son acquittement peut encore revenir (la réponse
 * ne la porte pas, cf. `writesSince`). Les lectures en vol ne se connaissent
 * pas d'un onglet à l'autre : la borne est donc un temps, très au-dessus de la
 * durée d'une lecture (20 s par requête), et un nombre.
 */
export function prune(draft: Draft): void {
  const now = draft.now();
  const acked = draft.record.entries.filter((e) => e.fate === 'acked');
  const stale = acked.filter((e) => isExpired(e, now));
  const kept = acked.filter((e) => !stale.includes(e)).sort((a, b) => (a.ack ?? 0) - (b.ack ?? 0));
  const overflow = kept.slice(0, Math.max(0, kept.length - ACKED_MAX));
  draft.drop([...stale, ...overflow].map((e) => e.uid));
}

/**
 * L'écriture acquittée a-t-elle passé sa rétention ? Elle ne doit alors plus
 * être appliquée à aucune lecture, même si rien ne l'a encore retirée (le
 * registre n'est nettoyé qu'à la transition suivante).
 */
export function isExpired(entry: Entry, now: number): boolean {
  if (entry.fate !== 'acked') return false;
  // L'âge se compte à l'HEURE de l'acquittement, pas à son numéro : le numéro
  // ne recule jamais, il peut donc être en avance sur une horloge qui a reculé,
  // et l'écriture était alors rejouée bien au-delà de sa rétention. Une heure
  // d'acquittement dans le futur (l'horloge a reculé depuis) ne dit plus rien
  // de l'âge : l'écriture est tenue pour passée, plutôt que gardée sans borne.
  if (entry.at === undefined) return now - (entry.ack ?? 0) > ACKED_RETENTION_MS;
  const age = now - entry.at;
  return age > ACKED_RETENTION_MS || age < 0;
}

/** Remet une écriture refusée en attente, à sa place d'origine. */
export function retry(draft: Draft, uid: string): Outcome {
  const entry = draft.get(uid);
  if (!entry || entry.fate !== 'refused') return 'gone';
  draft.patch(uid, { fate: 'pending', refusal: undefined });
  return 'done';
}

/** Abandonne une écriture non acquittée, et tout ce qui en dépend. Rend les identités retirées. */
export function abandon(draft: Draft, uid: string): string[] {
  const entry = draft.get(uid);
  if (!entry || entry.fate === 'acked') return [];
  const gone = [uid, ...dependentsOf(draft.record, uid).map((e) => e.uid)];
  draft.drop(gone);
  return gone;
}

/**
 * Le sort de l'écriture `uid`, suivie dans sa lignée : écartée au profit d'une
 * autre, elle a le sort de sa remplaçante. `'gone'` : abandonnée, purgée, ou
 * acquittée depuis plus longtemps que la rétention.
 */
export function fateOf(record: RegistryRecord, uid: string): Fate | 'gone' {
  const entry =
    record.entries.find((e) => e.uid === uid) ??
    record.entries.find((e) => e.replaces?.includes(uid));
  if (!entry) return 'gone';
  return heldBy(record, entry) ? 'refused' : entry.fate;
}

// --- Reprise d'une file et d'une quarantaine de l'ancien format ------------------
// À RETIRER avec la reprise continue (cf. `LEGACY_UNTIL`, outbox.ts).

type LegacyOp = OutboxOp & { _seq?: number; _owner?: string; _uid?: string; _at?: number };
interface LegacyQuarantined {
  op: LegacyOp;
  reason?: string;
  at?: string;
  superseded?: boolean;
}

/** Convertit l'écriture partielle d'avant `patchSet` (une `insertSet` marquée `only`). */
function upgradeLegacyOp(op: OutboxOp): OutboxOp {
  if (op.type !== 'insertSet') return op;
  const only = (op as { only?: unknown }).only;
  if (only !== 'values' && only !== 'rank') return op;
  return { ...op, type: 'patchSet', only } as OutboxOp;
}

function stripQueueFields(op: LegacyOp): OutboxOp {
  const { _seq: _a, _owner: _b, _uid: _c, _at: _d, ...rest } = op;
  return rest as OutboxOp;
}

/**
 * Les deux écritures que le registre pose lui-même dans l'ancienne file, sous
 * une même identité : le VERROU (`'stop'`, cf. outbox.ts), et le REPÈRE
 * (`'anchor'`), qui garde l'instant d'une écriture datée retirée tant qu'une
 * voisine sans instant en a besoin pour tenir sa place.
 */
export const LEGACY_MARK_UID = 'registre-actif';
export function legacyMark(op: unknown): 'stop' | 'anchor' | null {
  const raw = op as { _uid?: unknown; _at?: unknown } | null;
  if (raw?._uid !== LEGACY_MARK_UID) return null;
  return typeof raw._at === 'number' && raw._at > 0 ? 'anchor' : 'stop';
}

/**
 * Rend son type à une écriture marquée sur place pour arrêter l'ancienne
 * version (initiale en majuscule, cf. « POSE », outbox.ts).
 */
function unmarked<T>(op: T): T {
  const type = (op as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !/^[A-Z]/.test(type)) return op;
  return { ...op, type: type.charAt(0).toLowerCase() + type.slice(1) };
}

/** L'identité au registre d'une écriture de l'ancien format : son UUID d'enfilement, à défaut son contenu. */
export function legacyIdentity(op: unknown): string {
  return (op as { _uid?: string } | null)?._uid ?? `legacy:${JSON.stringify(unmarked(op))}`;
}

/** Une écriture reprise de l'ancien format ; `n` nul : instant d'enfilement inconnu. */
export type LegacyEntry = Omit<Entry, 'n'> & { n: number | null };

/**
 * Les écritures d'une ancienne file (`queue`) et d'une ancienne quarantaine
 * (`quarantine`), au format du registre, dans l'ordre où les faire entrer
 * (`admitLegacy`). Le numéro d'une écriture est l'instant de son enfilement
 * (`_at`), comparable aux numéros du registre : elle prend sa place dans
 * l'ordre d'envoi, même reprise plus tard. Sans instant (bundle plus ancien
 * encore), elle reçoit le numéro suivant au moment où elle entre. Une saisie
 * retenue par sa séance (« dépend de… ») redevient une écriture en attente :
 * sa parenté la retiendra de nouveau.
 */
export function fromLegacy(queue: readonly unknown[], quarantine: readonly unknown[]): LegacyEntry[] {
  const out: LegacyEntry[] = [];
  const identity = legacyIdentity;
  for (const raw of quarantine) {
    const q = raw as LegacyQuarantined | null;
    if (!q || typeof q !== 'object' || !q.op || typeof q.op !== 'object') continue;
    q.op = unmarked(q.op);
    const at = typeof q.at === 'string' ? q.at : new Date(0).toISOString();
    const refusedAt = Date.parse(at);
    const base = {
      n: q.op._at ?? (Number.isNaN(refusedAt) ? null : refusedAt),
      uid: identity(q.op),
      ...(q.op._owner ? { owner: q.op._owner } : {}),
      op: upgradeLegacyOp(stripQueueFields(q.op)),
    };
    const reason = typeof q.reason === 'string' ? q.reason : '';
    if (reason.startsWith('dépend de l')) out.push({ ...base, fate: 'pending' });
    else out.push({ ...base, fate: 'refused', refusal: { reason, at, ...(q.superseded ? { superseded: true as const } : {}) } });
  }
  const ops = queue
    .filter((raw): raw is LegacyOp => typeof raw === 'object' && raw !== null && typeof (raw as LegacyOp).type === 'string')
    .map(unmarked);
  let previous = 0;
  ops.forEach((op, index) => {
    // L'ordre de la file fait foi entre ses écritures : jamais un numéro plus
    // petit que celui de l'écriture datée qui la précède. Une écriture sans
    // instant prend celui de sa voisine datée (celle d'avant, sinon celle
    // d'après) : elle reste à sa place dans la file. Sans aucune voisine datée,
    // son numéro est pris à l'entrée.
    if (op._at !== undefined) previous = Math.max(previous, op._at);
    const next = ops.slice(index + 1).find((later) => later._at !== undefined)?._at;
    const n = op._at !== undefined || previous > 0 ? previous : (next ?? null);
    // Un repère ne porte que l'instant d'une voisine retirée (cf. `legacyMark`).
    if (legacyMark(op) !== null) return;
    out.push({
      n,
      uid: identity(op),
      ...(op._owner ? { owner: op._owner } : {}),
      op: upgradeLegacyOp(stripQueueFields(op)),
      fate: 'pending',
    });
  });
  // Tri stable : les écritures datées par instant (la quarantaine et la file
  // s'entrelacent), puis celles sans instant, dans leur ordre.
  return out
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.n ?? Infinity) - (b.entry.n ?? Infinity) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Fait entrer une écriture reprise de l'ancien format, si elle n'est pas déjà connue. */
export function admitLegacy(draft: Draft, entry: LegacyEntry): void {
  if (knows(draft.record, entry.uid)) return;
  admit(draft, { ...entry, n: entry.n ?? draft.next() });
}

/**
 * Complète les EFFACEMENTS de note datée enfilés par un bundle antérieur, qui
 * ne portent que l'id de la note, avec le couple (exécution, exercice) de
 * l'écriture de la même note encore au registre (même id, même compte) : ils
 * visent alors la même ligne qu'elle (`upsertDatedNote`, features/notes/data.ts).
 */
export function completeLegacyNoteDeletes(draft: Draft): void {
  for (const e of draft.record.entries) {
    const op = e.op;
    if (e.fate === 'acked' || op.type !== 'deleteDatedNote') continue;
    if (op.executionId !== undefined && op.exerciseId !== undefined) continue;
    const write = draft.record.entries.find(
      (other) => other.op.type === 'upsertDatedNote' && other.op.id === op.id && other.owner === e.owner,
    );
    if (!write || write.op.type !== 'upsertDatedNote') continue;
    draft.patch(e.uid, { op: { ...op, executionId: write.op.executionId, exerciseId: write.op.exerciseId } });
  }
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const { n, uid, op, fate, parents, replaces } = value as Partial<Entry>;
  return (
    typeof n === 'number' &&
    typeof uid === 'string' &&
    typeof op === 'object' &&
    op !== null &&
    typeof op.type === 'string' &&
    (fate === 'pending' || fate === 'refused' || fate === 'acked') &&
    (parents === undefined || Array.isArray(parents)) &&
    (replaces === undefined || Array.isArray(replaces))
  );
}

/** Lit un enregistrement stocké. `'outdated'` : écrit par une version plus récente. */
export function parseRecord(raw: string): RegistryRecord | 'outdated' | 'corrupt' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'corrupt';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'corrupt';
  const { v, seq, entries } = parsed as { v?: unknown; seq?: unknown; entries?: unknown };
  if (typeof v !== 'number') return 'corrupt';
  if (v > REGISTRY_VERSION) return 'outdated';
  if (v !== REGISTRY_VERSION || typeof seq !== 'number' || !Array.isArray(entries)) return 'corrupt';
  // Une écriture mal formée ferait tomber chaque lecture du registre : dans le
  // doute, l'enregistrement entier est tenu pour illisible (et mis de côté).
  if (!entries.every(isEntry)) return 'corrupt';
  return { v: REGISTRY_VERSION, seq, entries: entries as Entry[] };
}
