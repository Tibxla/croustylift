import { describe, it, expect } from 'vitest';
import { createLateMailbox } from './late-reality';

describe('remise d’une réponse tardive au tableau de capture', () => {
  it('réponse arrivée AVANT le montage du tableau : gardée, remise à son montage', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];

    box.post(3, 'exec-1', 'séries de la base');
    box.register(3, 'exec-1', (payload) => received.push(payload));

    expect(received).toEqual(['séries de la base']);
  });

  it('une réponse gardée n’est remise qu’une fois', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];
    box.post(3, 'exec-1', 'séries de la base');

    box.register(3, 'exec-1', (payload) => received.push(payload))();
    box.register(3, 'exec-1', (payload) => received.push(payload));

    expect(received).toEqual(['séries de la base']);
  });

  it('réponse arrivée APRÈS le montage : remise tout de suite', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];
    box.register(3, 'exec-1', (payload) => received.push(payload));

    box.post(3, 'exec-1', 'séries de la base');

    expect(received).toEqual(['séries de la base']);
  });

  it('génération périmée : la réponse d’un chargement antérieur n’atteint pas le tableau suivant', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];

    box.post(3, 'exec-1', 'réponse du chargement 3');
    box.register(4, 'exec-1', (payload) => received.push(payload));
    // Ni gardée pour plus tard : elle a quitté la boîte.
    box.register(3, 'exec-1', (payload) => received.push(payload));

    expect(received).toEqual([]);
  });

  it('une réponse périmée arrivée après le montage du tableau suivant n’est pas remise', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];
    box.register(4, 'exec-1', (payload) => received.push(payload));

    box.post(3, 'exec-1', 'réponse du chargement 3');

    expect(received).toEqual([]);
  });

  it('une réponse qui concerne une autre exécution n’est pas remise', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];

    box.post(3, 'exec-autre', 'séries d’une autre exécution');
    box.register(3, 'exec-1', (payload) => received.push(payload));

    expect(received).toEqual([]);
  });

  it('après le démontage du tableau, une réponse est gardée pour le suivant de même génération', () => {
    const box = createLateMailbox<string>();
    const received: string[] = [];
    box.register(3, 'exec-1', () => received.push('ancien tableau'))();

    box.post(3, 'exec-1', 'séries de la base');
    box.register(3, 'exec-1', (payload) => received.push(payload));

    expect(received).toEqual(['séries de la base']);
  });
});
