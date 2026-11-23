// PROTOTYPE JETABLE · surface Séances. Store en mémoire du plan (routines,
// séances, versions, brouillons d'édition, notes d'instructions).
//
// Pourquoi un store au niveau module : `Pages` remonte chaque page à chaque
// changement de route, et App démonte la surface dès qu'on en change. Le
// brouillon d'une séance survit donc à un détour par une autre surface, et la
// ligne de la séance l'annonce (« modifications non enregistrées »).
//
// Le store part d'une COPIE de `routines` (fixtures-e.ts) : la Salle lit
// toujours la fixture d'origine et ne voit pas les éditions faites ici.
//
// Règles du domaine tenues ici (CONTEXT.md, ADR 0001, 0015, 0017) :
//   - éditer une séance crée une version ; « modifié » = le plan diffère de la
//     version enregistrée (bornes effectives, ordre, exos), pas « on a touché » ;
//   - la note d'instructions appartient à l'exo, hors version ;
//   - exécutée, une routine ou une séance s'archive ; jamais exécutée, elle se
//     supprime ; la routine courante ne s'archive pas ;
//   - noms uniques, archivées comprises, casse et espaces ignorés ;
//   - duplication de séance seulement (pas de duplication de routine), copie
//     de la version enregistrée, sans historique.
import { useSyncExternalStore } from 'react';
import { countPlannedSets, type CountRange } from '../../../domain/set-count';
import { nameKey } from '../../../domain/unique-name';
import { catalog, catalogById, MUSCLES, routines as fixtureRoutines, type Prescription } from './fixtures-e';
import { fmtDate as fmtDateRaw } from './format';

/** Date insécable : « 20 nov. » ne se coupe pas en fin de ligne. */
export const fmtDate = (iso: string) => fmtDateRaw(iso).replace(' ', '\u00a0');

export const TODAY = '2026-11-23';

/* ------------------------------------------------------------------------ */
/* Modèle                                                                     */
/* ------------------------------------------------------------------------ */

export type FieldKey = 'sets' | 'reps' | 'rir';

/** Un champ de prescription : fixe (min seul compte) ou fourchette. */
export interface Field {
  mode: 'fixe' | 'fourchette';
  min: number;
  max: number;
}

export interface PlanItem {
  /** Identité de ligne : une séance peut contenir deux fois le même exo. */
  rowId: string;
  exerciseId: string;
  sets: Field;
  reps: Field;
  rir: Field;
}

export interface PlanSeance {
  id: string;
  name: string;
  lastDone: string | null;
  archived: boolean;
  version: number;
  versionDate: string;
  items: PlanItem[];
}

export interface PlanRoutine {
  id: string;
  name: string;
  current: boolean;
  archived: boolean;
  seances: PlanSeance[];
}

export interface PlanState {
  routines: PlanRoutine[];
  /** Brouillons d'édition par séance (absents = pas d'édition en cours). */
  drafts: Record<string, PlanItem[]>;
  /** Notes d'instructions par exo (hors version). */
  notes: Record<string, string>;
  /** Commande du prototype : compte sans aucune routine. */
  simulateEmpty: boolean;
  backup: PlanRoutine[] | null;
}

export const FIELD_FLOOR: Record<FieldKey, number> = { sets: 1, reps: 1, rir: 0 };
export const FIELD_CEIL: Record<FieldKey, number> = { sets: 10, reps: 30, rir: 5 };
export const FIELD_WORD: Record<FieldKey, string> = { sets: 'séries', reps: 'reps', rir: 'RIR' };

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

const field = ([a, b]: [number, number]): Field => ({ mode: a === b ? 'fixe' : 'fourchette', min: a, max: b });

function itemFrom(p: Prescription): PlanItem {
  return { rowId: uid('l'), exerciseId: p.exerciseId, sets: field(p.sets), reps: field(p.reps), rir: field(p.rir) };
}

const VERSIONS: Record<string, [number, string]> = {
  'upper-a': [3, '2026-10-12'],
  'lower-a': [2, '2026-10-12'],
  'upper-b': [2, '2026-10-26'],
  'lower-b': [1, '2026-11-02'],
  'fb-a': [4, '2026-08-30'],
};

function initialRoutines(): PlanRoutine[] {
  const base: PlanRoutine[] = fixtureRoutines.map((r) => ({
    id: r.id,
    name: r.name,
    current: r.current,
    archived: !!r.archived,
    seances: r.seances.map((s) => ({
      id: s.id,
      name: s.name,
      lastDone: s.lastDone,
      archived: !!s.archived,
      version: VERSIONS[s.id]?.[0] ?? 1,
      versionDate: VERSIONS[s.id]?.[1] ?? '2026-11-01',
      items: s.items.map(itemFrom),
    })),
  }));
  const p = (exerciseId: string, sets: [number, number], reps: [number, number], rir: [number, number]): Prescription => ({
    exerciseId,
    sets,
    reps,
    rir,
  });
  // Une séance archivée dans la routine courante (exécutée, sortie du plan).
  base[0]?.seances.push({
    id: 'bras',
    name: 'Bras',
    lastDone: '2026-10-28',
    archived: true,
    version: 1,
    versionDate: '2026-10-12',
    items: [p('curl', [3, 3], [10, 12], [0, 1]), p('pushdown', [3, 3], [10, 15], [0, 1])].map(itemFrom),
  });
  // Une routine ni courante ni archivée, jamais faite (elle se supprime).
  base.splice(1, 0, {
    id: 'force-hiver',
    name: 'Force hiver',
    current: false,
    archived: false,
    seances: [
      {
        id: 'force-a',
        name: 'Force A',
        lastDone: null,
        archived: false,
        version: 1,
        versionDate: '2026-11-21',
        items: [p('squat', [5, 5], [5, 5], [2, 2]), p('bench', [5, 5], [5, 5], [2, 2]), p('row', [3, 3], [6, 8], [1, 2])].map(itemFrom),
      },
      {
        id: 'force-b',
        name: 'Force B',
        lastDone: null,
        archived: false,
        version: 1,
        versionDate: '2026-11-21',
        items: [p('rdl', [3, 3], [5, 5], [2, 2]), p('ohp', [5, 5], [5, 5], [2, 2]), p('pullup', [3, 4], [5, 8], [1, 2])].map(itemFrom),
      },
    ],
  });
  return base;
}

function initialNotes(): Record<string, string> {
  const notes: Record<string, string> = {
    bench: "Prise un doigt plus serrée que l'anneau, omoplates serrées, descente en deux secondes.",
  };
  for (const c of catalog) if (c.note) notes[c.id] = c.note;
  return notes;
}

/* ------------------------------------------------------------------------ */
/* Store                                                                      */
/* ------------------------------------------------------------------------ */

let state: PlanState = {
  routines: initialRoutines(),
  drafts: {},
  notes: initialNotes(),
  simulateEmpty: false,
  backup: null,
};
const listeners = new Set<() => void>();

function commit(next: PlanState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePlan(): PlanState {
  return useSyncExternalStore(subscribe, () => state);
}

function mapRoutines(f: (r: PlanRoutine) => PlanRoutine) {
  commit({ ...state, routines: state.routines.map(f) });
}

function mapSeance(seanceId: string, f: (s: PlanSeance) => PlanSeance) {
  mapRoutines((r) => (r.seances.some((s) => s.id === seanceId) ? { ...r, seances: r.seances.map((s) => (s.id === seanceId ? f(s) : s)) } : r));
}

export const plan = {
  createRoutine(name: string): string {
    const id = uid('routine');
    // La première routine devient courante : sans elle, la salle n'a rien à proposer.
    const hasCurrent = state.routines.some((r) => r.current);
    commit({ ...state, routines: [...state.routines, { id, name: clean(name), current: !hasCurrent, archived: false, seances: [] }] });
    return id;
  },
  renameRoutine(id: string, name: string) {
    mapRoutines((r) => (r.id === id ? { ...r, name: clean(name) } : r));
  },
  setCurrent(id: string) {
    mapRoutines((r) => ({ ...r, current: r.id === id }));
  },
  archiveRoutine(id: string) {
    mapRoutines((r) => (r.id === id && !r.current ? { ...r, archived: true } : r));
  },
  unarchiveRoutine(id: string) {
    mapRoutines((r) => (r.id === id ? { ...r, archived: false } : r));
  },
  deleteRoutine(id: string) {
    commit({ ...state, routines: state.routines.filter((r) => r.id !== id) });
  },

  createSeance(routineId: string, name: string, items: PlanItem[] = []): string {
    const id = uid('seance');
    // Vierge : aucune version tant qu'elle n'a pas un exo enregistré.
    const s: PlanSeance = { id, name: clean(name), lastDone: null, archived: false, version: items.length ? 1 : 0, versionDate: TODAY, items };
    mapRoutines((r) => (r.id === routineId ? { ...r, seances: [...r.seances, s] } : r));
    return id;
  },
  /** Copie franche de la version enregistrée de la source (ADR 0015). */
  duplicateSeance(sourceId: string, routineId: string, name: string): string {
    const src = findSeance(state, sourceId)?.seance;
    const items = (src?.items ?? []).map((it) => ({ ...it, rowId: uid('l') }));
    return plan.createSeance(routineId, name, items);
  },
  renameSeance(seanceId: string, name: string) {
    mapSeance(seanceId, (s) => ({ ...s, name: clean(name) }));
  },
  /** Déplace une séance d'un cran parmi les séances actives de sa routine. */
  moveSeance(routineId: string, seanceId: string, dir: -1 | 1) {
    mapRoutines((r) => {
      if (r.id !== routineId) return r;
      const active = r.seances.filter((s) => !s.archived);
      const i = active.findIndex((s) => s.id === seanceId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= active.length) return r;
      const next = [...active];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...r, seances: [...next, ...r.seances.filter((s) => s.archived)] };
    });
  },
  archiveSeance(seanceId: string) {
    mapSeance(seanceId, (s) => ({ ...s, archived: true }));
    plan.discard(seanceId);
  },
  unarchiveSeance(seanceId: string) {
    // Revient au plan en dernière position.
    mapRoutines((r) => {
      const s = r.seances.find((x) => x.id === seanceId);
      if (!s) return r;
      const rest = r.seances.filter((x) => x.id !== seanceId);
      const active = rest.filter((x) => !x.archived);
      return { ...r, seances: [...active, { ...s, archived: false }, ...rest.filter((x) => x.archived)] };
    });
  },
  deleteSeance(seanceId: string) {
    mapRoutines((r) => ({ ...r, seances: r.seances.filter((s) => s.id !== seanceId) }));
    plan.discard(seanceId);
  },

  setDraft(seanceId: string, items: PlanItem[]) {
    commit({ ...state, drafts: { ...state.drafts, [seanceId]: items } });
  },
  discard(seanceId: string) {
    if (!(seanceId in state.drafts)) return;
    const drafts = { ...state.drafts };
    delete drafts[seanceId];
    commit({ ...state, drafts });
  },
  /** Enregistre le brouillon : nouvelle version datée du jour. */
  save(seanceId: string) {
    const draft = state.drafts[seanceId];
    if (!draft) return;
    mapSeance(seanceId, (s) => ({ ...s, items: draft, version: s.version + 1, versionDate: TODAY }));
    plan.discard(seanceId);
  },
  newItem(exerciseId: string): PlanItem {
    return {
      rowId: uid('l'),
      exerciseId,
      sets: { mode: 'fixe', min: 3, max: 3 },
      reps: { mode: 'fourchette', min: 8, max: 12 },
      rir: { mode: 'fourchette', min: 1, max: 2 },
    };
  },

  setNote(exerciseId: string, body: string) {
    const notes = { ...state.notes };
    if (body.trim() === '') delete notes[exerciseId];
    else notes[exerciseId] = body.trim();
    commit({ ...state, notes });
  },

  setSimulateEmpty(on: boolean) {
    if (on === state.simulateEmpty) return;
    commit(
      on
        ? { ...state, simulateEmpty: true, backup: state.routines, routines: [], drafts: {} }
        : { ...state, simulateEmpty: false, routines: state.backup ?? initialRoutines(), backup: null },
    );
  },
};

/* ------------------------------------------------------------------------ */
/* Lectures                                                                   */
/* ------------------------------------------------------------------------ */

export function findSeance(s: PlanState, seanceId: string): { routine: PlanRoutine; seance: PlanSeance } | null {
  for (const routine of s.routines) {
    const seance = routine.seances.find((x) => x.id === seanceId);
    if (seance) return { routine, seance };
  }
  return null;
}

/** Exécutée au moins une fois : elle s'archive au lieu de se supprimer. */
export const routineExecuted = (r: PlanRoutine) => r.seances.some((s) => s.lastDone !== null);
export const seanceExecuted = (s: PlanSeance) => s.lastDone !== null;

export const exoName = (id: string) => catalogById(id)?.name ?? id;

/** Plan effectif d'une ligne : en fixe, seul min compte. */
const eff = (f: Field): [number, number] => (f.mode === 'fixe' ? [f.min, f.min] : [f.min, f.max]);

export function fieldText(f: Field): string {
  const [a, b] = eff(f);
  return a === b ? String(a) : `${a}-${b}`;
}

export function itemSummary(it: PlanItem): string {
  return `${fieldText(it.sets)} × ${fieldText(it.reps)} · RIR ${fieldText(it.rir)}`;
}

function sameItem(a: PlanItem, b: PlanItem): boolean {
  return a.exerciseId === b.exerciseId && (['sets', 'reps', 'rir'] as const).every((k) => fieldText(a[k]) === fieldText(b[k]));
}

/** Même plan : mêmes exos, même ordre, mêmes bornes effectives. */
export function samePlan(a: PlanItem[], b: PlanItem[]): boolean {
  return a.length === b.length && a.every((it, i) => sameItem(it, b[i]!));
}

export function isDirty(s: PlanState, seance: PlanSeance): boolean {
  const d = s.drafts[seance.id];
  return !!d && !samePlan(d, seance.items);
}

/** Changements lisibles entre la version enregistrée et le brouillon. */
export function diffLines(saved: PlanItem[], draft: PlanItem[]): string[] {
  const lines: string[] = [];
  const savedIds = new Set(saved.map((i) => i.rowId));
  const draftIds = new Set(draft.map((i) => i.rowId));
  for (const it of saved) if (!draftIds.has(it.rowId)) lines.push(`Retiré · ${exoName(it.exerciseId)}`);
  for (const it of draft) if (!savedIds.has(it.rowId)) lines.push(`Ajouté · ${exoName(it.exerciseId)} · ${itemSummary(it)}`);
  for (const it of draft) {
    const before = saved.find((x) => x.rowId === it.rowId);
    if (!before) continue;
    for (const k of ['sets', 'reps', 'rir'] as const) {
      if (fieldText(before[k]) !== fieldText(it[k])) {
        lines.push(`${exoName(it.exerciseId)} · ${FIELD_WORD[k]} ${fieldText(before[k])} → ${fieldText(it[k])}`);
      }
    }
  }
  const commonSaved = saved.filter((i) => draftIds.has(i.rowId)).map((i) => i.rowId);
  const commonDraft = draft.filter((i) => savedIds.has(i.rowId)).map((i) => i.rowId);
  if (commonSaved.join() !== commonDraft.join()) lines.push('Ordre des exos modifié');
  return lines;
}

/* ------------------------------------------------------------------------ */
/* Décompte des séries prévues (domain/set-count)                             */
/* ------------------------------------------------------------------------ */

export interface PlannedCount {
  total: CountRange;
  byMuscle: { muscle: string; range: CountRange }[];
}

export function plannedCount(items: PlanItem[]): PlannedCount {
  const c = countPlannedSets(
    items.map((it) => {
      const ex = catalogById(it.exerciseId);
      const [sMin, sMax] = eff(it.sets);
      const [rMin, rMax] = eff(it.reps);
      return {
        unilateral: !!ex?.unilateral,
        primaryMuscles: ex?.muscles ?? [],
        sets: { min: sMin, max: sMax },
        reps: { min: rMin, max: rMax },
      };
    }),
  );
  const byMuscle = (MUSCLES as readonly string[])
    .filter((m) => c.byMuscle[m])
    .map((m) => ({ muscle: m, range: c.byMuscle[m]! }));
  return { total: c.total, byMuscle };
}

/** Un compte pondéré : entier tel quel, sinon une décimale à virgule. */
export function fmtCount(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

export function fmtCountRange(r: CountRange): string {
  const a = fmtCount(r.min);
  const b = fmtCount(r.max);
  return a === b ? a : `${a}-${b}`;
}

/* ------------------------------------------------------------------------ */
/* Noms                                                                       */
/* ------------------------------------------------------------------------ */

function clean(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Message d'erreur si le nom est pris (archivés compris), sinon null. */
export function nameError(
  name: string,
  taken: { id: string; name: string; archived: boolean }[],
  kind: 'routine' | 'seance',
  selfId?: string,
): string | null {
  if (clean(name) === '') return null;
  const hit = taken.find((t) => t.id !== selfId && nameKey(t.name) === nameKey(name));
  if (!hit) return null;
  if (kind === 'routine') {
    return hit.archived
      ? `« ${hit.name} » est le nom d'une routine archivée. Il lui reste réservé.`
      : `Tu as déjà une routine « ${hit.name} ».`;
  }
  return hit.archived
    ? `« ${hit.name} » existe déjà dans cette routine, archivée. Son nom lui reste réservé.`
    : `« ${hit.name} » existe déjà dans cette routine.`;
}

export const lastDoneText = (s: PlanSeance) => (s.lastDone ? `faite le ${fmtDate(s.lastDone)}` : 'jamais faite');

export function lastDoneOfRoutine(r: PlanRoutine): string | null {
  const dates = r.seances.map((s) => s.lastDone).filter((d): d is string => d !== null).sort();
  return dates[dates.length - 1] ?? null;
}

export function routineMeta(r: PlanRoutine): string {
  const active = r.seances.filter((s) => !s.archived);
  const n = `${active.length} séance${active.length > 1 ? 's' : ''}`;
  const last = lastDoneOfRoutine(r);
  return `${n} · ${last ? `dernière séance le ${fmtDate(last)}` : 'jamais faite'}`;
}
