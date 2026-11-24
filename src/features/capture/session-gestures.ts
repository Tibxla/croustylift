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
// porte donc la suppression de l'exécution dès qu'elle a pu naître.
//
// API pour l'écran : `leaveSession(état, { executionStarted })` rend
//   - `kind` : 'change' ou 'cancel', pour le libellé du geste ;
//   - `needsConfirmation` : vrai pour 'cancel' ;
//   - `executionId` et `ops` : le ménage, identique dans les deux cas.
// L'écran déroule alors, dans cet ordre, ce que fait déjà « Annuler la séance »
// (`handleCancelSession`, CaptureScreen) :
//   1. `clearPersisted(séance, date)` : l'état de capture quitte l'appareil ;
//   2. `purgeByExecution(executionId)` : les écritures en file et en
//      quarantaine de cette exécution n'ont plus d'objet ;
//   3. enfiler `ops` (la suppression de l'exécution, si elle a pu naître) ;
//   4. retour à l'écran de lancement.
// `executionStarted` : ce que l'écran sait de la naissance de l'exécution (sa
// ref `executionStartedRef`). L'état est relu en plus : s'il porte une série ou
// une note, l'exécution est née quoi que dise le drapeau.

import { isBlankNote } from '../../domain/notes';
import type { OutboxOp } from './outbox';
import { isExecutionStarted, totalLoggedSets, type CaptureState } from './state';

/** Rien n'est saisi dans cette séance : la quitter ne fait rien perdre (cf. en-tête). */
export function nothingEntered(state: CaptureState): boolean {
  if (totalLoggedSets(state) > 0) return false;
  if ((state.layout?.length ?? 0) > 0) return false;
  return Object.values(state.datedNotes).every((note) => isBlankNote(note.body));
}

/** Ce qu'il faut faire pour quitter la séance en cours sans la ranger. */
export interface LeaveSessionPlan {
  /** 'change' : rien n'est saisi, « Changer de séance ». 'cancel' : « Annuler la séance ». */
  kind: 'change' | 'cancel';
  /** Le geste doit-il être confirmé avant d'agir ? */
  needsConfirmation: boolean;
  /** L'exécution quittée : à passer à `purgeByExecution`. */
  executionId: string;
  /** Les écritures à enfiler après la purge (la suppression de l'exécution, ou rien). */
  ops: OutboxOp[];
}

export function leaveSession(
  state: CaptureState,
  ctx: { executionStarted: boolean },
): LeaveSessionPlan {
  const kind = nothingEntered(state) ? 'change' : 'cancel';
  const born = ctx.executionStarted || isExecutionStarted(state, null, []);
  // Les exos déjà touchés : leurs copies locales seront relues à l'acquittement.
  const exerciseIds = [...new Set([...Object.keys(state.progress), ...Object.keys(state.datedNotes)])];
  return {
    kind,
    needsConfirmation: kind === 'cancel',
    executionId: state.executionId,
    ops: born ? [{ type: 'deleteExecution', id: state.executionId, exerciseIds }] : [],
  };
}
