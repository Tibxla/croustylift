import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchWithTimeout, TIMEOUT_ERROR_NAME } from './fetch-timeout';
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
    expect((err as DOMException).name).toBe(TIMEOUT_ERROR_NAME);
  });

  it('un abandon par délai n’est pas un rejet définitif pour l’outbox', async () => {
    vi.useFakeTimers();
    const outcome = fetchWithTimeout(1000, hanging)('https://exemple.test').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);

    expect(isPermanentRejection(await outcome)).toBe(false);
  });

  it('une réponse arrivée à temps passe entière (statut, en-têtes, corps), et le minuteur est rendu', async () => {
    vi.useFakeTimers();
    const fast: typeof fetch = async () =>
      new Response('{"ok":true}', {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json', 'content-range': '0-0/1' },
      });

    const res = await fetchWithTimeout(1000, fast)('https://exemple.test');
    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Created');
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-range')).toBe('0-0/1');
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('une réponse sans corps (204) passe, et le minuteur est rendu', async () => {
    vi.useFakeTimers();
    const empty: typeof fetch = async () => new Response(null, { status: 204 });

    const res = await fetchWithTimeout(1000, empty)('https://exemple.test');
    expect(res.status).toBe(204);
    await expect(res.text()).resolves.toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('seuls les en-têtes arrivent, le corps se bloque : abandon au bout du délai', async () => {
    vi.useFakeTimers();
    // Le serveur a répondu 200, puis plus rien : le corps ne se termine jamais.
    const stalled: typeof fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    const outcome = fetchWithTimeout(1000, stalled)('https://exemple.test').then(
      () => 'réponse',
      (err: unknown) => err,
    );

    await vi.advanceTimersByTimeAsync(999);
    // Toujours en attente : le minuteur n'a pas été rendu à la réception des en-têtes.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    const err = await outcome;
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe(TIMEOUT_ERROR_NAME);
    expect(isPermanentRejection(err)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un corps qui arrive en plusieurs morceaux avant le délai est rendu entier', async () => {
    vi.useFakeTimers();
    const chunked: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('[1,'));
            setTimeout(() => {
              controller.enqueue(encoder.encode('2]'));
              controller.close();
            }, 500);
          },
        }),
        { status: 200 },
      );
    const pending = fetchWithTimeout(1000, chunked)('https://exemple.test');
    await vi.advanceTimersByTimeAsync(500);
    await expect((await pending).json()).resolves.toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('l’appelant annule pendant la lecture du corps : sa raison remonte', async () => {
    const caller = new AbortController();
    const stalled: typeof fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 });
    const outcome = fetchWithTimeout(60_000, stalled)('https://exemple.test', {
      signal: caller.signal,
    }).catch((e: unknown) => e);
    await Promise.resolve();
    caller.abort(new Error('écran quitté'));

    expect(((await outcome) as Error).message).toBe('écran quitté');
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
