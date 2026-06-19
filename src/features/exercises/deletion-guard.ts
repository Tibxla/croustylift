// Garde PURE de suppression d'un exo perso (onglet « Exercices », issue #49).
//
// Pourquoi : en base, les FK `prescriptions.exercise_id`, `performed_sets.exercise_id`
// et `dated_notes.exercise_id` vers `exercises(id)` n'ont PAS de ON DELETE CASCADE
// (NO ACTION = RESTRICT, cf. migration 0001). Supprimer un exo encore référencé est
// donc rejeté par Postgres (23503). Plutôt que d'attendre l'erreur SQL brute, on
// COMPTE les références avant et on bloque proprement avec un message lisible.
//
// On ne compte que prescriptions (le template) et performed_sets (l'historique
// réel) : ce sont les deux références qui PORTENT du sens pour l'utilisateur et qui
// bloquent vraiment. Les dated_notes sont rares et toujours adossées à une série ;
// la couche data.ts les inclut dans le filet de sécurité 23503 sans les exposer ici.
//
// Sans React ni Supabase : déterministe et testé (cf. deletion-guard.test.ts).

/** Décompte des références d'un exo, par type de référence bloquante. */
export interface ExerciseReferenceCounts {
  /** Nombre de prescriptions (versions de séances) qui citent l'exo. */
  prescriptions: number;
  /** Nombre de séries réellement faites loggées sur l'exo (historique). */
  performedSets: number;
}

/** Vrai si l'exo est référencé quelque part (suppression à bloquer). */
export function isReferenced(counts: ExerciseReferenceCounts): boolean {
  return counts.prescriptions > 0 || counts.performedSets > 0;
}

/** Accorde un nom commun (singulier/pluriel) selon le compte. */
function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/**
 * Message expliquant POURQUOI la suppression est bloquée, prêt à afficher
 * (français, sans tiret long). `null` si l'exo n'est pas référencé (rien à dire).
 * On nomme chaque cause avec son décompte pour que l'utilisateur sache quoi
 * détacher avant de réessayer (retirer l'exo de ses séances, etc.).
 */
export function describeReferenceBlock(counts: ExerciseReferenceCounts): string | null {
  if (!isReferenced(counts)) return null;

  const causes: string[] = [];
  if (counts.prescriptions > 0) {
    causes.push(`${plural(counts.prescriptions, 'séance le prescrit', 'séances le prescrivent')}`);
  }
  if (counts.performedSets > 0) {
    causes.push(`${plural(counts.performedSets, 'série a été loggée dessus', 'séries ont été loggées dessus')}`);
  }

  return `Impossible de supprimer cet exercice : ${causes.join(', ')}. Retire-le de tes séances avant de le supprimer ; ton historique reste intact.`;
}
