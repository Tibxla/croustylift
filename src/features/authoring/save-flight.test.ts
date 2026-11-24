import { describe, expect, it, vi } from 'vitest';
import { createSaveFlight } from './save-flight';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('une seule sauvegarde du plan en vol', () => {
  it('deux déclenchements pendant une sauvegarde lente : une seule version créée', async () => {
    const slow = deferred();
    const save = vi.fn((_plan: string) => slow.promise);
    const flight = createSaveFlight<string>(save);
    const first = flight.run('plan A'); // « Enregistrer »
    const second = flight.run('plan A'); // « Enregistrer et quitter » depuis la garde
    expect(flight.busy).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    slow.resolve();
    await expect(first).resolves.toBe('plan A');
    await expect(second).resolves.toBe('plan A');
    expect(save).toHaveBeenCalledTimes(1);
    expect(flight.busy).toBe(false);
  });

  it('une fois la première finie, une nouvelle demande repart', async () => {
    const save = vi.fn((_plan: string) => Promise.resolve());
    const flight = createSaveFlight<string>(save);
    await flight.run('v1');
    await flight.run('v2');
    expect(save.mock.calls.map((c) => c[0])).toEqual(['v1', 'v2']);
  });

  it('un échec est partagé, et la demande suivante retente', async () => {
    const slow = deferred();
    const save = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(undefined);
    const flight = createSaveFlight<string>(save);
    const a = flight.run('p');
    const b = flight.run('p');
    slow.reject(new Error('réseau'));
    await expect(a).rejects.toThrow('réseau');
    await expect(b).rejects.toThrow('réseau');
    await expect(flight.run('p')).resolves.toBe('p');
    expect(save).toHaveBeenCalledTimes(2);
  });
});
