// Quitter la séance en cours sans la ranger. Logique pure, sans React ni réseau.
//
// Avant, un seul geste, « Annuler la séance » : il faisait craindre une perte
// même quand on venait de se tromper de séance au lancement. Deux noms pour le
// même ménage :
//   - « Changer de séance » quand RIEN N'EST SAISI, sans confirmation ;
//   - « Annuler la séance », confirmée, dès qu'il y a quelque chose à perdre.
// Avec des séries que l'on veut garder, le parcours reste « Terminer », « Ranger
// la séance », « Nouvelle séance » : rien de cela ne passe par ici.
//
// RIEN N'EST SAISI (`nothingEntered`) : aucune série au tableau, aucune note du
// jour avec du texte, aucun exo ajouté ou remplacé. Ouvrir un exo ou le marquer
// « passé » ne compte pas (rien à retaper). Un exo ajouté compte : dans le
// doute, on confirme.
//
// « Rien saisi » ne veut pas dire « rien à défaire ». Une série loggée puis
// annulée, une note écrite puis vidée ont fait NAÎTRE l'exécution (en file, ou
// déjà en base) : la quitter sans la supprimer laisserait une exécution vide,
// ouverte, que la prochaine ouverture de cette séance adopterait. Le plan rendu
// porte donc TOUJOURS la suppression de l'exécution. On ne cherche plus à
// savoir si elle est née : après un remontage hors ligne (série loggée, annulée,
// tout acquitté), le cache rend son id sans série, sans note et sans écriture
// en file, et plus rien ne le dit. Les deux suppressions sont idempotentes :
// sur une exécution jamais née, elles sont sans effet. Seul coût : hors ligne,
// une écriture attend en file après un simple changement de séance.
//
// API pour l'écran : `leaveSession(état, { executionStarted, pendingOps })` rend
//   - `kind` : 'change' ou 'cancel', pour le libellé du geste ;
//   - `needsConfirmation` : vrai pour 'cancel' ;
//   - `purge` : faut-il purger la file de cette exécution (étape 2) ;
//   - `executionId` et `ops` : le ménage à enfiler.
// L'écran déroule alors, dans cet ordre :
//   1. `clearPersisted(séance, date)` : l'état de capture quitte l'appareil ;
//   2. SI `plan.purge` : `purgeByExecution(executionId)` ;
//   3. enfiler `ops` ;
//   4. retour à l'écran de lancement.
// `executionStarted` : gardé pour la compatibilité de la signature, sans effet
// depuis le constat 7 (la suppression est toujours demandée, cf. plus haut).
// `pendingOps` (facultatif, recommandé) : la file commune, `readQueue()`.
//
// CHANGEMENT D'API (relecture du lot 3, constat 1), à suivre par l'écran :
//   - `plan.purge` est nouveau. « Changer » (`purge: false`) NE PURGE PLUS la
//     file : l'ancienne étape 2, inconditionnelle, effaçait la saisie qu'un
//     autre onglet venait d'enfiler dans la même exécution ;
//   - les `ops` de « changer » portent une suppression CONDITIONNELLE
//     (`deleteExecutionIfEmpty`, outbox.ts) au lieu de `deleteExecution` ;
//   - `ctx.pendingOps` est nouveau et facultatif ;
//   - `ops` n'est plus jamais vide (constat 7) : la suppression est demandée
//     même quand la naissance de l'exécution est inconnue.
//
// DEUX ONGLETS. Le tableau d'un onglet ne voit pas ce qu'un autre a saisi dans
// la même exécution. Un geste SANS confirmation ne doit donc rien pouvoir
// effacer :
//   - « changer » laisse la file telle quelle (ses propres écritures, une série
//     loggée puis annulée par exemple, partent et s'annulent en base) et enfile
//     une suppression que la BASE tranche au moment de l'écriture : l'exécution
//     ne part que si elle est encore ouverte et vide. Une série arrivée
//     d'ailleurs, en file ou déjà acquittée, la garde en vie ;
//   - si la file montre déjà une saisie de cette exécution que le tableau ne
//     porte pas (`pendingOps`), il y a quelque chose à perdre : le geste devient
//     « annuler », confirmé.
// « Annuler », confirmé, garde son ménage complet : purge et suppression sans
// condition, saisies d'un autre onglet comprises (c'est ce que l'utilisateur
// vient de confirmer).

import { isBlankNote } from '../../domain/notes';
import type { OutboxOp } from './outbox';
import { totalLoggedSets, type CaptureState } from './state';

/** Rien n'est saisi dans cette séance : la quitter ne fait rien perdre (cf. en-tête). */
export function nothingEntered(state: CaptureState): boolean {
  if (totalLoggedSets(state) > 0) return false;
  if ((state.layout?.length ?? 0) > 0) return false;
  return Object.values(state.datedNotes).every((note) => isBlankNote(note.body));
}

/**
 * Une saisie de l'exécution `executionId` attend-elle en file sans figurer au
 * tableau `state` : une série ou une note d'un AUTRE onglet ? Bilan net de la
 * file : une série insérée puis supprimée, une note écrite puis effacée ne
 * comptent pas (c'est le « loggé puis annulé » de cet onglet-ci).
 */
export function enteredElsewhere(state: CaptureState, pendingOps: readonly OutboxOp[]): boolean {
  const known = new Set<string>();
  for (const progress of Object.values(state.progress)) {
    for (const id of progress.setIds) if (id !== null) known.add(id);
  }
  for (const note of Object.values(state.datedNotes)) known.add(note.id);
  const waiting = new Set<string>();
  for (const op of pendingOps) {
    if (op.type === 'insertSet' && op.executionId === state.executionId) waiting.add(op.id);
    else if (op.type === 'upsertDatedNote' && op.executionId === state.executionId) {
      if (isBlankNote(op.body)) waiting.delete(op.id);
      else waiting.add(op.id);
    } else if (op.type === 'deleteSet' || op.type === 'deleteDatedNote') waiting.delete(op.id);
  }
  return [...waiting].some((id) => !known.has(id));
}

/** Ce qu'il faut faire pour quitter la séance en cours sans la ranger. */
export interface LeaveSessionPlan {
  /** 'change' : rien n'est saisi, « Changer de séance ». 'cancel' : « Annuler la séance ». */
  kind: 'change' | 'cancel';
  /** Le geste doit-il être confirmé avant d'agir ? */
  needsConfirmation: boolean;
  /** Faut-il purger la file de cette exécution (`purgeByExecution`) avant d'enfiler `ops` ? */
  purge: boolean;
  /** L'exécution quittée. */
  executionId: string;
  /** Les écritures à enfiler : la suppression de l'exécution, conditionnelle pour « changer ». */
  ops: OutboxOp[];
}

export function leaveSession(
  state: CaptureState,
  ctx: { executionStarted?: boolean; pendingOps?: readonly OutboxOp[] } = {},
): LeaveSessionPlan {
  const kind =
    nothingEntered(state) && !enteredElsewhere(state, ctx.pendingOps ?? []) ? 'change' : 'cancel';
  // Les exos déjà touchés : leurs copies locales seront relues à l'acquittement.
  const exerciseIds = [...new Set([...Object.keys(state.progress), ...Object.keys(state.datedNotes)])];
  const target = { id: state.executionId, exerciseIds };
  // Toujours demandée, même si rien ne dit que l'exécution est née (cf. en-tête).
  const ops: OutboxOp[] =
    kind === 'cancel'
      ? [{ type: 'deleteExecution', ...target }]
      : [{ type: 'deleteExecutionIfEmpty', ...target }];
  return {
    kind,
    needsConfirmation: kind === 'cancel',
    purge: kind === 'cancel',
    executionId: state.executionId,
    ops,
  };
}
