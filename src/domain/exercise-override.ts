// Fusion PURE d'un exercice de base avec l'override per-user (issue #50).
//
// Un exo de BASE (owner_id null) est commun à tous : on ne le modifie jamais.
// Pour qu'un user adapte un exo de base à sa réalité (renommer « DC » en « DC
// haltères », marquer un mouvement unilatéral, ajuster les muscles principaux),
// on stocke un OVERRIDE par (user, exo) dans `exercise_overrides`. Cet override
// gagne CHAMP PAR CHAMP à la lecture : il ne remplace pas l'exo, il le surcharge.
//
// Logique CENTRALE et déterministe (testée, cf. exercise-override.test.ts) : tous
// les chemins de lecture des champs partagés d'un exo (catalogue Capture, séance,
// éditeur, onglet Exercices, donc indirectement le compteur de séries #37 et la
// courbe e1RM côté faible #46) fusionnent ICI, jamais en réimplémentant la règle.
//
// Champs surchargeables = ceux qui changent le SENS d'un exo pour le logging et
// l'analyse : `name`, `unilateral`, `primaryMuscles`. Le reste (id, owner_id,
// muscle_group legacy) n'a pas de raison d'être personnalisé.

/** Les seuls champs d'un exo qu'un override peut personnaliser (forme camelCase). */
export interface ExerciseShared {
  name: string
  unilateral: boolean
  primaryMuscles: string[]
}

/**
 * Valeurs d'un override telles que stockées : chaque champ est OPTIONNEL et peut
 * valoir `null` (= « pas d'override sur ce champ », la base est gardée). Un champ
 * réellement renseigné gagne sur la base.
 */
export interface ExerciseOverrideValues {
  name?: string | null
  unilateral?: boolean | null
  primaryMuscles?: string[] | null
}

/** Vrai si la valeur de nom est un override EFFECTIF (non vide après trim). */
function hasName(name: string | null | undefined): name is string {
  return typeof name === 'string' && name.trim().length > 0
}

/** Vrai si la liste de muscles est un override EFFECTIF (au moins un muscle). */
function hasMuscles(muscles: string[] | null | undefined): muscles is string[] {
  return Array.isArray(muscles) && muscles.length > 0
}

/**
 * Fusionne un exo de base avec son override (per-user). Règle : un champ de
 * l'override gagne s'il est EFFECTIF, sinon on garde la base.
 *   - `name` : doit être non vide (un nom vide ne doit jamais effacer la base) ;
 *   - `unilateral` : un booléen explicite (true OU false) gagne ; `null`/absent garde ;
 *   - `primaryMuscles` : doit être non vide (on ne vide jamais les muscles de base).
 *
 * Pur et sans effet de bord : ne mute ni la base ni l'override (la liste de
 * muscles retenue est recopiée).
 */
export function mergeExerciseOverride(
  base: ExerciseShared,
  override: ExerciseOverrideValues | null,
): ExerciseShared {
  if (!override) return { ...base, primaryMuscles: [...base.primaryMuscles] }

  return {
    name: hasName(override.name) ? override.name.trim() : base.name,
    unilateral:
      typeof override.unilateral === 'boolean' ? override.unilateral : base.unilateral,
    primaryMuscles: hasMuscles(override.primaryMuscles)
      ? [...override.primaryMuscles]
      : [...base.primaryMuscles],
  }
}

/**
 * Vrai si l'override personnalise EFFECTIVEMENT au moins un champ (sert à
 * l'indicateur « personnalisé » de l'onglet Exercices). Un override tout en
 * `null`/vide ne compte pas comme une personnalisation.
 */
export function isOverridden(override: ExerciseOverrideValues | null): boolean {
  if (!override) return false
  return (
    hasName(override.name) ||
    typeof override.unilateral === 'boolean' ||
    hasMuscles(override.primaryMuscles)
  )
}
