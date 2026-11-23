// PROTOTYPE JETABLE · socle E. Données fabriquées en plus de ../fixtures.ts :
// catalogue d'exercices (base + perso) et routines de l'utilisateur. Muscles
// dans le vocabulaire canonique de CONTEXT.md (15 muscles principaux).
import type { ExercisePlan } from '../fixtures';
import { e1rm, session } from '../fixtures';

export const MUSCLES = [
  'pectoraux', 'avant épaule', 'milieu épaule', 'arrière épaule', 'trapèzes',
  'dorsaux', 'biceps', 'triceps', 'brachioradial', 'abdominaux',
  'quadriceps', 'ischio-jambiers', 'adducteurs', 'fessiers', 'mollets',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export interface CatalogExercise {
  id: string;
  name: string;
  muscles: Muscle[];
  /** base = catalogue commun (lecture seule) ; perso = créé par l'utilisateur. */
  kind: 'base' | 'perso';
  unilateral?: boolean;
  /** Note d'instructions personnelle (persistante). */
  note?: string;
}

export const catalog: CatalogExercise[] = [
  { id: 'bench', name: 'Développé couché', muscles: ['pectoraux', 'triceps', 'avant épaule'], kind: 'base' },
  { id: 'incline-db', name: 'Développé incliné haltères', muscles: ['pectoraux', 'avant épaule'], kind: 'base' },
  { id: 'dips', name: 'Dips lestés', muscles: ['pectoraux', 'triceps'], kind: 'base' },
  { id: 'fly', name: 'Écarté poulie', muscles: ['pectoraux'], kind: 'base' },
  { id: 'row', name: 'Tirage horizontal', muscles: ['dorsaux', 'biceps'], kind: 'base' },
  { id: 'pulldown', name: 'Tirage vertical', muscles: ['dorsaux', 'biceps'], kind: 'base' },
  { id: 'pullup', name: 'Tractions lestées', muscles: ['dorsaux', 'biceps'], kind: 'base' },
  { id: 'db-row', name: 'Rowing haltère unilatéral', muscles: ['dorsaux'], kind: 'base', unilateral: true },
  { id: 'ohp', name: 'Développé militaire', muscles: ['avant épaule', 'triceps'], kind: 'base' },
  { id: 'lateral', name: 'Élévations latérales', muscles: ['milieu épaule'], kind: 'base' },
  { id: 'facepull', name: 'Face pull', muscles: ['arrière épaule', 'trapèzes'], kind: 'base' },
  { id: 'shrug', name: 'Shrug haltères', muscles: ['trapèzes'], kind: 'base' },
  { id: 'curl', name: 'Curl biceps haltères', muscles: ['biceps'], kind: 'base' },
  { id: 'hammer', name: 'Curl marteau', muscles: ['brachioradial', 'biceps'], kind: 'base' },
  { id: 'pushdown', name: 'Extension triceps poulie', muscles: ['triceps'], kind: 'base' },
  { id: 'skull', name: 'Barre au front', muscles: ['triceps'], kind: 'base' },
  { id: 'squat', name: 'Squat', muscles: ['quadriceps', 'fessiers', 'adducteurs'], kind: 'base' },
  { id: 'legpress', name: 'Presse à cuisses', muscles: ['quadriceps', 'fessiers'], kind: 'base' },
  { id: 'rdl', name: 'Soulevé de terre roumain', muscles: ['ischio-jambiers', 'fessiers'], kind: 'base' },
  { id: 'legcurl', name: 'Leg curl assis', muscles: ['ischio-jambiers'], kind: 'base' },
  { id: 'split', name: 'Fente bulgare', muscles: ['quadriceps', 'fessiers'], kind: 'base', unilateral: true },
  { id: 'calf', name: 'Mollets debout', muscles: ['mollets'], kind: 'base' },
  { id: 'crunch', name: 'Crunch poulie', muscles: ['abdominaux'], kind: 'base' },
  {
    id: 'hack-perso',
    name: 'Hack squat machine salle 2',
    muscles: ['quadriceps'],
    kind: 'perso',
    note: 'Dossier cran 3, pieds hauts sur la plateforme.',
  },
];

export function catalogById(id: string): CatalogExercise | undefined {
  return catalog.find((c) => c.id === id);
}

export interface Prescription {
  exerciseId: string;
  sets: [number, number];
  reps: [number, number];
  rir: [number, number];
}

export interface SeanceTemplate {
  id: string;
  name: string;
  /** Dernière exécution (ISO), null si jamais faite. */
  lastDone: string | null;
  archived?: boolean;
  items: Prescription[];
}

export interface Routine {
  id: string;
  name: string;
  current: boolean;
  archived?: boolean;
  seances: SeanceTemplate[];
}

const p = (exerciseId: string, sets: [number, number], reps: [number, number], rir: [number, number]): Prescription => ({
  exerciseId,
  sets,
  reps,
  rir,
});

export const routines: Routine[] = [
  {
    id: 'ppl-automne',
    name: 'PPL automne',
    current: true,
    seances: [
      {
        id: 'upper-a',
        name: 'Upper A',
        lastDone: '2026-11-17',
        items: session.exercises.map((e) => p(e.id, e.sets, e.reps, e.rir)),
      },
      {
        id: 'lower-a',
        name: 'Lower A',
        lastDone: '2026-11-19',
        items: [
          p('squat', [3, 4], [5, 8], [1, 2]),
          p('rdl', [3, 3], [8, 10], [1, 2]),
          p('legcurl', [3, 3], [10, 12], [0, 1]),
          p('calf', [3, 4], [10, 15], [0, 1]),
        ],
      },
      {
        id: 'upper-b',
        name: 'Upper B',
        lastDone: '2026-11-20',
        items: [
          p('incline-db', [3, 4], [8, 12], [1, 2]),
          p('pullup', [3, 4], [6, 10], [1, 2]),
          p('db-row', [3, 3], [8, 12], [1, 2]),
          p('lateral', [3, 4], [12, 20], [0, 1]),
          p('pushdown', [3, 3], [10, 15], [0, 1]),
          p('hammer', [2, 3], [10, 12], [0, 1]),
        ],
      },
      {
        id: 'lower-b',
        name: 'Lower B',
        lastDone: null,
        items: [p('legpress', [3, 4], [10, 15], [1, 2]), p('split', [3, 3], [8, 10], [1, 2]), p('crunch', [3, 3], [12, 15], [0, 1])],
      },
    ],
  },
  {
    id: 'full-body-ete',
    name: 'Full body été',
    current: false,
    archived: true,
    seances: [
      {
        id: 'fb-a',
        name: 'Full A',
        lastDone: '2026-09-15',
        items: [p('squat', [3, 3], [6, 8], [2, 2]), p('bench', [3, 3], [6, 8], [2, 2]), p('row', [3, 3], [8, 10], [2, 2])],
      },
    ],
  },
];

/** Exercice du catalogue habillé en ExercisePlan (sans Référence : jamais fait
 *  dans cette séance). Sert à « Ajouter » et « Remplacer » en salle. */
export function planFromCatalog(c: CatalogExercise, presc?: Omit<Prescription, 'exerciseId'>): ExercisePlan {
  return {
    id: c.id,
    name: c.name,
    muscles: c.muscles,
    sets: presc?.sets ?? [3, 3],
    reps: presc?.reps ?? [8, 12],
    rir: presc?.rir ?? [1, 2],
    status: 'todo',
    reference: null,
    pr: null,
    history: [],
    weeklyRatePct: null,
    loggedToday: [],
  };
}

/* ------------------------------------------------------------------------ */
/* Unilatéral : valeurs par côté (ADR 0005, ADR 0010)                         */
/* ------------------------------------------------------------------------ */

/** G = gauche, D = droite. */
export type Side = 'G' | 'D';
export interface SideValue {
  weightKg: number;
  reps: number;
  rir: number;
}
export type SidePair = Record<Side, SideValue>;

/** Par exo unilatéral : la Référence par (position, côté) dans UNE séance, et
 *  le Record par côté (tous jours confondus). Le journal de l'Analyse garde le
 *  côté faible de chaque série (fixtures-analyse.ts), la courbe aussi. */
export interface UniHistory {
  ref: { seanceId: string; date: string; sets: SidePair[] } | null;
  pr: Record<Side, { e1rm: number; weightKg: number; reps: number; date: string }> | null;
}

const sv = (weightKg: number, reps: number, rir: number): SideValue => ({ weightKg, reps, rir });
const prOf = (v: SideValue, date: string) => ({ e1rm: e1rm(v.weightKg, v.reps, v.rir), weightKg: v.weightKg, reps: v.reps, date });

/** Rowing haltère unilatéral, fait en Upper B le 20 nov. : la droite est le
 *  côté faible (2,5 kg de moins), comme souvent. */
const DB_ROW_REF: SidePair[] = [
  { G: sv(35, 10, 2), D: sv(32.5, 10, 2) },
  { G: sv(35, 9, 2), D: sv(32.5, 9, 1) },
  { G: sv(35, 8, 1), D: sv(32.5, 8, 1) },
];

export const UNI_HISTORY: Record<string, UniHistory> = {
  'db-row': {
    ref: { seanceId: 'upper-b', date: '2026-11-20', sets: DB_ROW_REF },
    pr: { G: prOf(sv(35, 10, 2), '2026-11-20'), D: prOf(sv(32.5, 10, 2), '2026-11-20') },
  },
};

/** Côté faible d'une paire : e1RM la plus basse (à égalité, la droite). */
export function weakOf(p: SidePair): SideValue {
  return e1rm(p.G.weightKg, p.G.reps, p.G.rir) < e1rm(p.D.weightKg, p.D.reps, p.D.rir) ? p.G : p.D;
}

/* ------------------------------------------------------------------------ */
/* Notes datées de la dernière exécution (repère « tu notais »)               */
/* ------------------------------------------------------------------------ */

/** Note datée que la DERNIÈRE exécution de chaque séance porte pour un exo
 *  (CONTEXT.md « Note datée ») : rien si elle n'en porte pas, on ne repêche
 *  jamais une note plus ancienne. Clé : id de séance, puis id d'exo. */
export const LAST_DATED_NOTES: Record<string, Record<string, { date: string; body: string }>> = {
  'upper-a': {
    bench: { date: '2026-11-17', body: 'Épaule droite raide, échauffement plus long. Prise un doigt plus serrée.' },
    curl: { date: '2026-11-17', body: 'Haltères de 14 pris, fait à 12 les deux dernières.' },
  },
  'upper-b': {
    'db-row': { date: '2026-11-20', body: 'Banc du fond, le seul qui ne bouge pas.' },
  },
};
