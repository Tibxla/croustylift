import { describe, it, expect } from 'vitest';
import {
  applyPendingSets,
  decideCaptureSource,
  deriveExerciseHistory,
  resolveCaptureRoutineId,
  reconstructExerciseExecutions,
  type SeanceChoice,
  type PerformedSetWithExecutionRow,
} from './data';
import type { OutboxOp } from './outbox';

// Logique PURE de sélection de la séance en Capture (issue #1).
//
// La capture ne charge plus « la 1ʳᵉ séance de la 1ʳᵉ routine » : elle respecte
// la ROUTINE COURANTE (getCurrentRoutineId) et présente ses séances. La fixture
// de démo ne sert plus que de FALLBACK (user sans routine exploitable).
//
// `decideCaptureSource` tranche cette décision à partir de deux entrées déjà
// lues côté Supabase (id de routine courante + séances de cette routine), pour
// la garder testable sans toucher la base.

const seance = (id: string, name: string): SeanceChoice => ({ id, name });

describe('decideCaptureSource', () => {
  it('aucune routine courante -> fallback démo', () => {
    expect(decideCaptureSource(null, [])).toEqual({ kind: 'demo' });
  });

  it('routine courante mais sans séance -> fallback démo (rien à choisir)', () => {
    expect(decideCaptureSource('routine-1', [])).toEqual({ kind: 'demo' });
  });

  it('routine courante avec séances -> choix parmi ces séances', () => {
    const seances = [seance('s-1', 'Upper'), seance('s-2', 'Lower')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });

  it('une seule séance reste un choix (pas un raccourci automatique ici)', () => {
    const seances = [seance('s-1', 'Full body')];
    expect(decideCaptureSource('routine-1', seances)).toEqual({
      kind: 'choose',
      seances,
    });
  });
});

// Résolution de la routine sur laquelle ouvrir la Capture : routine courante si
// définie, sinon repli sur la 1ʳᵉ routine existante (évite l'impasse « rien à
// logger » quand une routine existe mais qu'aucune n'a été « définie courante »).
describe('resolveCaptureRoutineId', () => {
  it('routine courante définie -> on la prend (même avec d\'autres routines)', () => {
    expect(resolveCaptureRoutineId('r-courante', ['r-1', 'r-courante', 'r-2'])).toBe(
      'r-courante',
    );
  });

  it('aucune routine courante mais des routines existent -> repli sur la 1ʳᵉ', () => {
    expect(resolveCaptureRoutineId(null, ['r-1', 'r-2'])).toBe('r-1');
  });

  it('aucune routine courante et aucune routine -> null (vrai premier lancement)', () => {
    expect(resolveCaptureRoutineId(null, [])).toBeNull();
  });
});

// Reconstruction de l'historique domaine à partir des lignes plates
// `performed_sets`+`executions` (partie PURE de `loadExerciseExecutions`). La
// requête Supabase reste dans la couche d'accès ; seul ce regroupement est
// testé ici — sans toucher la base. On vérifie les invariants que les dérivées
// du domaine (`lastReference`, `personalRecord`, courbes) supposent : mapping du
// `side`, regroupement par exécution avec tie-breaks (createdAt + id) portés,
// garde-fou orphelin et coercition numérique de `weight_kg`.

/** Fabrique une ligne plate `performed_sets`+`executions` (jointure présente par défaut). */
function setRow(
  overrides: Partial<PerformedSetWithExecutionRow> & { execution_id: string } & {
    executions?: {
      performed_on: string;
      created_at: string;
      seance_version_id: string;
    } | null;
  },
): PerformedSetWithExecutionRow {
  return {
    weight_kg: 100,
    reps: 8,
    rir: 2,
    set_order: 1,
    side: null,
    executions: {
      performed_on: '2026-06-18',
      created_at: '2026-06-18T10:00:00.000Z',
      seance_version_id: 'v-upper-1',
    },
    ...overrides,
  };
}

describe('reconstructExerciseExecutions', () => {
  it('aucune ligne -> historique vide (user neuf)', () => {
    expect(reconstructExerciseExecutions([], 'exo-1')).toEqual([]);
  });

  it('side null -> undefined (toSide) ; "left"/"right" préservés, autre valeur -> undefined', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-1', set_order: 1, side: null }),
      setRow({ execution_id: 'e-1', set_order: 2, side: 'left' }),
      setRow({ execution_id: 'e-1', set_order: 2, side: 'right' }),
      setRow({ execution_id: 'e-1', set_order: 3, side: 'bilateral' }),
    ];
    const [exec] = reconstructExerciseExecutions(rows, 'exo-1');
    expect(exec?.sets.map((s) => s.side)).toEqual([undefined, 'left', 'right', undefined]);
  });

  it('regroupe par execution_id : deux exécutions à performed_on égal restent distinctes, clés de tie-break (createdAt + id) portées', () => {
    // Deux séances le même jour (performed_on égal) : `created_at`/`id` distincts
    // les départagent côté domaine (lastReference, courbes). On vérifie que ces
    // clés sont bien portées sur chaque ExerciseExecution.
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({
        execution_id: 'e-matin',
        set_order: 1,
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T08:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
      setRow({
        execution_id: 'e-soir',
        set_order: 1,
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T19:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(2);
    expect(execs.map((e) => e.id)).toEqual(['e-matin', 'e-soir']);
    expect(execs.map((e) => e.date)).toEqual(['2026-06-18', '2026-06-18']);
    expect(execs.map((e) => e.createdAt)).toEqual([
      '2026-06-18T08:00:00.000Z',
      '2026-06-18T19:00:00.000Z',
    ]);
    expect(execs.every((e) => e.exerciseId === 'exo-1')).toBe(true);
  });

  it('plusieurs séries d\'une même exécution sont regroupées sous une seule ExerciseExecution', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-1', set_order: 1 }),
      setRow({ execution_id: 'e-1', set_order: 2 }),
      setRow({ execution_id: 'e-1', set_order: 3 }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(1);
    expect(execs[0]?.sets.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('garde-fou orphelin : ligne sans jointure executions (null) ignorée', () => {
    const rows: PerformedSetWithExecutionRow[] = [
      setRow({ execution_id: 'e-orpheline', executions: null }),
      setRow({
        execution_id: 'e-valide',
        executions: { performed_on: '2026-06-18', created_at: '2026-06-18T10:00:00.000Z', seance_version_id: 'v-upper-1' },
      }),
    ];
    const execs = reconstructExerciseExecutions(rows, 'exo-1');
    expect(execs).toHaveLength(1);
    expect(execs[0]?.id).toBe('e-valide');
  });

  it('coercition Number(weight_kg) : une charge en chaîne (numeric Postgres) devient un nombre', () => {
    // Postgres renvoie `numeric` en chaîne via PostgREST : `Number(...)` la coerce.
    const rows = [
      setRow({
        execution_id: 'e-1',
        weight_kg: '82.5' as unknown as number,
      }),
    ];
    const [exec] = reconstructExerciseExecutions(rows, 'exo-1');
    const weight = exec?.sets[0]?.weightKg;
    expect(weight).toBe(82.5);
    expect(typeof weight).toBe('number');
  });
});

// Dérivées d'historique (Référence scopée séance + repli + records all-time).
// Partie PURE de `loadExerciseHistory` : le scope de séance filtre les lignes par
// `seance_version_id` (toutes les versions du template) ; les records ignorent le
// scope. Décisions du 2026-07-29, cf. CONTEXT.md « Référence » / « Record personnel ».

describe('deriveExerciseHistory', () => {
  // Historique sur DEUX séances : Upper (v1 puis v2) et Full Body. L'exo est le
  // même partout ; les perfs diffèrent pour rendre tout mauvais scope détectable.
  const rows: PerformedSetWithExecutionRow[] = [
    // Upper v1, 2026-06-01 : 80 kg.
    setRow({
      execution_id: 'e-upper-old',
      weight_kg: 80,
      executions: {
        performed_on: '2026-06-01',
        created_at: '2026-06-01T10:00:00.000Z',
        seance_version_id: 'v-upper-1',
      },
    }),
    // Full Body, 2026-06-15 : 90 kg (plus récent que Upper, AUTRE séance).
    setRow({
      execution_id: 'e-fullbody',
      weight_kg: 90,
      executions: {
        performed_on: '2026-06-15',
        created_at: '2026-06-15T10:00:00.000Z',
        seance_version_id: 'v-fullbody-1',
      },
    }),
    // Upper v2, 2026-06-10 : 82,5 kg (la dernière fois DANS Upper).
    setRow({
      execution_id: 'e-upper-recent',
      weight_kg: 82.5,
      executions: {
        performed_on: '2026-06-10',
        created_at: '2026-06-10T10:00:00.000Z',
        seance_version_id: 'v-upper-2',
      },
    }),
  ];
  const upperVersions = ['v-upper-1', 'v-upper-2'];

  it('la Référence est la dernière perf DANS la séance, pas la plus récente toutes séances', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    // Dernière exécution d'Upper = 2026-06-10 (82,5), PAS le Full Body du 15 (90).
    expect(h.reference?.map((s) => s.weightKg)).toEqual([82.5]);
  });

  it('la Référence traverse les versions du template (v1 comptée si v2 vide)', () => {
    const onlyV1 = rows.filter((r) => r.executions?.seance_version_id !== 'v-upper-2');
    const h = deriveExerciseHistory(onlyV1, 'exo-1', upperVersions, false);
    expect(h.reference?.map((s) => s.weightKg)).toEqual([80]);
  });

  it('pas de repli quand la séance a une Référence (fallbackReference null)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    expect(h.fallbackReference).toBeNull();
  });

  it('séance sans historique : Référence null, repli = dernière perf toutes séances', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', ['v-lower-1'], false);
    expect(h.reference).toBeNull();
    // Le repli pioche la plus récente TOUTES séances : le Full Body du 15 (90).
    expect(h.fallbackReference?.map((s) => s.weightKg)).toEqual([90]);
  });

  it('aucun historique nulle part : Référence ET repli null, records nuls', () => {
    const h = deriveExerciseHistory([], 'exo-1', upperVersions, false);
    expect(h.reference).toBeNull();
    expect(h.fallbackReference).toBeNull();
    expect(h.personalRecord).toEqual({
      bestE1rm: null,
      bestE1rmSet: null,
      bestWeightReps: null,
    });
  });

  it('le Record personnel reste ALL-TIME toutes séances (le 90 du Full Body compte)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', upperVersions, false);
    expect(h.personalRecord.bestWeightReps).toEqual({ weightKg: 90, reps: 8 });
    expect(h.personalRecord.bestE1rmSet).toEqual({ weightKg: 90, reps: 8 });
  });

  it('exo bilatéral : pas de records par côté (null) ; unilatéral : dérivés', () => {
    expect(deriveExerciseHistory(rows, 'exo-1', upperVersions, false).personalRecordBySide).toBeNull();
    const uniRows = [
      setRow({ execution_id: 'e-uni', side: 'left', weight_kg: 30 }),
      setRow({ execution_id: 'e-uni', side: 'right', weight_kg: 28 }),
    ];
    const bySide = deriveExerciseHistory(uniRows, 'exo-1', upperVersions, true).personalRecordBySide;
    expect(bySide?.left.bestWeightReps).toEqual({ weightKg: 30, reps: 8 });
    expect(bySide?.right.bestWeightReps).toEqual({ weightKg: 28, reps: 8 });
  });

  it('une ligne orpheline (jointure absente) reste hors du scope de séance', () => {
    const withOrphan = [...rows, setRow({ execution_id: 'e-orpheline', executions: null })];
    const h = deriveExerciseHistory(withOrphan, 'exo-1', upperVersions, false);
    expect(h.reference?.map((s) => s.weightKg)).toEqual([82.5]);
  });
});


// --- Fusion des écritures en attente + exclusion de l'exécution en cours -----
//
// ADR 0014. Deux défauts corrigés ici : (1) une séance capturée hors-ligne
// n'existait dans AUCUNE source de la Référence (ni base, ni copie locale, que
// seul le réseau alimente), donc le repère « dernière fois » affichait
// l'avant-dernière ; (2) l'exécution du jour n'était pas écartée, donc après une
// revalidation post-flush le repère opposait à l'utilisateur ses propres séries.

describe('applyPendingSets', () => {
  const upsertExec = (id: string, performedOn: string, versionId = 'v-upper-1'): OutboxOp => ({
    type: 'upsertExecution',
    id,
    seanceVersionId: versionId,
    performedOn,
    startedAt: `${performedOn}T18:00:00.000Z`,
  });
  const insertSet = (
    id: string,
    executionId: string,
    weightKg: number,
    exerciseId = 'exo-1',
  ): OutboxOp => ({
    type: 'insertSet',
    id,
    executionId,
    exerciseId,
    setOrder: 1,
    weightKg,
    reps: 5,
    rir: 1,
  });

  it('file vide -> les lignes lues passent telles quelles', () => {
    const rows = [setRow({ id: 's-1', execution_id: 'e-1' })];
    expect(applyPendingSets(rows, [], 'exo-1')).toEqual(rows);
  });

  it('séance jamais remontée : ses séries entrent, datées par son upsertExecution', () => {
    const ops = [upsertExec('e-offline', '2026-06-20'), insertSet('s-9', 'e-offline', 95)];
    const merged = applyPendingSets([], ops, 'exo-1');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      weight_kg: 95,
      execution_id: 'e-offline',
      executions: { performed_on: '2026-06-20', seance_version_id: 'v-upper-1' },
    });
  });

  it('une série en attente sur une exécution DÉJÀ en base hérite de sa jointure', () => {
    const rows = [setRow({ id: 's-1', execution_id: 'e-1', weight_kg: 80 })];
    const merged = applyPendingSets(rows, [insertSet('s-2', 'e-1', 85)], 'exo-1');
    expect(merged.map((r) => r.weight_kg)).toEqual([80, 85]);
    expect(merged[1]?.executions?.performed_on).toBe('2026-06-18');
  });

  it('ignore les séries d\'un AUTRE exo (la lecture est par exercice)', () => {
    const ops = [upsertExec('e-offline', '2026-06-20'), insertSet('s-9', 'e-offline', 95, 'exo-2')];
    expect(applyPendingSets([], ops, 'exo-1')).toEqual([]);
  });

  it('rejouer une série déjà lue ne la duplique pas (idempotence par id)', () => {
    const rows = [setRow({ id: 's-1', execution_id: 'e-1', weight_kg: 80 })];
    const merged = applyPendingSets(rows, [insertSet('s-1', 'e-1', 82.5)], 'exo-1');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.weight_kg).toBe(82.5);
  });

  it('deleteSet retire la ligne (annulation encore en attente)', () => {
    const rows = [setRow({ id: 's-1', execution_id: 'e-1' })];
    expect(applyPendingSets(rows, [{ type: 'deleteSet', id: 's-1' }], 'exo-1')).toEqual([]);
  });

  it('deleteExecution retire TOUTES les lignes de son exécution', () => {
    const rows = [
      setRow({ id: 's-1', execution_id: 'e-1' }),
      setRow({ id: 's-2', execution_id: 'e-1', set_order: 2 }),
      setRow({ id: 's-3', execution_id: 'e-2' }),
    ];
    const merged = applyPendingSets(rows, [{ type: 'deleteExecution', id: 'e-1' }], 'exo-1');
    expect(merged.map((r) => r.id)).toEqual(['s-3']);
  });

  it('une série sans contexte d\'exécution lisible est ignorée (ni datable ni scopable)', () => {
    // `upsertExecution` déjà parti, `insertSet` encore en file, aucune ligne de
    // cette exécution en base : limite assumée de l'ADR 0014.
    expect(applyPendingSets([], [insertSet('s-9', 'e-inconnue', 95)], 'exo-1')).toEqual([]);
  });

  it('rend les lignes triées par date puis created_at, comme la requête', () => {
    const rows = [
      setRow({
        id: 's-old',
        execution_id: 'e-old',
        executions: {
          performed_on: '2026-06-01',
          created_at: '2026-06-01T10:00:00.000Z',
          seance_version_id: 'v-upper-1',
        },
      }),
    ];
    const ops = [upsertExec('e-new', '2026-06-20'), insertSet('s-new', 'e-new', 95)];
    expect(applyPendingSets(rows, ops, 'exo-1').map((r) => r.id)).toEqual(['s-old', 's-new']);
  });

  it('une ligne d\'une copie locale SANS id survit (clé de repli execution:order:side)', () => {
    const rows = [setRow({ execution_id: 'e-1' }), setRow({ execution_id: 'e-1', set_order: 2 })];
    expect(applyPendingSets(rows, [], 'exo-1')).toHaveLength(2);
  });
});

describe('deriveExerciseHistory — exclusion de l\'exécution en cours', () => {
  const versions = ['v-upper-1'];
  const rows = [
    setRow({
      id: 's-passe',
      execution_id: 'e-passe',
      weight_kg: 80,
      executions: {
        performed_on: '2026-06-10',
        created_at: '2026-06-10T10:00:00.000Z',
        seance_version_id: 'v-upper-1',
      },
    }),
    setRow({
      id: 's-jour',
      execution_id: 'e-jour',
      weight_kg: 85,
      executions: {
        performed_on: '2026-06-18',
        created_at: '2026-06-18T10:00:00.000Z',
        seance_version_id: 'v-upper-1',
      },
    }),
  ];

  it('sans exclusion, le repère serait les séries du jour (le bug)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', versions, false);
    expect(h.reference?.map((s) => s.weightKg)).toEqual([85]);
  });

  it('l\'exécution en cours ne peut pas être sa propre Référence', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', versions, false, 'e-jour');
    expect(h.reference?.map((s) => s.weightKg)).toEqual([80]);
  });

  it('seule exécution de la séance = celle du jour -> pas de Référence', () => {
    const jourSeul = rows.filter((r) => r.execution_id === 'e-jour');
    const h = deriveExerciseHistory(jourSeul, 'exo-1', versions, false, 'e-jour');
    expect(h.reference).toBeNull();
    expect(h.fallbackReference).toBeNull();
  });

  it('le repli de préremplissage écarte lui aussi l\'exécution en cours', () => {
    const autreSeance = [
      setRow({
        id: 's-autre',
        execution_id: 'e-autre',
        weight_kg: 70,
        executions: {
          performed_on: '2026-06-05',
          created_at: '2026-06-05T10:00:00.000Z',
          seance_version_id: 'v-fullbody-1',
        },
      }),
      setRow({
        id: 's-jour',
        execution_id: 'e-jour',
        weight_kg: 85,
        executions: {
          performed_on: '2026-06-18',
          created_at: '2026-06-18T10:00:00.000Z',
          seance_version_id: 'v-upper-1',
        },
      }),
    ];
    const h = deriveExerciseHistory(autreSeance, 'exo-1', versions, false, 'e-jour');
    expect(h.reference).toBeNull();
    expect(h.fallbackReference?.map((s) => s.weightKg)).toEqual([70]);
  });

  it('les RECORDS aussi partent d\'AVANT le jour (la Capture rejoue les séries par-dessus)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', versions, false, 'e-jour');
    // Le socle reste 80 : sinon le badge « Record » posé sur la série du jour à
    // 85 s'éteindrait au premier remontage de l'écran (cf. computeRecordFlags,
    // qui fait avancer un record « running » série après série).
    expect(h.personalRecord.bestWeightReps).toEqual({ weightKg: 80, reps: 8 });
  });

  it('sans exclusion, le socle des records absorbe le jour (le comportement d\'avant)', () => {
    const h = deriveExerciseHistory(rows, 'exo-1', versions, false);
    expect(h.personalRecord.bestWeightReps).toEqual({ weightKg: 85, reps: 8 });
  });
});
