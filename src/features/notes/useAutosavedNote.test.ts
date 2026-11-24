// Une note adoptée par une réponse tardive de la base, pendant que le panneau de
// l'exo est ouvert, doit apparaître dans le champ sans réouverture, et sans
// jamais remplacer une saisie en cours.
//
// Sans DOM : `react` est remplacé par un moteur de hooks minimal (cases mémoire
// par ordre d'appel, `useState` qui redemande un rendu, effets rejoués quand
// leurs dépendances changent, nettoyages au démontage). Il déroule le vrai hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface EffectSlot {
  deps?: readonly unknown[];
  cleanup?: void | (() => void);
}

const engine = vi.hoisted(() => {
  const state = {
    slots: [] as unknown[],
    cursor: 0,
    pending: [] as (() => void)[],
    dirty: false,
  };
  function slot<T>(init: () => T): T {
    if (state.cursor >= state.slots.length) state.slots.push(init());
    return state.slots[state.cursor++] as T;
  }
  return { state, slot };
});

vi.mock('react', () => ({
  useState: <T,>(initial: T | (() => T)) => {
    const cell = engine.slot(() => ({
      value: typeof initial === 'function' ? (initial as () => T)() : initial,
    }));
    const set = (next: T | ((prev: T) => T)) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(cell.value) : next;
      if (Object.is(value, cell.value)) return;
      cell.value = value;
      engine.state.dirty = true;
    };
    return [cell.value, set];
  },
  useRef: <T,>(initial: T) => engine.slot(() => ({ current: initial })),
  useCallback: <T,>(fn: T) => engine.slot(() => fn),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const slot = engine.slot<EffectSlot>(() => ({}));
    const changed =
      slot.deps === undefined ||
      deps === undefined ||
      deps.length !== slot.deps.length ||
      deps.some((dep, i) => !Object.is(dep, slot.deps![i]));
    if (!changed) return;
    engine.state.pending.push(() => {
      slot.cleanup?.();
      slot.deps = deps;
      slot.cleanup = effect();
    });
  },
}));

import { shouldAdoptIncomingNote, useAutosavedNote } from './useAutosavedNote';

type Api = ReturnType<typeof useAutosavedNote>;
let api: Api;
let parentValue = '';
let adoptIncoming = true;
const saves: string[] = [];
/** Le parent : enregistre, et rend la nouvelle valeur au champ au rendu suivant. */
const onSave = (body: string) => {
  saves.push(body);
  parentValue = body;
};

/** Rend le composant porteur jusqu'à stabilité (états posés pendant le rendu ou les effets). */
function render(): Api {
  // Appelé sous un autre nom : ce « rendu » n'est pas un composant React.
  const hook = useAutosavedNote;
  for (let pass = 0; pass < 20; pass += 1) {
    engine.state.cursor = 0;
    engine.state.dirty = false;
    engine.state.pending = [];
    api = hook(parentValue, onSave, { adoptIncoming });
    if (engine.state.dirty) continue; // état ajusté pendant le rendu : on rend de nouveau
    for (const run of engine.state.pending.splice(0)) run();
    if (!engine.state.dirty) return api;
  }
  throw new Error('rendu instable');
}

function unmount(): void {
  for (const slot of engine.state.slots) {
    if (slot !== null && typeof slot === 'object' && 'cleanup' in slot) {
      (slot as EffectSlot).cleanup?.();
    }
  }
  engine.state.slots = [];
}

beforeEach(() => {
  vi.useFakeTimers();
  engine.state.slots = [];
  parentValue = '';
  adoptIncoming = true;
  saves.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shouldAdoptIncomingNote', () => {
  it('champ intact, valeur nouvelle : reprise', () => {
    expect(shouldAdoptIncomingNote('écrite ailleurs', '', '')).toBe(true);
    expect(shouldAdoptIncomingNote('corrigée ailleurs', 'ancienne', 'ancienne')).toBe(true);
  });

  it('saisie en cours : jamais remplacée', () => {
    expect(shouldAdoptIncomingNote('écrite ailleurs', '', 'je tape')).toBe(false);
    expect(shouldAdoptIncomingNote('écrite ailleurs', 'ancienne', '')).toBe(false);
  });

  it('la valeur que le champ vient lui-même d’enregistrer n’est pas une arrivée', () => {
    expect(shouldAdoptIncomingNote('épaule raide', 'épaule raide', 'épaule raide')).toBe(false);
    // Corps comparés normalisés : un espace de bord n'est pas une saisie en cours.
    expect(shouldAdoptIncomingNote('épaule raide', 'épaule raide', 'épaule raide ')).toBe(false);
    expect(shouldAdoptIncomingNote('autre', 'épaule raide', 'épaule raide \r\n')).toBe(true);
  });
});

describe('useAutosavedNote, valeur qui arrive pendant que le champ est monté', () => {
  it('champ intact : la note adoptée apparaît sans remontage, sans rien enregistrer', () => {
    expect(render().draft).toBe('');
    parentValue = 'coude gauche sensible'; // réponse tardive adoptée par la Capture
    expect(render().draft).toBe('coude gauche sensible');
    expect(saves).toEqual([]);
    // Démontage : rien n'a été saisi, rien ne part (et surtout pas un effacement).
    unmount();
    expect(saves).toEqual([]);
  });

  it('saisie en cours : elle reste, part à son tour, et gagne', () => {
    render();
    api.handleChange('je tape');
    expect(render().draft).toBe('je tape');
    parentValue = 'écrite ailleurs';
    expect(render().draft).toBe('je tape');
    vi.advanceTimersByTime(700);
    expect(saves).toEqual(['je tape']);
    expect(render().draft).toBe('je tape');
  });

  it('après la reprise, taper puis effacer enregistre bien par rapport à la note adoptée', () => {
    render();
    parentValue = 'adoptée';
    render();
    api.handleChange('adoptée, complétée');
    render();
    api.flush();
    expect(saves).toEqual(['adoptée, complétée']);
    render();
    // Remise à l'identique de ce qui est enregistré : aucun envoi de plus.
    api.handleChange('adoptée, complétée ');
    render();
    api.flush();
    expect(saves).toEqual(['adoptée, complétée']);
  });

  it('note reprise puis champ vidé : l’effacement part (la note adoptée est la référence)', () => {
    render();
    parentValue = 'adoptée';
    render();
    api.handleChange('');
    render();
    api.flush();
    expect(saves).toEqual(['']);
  });

  it('l’enregistrement du champ lui-même ne déclenche aucune reprise', () => {
    render();
    api.handleChange('épaule raide ');
    render();
    api.flush();
    expect(saves).toEqual(['épaule raide']);
    // Le parent rend la valeur normalisée : le brouillon, avec son espace, ne bouge pas.
    expect(render().draft).toBe('épaule raide ');
  });

  it('sans l’option (note d’instructions) : une valeur entrante ne touche jamais le champ', () => {
    adoptIncoming = false;
    parentValue = 'prise serrée';
    expect(render().draft).toBe('prise serrée');
    // Une lecture partie avant un enregistrement ramène l'ancien texte dans la prop.
    parentValue = 'ancienne version';
    expect(render().draft).toBe('prise serrée');
    unmount();
    expect(saves).toEqual([]);
  });

  it('une seconde arrivée remplace la première tant que le champ reste intact', () => {
    render();
    parentValue = 'première';
    render();
    parentValue = 'seconde';
    expect(render().draft).toBe('seconde');
    unmount();
    expect(saves).toEqual([]);
  });
});
