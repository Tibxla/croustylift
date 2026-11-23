// PROTOTYPE JETABLE · socle E, données et dérivations de la surface Analyse.
//
// UNE SEULE SOURCE : le journal des Exécutions (séries réellement loggées,
// durée, BPM). Tout le reste en est dérivé à la lecture, rien n'est stocké :
//   - le point e1RM d'un exo un jour = e1RM de sa 1ʳᵉ série (comparabilité) ;
//   - une courbe par séance (jamais deux contextes de fatigue dans une courbe) ;
//   - la pente = moindres carrés sur les points d'une courbe, en %/semaine,
//     rapportée à la moyenne ; sous 3 points, pas de pente (null, jamais 0) ;
//   - le Record = meilleur e1RM sur TOUTES les séries, tous jours confondus ;
//   - les blocs = périodes où la configuration du plan n'a pas bougé.
// Un exo passé un jour n'a pas de point ce jour-là : un trou n'est jamais un zéro.
//
// La dernière Upper A (17 nov.) reprend à l'identique les séries de Référence
// de ../fixtures.ts, que la Salle affiche. L'Exécution en cours (état du shell)
// s'ajoute au journal dès sa première série, comme dans l'app réelle.
//
// L'état modifiable (corrections, suppressions, onglet courant) vit dans un
// petit store de module : la surface est démontée quand on change de surface,
// et `Pages` remonte chaque page à neuf.
import { useSyncExternalStore } from 'react';
import { session } from '../fixtures';
import { catalogById, routines, type Prescription } from './fixtures-e';
import { setE1rm, type SetValue } from './format';
import type { SeanceState } from './seance';

/* ------------------------------------------------------------------------ */
/* Types                                                                      */
/* ------------------------------------------------------------------------ */

export interface ExoLog {
  exerciseId: string;
  sets: SetValue[];
}

export interface Execution {
  id: string;
  date: string;
  seanceId: string;
  /** Durée chronométrée en minutes. */
  durationMin: number;
  /** BPM moyen, saisi à la Clôture : optionnel. null = non saisi, jamais 0. */
  bpm: number | null;
  exercises: ExoLog[];
  /** Exécution en cours en salle (vient du shell), pas encore close. */
  live?: boolean;
}

export interface Block {
  id: string;
  routineId: string;
  start: string;
  /** null : bloc en cours. */
  end: string | null;
  /** Ce qui l'a ouvert, en clair. */
  cause: string;
}

/* ------------------------------------------------------------------------ */
/* Plan : séances et routines                                                 */
/* ------------------------------------------------------------------------ */

export interface SeanceInfo {
  id: string;
  name: string;
  routineId: string;
  routineName: string;
  items: Prescription[];
  archivedRoutine: boolean;
}

export const SEANCES: SeanceInfo[] = routines.flatMap((r) =>
  r.seances.map((s) => ({ id: s.id, name: s.name, routineId: r.id, routineName: r.name, items: s.items, archivedRoutine: !!r.archived })),
);

export function seanceInfo(id: string): SeanceInfo {
  return SEANCES.find((s) => s.id === id)!;
}

export const CURRENT_ROUTINE = routines.find((r) => r.current)!;

export function exoName(id: string): string {
  return catalogById(id)?.name ?? id;
}

export function prescriptionOf(seanceId: string, exerciseId: string): Prescription | undefined {
  return seanceInfo(seanceId).items.find((i) => i.exerciseId === exerciseId);
}

/* ------------------------------------------------------------------------ */
/* Journal fabriqué                                                           */
/* ------------------------------------------------------------------------ */

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekly(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i * 7));
}

/** « 80x8@1 » → série. */
function parse(s: string): SetValue {
  const m = /^([\d.]+)x(\d+)@(\d)$/.exec(s)!;
  return { weightKg: Number(m[1]), reps: Number(m[2]), rir: Number(m[3]) };
}

/** Séries d'un exo un jour : la 1ʳᵉ donnée, les suivantes à la même charge,
 *  une rep de moins à chaque fois (fatigue), RIR inchangé. */
function sets(first: string, n: number): SetValue[] {
  const s = parse(first);
  return Array.from({ length: n }, (_, k) => ({ ...s, reps: Math.max(1, s.reps - k) }));
}

/** Spécification compacte d'une séance répétée : pour chaque exo, la 1ʳᵉ série
 *  de chaque occurrence (« - » = exo passé ce jour-là, aucun point). */
interface Spec {
  seanceId: string;
  dates: string[];
  exos: { id: string; n: number; firsts: string[] }[];
  /** Occurrences sautées (vacances, semaine manquée) : pas d'exécution. */
  missing?: string[];
}

const FULL_A_DATES = weekly('2026-07-07', 11);
const UPPER_A_DATES = weekly('2026-09-22', 9);
const LOWER_A_DATES = weekly('2026-09-24', 9);
const UPPER_B_DATES = weekly('2026-09-25', 9);

const SPECS: Spec[] = [
  {
    seanceId: 'fb-a',
    dates: FULL_A_DATES,
    missing: ['2026-08-11', '2026-08-18'],
    exos: [
      // Squat : monte vite (double progression 6 → 8 reps, puis +5 kg).
      { id: 'squat', n: 3, firsts: ['90x6@2', '90x7@2', '90x8@2', '95x6@2', '95x7@2', '', '', '95x8@2', '100x6@2', '100x7@2', '100x8@2'] },
      { id: 'bench', n: 3, firsts: ['70x6@2', '70x7@2', '70x7@2', '72.5x6@2', '72.5x7@2', '', '', '72.5x7@2', '72.5x8@2', '75x6@2', '75x7@2'] },
      // Tirage horizontal : recule tout l'été.
      { id: 'row', n: 3, firsts: ['67.5x10@2', '67.5x10@2', '67.5x9@2', '67.5x9@2', '65x10@2', '', '', '65x9@2', '65x9@2', '65x8@2', '62.5x9@2'] },
    ],
  },
  {
    seanceId: 'upper-a',
    dates: UPPER_A_DATES,
    exos: [
      { id: 'bench', n: 3, firsts: ['72.5x9@2', '72.5x10@2', '75x8@2', '75x9@1', '75x9@2', '77.5x8@2', '77.5x9@1', '77.5x10@1', '80x8@1'] },
      // Stable sur l'automne, en légère baisse depuis le 20 oct.
      { id: 'row', n: 3, firsts: ['70x11@2', '70x12@2', '72.5x11@1', '72.5x11@2', '72.5x12@2', '72.5x11@2', '72.5x10@2', '70x12@2', '70x12@2'] },
      // Militaire : recule (passé le 27 oct., machine prise : trou, pas de zéro).
      { id: 'ohp', n: 3, firsts: ['52.5x8@2', '52.5x8@2', '52.5x7@2', '52.5x7@2', '50x8@2', '-', '50x7@2', '50x7@2', '50x7@2'] },
      { id: 'curl', n: 3, firsts: ['12x12@1', '12x13@1', '12x14@1', '12x15@1', '14x10@1', '14x11@1', '14x11@1', '14x12@1', '14x12@1'] },
      // Dips : au plan, jamais faits. Aucun point.
    ],
  },
  {
    seanceId: 'lower-a',
    dates: LOWER_A_DATES,
    missing: ['2026-10-22'],
    exos: [
      { id: 'squat', n: 4, firsts: ['100x6@2', '100x7@2', '100x7@1', '100x8@1', '', '102.5x7@1', '102.5x7@1', '105x6@1', '105x7@1'] },
      { id: 'rdl', n: 3, firsts: ['90x8@2', '90x9@2', '90x10@2', '92.5x8@2', '', '92.5x9@2', '92.5x10@1', '95x8@2', '95x9@2'] },
      // Leg curl : machine prise presque chaque fois, 2 points seulement.
      { id: 'legcurl', n: 3, firsts: ['-', '-', '-', '-', '', '-', '-', '45x11@1', '45x12@1'] },
      { id: 'calf', n: 3, firsts: ['80x12@1', '80x13@1', '80x12@1', '80x12@0', '', '80x13@1', '80x12@1', '80x12@1', '80x13@0'] },
    ],
  },
  {
    seanceId: 'upper-b',
    dates: UPPER_B_DATES,
    exos: [
      { id: 'incline-db', n: 3, firsts: ['26x9@2', '26x10@2', '26x11@2', '28x9@2', '28x10@2', '28x10@1', '28x11@1', '30x9@2', '30x10@2'] },
      { id: 'pullup', n: 3, firsts: ['10x6@2', '10x7@2', '10x7@2', '10x8@2', '10x8@1', '12.5x6@2', '12.5x6@2', '12.5x7@2', '12.5x7@2'] },
      { id: 'lateral', n: 4, firsts: ['10x15@1', '10x15@1', '10x16@1', '10x14@1', '10x15@1', '10x16@0', '10x15@1', '10x15@1', '10x15@1'] },
      { id: 'pushdown', n: 3, firsts: ['30x12@1', '30x13@1', '32.5x11@1', '32.5x12@1', '32.5x13@1', '35x11@1', '35x12@1', '35x12@1', '35x13@1'] },
      // Curl marteau : recule depuis qu'il passe en fin de séance.
      { id: 'hammer', n: 2, firsts: ['16x12@1', '16x12@1', '16x11@1', '16x11@1', '16x10@1', '14x12@1', '14x11@1', '14x11@1', '14x10@1'] },
    ],
  },
];

/** Durée et BPM fabriqués, stables d'un rendu à l'autre. BPM absent sur la
 *  plupart de l'été (pas de montre) et une fois sur cinq ensuite. */
function metricsFor(date: string, i: number, seanceId: string): { durationMin: number; bpm: number | null } {
  const n = Number(date.slice(8, 10)) + i * 7;
  const durationMin = 50 + (n % 23) + (seanceId.startsWith('lower') ? 6 : 0);
  const noWatch = date < '2026-08-25' || n % 5 === 0;
  return { durationMin, bpm: noWatch ? null : 118 + ((n * 7) % 24) };
}

export function buildBase(): Execution[] {
  const out: Execution[] = [];
  for (const spec of SPECS) {
    spec.dates.forEach((date, i) => {
      if (spec.missing?.includes(date)) return;
      const exercises: ExoLog[] = [];
      for (const ex of spec.exos) {
        const first = ex.firsts[i];
        if (!first || first === '-') continue;
        exercises.push({ exerciseId: ex.id, sets: sets(first, ex.n) });
      }
      // 17 nov. : les séries de Référence que la Salle affiche, à l'identique.
      if (spec.seanceId === 'upper-a' && date === '2026-11-17') {
        for (const e of session.exercises) {
          const log = exercises.find((x) => x.exerciseId === e.id);
          if (log && e.reference) log.sets = e.reference.sets.map((s) => ({ ...s }));
        }
      }
      if (exercises.length === 0) return;
      out.push({ id: `${spec.seanceId}-${date}`, date, seanceId: spec.seanceId, ...metricsFor(date, i, spec.seanceId), exercises });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const BLOCKS: Block[] = [
  { id: 'b-ete', routineId: 'full-body-ete', start: '2026-07-07', end: '2026-09-15', cause: 'Full body été devient la routine courante' },
  { id: 'b-ppl-1', routineId: 'ppl-automne', start: '2026-09-22', end: '2026-10-19', cause: 'PPL automne devient la routine courante' },
  { id: 'b-ppl-2', routineId: 'ppl-automne', start: '2026-10-20', end: null, cause: 'Upper A modifiée le 20 oct.' },
];

export function blockOf(date: string): Block | undefined {
  return BLOCKS.find((b) => date >= b.start && (b.end === null || date <= b.end));
}

export function routineName(id: string): string {
  return routines.find((r) => r.id === id)?.name ?? id;
}

/* ------------------------------------------------------------------------ */
/* Store                                                                      */
/* ------------------------------------------------------------------------ */

export type AnalyseTab = 'exos' | 'blocs' | 'journal';

interface StoreState {
  base: Execution[];
  tab: AnalyseTab;
  /** Dernier geste du journal, dit une fois en haut de la liste. */
  notice: string | null;
  /** Démo de l'état vide : `?analyse=vide` dans l'URL. */
  empty: boolean;
  /** Paire comparée dans l'onglet Blocs. */
  pair: [string, string];
}

let state: StoreState = {
  base: buildBase(),
  tab: 'exos',
  notice: null,
  empty: typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('analyse') === 'vide',
  pair: ['b-ete', 'b-ppl-2'],
};
const listeners = new Set<() => void>();

function set(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useAnalyseStore(): StoreState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const store = {
  setTab: (tab: AnalyseTab) => set({ tab, notice: null }),
  setPair: (pair: [string, string]) => set({ pair }),
  setNotice: (notice: string | null) => set({ notice }),
  setEmpty: (empty: boolean) => set({ empty }),
  /** Corrige une série d'une exécution passée. */
  updateSet: (execId: string, exerciseId: string, rank: number, v: SetValue) =>
    set({
      base: state.base.map((e) =>
        e.id !== execId
          ? e
          : { ...e, exercises: e.exercises.map((x) => (x.exerciseId !== exerciseId ? x : { ...x, sets: x.sets.map((s, k) => (k === rank - 1 ? v : s)) })) },
      ),
    }),
  /** Retire une série ; un exo sans série quitte l'exécution, une exécution
   *  sans série quitte le journal (elle n'existe que par ses séries). */
  removeSet: (execId: string, exerciseId: string, rank: number) =>
    set({
      base: state.base
        .map((e) =>
          e.id !== execId
            ? e
            : {
                ...e,
                exercises: e.exercises
                  .map((x) => (x.exerciseId !== exerciseId ? x : { ...x, sets: x.sets.filter((_, k) => k !== rank - 1) }))
                  .filter((x) => x.sets.length > 0),
              },
        )
        .filter((e) => e.exercises.length > 0),
    }),
  updateMetrics: (execId: string, durationMin: number, bpm: number | null) =>
    set({ base: state.base.map((e) => (e.id === execId ? { ...e, durationMin, bpm } : e)) }),
  /** Suppression définitive (ADR 0008) : la séance quitte journal, courbes et records. */
  removeExecution: (execId: string, notice: string) => set({ base: state.base.filter((e) => e.id !== execId), notice }),
};

/** Le journal complet : base + Exécution en cours du shell si elle a des séries. */
export function journalOf(base: Execution[], live: SeanceState, empty: boolean): Execution[] {
  if (empty) return [];
  const exercises: ExoLog[] = live.exercises
    .map((e) => ({ exerciseId: e.id, sets: live.logged[e.id] ?? [] }))
    .filter((x) => x.sets.length > 0);
  if (exercises.length === 0) return base;
  const seance = SEANCES.find((s) => s.name === live.seanceName && s.routineId === CURRENT_ROUTINE.id);
  if (!seance) return base;
  const liveExec: Execution = {
    id: `live-${live.dateIso}-${seance.id}`,
    date: live.dateIso,
    seanceId: seance.id,
    durationMin: live.elapsedMin,
    bpm: null,
    exercises,
    live: live.phase === 'en-cours',
  };
  return [...base, liveExec].sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------------ */
/* Dérivations                                                                */
/* ------------------------------------------------------------------------ */

export interface Point {
  date: string;
  e1rm: number;
  execId: string;
}

export interface Curve {
  seanceId: string;
  points: Point[];
  /** %/semaine, null sous MIN_POINTS. */
  slope: number | null;
}

export const MIN_POINTS = 3;

const DAY = 86_400_000;
const t = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/** Pente en %/semaine par moindres carrés, rapportée à la moyenne. */
export function slopeOf(points: { date: string; e1rm: number }[]): number | null {
  if (points.length < MIN_POINTS) return null;
  const xs = points.map((p) => (t(p.date) - t(points[0]!.date)) / DAY);
  const ys = points.map((p) => p.e1rm);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    den += (x - mx) ** 2;
  });
  if (den === 0) return null;
  return Math.round(((num / den) * 7 * 100 * 10) / my) / 10;
}

/** Courbes d'un exo, une par séance, la plus récemment exécutée en premier. */
export function curvesOf(journal: Execution[], exerciseId: string, filter?: (e: Execution) => boolean): Curve[] {
  const by = new Map<string, Point[]>();
  for (const e of journal) {
    if (filter && !filter(e)) continue;
    const log = e.exercises.find((x) => x.exerciseId === exerciseId);
    const first = log?.sets[0];
    if (!first) continue;
    const pts = by.get(e.seanceId) ?? [];
    pts.push({ date: e.date, e1rm: setE1rm(first), execId: e.id });
    by.set(e.seanceId, pts);
  }
  return [...by.entries()]
    .map(([seanceId, points]) => ({ seanceId, points, slope: slopeOf(points) }))
    .sort((a, b) => b.points[b.points.length - 1]!.date.localeCompare(a.points[a.points.length - 1]!.date));
}

export interface RecordFact {
  e1rm: number;
  set: SetValue;
  date: string;
  seanceId: string;
}

/** Record personnel : meilleur e1RM sur toutes les séries, et la charge la plus
 *  lourde (reps en départage). */
export function recordsOf(journal: Execution[], exerciseId: string): { best: RecordFact; heaviest: RecordFact } | null {
  let best: RecordFact | null = null;
  let heaviest: RecordFact | null = null;
  for (const e of journal) {
    for (const s of e.exercises.find((x) => x.exerciseId === exerciseId)?.sets ?? []) {
      const f = { e1rm: setE1rm(s), set: s, date: e.date, seanceId: e.seanceId };
      if (!best || f.e1rm > best.e1rm) best = f;
      if (!heaviest || s.weightKg > heaviest.set.weightKg || (s.weightKg === heaviest.set.weightKg && s.reps > heaviest.set.reps)) heaviest = f;
    }
  }
  return best && heaviest ? { best, heaviest } : null;
}

/** kg soulevés : Σ poids × reps. */
export function liftedKg(sets: SetValue[]): number {
  return sets.reduce((n, s) => n + s.weightKg * s.reps, 0);
}

/** Exos de la routine courante, dans l'ordre du plan, séance par séance. */
export function currentPlan(): { seance: SeanceInfo; exerciseIds: string[] }[] {
  return CURRENT_ROUTINE.seances
    .filter((s) => !s.archived)
    .map((s) => ({ seance: seanceInfo(s.id), exerciseIds: s.items.map((i) => i.exerciseId) }));
}

/** Pente d'un exo dans un bloc : sa courbe dans la séance de la routine du
 *  bloc où il revient le plus (une seule séance, jamais un mélange). */
export function blockCurve(journal: Execution[], exerciseId: string, block: Block): Curve | null {
  const inBlock = (e: Execution) => blockOf(e.date)?.id === block.id;
  const curves = curvesOf(journal, exerciseId, inBlock);
  if (curves.length === 0) return null;
  return [...curves].sort((a, b) => b.points.length - a.points.length)[0]!;
}

export function blockExecutions(journal: Execution[], block: Block): Execution[] {
  return journal.filter((e) => blockOf(e.date)?.id === block.id);
}
