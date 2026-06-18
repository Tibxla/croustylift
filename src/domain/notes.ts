// Notes attachées aux exercices (cf. brainstorm-intent §4 « Modèle de données »).
//
// Le domaine distingue DEUX types de notes, qui ne vivent pas au même endroit :
//   - `per-exercise` : instructions PERSISTANTES attachées à la DÉFINITION de
//     l'exo (table `exercise_notes`, unique par (user, exo)). « Prise serrée,
//     coudes rentrés. » Visible comme RÉFÉRENCE en Capture, éditable en authoring.
//   - `dated` : contexte d'une PERF un jour donné, attaché à l'EXÉCUTION (table
//     `dated_notes`). « Dos un peu raide aujourd'hui. » Saisie en Capture le jour
//     de la séance, ne déteint pas sur les autres jours.
//
// Une note EST du texte libre (contrairement aux séries, 100 % steppers) : la
// seule logique pure ici est la NORMALISATION du corps et la DISTINCTION des deux
// types. Pas d'accès DB : la couche data mappe ces helpers vers Supabase.

/** Lequel des deux types de notes du modèle. Discriminant partagé UI + data. */
export type NoteKind = 'per-exercise' | 'dated'

/**
 * Normalise le corps d'une note avant persistance / affichage :
 *   - fins de ligne Windows (\r\n) ramenées à \n (saisie cross-device) ;
 *   - espaces de bord retirés, texte interne (et retours à la ligne) préservés.
 * Une saisie vide ou seulement blanche devient la chaîne vide : « rien à noter »
 * a une seule représentation, qu'on peut tester avec `isBlankNote`.
 */
export function normalizeNoteBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').trim()
}

/**
 * Vrai si la note ne porte aucun contenu réel (vide ou seulement blanche). Sert
 * à NE PAS persister une note vide et à NE PAS l'afficher comme référence : une
 * note blanche est traitée comme absente.
 */
export function isBlankNote(body: string): boolean {
  return normalizeNoteBody(body) === ''
}

/** Libellé FR du type de note, pour les en-têtes d'UI (vocabulaire centralisé). */
export function describeNoteKind(kind: NoteKind): string {
  switch (kind) {
    case 'per-exercise':
      return 'Note de l’exercice'
    case 'dated':
      return 'Note du jour'
  }
}
