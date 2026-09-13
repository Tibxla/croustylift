// Panneau de comparaison de deux blocs d'un exercice (cf. issue #6, ADR 0016).
//
// L'utilisateur choisit deux options ; on superpose leurs pentes de progression
// e1RM (%/semaine) et on désigne la plus rapide. Une option est un couple BLOC +
// SÉANCE : chaque pente lit une seule séance pendant un seul bloc, ce qui permet
// de comparer deux routines (Upper A pendant Upper/Lower contre Push pendant PPL)
// ou deux séances d'un même bloc sans mêler deux contextes de fatigue dans une
// même pente. Une option sans assez de points n'a pas de pente : pas de verdict
// trompeur, on le dit en clair.
//
// Séparation CHARGEMENT / PRÉSENTATION comme `AnalysisScreen` : `ComparisonView`
// est pur (prend exécutions + blocs + séances déjà chargés), montable sans réseau
// dans le harness de screenshot ; le wrapper `BlockComparisonPanel` fait la
// lecture Supabase. Tout le calcul vient du domaine pur (`summarizeBlockSeances`,
// `compareBlockSeances`, `defaultComparisonPair`).
import { useEffect, useMemo, useState } from 'react';
import type { ExerciseExecution, Block } from '../../domain/types';
import {
  compareBlockSeances,
  defaultComparisonPair,
  summarizeBlockSeances,
  type BlockSeanceProgression,
  type Side,
} from '../../domain/block-comparison';
import { loadBlockComparisonData, type SeanceInfo } from './data';
import { blockLabel, seanceRoutineLabel } from './block-label';
import { toWeeklySeries } from './comparison-series';
import { ComparisonChart } from './ComparisonChart';
import { TrendArrow } from './TrendArrow';
import { trendColor, trendOf } from './trend';

/** Sous ce nombre de points, une option n'a pas de pente fiable (cf. weeklyProgressionRate). */
const MIN_POINTS = 3;

// --- Wrapper (chargement Supabase) -------------------------------------------

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      executions: ExerciseExecution[];
      blocks: Block[];
      seances: Map<string, SeanceInfo>;
    };

export function BlockComparisonPanel({ exerciseId }: { exerciseId: string }) {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const { executions, blocks, seances } = await loadBlockComparisonData(exerciseId);
        if (!active) return;
        setLoad({ phase: 'ready', executions, blocks, seances });
      } catch (err) {
        if (!active) return;
        setLoad({
          phase: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [exerciseId]);

  if (load.phase === 'loading') {
    return (
      <div className="flex h-24 items-center justify-center">
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent"
          role="status"
          aria-label="Chargement de la comparaison"
        />
      </div>
    );
  }

  if (load.phase === 'error') {
    return (
      <p className="readout px-1 py-3 text-xs text-warn">{load.message}</p>
    );
  }

  return (
    <ComparisonView
      exerciseId={exerciseId}
      executions={load.executions}
      blocks={load.blocks}
      seances={load.seances}
    />
  );
}

// --- Présentation (pure, montable sans réseau) -------------------------------

/** Les deux lignes d'un libellé d'option : « Push · PPL » puis « 15/10 · en cours ». */
interface OptionLabel {
  seance: string;
  dates: string;
}

function optionLabel(
  option: BlockSeanceProgression,
  seances: ReadonlyMap<string, SeanceInfo>,
): OptionLabel {
  return {
    seance: seanceRoutineLabel(seances.get(option.seanceId)),
    dates: blockLabel(option.block),
  };
}

function oneLine(label: OptionLabel): string {
  return `${label.seance} · ${label.dates}`;
}

export function ComparisonView({
  exerciseId,
  executions,
  blocks,
  seances,
}: {
  exerciseId: string;
  executions: ExerciseExecution[];
  blocks: Block[];
  seances: ReadonlyMap<string, SeanceInfo>;
}) {
  // Un couple (bloc, séance) par séance où l'exo a été travaillé dans le bloc,
  // la dernière option étant la plus récente.
  const options = useMemo(
    () => summarizeBlockSeances(executions, exerciseId, blocks),
    [executions, exerciseId, blocks],
  );

  const [firstIdx, setFirstIdx] = useState<number | null>(null);
  const [secondIdx, setSecondIdx] = useState<number | null>(null);

  // Pré-sélection dès qu'il y a de quoi comparer : la plus récente, face à la
  // plus récente d'un autre bloc (cf. defaultComparisonPair).
  useEffect(() => {
    if (firstIdx !== null || secondIdx !== null) return;
    const pair = defaultComparisonPair(options);
    if (pair) {
      setFirstIdx(pair[0]);
      setSecondIdx(pair[1]);
    }
  }, [options, firstIdx, secondIdx]);

  if (options.length < 2) {
    return (
      <p className="px-1 py-2 text-xs text-ink-muted">
        Il faut au moins deux périodes où cet exo a été travaillé pour comparer.
      </p>
    );
  }

  const first = firstIdx === null ? undefined : options[firstIdx];
  const second = secondIdx === null ? undefined : options[secondIdx];

  return (
    <div className="flex flex-col gap-3">
      {/* Empilés : « séance · routine · dates » ne tient pas dans deux menus côte à
          côte à 400 px. */}
      <div className="flex flex-col gap-2">
        <OptionSelect
          label="Premier"
          options={options}
          seances={seances}
          value={firstIdx}
          exclude={secondIdx}
          onChange={setFirstIdx}
        />
        <OptionSelect
          label="Second"
          options={options}
          seances={seances}
          value={secondIdx}
          exclude={firstIdx}
          onChange={setSecondIdx}
        />
      </div>

      {first && second && (
        <ComparisonResult
          executions={executions}
          exerciseId={exerciseId}
          first={first}
          second={second}
          firstLabel={optionLabel(first, seances)}
          secondLabel={optionLabel(second, seances)}
        />
      )}
    </div>
  );
}

function OptionSelect({
  label,
  options,
  seances,
  value,
  exclude,
  onChange,
}: {
  label: string;
  options: BlockSeanceProgression[];
  seances: ReadonlyMap<string, SeanceInfo>;
  value: number | null;
  exclude: number | null;
  onChange: (index: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="readout text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {label}
      </span>
      <select
        className="field h-11 rounded-xl px-2.5 text-sm text-ink"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((o, index) => (
          <option key={`${o.block.start}:${o.seanceId}`} value={index} disabled={index === exclude}>
            {oneLine(optionLabel(o, seances))}
            {o.pointCount < MIN_POINTS ? ' · trop peu de points' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComparisonResult({
  executions,
  exerciseId,
  first,
  second,
  firstLabel,
  secondLabel,
}: {
  executions: ExerciseExecution[];
  exerciseId: string;
  first: BlockSeanceProgression;
  second: BlockSeanceProgression;
  firstLabel: OptionLabel;
  secondLabel: OptionLabel;
}) {
  const result = useMemo(
    () =>
      compareBlockSeances(
        executions,
        exerciseId,
        { block: first.block, seanceId: first.seanceId },
        { block: second.block, seanceId: second.seanceId },
      ),
    [executions, exerciseId, first, second],
  );

  const firstSeries = useMemo(
    () => toWeeklySeries(result.first.curve),
    [result.first.curve],
  );
  const secondSeries = useMemo(
    () => toWeeklySeries(result.second.curve),
    [result.second.curve],
  );

  return (
    <div className="flex flex-col gap-3">
      <ComparisonChart
        first={firstSeries}
        second={secondSeries}
        winner={result.winner}
        firstLabel={oneLine(firstLabel)}
        secondLabel={oneLine(secondLabel)}
      />

      <div className="grid grid-cols-2 gap-2">
        <BlockRateCard
          label={firstLabel}
          rate={result.first.weeklyRate}
          pointCount={result.first.pointCount}
          isWinner={result.winner === 'first'}
        />
        <BlockRateCard
          label={secondLabel}
          rate={result.second.weeklyRate}
          pointCount={result.second.pointCount}
          isWinner={result.winner === 'second'}
        />
      </div>

      <Verdict
        winner={result.winner}
        firstLabel={oneLine(firstLabel)}
        secondLabel={oneLine(secondLabel)}
        firstSide={result.first}
        secondSide={result.second}
      />
    </div>
  );
}

function BlockRateCard({
  label,
  rate,
  pointCount,
  isWinner,
}: {
  label: OptionLabel;
  rate: number | null;
  pointCount: number;
  isWinner: boolean;
}) {
  // Comme ProgressionBadge : flèche (forme) + couleur + signe, jamais la couleur
  // seule (DESIGN.md ; +2,3 vs −3,0 et stagnation vs baisse sinon ambigus).
  const trend = rate === null ? null : trendOf(rate);
  const sign = rate !== null && rate > 0 ? '+' : ''; // le '−' vient du nombre négatif.

  return (
    <div
      className={`panel rounded-xl px-3 py-2 ${isWinner ? 'border-accent' : ''}`}
    >
      <p className="text-xs font-medium leading-tight text-ink">{label.seance}</p>
      <p className="readout mt-0.5 text-[10px] text-ink-faint">{label.dates}</p>
      {rate === null || trend === null ? (
        <p className="mt-1 text-xs text-ink-muted">
          {pointCount < MIN_POINTS
            ? `pas assez de points (${pointCount})`
            : 'pente indispo'}
        </p>
      ) : (
        <p className={`mt-1 flex items-center gap-1 ${trendColor(trend)}`}>
          <TrendArrow trend={trend} />
          <span className="readout text-sm font-medium">
            {sign}
            {rate.toFixed(1)}
            <span className="ml-0.5 text-xs font-normal opacity-80"> %/sem</span>
          </span>
        </p>
      )}
    </div>
  );
}

function Verdict({
  winner,
  firstLabel,
  secondLabel,
  firstSide,
  secondSide,
}: {
  winner: Side | 'tie' | null;
  firstLabel: string;
  secondLabel: string;
  firstSide: { weeklyRate: number | null; pointCount: number };
  secondSide: { weeklyRate: number | null; pointCount: number };
}) {
  // Pas de verdict si une pente manque : on explique pourquoi, sans trancher.
  if (winner === null) {
    const thin: string[] = [];
    if (firstSide.weeklyRate === null) thin.push(firstLabel);
    if (secondSide.weeklyRate === null) thin.push(secondLabel);
    return (
      <p className="text-xs text-ink-muted">
        Pas assez de points pour comparer
        {thin.length > 0 ? ` (${thin.join(' et ')})` : ''}. Continue cet exo
        sur ces périodes pour un verdict.
      </p>
    );
  }

  if (winner === 'tie') {
    return (
      <p className="text-xs text-ink-muted">
        Progression équivalente des deux côtés.
      </p>
    );
  }

  const winnerLabel = winner === 'first' ? firstLabel : secondLabel;
  return (
    <p className="text-xs text-ink">
      <span className="text-accent-ink">{winnerLabel}</span> progresse le
      plus vite.
    </p>
  );
}
