// PROTOTYPE JETABLE · socle E, surface Exercices : magasin en mémoire du
// catalogue de l'utilisateur. Il vit au niveau du module (il survit aux
// changements de surface, que le shell démonte) et se lit par `useCatalogue()`.
//
// Ce qu'il tient, d'après CONTEXT.md et les ADR 0004 et 0007 :
//   - les exos de base (copie de fixtures-e.ts, qu'on ne mute jamais) et les
//     exos perso, avec leurs muscles principaux (≥ 1) et le drapeau unilatéral ;
//   - les overrides per-user d'un exo de base (nom, muscles, unilatéral),
//     fusionnés champ par champ à la lecture ; « revenir à l'original » efface
//     l'override, jamais la note ni l'historique ;
//   - la note d'instructions, propre à l'utilisateur et distincte de l'override ;
//   - l'archivage d'un exo perso déjà utilisé, la suppression d'un exo perso
//     qui n'a jamais servi.
//
// Historique : celui de l'Analyse (son journal, lu dans exercices.tsx), pour que
// la fiche et la courbe disent la même chose. Seuls deux exos perso portent ici
// un usage résumé (`usage`), absent du journal de l'Analyse.
import { useSyncExternalStore } from 'react';
import { catalog, MUSCLES, routines, type CatalogExercise, type Muscle } from './fixtures-e';

export { MUSCLES, type Muscle };

export interface Override {
  name?: string;
  muscles?: Muscle[];
  unilateral?: boolean;
}

/** Usage hors courbes : exécutions et séries d'un exo perso (fabriqué ici). */
export interface PersoUsage {
  executions: number;
  sets: number;
  first: string;
  last: string;
  seanceName: string;
}

export interface Item {
  id: string;
  kind: 'base' | 'perso';
  /** Valeurs de base (ou de création pour un perso). */
  name: string;
  muscles: Muscle[];
  unilateral: boolean;
  override?: Override;
  note: string;
  archived: boolean;
  usage?: PersoUsage;
}

/** Vue fusionnée (ADR 0007) : un champ surchargé gagne, les autres gardent la base. */
export interface Exo extends Item {
  shownName: string;
  shownMuscles: Muscle[];
  shownUnilateral: boolean;
  overridden: boolean;
}

export function fuse(it: Item): Exo {
  const o = it.override;
  const overridden = !!o && (o.name !== undefined || o.muscles !== undefined || o.unilateral !== undefined);
  return {
    ...it,
    shownName: o?.name ?? it.name,
    shownMuscles: o?.muscles ?? it.muscles,
    shownUnilateral: o?.unilateral ?? it.unilateral,
    overridden,
  };
}

/* ------------------------------------------------------------------------ */
/* Données de départ                                                          */
/* ------------------------------------------------------------------------ */

const fromCatalog = (c: CatalogExercise): Item => ({
  id: c.id,
  kind: c.kind,
  name: c.name,
  muscles: [...c.muscles],
  unilateral: !!c.unilateral,
  note: c.note ?? '',
  archived: false,
});

function seed(): Item[] {
  const items = catalog.map(fromCatalog);
  const byId = (id: string) => items.find((i) => i.id === id)!;
  // Un exo de base déjà personnalisé : renommé et resserré sur les dorsaux.
  byId('pulldown').override = { name: 'Tirage vertical prise neutre', muscles: ['dorsaux'] };
  byId('bench').note = 'Omoplates serrées, pieds à plat, barre au bas des pectoraux.';
  const hack = byId('hack-perso');
  hack.usage = { executions: 6, sets: 18, first: '2026-10-08', last: '2026-11-12', seanceName: 'Lower A' };
  items.push(
    {
      id: 'curl-pupitre',
      kind: 'perso',
      name: 'Curl pupitre machine',
      muscles: ['biceps'],
      unilateral: false,
      note: '',
      archived: false,
    },
    {
      id: 'pec-deck',
      kind: 'perso',
      name: 'Pec deck salle 1',
      muscles: ['pectoraux'],
      unilateral: false,
      note: 'Siège cran 4.',
      archived: true,
      usage: { executions: 9, sets: 27, first: '2026-06-02', last: '2026-09-12', seanceName: 'Full A' },
    },
  );
  return items;
}

/* ------------------------------------------------------------------------ */
/* Magasin                                                                    */
/* ------------------------------------------------------------------------ */

let items: Item[] = seed();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Item[]) => {
  items = next;
  emit();
};
const patch = (id: string, f: (it: Item) => Item) => set(items.map((it) => (it.id === id ? f(it) : it)));

export const catalogue = {
  create(v: { name: string; muscles: Muscle[]; unilateral: boolean }): string {
    const id = `perso-${Date.now().toString(36)}`;
    set([...items, { id, kind: 'perso', name: v.name, muscles: v.muscles, unilateral: v.unilateral, note: '', archived: false }]);
    return id;
  },
  /** Exo perso : on réécrit l'exo. Exo de base : on n'écrit que les champs qui diffèrent de la base. */
  save(id: string, v: { name: string; muscles: Muscle[]; unilateral: boolean }) {
    patch(id, (it) => {
      if (it.kind === 'perso') return { ...it, name: v.name, muscles: v.muscles, unilateral: v.unilateral };
      const o: Override = {};
      if (v.name !== it.name) o.name = v.name;
      if (!sameMuscles(v.muscles, it.muscles)) o.muscles = v.muscles;
      if (v.unilateral !== it.unilateral) o.unilateral = v.unilateral;
      return { ...it, override: Object.keys(o).length ? o : undefined };
    });
  },
  resetOverride(id: string) {
    patch(id, (it) => ({ ...it, override: undefined }));
  },
  setNote(id: string, note: string) {
    patch(id, (it) => ({ ...it, note: note.trim() }));
  },
  archive(id: string, archived: boolean) {
    patch(id, (it) => ({ ...it, archived }));
  },
  remove(id: string) {
    set(items.filter((it) => it.id !== id));
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tous les exos (archivés compris), vue fusionnée. */
export function useCatalogue(): Exo[] {
  const raw = useSyncExternalStore(subscribe, () => items);
  return raw.map(fuse);
}

export function sameMuscles(a: Muscle[], b: Muscle[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m));
}

/** Tri canonique (ordre de CONTEXT.md). */
export function canonical(ms: Muscle[]): Muscle[] {
  return [...ms].sort((x, y) => MUSCLES.indexOf(x) - MUSCLES.indexOf(y));
}

/* ------------------------------------------------------------------------ */
/* Historique et usage, dérivés des fixtures                                  */
/* ------------------------------------------------------------------------ */

/** Séances (non archivées) qui prescrivent l'exo, avec leur routine. */
export function prescribedIn(id: string) {
  const out: { routine: string; seance: string; current: boolean; lastDone: string | null; presc: string }[] = [];
  for (const r of routines) {
    if (r.archived) continue;
    for (const s of r.seances) {
      if (s.archived) continue;
      const p = s.items.find((i) => i.exerciseId === id);
      if (p) {
        const rg = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}-${b}`);
        out.push({ routine: r.name, seance: s.name, current: r.current, lastDone: s.lastDone, presc: `${rg(p.sets)} × ${rg(p.reps)} · RIR ${rg(p.rir)}` });
      }
    }
  }
  return out;
}
