// Remise d'une réponse TARDIVE de la base au tableau de capture.
//
// L'ouverture d'une séance n'attend la base que 3 s. Une réponse arrivée après
// est remise au tableau monté, qui réconcilie son réalisé (cf. CaptureScreen).
// Mais elle peut arriver AVANT que le tableau soit monté : le chargement
// continue après la borne (template, historique des exos) et le tableau ne
// s'abonne qu'à son montage. Sans boîte, cette réponse était perdue et le rang
// suivant pouvait doubler un rang pris ailleurs.
//
// La boîte garde UNE réponse, étiquetée par la génération du chargement qui l'a
// demandée et par l'exécution qu'elle concerne, jusqu'à ce que le tableau de
// CETTE génération et de CETTE exécution vienne la prendre. Une réponse d'un
// chargement périmé, ou d'une autre exécution, n'est jamais remise.

export interface LateMailbox<T> {
  /** Dépose une réponse : remise tout de suite si son destinataire est là, gardée sinon. */
  post(generation: number, executionId: string, payload: T): void;
  /**
   * Le tableau monté s'annonce : il reçoit la réponse gardée pour lui s'il y en a
   * une, puis celles qui arriveront. Rend la fonction de départ (démontage).
   */
  register(generation: number, executionId: string, receive: (payload: T) => void): () => void;
}

export function createLateMailbox<T>(): LateMailbox<T> {
  let held: { generation: number; executionId: string; payload: T } | null = null;
  let receiver: { generation: number; executionId: string; receive: (payload: T) => void } | null =
    null;
  const matches = (
    a: { generation: number; executionId: string },
    generation: number,
    executionId: string,
  ) => a.generation === generation && a.executionId === executionId;

  return {
    post(generation, executionId, payload) {
      if (receiver && matches(receiver, generation, executionId)) {
        receiver.receive(payload);
        return;
      }
      // Pas de destinataire (tableau pas encore monté), ou un autre : la plus
      // récente est gardée, une plus ancienne d'un chargement périmé s'efface.
      if (held === null || generation >= held.generation) held = { generation, executionId, payload };
    },
    register(generation, executionId, receive) {
      const mine = { generation, executionId, receive };
      receiver = mine;
      const waiting = held;
      if (waiting !== null && waiting.generation <= generation) {
        // Prise ou périmée : dans les deux cas elle quitte la boîte.
        held = null;
        if (matches(waiting, generation, executionId)) receive(waiting.payload);
      }
      return () => {
        if (receiver === mine) receiver = null;
      };
    },
  };
}
