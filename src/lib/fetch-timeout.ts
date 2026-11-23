// `fetch` borné dans le temps, pour le client Supabase.
//
// supabase-js n'a aucun délai maximal : sur un wifi zombie (portail captif, DNS
// qui pend) une requête ne répond jamais et ne rejette jamais. Or le flush de
// l'outbox est sérialisé (une passe à la fois, cf. capture/outbox) : une seule
// requête pendante retenait la passe en cours, donc TOUS les flush suivants,
// jusqu'au rechargement de l'app. Toute requête est donc abandonnée au bout de
// `ms`. Pour l'outbox c'est un échec transitoire comme une coupure : l'op reste
// en file et sera rejouée (elle est idempotente par id).
//
// Écrit avec `AbortController` et un minuteur, sans `AbortSignal.timeout` ni
// `AbortSignal.any`, absents de certains iOS encore en service.

/** Délai maximal d'une requête Supabase (lecture paginée de 1000 lignes comprise). */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Enveloppe `baseFetch` : la requête est abandonnée après `ms`. Le signal
 * d'annulation fourni par l'appelant, s'il y en a un, reste honoré.
 */
export function fetchWithTimeout(
  ms: number = REQUEST_TIMEOUT_MS,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal ?? null;
    const relay = () => controller.abort(outer?.reason);
    if (outer?.aborted) relay();
    else outer?.addEventListener('abort', relay, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException(`Pas de réponse du serveur sous ${ms} ms.`, 'TimeoutError')),
      ms,
    );
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', relay);
    }
  };
}
