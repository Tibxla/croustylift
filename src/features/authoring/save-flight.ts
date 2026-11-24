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
