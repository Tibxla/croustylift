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
 * Nom de l'erreur d'un délai dépassé : `AbortError`, et non `TimeoutError`.
 * `postgrest-js` rejoue de lui-même une lecture dont le `fetch` a échoué, trois
 * fois, avec 1 s, 2 s puis 4 s d'attente ; il ne rejoue PAS un abandon
 * (`AbortError`). Sous `TimeoutError`, une lecture qui pendait était donc tentée
 * quatre fois : environ 87 s avant d'échouer, pour un délai annoncé de 20 s. Un
 * délai dépassé est un abandon : une seule tentative, l'appelant décide de la
 * suite (copie locale, nouvel essai du flush). Une coupure franche (`TypeError`)
 * reste rejouée par la bibliothèque, avec 7 s d'attente entre ses essais : au
 * pire, trois échecs francs puis une tentative qui pend, environ 27 s.
 */
export const TIMEOUT_ERROR_NAME = 'AbortError';

/** Statuts dont la réponse ne porte jamais de corps (`Response` refuse d'en construire une avec). */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/**
 * Enveloppe `baseFetch` : la requête est abandonnée après `ms`. Le signal
 * d'annulation fourni par l'appelant, s'il y en a un, reste honoré.
 *
 * Le délai court jusqu'à la FIN DU CORPS, pas seulement jusqu'aux en-têtes :
 * `fetch` se résout dès les en-têtes, et un corps qui se bloque ensuite laissait
 * l'appelant attendre sa lecture sans fin (PostgREST lit `res.text()`), minuteur
 * déjà rendu. Une écriture directe gardait alors son blocage de rechargement
 * pour toujours (`withReloadBlocked`, pwa/blockers), et la passe de flush sa
 * place. Le corps est donc lu ici, sous le minuteur, et rendu dans une réponse
 * équivalente déjà complète. Les réponses de Supabase sont du JSON court : rien
 * n'a besoin d'être lu au fil de l'eau.
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
      () => controller.abort(new DOMException(`Pas de réponse du serveur sous ${ms} ms.`, TIMEOUT_ERROR_NAME)),
      ms,
    );
    try {
      const res = await baseFetch(input, { ...init, signal: controller.signal });
      // Rien à lire, ou un statut que `Response` ne sait pas reconstruire (0 d'une
      // réponse opaque, 1xx) : la réponse d'origine passe telle quelle.
      if (res.body === null || res.status < 200 || res.status > 599) return res;
      // Course contre l'abandon : la lecture du corps d'un vrai `fetch` rejette
      // à l'abandon du signal, mais rien ne le garantit pour toute `Response`.
      const body = await Promise.race([res.arrayBuffer(), aborted(controller.signal)]);
      const complete = new Response(NULL_BODY_STATUS.has(res.status) ? null : body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      // `url` et `redirected` ne se passent pas au constructeur.
      Object.defineProperty(complete, 'url', { value: res.url });
      Object.defineProperty(complete, 'redirected', { value: res.redirected });
      return complete;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', relay);
    }
  };
}

/** Une promesse qui rejette, avec sa raison, quand `signal` est abandonné. */
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
