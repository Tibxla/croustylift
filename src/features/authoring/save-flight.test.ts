import { describe, expect, it, vi } from 'vitest';
import { createSaveFlight, saveAllThenLeave } from './save-flight';

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

describe('« Enregistrer et quitter » prend la main sur la navigation', () => {
  function slowSaves() {
    const pending: { plan: string; done: ReturnType<typeof deferred> }[] = [];
    const save = vi.fn((plan: string) => {
      const done = deferred();
      pending.push({ plan, done });
      return done.promise;
    });
    return { save, pending };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('A en vol, B retouché : attend A, envoie B, puis seulement quitte', async () => {
    const { save, pending } = slowSaves();
    const flight = createSaveFlight<string>(save);
    let latest = 'A';
    void flight.run('A'); // « Enregistrer » sur A
    latest = 'B'; // retouche pendant l'envoi
    const saved: string[] = [];
    const leave = vi.fn();
    const done = saveAllThenLeave({ flight, latest: () => latest, changed: (s, l) => s !== l, onSaved: (s) => saved.push(s), leave });
    pending[0]!.done.resolve(); // A aboutit
    await tick();
    expect(leave).not.toHaveBeenCalled();
    expect(save.mock.calls.map((c) => c[0])).toEqual(['A', 'B']);
    pending[1]!.done.resolve(); // B aboutit
    await done;
    expect(saved).toEqual(['A', 'B']);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('un brouillon retouché encore pendant B part lui aussi avant la sortie', async () => {
    const { save, pending } = slowSaves();
    const flight = createSaveFlight<string>(save);
    let latest = 'B';
    const leave = vi.fn();
    const done = saveAllThenLeave({ flight, latest: () => latest, changed: (s, l) => s !== l, onSaved: () => {}, leave });
    latest = 'C';
    pending[0]!.done.resolve();
    await tick();
    pending[1]!.done.resolve();
    await done;
    expect(save.mock.calls.map((c) => c[0])).toEqual(['B', 'C']);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('un envoi qui échoue : pas de sortie, l’erreur remonte', async () => {
    const { save, pending } = slowSaves();
    const flight = createSaveFlight<string>(save);
    const leave = vi.fn();
    const done = saveAllThenLeave({ flight, latest: () => 'B', changed: (s, l) => s !== l, onSaved: () => {}, leave });
    pending[0]!.done.reject(new Error('réseau'));
    await expect(done).rejects.toThrow('réseau');
    expect(leave).not.toHaveBeenCalled();
  });

  it('les notes passent après le plan, avant la sortie', async () => {
    const order: string[] = [];
    const flight = createSaveFlight<string>(async (p) => {
      order.push(`plan ${p}`);
    });
    await saveAllThenLeave({
      flight,
      latest: () => 'A',
      changed: (s, l) => s !== l,
      onSaved: () => {},
      afterPlan: async () => {
        order.push('notes');
      },
      leave: () => order.push('sortie'),
    });
    expect(order).toEqual(['plan A', 'notes', 'sortie']);
  });
});
