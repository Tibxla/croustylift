// Une seule sauvegarde du plan d'une séance en vol à la fois.
//
// « Enregistrer » et « Enregistrer et quitter » (garde de sortie) mènent à la
// même écriture, qui crée une version (ADR 0001). Sur un réseau lent, toucher le
// premier puis, pendant l'envoi, un autre onglet puis le second en créait deux.
// Toute demande faite pendant une sauvegarde en cours la rejoint : elle reçoit
// SON résultat (le plan effectivement enregistré, ou son échec) au lieu d'en
// lancer une autre. Une fois finie, la demande suivante repart.
export interface SaveFlight<T> {
  /** Enregistre `snapshot`, ou rejoint la sauvegarde en cours ; rend le plan enregistré. */
  run(snapshot: T): Promise<T>;
  /** Une sauvegarde est-elle en vol ? */
  readonly busy: boolean;
}

export function createSaveFlight<T>(save: (snapshot: T) => Promise<unknown>): SaveFlight<T> {
  let inFlight: Promise<T> | null = null;
  return {
    run(snapshot) {
      if (inFlight) return inFlight;
      const flight = save(snapshot)
        .then(() => snapshot)
        .finally(() => {
          inFlight = null;
        });
      inFlight = flight;
      return flight;
    },
    get busy() {
      return inFlight !== null;
    },
  };
}

/**
 * « Enregistrer et quitter » : rejoint l'envoi en vol s'il y en a un, puis envoie
 * le dernier brouillon tant qu'il diffère de ce qui vient d'être acquitté (une
 * retouche faite pendant un envoi est une nouvelle version), puis les notes
 * (`afterPlan`), et SEULEMENT ensuite quitte. Un échec rejette sans quitter.
 * L'appelant garde la main sur la navigation pendant tout ce temps : la
 * confirmation reste ouverte et l'édition bloquée, aucun autre geste (la fin
 * d'un « Enregistrer » lancé avant) ne la referme.
 */
export async function saveAllThenLeave<T>(opts: {
  flight: SaveFlight<T>;
  /** Le brouillon courant, relu après chaque envoi. */
  latest: () => T;
  /** Le brouillon diffère-t-il de ce qui vient d'être enregistré ? */
  changed: (saved: T, latest: T) => boolean;
  onSaved: (saved: T) => void;
  afterPlan?: () => Promise<void>;
  leave: () => void;
  /** Garde-fou : nombre maximal d'envois enchaînés. */
  maxRounds?: number;
}): Promise<void> {
  const { flight, latest, changed, onSaved, afterPlan, leave, maxRounds = 5 } = opts;
  let saved = await flight.run(latest());
  onSaved(saved);
  for (let round = 1; round < maxRounds && changed(saved, latest()); round += 1) {
    saved = await flight.run(latest());
    onSaved(saved);
  }
  if (changed(saved, latest())) throw new Error('Le plan change encore : enregistre-le, puis quitte.');
  await afterPlan?.();
  leave();
}
