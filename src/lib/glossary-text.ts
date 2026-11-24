// Les mots du domaine expliqués en une phrase, pour qui ne les connaît pas (le
// pote du premier soir). UNE seule source : la Salle (toucher « RIR » ou
// « e1RM » sur l'instrument), le premier lancement, l'en-tête de l'Analyse et la
// fiche d'un exo lisent ces textes, jamais une copie. Le sens exact, avec ses
// cas limites, vit dans GLOSSARY.md ; ici, du français simple, en phrases
// courtes, sans jargon, sans ton de coach.
//
// `term` : le mot tel que l'écran l'écrit. `definition` : une à deux phrases,
// lisibles seules (sans le mot en tête : l'appelant le pose en titre, ou écrit
// « RIR : » devant au besoin, cf. `glossaryLine`).

export type GlossaryTerm = 'rir' | 'e1rm' | 'reference' | 'bloc' | 'pente';

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY_TEXT: Record<GlossaryTerm, GlossaryEntry> = {
  rir: {
    term: 'RIR',
    definition:
      'Les reps que tu aurais encore pu faire à la fin de la série. 0 : tu ne pouvais pas en faire une de plus.',
  },
  e1rm: {
    term: 'e1RM',
    definition:
      'La charge que tu soulèverais une seule fois, estimée d’après le poids, les reps et le RIR d’une série. Elle permet de comparer deux séries différentes.',
  },
  reference: {
    term: 'Référence',
    definition:
      'Ce que tu as fait la dernière fois dans cette séance, série par série. C’est ce que tu cherches à battre.',
  },
  bloc: {
    term: 'bloc',
    definition: 'La période pendant laquelle ta routine n’a pas changé. Modifier le plan ouvre un nouveau bloc.',
  },
  pente: {
    term: 'pente',
    definition: 'La vitesse à laquelle ton e1RM monte, en pourcentage par semaine, sur le bloc en cours.',
  },
};

/** La définition précédée de son mot : « RIR : les reps que tu aurais… ». */
export function glossaryLine(key: GlossaryTerm): string {
  const { term, definition } = GLOSSARY_TEXT[key];
  return `${term} : ${definition.charAt(0).toLowerCase()}${definition.slice(1)}`;
}
