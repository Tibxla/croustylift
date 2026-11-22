// PROTOTYPE JETABLE (branche prototype/refonte-visuelle) : données fabriquées,
// aucune lecture ni écriture Supabase. Sert les trois variantes de la refonte.
//
// Le scénario : Thibaud est en plein « Upper A », sur le développé couché,
// 2 séries loggées sur 3-4. Chaque exo porte son historique d'e1RM pour la
// surface Analyse.

export type Status = 'todo' | 'in-progress' | 'done' | 'skipped';

export interface LoggedSet {
  order: number;
  weightKg: number;
  reps: number;
  rir: number;
  /** Comparaison à la Référence (même rang de série, dernière fois). */
  vsReference: 'beaten' | 'matched' | 'below' | 'none';
}

export interface ExercisePlan {
  id: string;
  name: string;
  muscles: string[];
  /** Prescription : séries, reps, RIR en fourchettes. */
  sets: [number, number];
  reps: [number, number];
  rir: [number, number];
  status: Status;
  /** Référence = la dernière exécution de cet exo dans cette séance. */
  reference: { date: string; sets: { weightKg: number; reps: number; rir: number }[] } | null;
  /** Record personnel (meilleure e1RM tous temps). */
  pr: { e1rm: number; weightKg: number; reps: number; date: string } | null;
  /** Historique e1RM par séance, du plus ancien au plus récent. Un trou = absent, jamais 0. */
  history: { date: string; e1rm: number }[];
  /** Pente de progression, % par semaine (null si pas assez de points). */
  weeklyRatePct: number | null;
  loggedToday: LoggedSet[];
}

export interface SessionFixture {
  routineName: string;
  seanceName: string;
  dateIso: string;
  startedAt: string; // HH:MM
  elapsedMin: number;
  pendingSync: number; // écritures en attente dans l'outbox
  exercises: ExercisePlan[];
}

const DATES = [
  '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20',
  '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17',
];

function curve(start: number, steps: number[]): { date: string; e1rm: number }[] {
  let v = start;
  return DATES.map((date, i) => {
    v += steps[i] ?? 0;
    return { date, e1rm: Math.round(v * 10) / 10 };
  });
}

export const session: SessionFixture = {
  routineName: 'PPL automne',
  seanceName: 'Upper A',
  dateIso: '2026-11-22',
  startedAt: '18:42',
  elapsedMin: 27,
  pendingSync: 0,
  exercises: [
    {
      id: 'bench',
      name: 'Développé couché',
      muscles: ['Pectoraux', 'Triceps', 'Épaules ant.'],
      sets: [3, 4],
      reps: [8, 12],
      rir: [1, 2],
      status: 'in-progress',
      reference: {
        date: '2026-11-17',
        sets: [
          { weightKg: 80, reps: 8, rir: 1 },
          { weightKg: 80, reps: 7, rir: 1 },
          { weightKg: 77.5, reps: 8, rir: 1 },
        ],
      },
      // Record battu aujourd'hui : 82,5 × 8 @ RIR 2 → 107,3.
      pr: { e1rm: 107.3, weightKg: 82.5, reps: 8, date: '2026-11-22' },
      history: curve(94, [0, 1.2, 0.8, 1.5, -0.5, 1.8, 1.1, 1.4, 0.9]),
      weeklyRatePct: 1.4,
      loggedToday: [
        { order: 1, weightKg: 82.5, reps: 8, rir: 2, vsReference: 'beaten' },
        { order: 2, weightKg: 82.5, reps: 7, rir: 1, vsReference: 'beaten' },
      ],
    },
    {
      id: 'row',
      name: 'Tirage horizontal',
      muscles: ['Dos', 'Biceps'],
      sets: [3, 4],
      reps: [10, 12],
      rir: [1, 2],
      status: 'done',
      reference: {
        date: '2026-11-17',
        sets: [
          { weightKg: 70, reps: 12, rir: 2 },
          { weightKg: 70, reps: 11, rir: 1 },
          { weightKg: 70, reps: 10, rir: 1 },
        ],
      },
      // Record battu aujourd'hui : 72,5 × 11 @ RIR 2 → 101,5.
      pr: { e1rm: 101.5, weightKg: 72.5, reps: 11, date: '2026-11-22' },
      history: curve(96.5, [0, 0.8, -0.6, 0.9, -0.4, 1.2, -0.9, 0.3, -0.2]),
      weeklyRatePct: -0.1,
      loggedToday: [
        { order: 1, weightKg: 72.5, reps: 11, rir: 2, vsReference: 'beaten' },
        { order: 2, weightKg: 72.5, reps: 10, rir: 1, vsReference: 'beaten' },
        // Série 3 : égale à la Référence (même e1RM).

        { order: 3, weightKg: 70, reps: 10, rir: 1, vsReference: 'matched' },
      ],
    },
    {
      id: 'ohp',
      name: 'Développé militaire',
      muscles: ['Épaules', 'Triceps'],
      sets: [3, 3],
      reps: [6, 8],
      rir: [2, 2],
      status: 'todo',
      reference: {
        date: '2026-11-17',
        sets: [
          { weightKg: 50, reps: 7, rir: 2 },
          { weightKg: 50, reps: 6, rir: 2 },
          { weightKg: 47.5, reps: 7, rir: 2 },
        ],
      },
      pr: { e1rm: 63.5, weightKg: 52.5, reps: 8, date: '2026-10-06' },
      history: curve(63, [0, 0, 0.5, -1.5, 0, -1.2, 0.4, -1.4, -0.3]),
      weeklyRatePct: -0.6,
      loggedToday: [],
    },
    {
      id: 'curl',
      name: 'Curl biceps haltères',
      muscles: ['Biceps'],
      sets: [3, 4],
      reps: [10, 15],
      rir: [0, 1],
      status: 'todo',
      reference: {
        date: '2026-11-17',
        sets: [
          { weightKg: 14, reps: 12, rir: 1 },
          { weightKg: 14, reps: 11, rir: 0 },
          { weightKg: 14, reps: 10, rir: 0 },
        ],
      },
      pr: { e1rm: 19.6, weightKg: 14, reps: 13, date: '2026-11-03' },
      history: curve(17.8, [0, 0.3, 0.2, 0.4, 0, 0.5, 0.2, -0.1, 0.2]),
      weeklyRatePct: 0.9,
      loggedToday: [],
    },
    {
      id: 'dips',
      name: 'Dips lestés',
      muscles: ['Pectoraux', 'Triceps'],
      sets: [2, 3],
      reps: [8, 10],
      rir: [1, 2],
      status: 'skipped',
      reference: null,
      pr: null,
      history: [],
      weeklyRatePct: null,
      loggedToday: [],
    },
  ],
};

/** e1RM d'Epley décalé d'une rep (ADR 0013) : poids × (1 + (reps + rir − 1) / 30). */
export function e1rm(weightKg: number, reps: number, rir: number): number {
  const effective = reps + rir;
  if (effective <= 1) return weightKg;
  return Math.round(weightKg * (1 + (effective - 1) / 30) * 10) / 10;
}

/** Formatage français d'un poids : 82,5 ; 80. */
export function kg(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

export function range([a, b]: [number, number]): string {
  return a === b ? String(a) : `${a}-${b}`;
}

/** Séries par muscle de la séance du jour (pour un récap de fin). */
export const setsPerMuscleWeek: { muscle: string; sets: number; target: [number, number] }[] = [
  { muscle: 'Pectoraux', sets: 11, target: [10, 16] },
  { muscle: 'Dos', sets: 13, target: [10, 16] },
  { muscle: 'Épaules', sets: 7, target: [8, 12] },
  { muscle: 'Biceps', sets: 9, target: [8, 12] },
  { muscle: 'Triceps', sets: 12, target: [8, 12] },
  { muscle: 'Quadriceps', sets: 0, target: [10, 16] },
];
