// Règle d'archivage des routines et des séances (ADR 0017) — logique PURE.
//
// Ce qui a déjà été exécuté s'archive : son historique (blocs, courbes, journal)
// reste entier, et une ancienne routine reste l'un des deux termes d'une
// comparaison (ADR 0016). Ce qui n'a jamais été exécuté se supprime. La routine
// courante ne s'archive pas : il faut d'abord en définir une autre. La base tient
// la règle de son côté (une séance exécutée ne se supprime pas, migration 0014) ;
// ce module décide seulement quelles actions proposer.

/** Les routines dont au moins une séance a été exécutée. */
export function executedRoutineIds(
  seances: readonly { id: string; routine_id: string }[],
  executedSeanceIds: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const seance of seances) {
    if (executedSeanceIds.has(seance.id)) ids.add(seance.routine_id);
  }
  return ids;
}

/** Les actions de fin de vie proposées pour une routine ou une séance. */
export interface PlanRowActions {
  canArchive: boolean;
  canDelete: boolean;
  canUnarchive: boolean;
}

export function planRowActions(row: {
  executed: boolean;
  archived: boolean;
  /** Routine courante (toujours `false` pour une séance). */
  isCurrent: boolean;
}): PlanRowActions {
  if (row.archived) return { canArchive: false, canDelete: false, canUnarchive: true };
  return {
    canArchive: row.executed && !row.isCurrent,
    canDelete: !row.executed,
    canUnarchive: false,
  };
}
