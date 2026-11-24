// Ce que propose le ⋯ d'une séance ou d'une routine (logique PURE), et quand un
// geste demande confirmation.
//
// Un objet a une seule porte d'actions, son ⋯ : sur sa ligne dans la liste
// parente comme en tête de sa propre page. Ce module décide quelles actions la
// feuille montre ; la fin de vie (archiver ou supprimer) suit `planRowActions`
// (ADR 0017), appelée telle quelle.
//
// Confirmation : un geste qui se défait ne la demande pas, sauf s'il ouvre un
// bloc ou abandonne une saisie.
//   - Archiver se défait (« Désarchiver », sur la ligne d'état qui suit). Hors
//     routine courante, il part au premier toucher. Dans la routine courante, le
//     plan change et un nouveau bloc commence : on le dit avant. Depuis
//     l'éditeur avec une saisie non enregistrée, il l'abandonne : confirmé, la
//     perte en lien (« Archiver sans les modifications »).
//   - Définir comme routine courante ouvre un bloc : confirmé.
//   - Supprimer ne se défait pas : toujours confirmé, l'option sûre en bouton.
import { planRowActions } from './archive';

/** Forme de la confirmation : aucune, ordinaire (l'action en bouton, « Annuler »
 *  en lien) ou destructive (l'option sûre en bouton, la perte en lien). */
export type ConfirmKind = 'none' | 'plain' | 'destructive';

export type SeanceActionKey = 'rename' | 'duplicate' | 'archive' | 'delete';
export type RoutineActionKey = 'rename' | 'set-current' | 'archive' | 'delete';

export interface MenuItem<K extends string> {
  key: K;
  confirm: ConfirmKind;
}

export function seanceMenu(s: {
  /** Déjà exécutée : elle s'archive au lieu de se supprimer. */
  executed: boolean;
  /** Dans la routine courante : l'archiver coupe un bloc. */
  inCurrentRoutine: boolean;
  /** Sa version enregistrée a au moins un exo (sinon rien à copier). */
  hasExercises: boolean;
  /** Depuis l'éditeur : une saisie (prescriptions ou note) n'est pas enregistrée. */
  unsavedEdits?: boolean;
}): MenuItem<SeanceActionKey>[] {
  const life = planRowActions({ executed: s.executed, archived: false, isCurrent: false });
  const items: MenuItem<SeanceActionKey>[] = [{ key: 'rename', confirm: 'none' }];
  if (s.hasExercises) items.push({ key: 'duplicate', confirm: 'none' });
  if (life.canArchive) {
    items.push({
      key: 'archive',
      confirm: s.unsavedEdits ? 'destructive' : s.inCurrentRoutine ? 'plain' : 'none',
    });
  } else if (life.canDelete) {
    items.push({ key: 'delete', confirm: 'destructive' });
  }
  return items;
}

export interface RoutineMenu {
  items: MenuItem<RoutineActionKey>[];
  /** La routine courante : ni archivage ni suppression, la feuille dit pourquoi. */
  currentNote: boolean;
}

export function routineMenu(r: { executed: boolean; isCurrent: boolean; archived: boolean }): RoutineMenu {
  // Archivée : hors du plan, elle ne se modifie pas ; « Désarchiver » est sur sa
  // ligne et en tête de sa page.
  if (r.archived) return { items: [], currentNote: false };
  const items: MenuItem<RoutineActionKey>[] = [{ key: 'rename', confirm: 'none' }];
  if (r.isCurrent) return { items, currentNote: true };
  items.push({ key: 'set-current', confirm: 'plain' });
  const life = planRowActions({ executed: r.executed, archived: false, isCurrent: false });
  if (life.canArchive) items.push({ key: 'archive', confirm: 'none' });
  else if (life.canDelete) items.push({ key: 'delete', confirm: 'destructive' });
  return { items, currentNote: false };
}

const VERB: Record<SeanceActionKey | RoutineActionKey, string> = {
  rename: 'renommer',
  duplicate: 'dupliquer',
  archive: 'archiver',
  delete: 'supprimer',
  'set-current': 'définir comme courante',
};

/** Nom lu du bouton ⋯ : les actions qu'il ouvre, puis l'objet (« Renommer,
 *  dupliquer ou archiver Upper A »), comme « Remplacer ou passer » au Sommaire. */
export function menuLabel(keys: readonly (SeanceActionKey | RoutineActionKey)[], name: string): string {
  const verbs = keys.map((k) => VERB[k]);
  if (verbs.length === 0) return `Actions de ${name}`;
  const last = verbs[verbs.length - 1] ?? '';
  const text = verbs.length === 1 ? last : `${verbs.slice(0, -1).join(', ')} ou ${last}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${name}`;
}
