import { describe, expect, it, vi } from 'vitest';
import { draftSignOutRefusal, guardSignOut, openMemory, surfaceKey, switchMemory } from './surface-memory';

describe('openMemory', () => {
  it('monte seulement la surface d’arrivée, en haut', () => {
    const memory = openMemory('capture');
    expect(memory.current).toBe('capture');
    expect(memory.mounted).toEqual(['capture']);
    expect(memory.scrolls).toEqual({});
  });
});

describe('switchMemory', () => {
  it('garde la surface quittée montée et retient son défilement', () => {
    const { memory, scrollTo } = switchMemory(openMemory('capture'), {
      to: 'reglages',
      scrollY: 420,
      failed: [],
      intent: false,
    });
    expect(memory.current).toBe('reglages');
    expect(memory.mounted).toEqual(['capture', 'reglages']);
    expect(memory.scrolls.capture).toBe(420);
    // Première visite : en haut.
    expect(scrollTo).toBe(0);
  });

  it('au retour, rend le défilement quitté', () => {
    let memory = openMemory('analysis');
    memory = switchMemory(memory, { to: 'exercises', scrollY: 900, failed: [], intent: false }).memory;
    const back = switchMemory(memory, { to: 'analysis', scrollY: 120, failed: [], intent: false });
    expect(back.scrollTo).toBe(900);
    expect(back.memory.scrolls.exercises).toBe(120);
    // Aucune surface n'est remontée : même clé qu'avant.
    expect(surfaceKey(back.memory, 'analysis')).toBe(surfaceKey(openMemory('analysis'), 'analysis'));
  });

  it('une intention en attente prime sur la vue mémorisée : en haut, défilement oublié', () => {
    let memory = openMemory('analysis');
    memory = switchMemory(memory, { to: 'capture', scrollY: 900, failed: [], intent: false }).memory;
    const { memory: after, scrollTo } = switchMemory(memory, { to: 'analysis', scrollY: 0, failed: [], intent: true });
    expect(scrollTo).toBe(0);
    expect(after.scrolls.analysis).toBeUndefined();
  });

  it('tap sur l’onglet affiché : rien ne bouge, retour en haut', () => {
    const memory = openMemory('seances');
    const result = switchMemory(memory, { to: 'seances', scrollY: 300, failed: [], intent: false });
    expect(result.memory).toBe(memory);
    expect(result.scrollTo).toBe(0);
  });

  it('une surface en erreur quittée est démontée, et remontée à neuf au retour', () => {
    let memory = openMemory('analysis');
    const before = surfaceKey(memory, 'analysis');
    memory = switchMemory(memory, { to: 'capture', scrollY: 500, failed: ['analysis'], intent: false }).memory;
    expect(memory.mounted).toEqual(['capture']);
    expect(memory.scrolls.analysis).toBeUndefined();
    const back = switchMemory(memory, { to: 'analysis', scrollY: 0, failed: [], intent: false });
    expect(back.memory.mounted).toEqual(['capture', 'analysis']);
    expect(surfaceKey(back.memory, 'analysis')).not.toBe(before);
    expect(back.scrollTo).toBe(0);
  });

  it('une surface cachée tombée en erreur (chunk) est remontée à neuf quand on y revient', () => {
    let memory = openMemory('capture');
    memory = switchMemory(memory, { to: 'exercises', scrollY: 0, failed: [], intent: false }).memory;
    memory = switchMemory(memory, { to: 'capture', scrollY: 0, failed: [], intent: false }).memory;
    const before = surfaceKey(memory, 'exercises');
    // L'import des Exos a échoué pendant qu'ils étaient cachés.
    const back = switchMemory(memory, { to: 'exercises', scrollY: 0, failed: ['exercises'], intent: false });
    expect(back.memory.mounted).toContain('exercises');
    expect(surfaceKey(back.memory, 'exercises')).not.toBe(before);
    expect(back.scrollTo).toBe(0);
  });

  it('les autres surfaces restent montées, avec leur défilement', () => {
    let memory = openMemory('capture');
    memory = switchMemory(memory, { to: 'seances', scrollY: 10, failed: [], intent: false }).memory;
    memory = switchMemory(memory, { to: 'analysis', scrollY: 640, failed: [], intent: false }).memory;
    memory = switchMemory(memory, { to: 'reglages', scrollY: 50, failed: [], intent: false }).memory;
    expect(memory.mounted).toEqual(['capture', 'seances', 'analysis', 'reglages']);
    // Séances a été quittée à 640 px (vers l'Analyse).
    expect(switchMemory(memory, { to: 'seances', scrollY: 0, failed: [], intent: false }).scrollTo).toBe(640);
  });
});

describe('draftSignOutRefusal', () => {
  it('aucun brouillon : la déconnexion suit son cours', () => {
    expect(draftSignOutRefusal([])).toBeNull();
    expect(draftSignOutRefusal(['ecriture-directe'])).toBeNull();
  });

  it('un brouillon tenu par un écran (même caché) : refusée, avec la raison', () => {
    for (const block of ['brouillon-seance', 'brouillon-seance-passee', 'brouillon-exercice', 'brouillon-note-exercice']) {
      const refusal = draftSignOutRefusal([block]);
      expect(refusal).toMatch(/brouillon/);
      expect(refusal).toMatch(/enregistre-le ou abandonne-le/);
    }
  });
});

// Le bug : « Me déconnecter et perdre ces saisies » (forçage des écritures
// retenues) passait aussi la garde des brouillons. Un brouillon tenu par un
// écran caché partait sans un mot. Le forçage ne vise que les écritures
// retenues : les brouillons sont vérifiés dans tous les cas.
describe('guardSignOut', () => {
  it('sans brouillon : la déconnexion part, forcée ou non, avec ses options', async () => {
    const signOut = vi.fn(async () => {});
    await guardSignOut(signOut, [], undefined);
    await guardSignOut(signOut, ['ecriture-directe'], { force: true });
    expect(signOut).toHaveBeenNthCalledWith(1, undefined);
    expect(signOut).toHaveBeenNthCalledWith(2, { force: true });
  });

  it('un brouillon ouvert : refusée, même forcée, et rien n’est purgé', async () => {
    const signOut = vi.fn(async () => {});
    await expect(guardSignOut(signOut, ['brouillon-seance'], { force: true })).rejects.toThrow(/brouillon/);
    await expect(guardSignOut(signOut, ['brouillon-note-exercice'], undefined)).rejects.toThrow(/brouillon/);
    expect(signOut).not.toHaveBeenCalled();
  });
});
