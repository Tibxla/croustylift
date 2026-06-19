// Panneau de comparaison de deux blocs d'un exercice (cf. issue #6).
//
// L'utilisateur choisit deux blocs ; on superpose leurs pentes de progression
// e1RM (%/semaine) et on désigne le plus rapide. « Quel volume me fait le plus
// progresser ». Un bloc sans assez de points n'a pas de pente : pas de verdict
// trompeur, on le dit en clair.
//
// Séparation CHARGEMENT / PRÉSENTATION comme `AnalysisScreen` : `ComparisonView`
// est pur (prend exécutions + blocs déjà chargés), montable sans réseau dans le
// harness de screenshot ; le wrapper `BlockComparisonPanel` fait la lecture
// Supabase. Tout le calcul vient du domaine pur (`summarizeBlocks`,
// `compareBlocks`).
import { useEffect, useMemo, useState } from 'react';
import type { Block, ExerciseExecution } from '../../domain/types';
import {
  compareBlocks,
  summarizeBlocks,
  type Side,
} from '../../domain/block-comparison';
import { loadBlockComparisonData } from './data';
import { blockLabel } from './block-label';
import { toWeeklySeries } from './comparison-series';
import { ComparisonChart } from './ComparisonChart';
import { TrendArrow, trendColor, trendOf } from './TrendArrow';

/** Sous ce nombre de points, un bloc n'a pas de pente fiable (cf. weeklyProgressionRate). */
const MIN_POINTS = 3;

// --- Wrapper (chargement Supabase) -------------------------------------------

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; executions: ExerciseExecution[]; blocks: Block[] };

export function BlockComparisonPanel({
  exerciseId,
}: {
  exerciseId: string;
}) {
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    setLoad({ phase: 'loading' });

    void (async () => {
      try {
        const { executions, blocks } = await loadBlockComparisonData(exerciseId);
        if (!active) return;
        setLoad({ phase: 'ready', executions, blocks });
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
    />
  );
}

// --- Présentation (pure, montable sans réseau) -------------------------------

export function ComparisonView({
  exerciseId,
  executions,
  blocks,
}: {
  exerciseId: string;
  executions: ExerciseExecution[];
  blocks: Block[];
}) {
  // Progression de chaque bloc pour CET exo (courbe + pente + nb de points).
  const summaries = useMemo(
    () => summarizeBlocks(executions, exerciseId, blocks),
    [executions, exerciseId, blocks],
  );

  // On ne propose à la comparaison que les blocs où l'exo a été travaillé : un
  // bloc sans aucun point pour cet exo n'a rien à comparer. Index d'origine
  // conservé pour repointer vers `blocks`.
  const options = useMemo(
    () =>
      summaries
        .map((summary, index) => ({ summary, index }))
        .filter((o) => o.summary.pointCount > 0),
    [summaries],
  );

  const [firstIdx, setFirstIdx] = useState<number | null>(null);
  const [secondIdx, setSecondIdx] = useState<number | null>(null);

  // Pré-sélectionne les deux blocs les plus récents dès qu'il y en a assez (les
  // blocs arrivent triés par date croissante : les deux derniers de `options`).
  useEffect(() => {
    if (options.length >= 2 && firstIdx === null && secondIdx === null) {
      const beforeLast = options[options.length - 2];
      const last = options[options.length - 1];
      if (beforeLast && last) {
        setFirstIdx(beforeLast.index);
        setSecondIdx(last.index);
      }
    }
  }, [options, firstIdx, secondIdx]);

  if (blocks.length < 2 || options.length < 2) {
    return (
      <p className="px-1 py-2 text-xs text-ink-muted">
        Il faut au moins deux blocs où cet exo a été travaillé pour comparer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <BlockSelect
          label="Premier bloc"
          options={options}
          value={firstIdx}
          exclude={secondIdx}
          onChange={setFirstIdx}
        />
        <BlockSelect
          label="Second bloc"
          options={options}
          value={secondIdx}
          exclude={firstIdx}
          onChange={setSecondIdx}
        />
      </div>

      {firstIdx !== null &&
        secondIdx !== null &&
        blocks[firstIdx] &&
        blocks[secondIdx] && (
          <ComparisonResult
            executions={executions}
            exerciseId={exerciseId}
            first={blocks[firstIdx]}
            second={blocks[secondIdx]}
          />
        )}
    </div>
  );
}

interface BlockOption {
  summary: { block: Block; pointCount: number; weeklyRate: number | null };
  index: number;
}

function BlockSelect({
  label,
  options,
  value,
  exclude,
  onChange,
}: {
  label: string;
  options: BlockOption[];
  value: number | null;
  exclude: number | null;
  onChange: (index: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <select
        className="h-11 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink"
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.index} value={o.index} disabled={o.index === exclude}>
            {blockLabel(o.summary.block)}
            {o.summary.pointCount < MIN_POINTS ? ' · trop peu de points' : ''}
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
}: {
  executions: ExerciseExecution[];
  exerciseId: string;
  first: Block;
  second: Block;
}) {
  const result = useMemo(
    () => compareBlocks(executions, exerciseId, first, second),
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
        firstLabel={blockLabel(first)}
        secondLabel={blockLabel(second)}
      />

      <div className="grid grid-cols-2 gap-2">
        <BlockRateCard
          label={blockLabel(first)}
          rate={result.first.weeklyRate}
          pointCount={result.first.pointCount}
          isWinner={result.winner === 'first'}
        />
        <BlockRateCard
          label={blockLabel(second)}
          rate={result.second.weeklyRate}
          pointCount={result.second.pointCount}
          isWinner={result.winner === 'second'}
        />
      </div>

      <Verdict
        winner={result.winner}
        firstLabel={blockLabel(first)}
        secondLabel={blockLabel(second)}
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
  label: string;
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
      className={`rounded-xl border bg-surface-2 px-3 py-2 ${
        isWinner ? 'border-accent' : 'border-line'
      }`}
    >
      <p className="readout text-[11px] text-ink-muted">{label}</p>
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
        {thin.length > 0 ? ` (bloc ${thin.join(' et ')})` : ''}. Continue cet exo
        sur ces blocs pour un verdict.
      </p>
    );
  }

  if (winner === 'tie') {
    return (
      <p className="text-xs text-ink-muted">
        Progression équivalente sur les deux blocs.
      </p>
    );
  }

  const winnerLabel = winner === 'first' ? firstLabel : secondLabel;
  return (
    <p className="text-xs text-ink">
      <span className="text-accent-ink">Bloc {winnerLabel}</span> progresse le
      plus vite.
    </p>
  );
}
