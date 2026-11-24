// LE RÉALISÉ D'UNE EXÉCUTION : ce que l'utilisateur a réellement fait, tel que
// l'appareil doit le montrer à l'instant.
//
// UNE RÈGLE, pour tous ceux qui lisent des séries : une LECTURE de la base (ou
// la copie locale qui en tient lieu), puis chaque écriture locale que cette
// lecture ne contient pas, appliquée dans l'ordre du registre et COLONNE PAR
// COLONNE.
//
// Quelles écritures : celles que rend `writesSince(estampille)` (outbox.ts),
// l'estampille étant relevée au DÉPART de la lecture. Ce sont les écritures en
// attente, celles que la base a refusées (l'appareil les retient), et celles
// acquittées après le départ : la réponse, figée à son départ, ne les porte pas.
// Aucun autre paramètre de course : ni file relevée avant et après, ni état
// local du départ, ni suivi des gestes faits pendant le trajet.
//
// Colonne par colonne (ADR 0003, amendement du 2026-11-24) :
//   - une insertion pose la ligne entière ;
//   - une correction (`patchSet`, `only: 'values'`) ne pose que les colonnes
//     qu'elle a changées (`cols`), sur une ligne qui existe ;
//   - une remontée de rang (`only: 'rank'`) ne pose que le rang, un changement
//     de côté (`only: 'side'`) que le côté ;
//   - une suppression retire la ligne, celle d'une exécution toutes ses lignes.
// Une ligne corrigée ailleurs (la lecture porte son nouveau poids) et
// renumérotée ici garde donc les deux. Une écriture partielle ne crée jamais de
// ligne : corriger une série supprimée ne la ressuscite pas.
//
// Trois lecteurs, la même règle :
//   - le MONTAGE du tableau de la Salle (`executionReality`) ;
//   - la RÉPONSE TARDIVE de la base, appliquée au tableau déjà monté (le cas
//     `reconcile-progress` du réducteur, state.ts) ;
//   - la RÉFÉRENCE et les records (`exerciseRowsReality`, sur la copie
//     d'historique d'un exo, ADR 0014).
// Pur : ni registre, ni stockage, ni réseau. L'appelant fournit la lecture et
// les écritures.
import type { PerformedSet, Side } from '../../domain/types';
import type { PerformedSetWithExecutionRow } from './data';
import type { LocalWrite, OutboxOp } from './outbox';
import type { DatedNoteDraft, ExerciseProgress } from './state';

/** Une ligne de série, sous la forme commune aux lecteurs. */
interface SetLine {
  executionId: string;
  exerciseId: string;
  order: number;
  weightKg: number;
  reps: number;
  rir: number;
  side?: Side;
}

function sameLine(a: SetLine | undefined, b: SetLine | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.executionId === b.executionId &&
    a.exerciseId === b.exerciseId &&
    a.order === b.order &&
    a.weightKg === b.weightKg &&
    a.reps === b.reps &&
    a.rir === b.rir &&
    (a.side ?? null) === (b.side ?? null)
  );
}

/**
 * LA règle : applique UNE écriture locale aux lignes, par identifiant de série.
 * `accepts` borne les insertions à ce que le lecteur regarde (une exécution,
 * un exo).
 */
function applyWrite(lines: Map<string, SetLine>, op: OutboxOp, accepts: (line: SetLine) => boolean): void {
  switch (op.type) {
    case 'insertSet': {
      const line: SetLine = {
        executionId: op.executionId,
        exerciseId: op.exerciseId,
        order: op.setOrder,
        weightKg: op.weightKg,
        reps: op.reps,
        rir: op.rir,
        ...(op.side ? { side: op.side } : {}),
      };
      if (accepts(line)) lines.set(op.id, line);
      return;
    }
    case 'patchSet': {
      // Écriture partielle : seulement sur une ligne qui existe, et seulement
      // ses colonnes. Elle n'en crée pas.
      const known = lines.get(op.id);
      if (!known) return;
      const next = { ...known };
      if (op.only === 'rank') next.order = op.setOrder;
      else if (op.only === 'side') {
        if (op.side) next.side = op.side;
        else delete next.side;
      } else {
        const cols = op.cols ?? (['weightKg', 'reps', 'rir'] as const);
        if (cols.includes('weightKg')) next.weightKg = op.weightKg;
        if (cols.includes('reps')) next.reps = op.reps;
        if (cols.includes('rir')) next.rir = op.rir;
      }
      lines.set(op.id, next);
      return;
    }
    case 'deleteSet':
      lines.delete(op.id);
      return;
    case 'deleteExecution': {
      for (const [id, line] of [...lines]) {
        if (line.executionId === op.id) lines.delete(id);
      }
      return;
    }
    default:
      return;
  }
}

// --- Le tableau de la Salle ----------------------------------------------------

/** Le réalisé d'un exo tel qu'une lecture le rend : ses séries et leurs ids. */
export interface ReadProgress {
  sets: PerformedSet[];
  setIds: readonly (string | null)[];
}

/**
 * Le réalisé de l'exécution `executionId`, par exo : la lecture `read`, puis les
 * écritures locales `writes` qu'elle ne contient pas (cf. en-tête).
 *
 * `read` est la réponse de la base pour cette exécution. Quand la base n'a pas
 * répondu (hors ligne), c'est le réalisé que l'appareil a gardé, avec
 * l'estampille de son enregistrement : la règle est la même.
 *
 * `skipped` : les exos que l'utilisateur a passés (la base ne le sait pas) ; ils
 * restent au réalisé même sans série. Les séries d'un exo touché par une
 * écriture sont rendues triées par rang, gauche avant droite ; celles d'un exo
 * intact gardent l'ordre de la lecture. Une série sans id (cache d'un très
 * ancien format) n'est visée par aucune écriture : elle reste telle quelle.
 */
export function executionReality(input: {
  executionId: string;
  read: Record<string, ReadProgress>;
  writes: readonly LocalWrite[];
  skipped?: ReadonlySet<string>;
}): Record<string, ExerciseProgress> {
  const { executionId, read, writes } = input;
  const skipped = input.skipped ?? new Set<string>();
  const lines = new Map<string, SetLine>();
  for (const [exerciseId, entry] of Object.entries(read)) {
    entry.sets.forEach((set, index) => {
      const id = entry.setIds[index] ?? null;
      if (id === null) return;
      lines.set(id, {
        executionId,
        exerciseId,
        order: set.order,
        weightKg: set.weightKg,
        reps: set.reps,
        rir: set.rir,
        ...(set.side ? { side: set.side } : {}),
      });
    });
  }
  const before = new Map(lines);
  for (const write of writes) applyWrite(lines, write.op, (line) => line.executionId === executionId);
  // Les exos dont une ligne diffère AU BOUT du compte : rejouer des écritures
  // que la lecture contenait déjà ne touche rien.
  const touched = new Set<string>();
  for (const id of new Set([...before.keys(), ...lines.keys()])) {
    const was = before.get(id);
    const now = lines.get(id);
    if (sameLine(was, now)) continue;
    if (was) touched.add(was.exerciseId);
    if (now) touched.add(now.exerciseId);
  }

  const out: Record<string, ExerciseProgress> = {};
  for (const exerciseId of new Set([...Object.keys(read), ...touched, ...skipped])) {
    const entry = read[exerciseId];
    const isSkipped = skipped.has(exerciseId);
    if (!touched.has(exerciseId)) {
      if (entry && (entry.sets.length > 0 || isSkipped)) {
        out[exerciseId] = { sets: entry.sets, setIds: [...entry.setIds], skipped: isSkipped };
      } else if (isSkipped) out[exerciseId] = { sets: [], setIds: [], skipped: true };
      continue;
    }
    const rows: { set: PerformedSet; id: string | null }[] = [];
    // Les séries sans id de la lecture, hors de portée des écritures.
    entry?.sets.forEach((set, index) => {
      if ((entry.setIds[index] ?? null) === null) rows.push({ set, id: null });
    });
    for (const [id, line] of lines) {
      if (line.exerciseId !== exerciseId) continue;
      rows.push({
        id,
        set: {
          weightKg: line.weightKg,
          reps: line.reps,
          rir: line.rir,
          order: line.order,
          ...(line.side ? { side: line.side } : {}),
        },
      });
    }
    rows.sort(
      (a, b) =>
        a.set.order - b.set.order ||
        (a.set.side === 'right' ? 1 : 0) - (b.set.side === 'right' ? 1 : 0),
    );
    if (rows.length === 0 && !isSkipped) continue;
    out[exerciseId] = { sets: rows.map((r) => r.set), setIds: rows.map((r) => r.id), skipped: isSkipped };
  }
  return out;
}

// --- Les notes datées de l'exécution ---------------------------------------------

/**
 * Les notes datées de l'exécution `executionId`, par exo : celles de la lecture,
 * puis les écritures de notes locales qu'elle ne contient pas. Une pose remplace
 * le corps, un effacement retire la note (par son couple exécution et exercice ;
 * par l'id de la note pour un effacement d'un bundle antérieur).
 */
export function datedNotesReality(
  executionId: string,
  read: Record<string, DatedNoteDraft>,
  writes: readonly LocalWrite[],
): Record<string, DatedNoteDraft> {
  let notes = read;
  const edit = () => (notes === read ? (notes = { ...read }) : notes);
  for (const { op } of writes) {
    if (op.type === 'upsertDatedNote') {
      if (op.executionId !== executionId) continue;
      const known = notes[op.exerciseId];
      if (known && known.body === op.body) continue;
      // La ligne en base garde son id quand elle existe (l'écriture vise le couple).
      edit()[op.exerciseId] = { id: known?.id ?? op.id, body: op.body };
    } else if (op.type === 'deleteDatedNote') {
      for (const [exerciseId, note] of Object.entries(notes)) {
        const aimed =
          op.executionId !== undefined && op.exerciseId !== undefined
            ? op.executionId === executionId && op.exerciseId === exerciseId
            : op.id === note.id;
        if (aimed) delete edit()[exerciseId];
      }
    }
  }
  return notes;
}

// --- La Référence : les lignes d'historique d'un exo --------------------------

/**
 * Les lignes d'historique de l'exo `exerciseId` : la copie locale `rows`, puis
 * les écritures locales qu'elle ne contient pas (ADR 0014). Sans cela, une
 * séance capturée hors ligne n'existe dans AUCUNE source de la Référence, ni en
 * base, ni dans la copie que le réseau alimente, et le repère « dernière fois »
 * affiche l'avant-dernière séance.
 *
 * Le contexte d'une exécution (date, version de séance) vient des lignes déjà
 * lues, complété par les créations d'exécution que portent les écritures : c'est
 * ce qui rend datable une séance jamais remontée. Une série insérée dont
 * l'exécution n'a ni ligne lue ni création parmi les écritures n'a pas de
 * contexte : elle ne dérive rien et reste ignorée jusqu'à la relecture de la
 * copie (ADR 0020).
 *
 * Rendues dans l'ordre de la requête d'origine (date, puis création de
 * l'exécution) : `reconstructExerciseExecutions` suit l'ordre des lignes.
 */
export function exerciseRowsReality(
  rows: readonly PerformedSetWithExecutionRow[],
  writes: readonly LocalWrite[],
  exerciseId: string,
): PerformedSetWithExecutionRow[] {
  type Context = NonNullable<PerformedSetWithExecutionRow['executions']>;
  const context = new Map<string, Context>();
  for (const row of rows) {
    if (row.executions) context.set(row.execution_id, row.executions);
  }
  for (const { op } of writes) {
    // Une exécution garde la date et la version sous lesquelles elle est née
    // (insertion seule, ADR 0021) : la copie fait foi, puis la première création.
    if (op.type !== 'upsertExecution' || context.has(op.id)) continue;
    context.set(op.id, {
      performed_on: op.performedOn,
      // La ligne n'existe pas encore côté serveur, donc pas de `created_at` :
      // `startedAt` en tient lieu pour le départage à date égale (cf.
      // `lastReference`). Absent : chaîne vide, qui perd le départage.
      created_at: op.startedAt ?? '',
      seance_version_id: op.seanceVersionId,
    });
  }

  // Identité d'une ligne : son `id` quand la copie le porte, sinon (exécution,
  // rang, côté), unique par exo et stable (ADR 0005). Une ligne sans id n'est
  // visée par aucune écriture.
  const untouchable: PerformedSetWithExecutionRow[] = [];
  const original = new Map<string, PerformedSetWithExecutionRow>();
  const lines = new Map<string, SetLine>();
  for (const row of rows) {
    if (row.id === undefined) {
      untouchable.push(row);
      continue;
    }
    original.set(row.id, row);
    lines.set(row.id, {
      executionId: row.execution_id,
      exerciseId,
      order: row.set_order,
      weightKg: Number(row.weight_kg),
      reps: row.reps,
      rir: row.rir,
      ...(row.side === 'left' || row.side === 'right' ? { side: row.side } : {}),
    });
  }
  const before = new Map(lines);
  for (const { op } of writes) {
    // Sans date ni version, la ligne ne dérive rien.
    applyWrite(lines, op, (line) => line.exerciseId === exerciseId && context.has(line.executionId));
  }

  const out: PerformedSetWithExecutionRow[] = [...untouchable];
  for (const [id, line] of lines) {
    const row = original.get(id);
    // Inchangée au bout du compte : la ligne lue elle-même.
    if (row && sameLine(before.get(id), line)) {
      out.push(row);
      continue;
    }
    out.push({
      id,
      weight_kg: line.weightKg,
      reps: line.reps,
      rir: line.rir,
      set_order: line.order,
      side: line.side ?? null,
      execution_id: line.executionId,
      executions: context.get(line.executionId) ?? row?.executions ?? null,
    });
  }
  return out.sort((a, b) => {
    const da = a.executions?.performed_on ?? '';
    const db = b.executions?.performed_on ?? '';
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.executions?.created_at ?? '';
    const cb = b.executions?.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return 0;
  });
}
