// PROTOTYPE JETABLE · socle E, données de la fin de séance (salle-fin.tsx).
//
// 1. Les Exécutions déjà faites avant la séance du jour, pour le décompte de
//    séries par muscle de la semaine (lundi → dimanche). Les reps notées sont
//    celles du côté faible pour un exo unilatéral (ADR 0005), ce qui suffit au
//    décompte par muscle.
// 2. Le prévu de la semaine : dérivé des prescriptions de la routine courante,
//    en supposant chaque séance faite une fois par semaine (hypothèse du
//    prototype, l'app réelle n'a pas encore de notion de fréquence). Aucune
//    cible inventée : c'est le plan de l'utilisateur, en fourchette min-max.
// 3. Le dernier BPM moyen noté sur la séance, pour amorcer le stepper.
//
// Décompte pondéré (ADR 0006) : une série vaut min(reps, 5) / 5.
import { catalogById, MUSCLES, routines, type Muscle } from './fixtures-e';

export function setWeight(reps: number): number {
  return Math.min(reps, 5) / 5;
}

/** Muscles principaux canoniques d'un exo (la fixture de séance n'a pas les noms canoniques). */
export function musclesOf(exerciseId: string): Muscle[] {
  return catalogById(exerciseId)?.muscles ?? [];
}

interface PastExecution {
  date: string;
  seanceName: string;
  /** Reps de chaque série loggée, par exo. */
  sets: Record<string, number[]>;
}

/** Semaine du 16 au 22 nov. 2026 : Upper A mardi (la Référence du jour), Lower A
 *  jeudi, Upper B vendredi. Lower B n'a pas été faite. */
const PAST: PastExecution[] = [
  {
    date: '2026-11-17',
    seanceName: 'Upper A',
    sets: { bench: [8, 7, 8], row: [12, 11, 10], ohp: [7, 6, 7], curl: [12, 11, 10] },
  },
  {
    date: '2026-11-19',
    seanceName: 'Lower A',
    sets: { squat: [6, 6, 5, 4], rdl: [10, 9, 8], legcurl: [12, 11, 10], calf: [14, 12, 12, 11] },
  },
  {
    date: '2026-11-20',
    seanceName: 'Upper B',
    sets: { 'incline-db': [10, 9, 8, 8], pullup: [8, 7, 4], lateral: [16, 14, 13, 12], pushdown: [14, 12, 11], hammer: [12, 11, 10] },
  },
];

/** Lundi de la semaine d'une date ISO. */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Décompte pondéré par muscle des Exécutions de la semaine, avant le jour `iso`. */
export function weekBefore(iso: string): { byMuscle: Partial<Record<Muscle, number>>; seances: string[] } {
  const from = weekStart(iso);
  const byMuscle: Partial<Record<Muscle, number>> = {};
  const seances: string[] = [];
  for (const ex of PAST) {
    if (ex.date < from || ex.date >= iso) continue;
    seances.push(ex.seanceName);
    for (const [id, reps] of Object.entries(ex.sets)) {
      const w = reps.reduce((n, r) => n + setWeight(r), 0);
      for (const m of musclesOf(id)) byMuscle[m] = (byMuscle[m] ?? 0) + w;
    }
  }
  return { byMuscle, seances };
}

/** Prévu de la semaine par muscle : chaque séance (non archivée) de la routine
 *  courante une fois, séries min-max pondérées par la borne basse des reps. */
export function plannedWeek(): { routineName: string; seanceCount: number; byMuscle: Partial<Record<Muscle, [number, number]>> } {
  const routine = routines.find((r) => r.current)!;
  const seances = routine.seances.filter((s) => !s.archived);
  const byMuscle: Partial<Record<Muscle, [number, number]>> = {};
  for (const s of seances) {
    for (const it of s.items) {
      const w = setWeight(it.reps[0]);
      for (const m of musclesOf(it.exerciseId)) {
        const [lo, hi] = byMuscle[m] ?? [0, 0];
        byMuscle[m] = [lo + it.sets[0] * w, hi + it.sets[1] * w];
      }
    }
  }
  return { routineName: routine.name, seanceCount: seances.length, byMuscle };
}

/** Ordre canonique des muscles (CONTEXT.md). */
export function byCanonicalOrder(a: Muscle, b: Muscle): number {
  return MUSCLES.indexOf(a) - MUSCLES.indexOf(b);
}

/** Dernier BPM moyen noté sur une séance, null si jamais noté. */
export function lastBpm(seanceName: string): { bpm: number; date: string } | null {
  return seanceName === 'Upper A' ? { bpm: 128, date: '2026-11-17' } : seanceName === 'Upper B' ? { bpm: 124, date: '2026-11-20' } : null;
}
