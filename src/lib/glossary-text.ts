/**
 * Les définitions courtes des mots du domaine, telles que l'app les dit
 * à l'écran la première fois qu'un mot apparaît (premier lancement, en-tête
 * de l'Analyse, fiche d'un exo, libellés touchables de la Salle).
 *
 * Une phrase simple par mot, tutoiement, sans jargon ni chiffre de méthode :
 * le détail exact vit dans GLOSSARY.md. Le même texte sert partout, pour
 * qu'un mot ne s'explique jamais de deux façons.
 */
export const GLOSSARY_TEXT = {
  rir: "RIR : les reps que tu aurais encore pu faire avant l'échec.",
  e1rm: 'e1RM : la charge que tu soulèverais une seule fois, estimée depuis tes séries.',
  reference:
    "Référence : la même série, la dernière fois que tu as fait cette séance. C'est elle à battre.",
  bloc: "Bloc : la période pendant laquelle ton plan n'a pas changé.",
  pente: 'Pente : la vitesse à laquelle ton e1RM monte, en % par semaine, sur le bloc en cours.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY_TEXT
