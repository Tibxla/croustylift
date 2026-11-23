// PROTOTYPE JETABLE · socle E. État de l'Exécution en cours, tenu par le shell
// (il survit aux changements de surface). Lu partout par `useProto().seance`.
//
//   seance.state       exos, séries loggées, brouillons, exo affiché, phase
//   seance.log()       logge le brouillon de l'exo affiché
//   seance.undo()      retire la dernière série de l'exo affiché
//   seance.setIdx(i)   affiche l'exo i dans l'instrument
//   seance.add(id) / replace(exId, id) / skip(exId)   Déviations en salle
//   seance.start(seanceId) / close()                   début, Clôture
//   seance.setSide(exId, côté)                         unilatéral : côté saisi
//   seance.setNote(exId, texte)                        Note datée du jour (par exo)
//   seance.cancel()                                    « Annuler la séance » : rien au journal
//   seance.setStale(on) / resume()                     séance d'hier non rangée (commande du prototype)
//
// DÉCOMPTE (CONTEXT.md « Décompte de séries ») : une série unilatérale complète
// compte 2 au TOTAL de la séance (`totalSets`) et 1 par muscle (côté faible, via
// `logged`). Une ligne d'exo garde une série par paire (`exoSummary`).
//
// UNILATÉRAL (ADR 0005, ADR 0010, CONTEXT.md « Unilatéral »). Une série = deux
// côtés, chacun avec ses valeurs, tenus dans `uni` (paires au même rang). Le
// côté se choisit à la saisie, sans ordre imposé. Une série est complète quand
// les deux côtés sont saisis ; un seul côté = série ENTAMÉE, jamais un côté
// fabriqué. `logged` reste l'ENTONNOIR unique pour tout l'aval (Sommaire,
// jauges, fin de séance, journal) : pour un exo unilatéral il ne contient que
// les séries complètes, au côté faible (la convention de l'analyse). La Salle,
// elle, lit les côtés dans `uni` (Référence et Record par côté).
import { useMemo, useReducer } from 'react';
import type { ExercisePlan } from '../fixtures';
import { session as fixtureSession } from '../fixtures';
import { catalogById, LAST_DATED_NOTES, planFromCatalog, routines, UNI_HISTORY, weakOf, type Side } from './fixtures-e';
import { isUnilateral } from './fixtures-exercices';
import { refAt, setE1rm, type SetValue } from './format';

export type { Side };
export const SIDE_WORD: Record<Side, string> = { G: 'gauche', D: 'droite' };
export const otherSide = (s: Side): Side => (s === 'G' ? 'D' : 'G');

/** Une série unilatérale : un côté par case, `first` = côté saisi en premier. */
export interface UniSet {
  G: SetValue | null;
  D: SetValue | null;
  first: Side;
}

/** Brouillon de la prochaine série, en kg (le pas de la règle est un réglage). */
export interface Draft {
  weightKg: number;
  reps: number;
  rir: number;
}

export interface SeanceState {
  /** `aucune` : pas de séance en cours (avant le choix, après la Clôture). */
  phase: 'en-cours' | 'aucune';
  routineName: string;
  /** Séance (template) exécutée : la Référence par côté en dépend. */
  seanceId: string;
  seanceName: string;
  dateIso: string;
  startedAt: string;
  elapsedMin: number;
  exercises: ExercisePlan[];
  /** Séries complètes. Unilatéral : côté faible de chaque paire complète. */
  logged: Record<string, SetValue[]>;
  /** Unilatéral seulement : les paires, complètes puis l'éventuelle entamée. */
  uni: Record<string, UniSet[]>;
  /** Unilatéral : côté en cours de saisie, par exo. */
  side: Record<string, Side>;
  /** Exos unilatéraux de la séance (drapeau figé à l'entrée de l'exo). */
  uniFlag: Record<string, boolean>;
  skipped: Record<string, boolean>;
  /** Exo affiché dans l'instrument. */
  idx: number;
  drafts: Record<string, Draft>;
  /** Exo de la dernière série loggée (pour « Annuler »), null sinon. */
  lastLog: string | null;
  /** Note datée du jour, par exo (texte libre, clavier autorisé). */
  notes: Record<string, string>;
  /** Déviations au plan : exo ajouté en salle, ou remplaçant (nom de l'exo remplacé). */
  origin: Record<string, { kind: 'ajouté' } | { kind: 'remplacé'; from: string }>;
  /** Séance commencée la veille et jamais rangée (frontière minuit), pas encore
   *  reprise : la Salle demande d'abord quoi en faire. */
  stale: boolean;
}

export type Progress = 'todo' | 'partial' | 'done' | 'skipped';

/** Unilatéral : drapeau FIGÉ à l'entrée de l'exo dans la séance (début,
 *  ajout, remplacement). Basculer le réglage dans la fiche en pleine séance ne
 *  ré-interprète pas les séries déjà loggées ; il vaut à la prochaine séance. */
export const isUni = (state: SeanceState, ex: ExercisePlan): boolean => !!state.uniFlag[ex.id];
const flagsOf = (exs: ExercisePlan[]): Record<string, boolean> => Object.fromEntries(exs.map((e) => [e.id, isUnilateral(e.id)]));

/** Série unilatérale entamée (un seul côté saisi), ou null. */
export function openSet(state: SeanceState, ex: ExercisePlan): UniSet | null {
  const pairs = state.uni[ex.id] ?? [];
  const last = pairs[pairs.length - 1];
  return last && (!last.G || !last.D) ? last : null;
}

/** Côté en cours : celui qui manque à la série entamée, sinon le côté choisi. */
export function activeSide(state: SeanceState, ex: ExercisePlan): Side {
  const open = openSet(state, ex);
  if (open) return open.G ? 'D' : 'G';
  return state.side[ex.id] ?? 'G';
}

/** Référence par (position, côté) : la dernière fois dans CETTE séance. */
export function sideRef(state: SeanceState, ex: ExercisePlan, rank: number, side: Side): SetValue | null {
  const r = UNI_HISTORY[ex.id]?.ref;
  if (!r || r.seanceId !== state.seanceId) return null;
  return r.sets[rank - 1]?.[side] ?? null;
}

export function sideRefDate(state: SeanceState, ex: ExercisePlan): string | null {
  const r = UNI_HISTORY[ex.id]?.ref;
  return r && r.seanceId === state.seanceId ? r.date : null;
}

/** Record d'un côté (tous jours) : e1RM, ou 0. */
export function sidePr(ex: ExercisePlan, side: Side): { e1rm: number; date: string } | null {
  return UNI_HISTORY[ex.id]?.pr?.[side] ?? null;
}

/** Fait = minimum de séries du plan atteint (règle de l'app réelle). Une série
 *  unilatérale entamée rend l'exo « en cours », jamais « fait ». */
export function progressOf(state: SeanceState, ex: ExercisePlan): Progress {
  const n = (state.logged[ex.id] ?? []).length;
  if (n === 0 && !openSet(state, ex)) return state.skipped[ex.id] ? 'skipped' : 'todo';
  return n >= ex.sets[0] ? 'done' : 'partial';
}

/** Prochain exo ni fait ni passé, dans l'ordre, après l'exo affiché puis depuis
 *  le début. null : il ne reste rien, l'action devient « Terminer la séance ». */
export function nextIndex(state: SeanceState): number | null {
  const n = state.exercises.length;
  for (let k = 1; k < n; k++) {
    const i = (state.idx + k) % n;
    const p = progressOf(state, state.exercises[i]!);
    if (p === 'todo' || p === 'partial') return i;
  }
  return null;
}

export function seedDraft(ex: ExercisePlan, logged: SetValue[]): Draft {
  const rank = logged.length + 1;
  const ref = refAt(ex, rank);
  const prev = logged[logged.length - 1];
  const base = prev ?? ref ?? ex.reference?.sets[0] ?? null;
  return {
    weightKg: prev?.weightKg ?? base?.weightKg ?? 20,
    reps: ref?.reps ?? base?.reps ?? ex.reps[0],
    rir: ref?.rir ?? base?.rir ?? ex.rir[1],
  };
}

/** Unilatéral : brouillon amorcé par (rang, côté). Poids du même côté à la
 *  série précédente, reps et RIR de la Référence de ce côté. */
function seedSideDraft(state: SeanceState, ex: ExercisePlan, side: Side): Draft {
  const done = (state.uni[ex.id] ?? []).filter((p) => p.G && p.D);
  const rank = done.length + 1;
  const ref = sideRef(state, ex, rank, side);
  const prev = done[done.length - 1]?.[side] ?? null;
  const base = prev ?? ref ?? sideRef(state, ex, 1, side);
  return {
    weightKg: prev?.weightKg ?? base?.weightKg ?? 20,
    reps: ref?.reps ?? base?.reps ?? ex.reps[0],
    rir: ref?.rir ?? base?.rir ?? ex.rir[1],
  };
}

export function draftOf(state: SeanceState, ex: ExercisePlan): Draft {
  if (state.drafts[ex.id]) return state.drafts[ex.id]!;
  return isUni(state, ex) ? seedSideDraft(state, ex, activeSide(state, ex)) : seedDraft(ex, state.logged[ex.id] ?? []);
}

const completes = (pairs: UniSet[]): SetValue[] =>
  pairs.filter((p) => p.G && p.D).map((p) => ({ ...weakOf({ G: p.G!, D: p.D! }) }));

/** Exo unilatéral habillé : sa Référence « au côté faible » pour l'aval
 *  (fin de séance), son Record au côté faible. La Salle lit les côtés à part. */
function withUni(ex: ExercisePlan, seanceId: string): ExercisePlan {
  if (!isUnilateral(ex.id)) return ex;
  const h = UNI_HISTORY[ex.id];
  if (!h) return ex;
  const ref = h.ref && h.ref.seanceId === seanceId ? { date: h.ref.date, sets: h.ref.sets.map((p) => ({ ...weakOf(p) })) } : null;
  const weakPr = h.pr ? (h.pr.G.e1rm < h.pr.D.e1rm ? h.pr.G : h.pr.D) : null;
  return { ...ex, reference: ref ?? ex.reference, pr: weakPr ?? ex.pr };
}

/** Total de séries de l'Exécution : une série unilatérale complète compte 2
 *  (les deux côtés), une bilatérale 1. Le décompte par muscle, lui, lit `logged`
 *  (une par paire, côté faible). */
export function totalSets(state: SeanceState): number {
  return state.exercises.reduce((n, ex) => n + (state.logged[ex.id] ?? []).length * (isUni(state, ex) ? 2 : 1), 0);
}

/** Bilan d'un exo, partagé par le Sommaire, la Salle (bilan de fin d'exo) et la
 *  fin de séance : séries complètes, battues et égalées contre la Référence au
 *  même rang, record personnel. Unilatéral : au côté faible (pas de récap par côté). */
export interface ExoSummary {
  sets: number;
  beaten: number;
  matched: number;
  /** e1RM du record battu aujourd'hui, null sinon. */
  record: number | null;
}

export function exoSummary(state: SeanceState, ex: ExercisePlan): ExoSummary {
  const logged = state.logged[ex.id] ?? [];
  let beaten = 0;
  let matched = 0;
  logged.forEach((s, k) => {
    const r = refAt(ex, k + 1);
    if (r && setE1rm(s) > setE1rm(r)) beaten++;
    else if (r && setE1rm(s) === setE1rm(r)) matched++;
  });
  const best = Math.max(0, ...logged.map(setE1rm));
  const pr = ex.pr;
  const record = pr && best > 0 && (best > pr.e1rm || (pr.date === state.dateIso && best >= pr.e1rm)) ? best : null;
  return { sets: logged.length, beaten, matched, record };
}

/** Saisies de l'Exécution (une par série bilatérale, une par côté en unilatéral) :
 *  ce qu'« Annuler la séance » retire de la file d'envoi. */
export function entryCount(state: SeanceState): number {
  return state.exercises.reduce((n, ex) => {
    if (!isUni(state, ex)) return n + (state.logged[ex.id] ?? []).length;
    return n + (state.uni[ex.id] ?? []).reduce((m, p) => m + (p.G ? 1 : 0) + (p.D ? 1 : 0), 0);
  }, 0);
}

/** Repère « tu notais » : la note datée de la dernière exécution de CETTE séance. */
export function lastDatedNote(state: SeanceState, exId: string): { date: string; body: string } | null {
  return LAST_DATED_NOTES[state.seanceId]?.[exId] ?? null;
}

function initial(): SeanceState {
  const s = fixtureSession;
  return {
    phase: 'en-cours',
    routineName: s.routineName,
    seanceId: 'upper-a',
    seanceName: s.seanceName,
    dateIso: s.dateIso,
    startedAt: s.startedAt,
    elapsedMin: s.elapsedMin,
    exercises: s.exercises,
    logged: Object.fromEntries(s.exercises.map((e) => [e.id, e.loggedToday.map(({ weightKg, reps, rir }) => ({ weightKg, reps, rir }))])),
    uni: {},
    side: {},
    uniFlag: flagsOf(s.exercises),
    skipped: Object.fromEntries(s.exercises.filter((e) => e.status === 'skipped').map((e) => [e.id, true])),
    idx: Math.max(0, s.exercises.findIndex((e) => e.status === 'in-progress')),
    drafts: {},
    lastLog: null,
    notes: {},
    origin: {},
    stale: false,
  };
}

type Action =
  | { type: 'idx'; i: number }
  | { type: 'draft'; id: string; d: Draft }
  | { type: 'side'; id: string; side: Side }
  | { type: 'log' }
  | { type: 'undo' }
  | { type: 'skip'; id: string }
  | { type: 'add'; catalogId: string }
  | { type: 'replace'; id: string; catalogId: string }
  | { type: 'start'; seanceId: string }
  | { type: 'close' }
  | { type: 'cancel' }
  | { type: 'note'; id: string; body: string }
  | { type: 'stale'; on: boolean }
  | { type: 'resume' };

function reducer(state: SeanceState, a: Action): SeanceState {
  switch (a.type) {
    case 'idx':
      return { ...state, idx: Math.min(state.exercises.length - 1, Math.max(0, a.i)), lastLog: null };
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [a.id]: a.d } };
    case 'side': {
      const ex = state.exercises.find((e) => e.id === a.id);
      // Le côté déjà saisi de la série entamée ne se resaisit pas.
      if (!ex || openSet(state, ex)) return state;
      return { ...state, side: { ...state.side, [a.id]: a.side } };
    }
    case 'log': {
      const ex = state.exercises[state.idx]!;
      if (isUni(state, ex)) {
        const pairs = state.uni[ex.id] ?? [];
        const side = activeSide(state, ex);
        const d = draftOf(state, ex);
        const open = openSet(state, ex);
        const nextPairs = open
          ? [...pairs.slice(0, -1), { ...open, [side]: { ...d } }]
          : [...pairs, { G: null, D: null, first: side, [side]: { ...d } } as UniSet];
        const last = nextPairs[nextPairs.length - 1]!;
        const complete = !!(last.G && last.D);
        const st: SeanceState = {
          ...state,
          uni: { ...state.uni, [ex.id]: nextPairs },
          logged: { ...state.logged, [ex.id]: completes(nextPairs) },
          skipped: { ...state.skipped, [ex.id]: false },
          // Série entamée : l'autre côté, mêmes valeurs (le cas le plus fréquent).
          // Série complète : on repart du côté qui l'a ouverte.
          side: { ...state.side, [ex.id]: complete ? last.first : otherSide(side) },
          lastLog: ex.id,
        };
        const drafts = { ...state.drafts };
        if (complete) delete drafts[ex.id];
        else drafts[ex.id] = { ...d };
        return { ...st, drafts };
      }
      const sets = state.logged[ex.id] ?? [];
      const d = draftOf(state, ex);
      const next = [...sets, { ...d }];
      const ref = refAt(ex, next.length + 1);
      return {
        ...state,
        logged: { ...state.logged, [ex.id]: next },
        skipped: { ...state.skipped, [ex.id]: false },
        drafts: { ...state.drafts, [ex.id]: { weightKg: d.weightKg, reps: ref?.reps ?? d.reps, rir: ref?.rir ?? d.rir } },
        lastLog: ex.id,
      };
    }
    case 'undo': {
      const ex = state.exercises[state.idx]!;
      if (isUni(state, ex)) {
        const pairs = state.uni[ex.id] ?? [];
        const last = pairs[pairs.length - 1];
        if (!last) return state;
        // Le dernier côté saisi : le second d'une paire complète, sinon le seul.
        const side: Side = last.G && last.D ? otherSide(last.first) : last.G ? 'G' : 'D';
        const popped = last[side]!;
        const rest = last.G && last.D ? [...pairs.slice(0, -1), { ...last, [side]: null }] : pairs.slice(0, -1);
        return {
          ...state,
          uni: { ...state.uni, [ex.id]: rest },
          logged: { ...state.logged, [ex.id]: completes(rest) },
          side: { ...state.side, [ex.id]: side },
          drafts: { ...state.drafts, [ex.id]: { ...popped } },
          lastLog: null,
        };
      }
      const sets = state.logged[ex.id] ?? [];
      const popped = sets[sets.length - 1];
      if (!popped) return state;
      return {
        ...state,
        logged: { ...state.logged, [ex.id]: sets.slice(0, -1) },
        drafts: { ...state.drafts, [ex.id]: { ...popped } },
        lastLog: null,
      };
    }
    case 'skip':
      return { ...state, skipped: { ...state.skipped, [a.id]: !state.skipped[a.id] } };
    case 'add': {
      const c = catalogById(a.catalogId);
      if (!c || state.exercises.some((e) => e.id === c.id)) return state;
      return {
        ...state,
        exercises: [...state.exercises, withUni(planFromCatalog(c), state.seanceId)],
        uniFlag: { ...state.uniFlag, [c.id]: isUnilateral(c.id) },
        origin: { ...state.origin, [c.id]: { kind: 'ajouté' } },
      };
    }
    case 'replace': {
      const c = catalogById(a.catalogId);
      const old = state.exercises.find((e) => e.id === a.id);
      if (!c || !old || state.exercises.some((e) => e.id === c.id)) return state;
      // Le remplaçant garde la prescription de l'exo remplacé (Déviation « exo remplacé »).
      const plan = withUni(planFromCatalog(c, { sets: old.sets, reps: old.reps, rir: old.rir }), state.seanceId);
      return {
        ...state,
        exercises: state.exercises.map((e) => (e.id === a.id ? plan : e)),
        uniFlag: { ...state.uniFlag, [c.id]: isUnilateral(c.id) },
        // Remplacer un ajouté le laisse ajouté ; remplacer un remplaçant garde l'exo du plan.
        origin: {
          ...state.origin,
          [c.id]: state.origin[a.id]?.kind === 'ajouté' ? { kind: 'ajouté' } : { kind: 'remplacé', from: (state.origin[a.id] as { from?: string } | undefined)?.from ?? old.name },
        },
      };
    }
    case 'start': {
      const routine = routines.find((r) => r.seances.some((s) => s.id === a.seanceId));
      const tpl = routine?.seances.find((s) => s.id === a.seanceId);
      if (!routine || !tpl) return state;
      const exercises =
        tpl.id === 'upper-a'
          ? fixtureSession.exercises.map((e) => ({ ...e, status: 'todo' as const, loggedToday: [] }))
          : tpl.items.flatMap((it) => {
              const c = catalogById(it.exerciseId);
              return c ? [withUni(planFromCatalog(c, it), tpl.id)] : [];
            });
      return {
        phase: 'en-cours',
        routineName: routine.name,
        seanceId: tpl.id,
        seanceName: tpl.name,
        dateIso: '2026-11-23',
        startedAt: '18:05',
        elapsedMin: 0,
        exercises,
        logged: {},
        uni: {},
        side: {},
        uniFlag: flagsOf(exercises),
        skipped: {},
        idx: 0,
        drafts: {},
        lastLog: null,
        notes: {},
        origin: {},
        stale: false,
      };
    }
    case 'close':
      return { ...state, phase: 'aucune', lastLog: null, stale: false };
    case 'cancel':
      // Annulée, pas rangée : ni séries ni notes ne restent, rien n'entre au journal.
      return { ...state, phase: 'aucune', logged: {}, uni: {}, notes: {}, drafts: {}, lastLog: null, stale: false };
    case 'note':
      return { ...state, notes: { ...state.notes, [a.id]: a.body } };
    case 'stale':
      // Simule une séance commencée hier soir et jamais rangée : la séance du
      // prototype (6 séries, 22 nov., 18:42) revient en cours, à reprendre ou ranger.
      return a.on ? { ...initial(), stale: true } : { ...state, stale: false };
    case 'resume':
      return { ...state, stale: false };
  }
}

export interface SeanceStore {
  state: SeanceState;
  setIdx: (i: number) => void;
  setDraft: (id: string, d: Draft) => void;
  setSide: (id: string, side: Side) => void;
  log: () => void;
  undo: () => void;
  skip: (id: string) => void;
  add: (catalogId: string) => void;
  replace: (id: string, catalogId: string) => void;
  start: (seanceId: string) => void;
  /** Clôture : la séance rejoint le journal, la Salle revient au choix. */
  close: () => void;
  /** Annuler la séance (lancée par erreur) : tout part, rien au journal. */
  cancel: () => void;
  setNote: (id: string, body: string) => void;
  setStale: (on: boolean) => void;
  resume: () => void;
}

export function useSeanceStore(): SeanceStore {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  return useMemo(
    () => ({
      state,
      setIdx: (i) => dispatch({ type: 'idx', i }),
      setDraft: (id, d) => dispatch({ type: 'draft', id, d }),
      setSide: (id, side) => dispatch({ type: 'side', id, side }),
      log: () => dispatch({ type: 'log' }),
      undo: () => dispatch({ type: 'undo' }),
      skip: (id) => dispatch({ type: 'skip', id }),
      add: (catalogId) => dispatch({ type: 'add', catalogId }),
      replace: (id, catalogId) => dispatch({ type: 'replace', id, catalogId }),
      start: (seanceId) => dispatch({ type: 'start', seanceId }),
      close: () => dispatch({ type: 'close' }),
      cancel: () => dispatch({ type: 'cancel' }),
      setNote: (id, body) => dispatch({ type: 'note', id, body }),
      setStale: (on) => dispatch({ type: 'stale', on }),
      resume: () => dispatch({ type: 'resume' }),
    }),
    [state],
  );
}
