import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-timeout';
import { isPermanentRejection } from '../features/capture/outbox';

/** Un `fetch` qui ne répond jamais, mais rejette quand son signal est abandonné. */
const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchWithTimeout', () => {
  it('une requête qui pend est abandonnée au bout du délai', async () => {
    vi.useFakeTimers();
    const request = fetchWithTimeout(1000, hanging)('https://exemple.test');
    const outcome = request.then(
      () => 'réponse',
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);

    const err = await outcome;
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe('TimeoutError');
  });

  it('un abandon par délai n’est pas un rejet définitif pour l’outbox', async () => {
    vi.useFakeTimers();
    const outcome = fetchWithTimeout(1000, hanging)('https://exemple.test').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);

    expect(isPermanentRejection(await outcome)).toBe(false);
  });

  it('une réponse arrivée à temps passe telle quelle, et le minuteur est rendu', async () => {
    vi.useFakeTimers();
    const response = new Response('ok');
    const fast: typeof fetch = async () => response;

    await expect(fetchWithTimeout(1000, fast)('https://exemple.test')).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('le signal d’annulation de l’appelant reste honoré', async () => {
    const caller = new AbortController();
    const outcome = fetchWithTimeout(60_000, hanging)('https://exemple.test', {
      signal: caller.signal,
    }).catch((e: unknown) => e);

    caller.abort(new Error('annulé par l’appelant'));

    expect(((await outcome) as Error).message).toBe('annulé par l’appelant');
  });

  it('transmet la requête et ses options au fetch d’origine', async () => {
    const base = vi.fn(async () => new Response('ok'));
    await fetchWithTimeout(1000, base as unknown as typeof fetch)('https://exemple.test', {
      method: 'POST',
    });

    expect(base).toHaveBeenCalledTimes(1);
    const [input, init] = base.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe('https://exemple.test');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
