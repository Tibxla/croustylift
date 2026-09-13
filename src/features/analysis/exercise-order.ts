// Ordre des exos dans l'Analyse (décision du 2026-09-13) — logique PURE.
//
// Les cartes suivent l'ordre du plan de la routine courante : séance par séance
// (position dans la routine), puis exo par exo (position dans la version
// courante de la séance). Un exo présent dans plusieurs séances prend sa place à
// sa première apparition. Les exos hors routine (anciennes routines, ajouts à la
// volée) viennent ensuite, par nom : ils n'ont pas d'ordre de plan à suivre.

/** Les exos du plan, dans l'ordre : séances par position, puis exos par position. */
export function planExerciseOrder(
  seances: readonly { id: string; position: number }[],
  prescriptions: readonly { seanceId: string; exerciseId: string; position: number }[],
): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const sortedSeances = [...seances].sort((a, b) => a.position - b.position);
  for (const seance of sortedSeances) {
    const rows = prescriptions
      .filter((p) => p.seanceId === seance.id)
      .sort((a, b) => a.position - b.position);
    for (const row of rows) {
      if (seen.has(row.exerciseId)) continue;
      seen.add(row.exerciseId);
      order.push(row.exerciseId);
    }
  }
  return order;
}

/** Les exos entraînés dans l'ordre du plan, puis les autres par nom (locale fr). */
export function orderByPlan<T extends { exerciseId: string; name: string }>(
  exercises: readonly T[],
  planOrder: readonly string[],
): T[] {
  const rank = new Map(planOrder.map((id, index) => [id, index]));
  return [...exercises].sort((a, b) => {
    const ra = rank.get(a.exerciseId);
    const rb = rank.get(b.exerciseId);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.name.localeCompare(b.name, 'fr');
  });
}
