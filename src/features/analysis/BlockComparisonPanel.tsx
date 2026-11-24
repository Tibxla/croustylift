// Comparer deux options d'un exo (cf. issue #6, ADR 0016) : laquelle a fait
// progresser le plus vite ? Une option est un couple BLOC + SÉANCE : chaque
// pente lit une seule séance pendant un seul bloc, ce qui compare deux routines
// (Upper A pendant Upper/Lower contre Push pendant PPL) ou deux séances d'un
// même bloc sans mêler deux contextes de fatigue. Une option sans assez de
// points n'a pas de pente : pas de verdict, on le dit en clair.
//
// Écran E (prototype e/analyse-blocs.tsx) : les deux options en lignes A et B,
// qu'on touche pour en choisir une autre dans une feuille ; les deux courbes
// superposées, semaine par semaine ; le verdict en phrase, puis sa limite.
//
// Séparation CHARGEMENT / PRÉSENTATION : `ComparisonView` est pur (exécutions +
// blocs + séances déjà chargés), `BlockComparisonPanel` fait la lecture
// Supabase, en copie datée comme le reste de l'Analyse (hors ligne : la copie,
// ou une phrase). Tout le calcul vient du domaine pur (`summarizeBlockSeances`,
// `compareBlockSeances`, `defaultComparisonPair`).
import { useCallback, useMemo, useState } from 'react';
import type { Block, ExerciseExecution } from '../../domain/types';
import { blockKey } from '../../domain/block';
import {
  compareBlockSeances,
  defaultComparisonPair,
  summarizeBlockSeances,
  type BlockSeanceProgression,
} from '../../domain/block-comparison';
import { CopyNote, EmptyState, List, OfflineState, Row, Sheet, Status } from '../../ui';
import { BLOCKS_VIEW_PREFIX } from '../../lib/dated-read';
import { useDatedLoad } from '../../lib/use-dated-load';
import { loadBlockComparisonData, type SeanceInfo } from './data';
import { blockPeriodLabel, seanceRoutineLabel } from './block-label';
import { toWeeklySeries } from './comparison-series';
import { ComparisonChart } from './ComparisonChart';
import { formatRate } from './format';
import { sessionsLabel } from './rate-period';
import { rateVerdict, SLOPE_WORD } from './slope-words';
import { winnerVerdict } from './trend';
import { measureLabel, rateNote } from './unit-label';

/** La lecture d'un exo, en copie datée (lib/dated-read) : la `Map` des séances
 *  passe en paires, la copie passe par JSON. */
interface ComparisonCopy {
  executions: ExerciseExecution[];
  blocks: Block[];
  seances: [string, SeanceInfo][];
}

/** Lecture puis présentation. À monter avec `key={exerciseId}` : un exo, un chargement.
 *  Hors ligne : la dernière copie, datée ; sans copie, une phrase, jamais « Erreur ». */
export function BlockComparisonPanel({ exerciseId }: { exerciseId: string }) {
  const fetchComparison = useCallback(async (): Promise<ComparisonCopy> => {
    const { executions, blocks, seances } = await loadBlockComparisonData(exerciseId);
    return { executions, blocks, seances: [...seances] };
  }, [exerciseId]);
  const { state, online, showDate } = useDatedLoad(`${BLOCKS_VIEW_PREFIX}${exerciseId}`, fetchComparison);
  const seances = useMemo(() => new Map(state.phase === 'ready' ? state.value.seances : []), [state]);

  if (state.phase === 'loading') {
    return (
      <p role="status" className="px-5 py-6 text-[15px] text-muted">
        Chargement des blocs…
      </p>
    );
  }
  if (state.phase === 'offline') return <OfflineState surface="La comparaison des blocs" />;
  if (state.phase === 'error') {
    return (
      <p role="alert" className="mx-5 mt-4 break-words border-y border-line py-3 text-[15px] leading-[1.45] text-ink">
        <span className="font-semibold">Erreur : </span>Impossible de charger les blocs : {state.message}
      </p>
    );
  }
  return (
    <>
      {showDate && <CopyNote at={state.at} online={online} />}
      <ComparisonView exerciseId={exerciseId} executions={state.value.executions} blocks={state.value.blocks} seances={seances} />
    </>
  );
}

// --- Présentation (pure, montable sans réseau) -------------------------------

/** « Push · PPL » : la séance d'une option, toujours avec sa routine. */
const seanceOf = (o: BlockSeanceProgression, seances: ReadonlyMap<string, SeanceInfo>) =>
  seanceRoutineLabel(seances.get(o.seanceId));

/**
 * Le nom d'une option : sa séance, et sa période dès qu'une autre option porte
 * le même nom (même séance de la même routine dans deux blocs, le cas courant).
 */
function optionName(
  o: BlockSeanceProgression,
  options: readonly BlockSeanceProgression[],
  seances: ReadonlyMap<string, SeanceInfo>,
): string {
  const name = seanceOf(o, seances);
  return options.filter((x) => seanceOf(x, seances) === name).length > 1 ? `${name}, ${blockPeriodLabel(o.block)}` : name;
}

/** La période en méta d'une option, sauf si son nom la porte déjà (« du 28/03 au 23/11 · »). */
function datesOf(
  o: BlockSeanceProgression,
  options: readonly BlockSeanceProgression[],
  seances: ReadonlyMap<string, SeanceInfo>,
): string {
  return optionName(o, options, seances) === seanceOf(o, seances) ? `${blockPeriodLabel(o.block)} · ` : '';
}

/** La pente d'une option en signe + mot, ou ce qui lui manque. */
function OptionRate({ rate, points }: { rate: number | null; points: number }) {
  // Le nombre de séances est écrit juste au-dessus : sans pente, on ne le répète pas.
  if (rate === null) return <span className="text-muted">{points === 0 ? 'aucune séance' : 'pas de pente'}</span>;
  const v = rateVerdict(rate);
  return <Status v={v} word={`${SLOPE_WORD[v]} · ${formatRate(rate)} %/sem`} />;
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
  const options = useMemo(() => summarizeBlockSeances(executions, exerciseId, blocks), [executions, exerciseId, blocks]);
  // Pré-sélection : la plus récente face à la plus récente d'un autre bloc. Un
  // choix de l'utilisateur la remplace, côté par côté.
  const pair = useMemo(() => defaultComparisonPair(options), [options]);
  const [picked, setPicked] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);

  const ia = picked.a ?? pair?.[0] ?? null;
  const ib = picked.b ?? pair?.[1] ?? null;
  const a = ia === null ? undefined : options[ia];
  const b = ib === null ? undefined : options[ib];

  if (options.length < 2 || !a || !b) {
    return (
      <EmptyState
        title="Rien à comparer"
        body={
          options.length === 0
            ? 'Cet exo n’a encore aucune séance.'
            : 'Cet exo n’a été fait que dans une seule séance d’un seul bloc. Il en faut deux pour comparer.'
        }
      />
    );
  }

  const sides = [
    ['a', a],
    ['b', b],
  ] as const;

  return (
    <>
      <List label="Options comparées">
        {sides.map(([side, o]) => (
          <Row
            key={side}
            lead={side.toUpperCase()}
            title={optionName(o, options, seances)}
            meta={
              <>
                <span className="block">
                  {datesOf(o, options, seances)}
                  {sessionsLabel(o.pointCount)}
                </span>
                <span className="mt-0.5 block">
                  <OptionRate rate={o.weeklyRate} points={o.pointCount} />
                </span>
              </>
            }
            onClick={() => setPicking(side)}
            ariaLabel={`Option ${side.toUpperCase()} : ${optionName(o, options, seances)}, ${blockPeriodLabel(o.block)}. Changer`}
          />
        ))}
      </List>

      <ComparisonResult
        executions={executions}
        exerciseId={exerciseId}
        a={a}
        b={b}
        aLabel={optionName(a, options, seances)}
        bLabel={optionName(b, options, seances)}
      />

      <Sheet open={picking !== null} title={picking === 'a' ? 'Option A' : 'Option B'} onClose={() => setPicking(null)}>
        <List label="Options">
          {options
            .map((o, index) => ({ o, index }))
            .reverse()
            .map(({ o, index }) => {
              const other = picking === 'a' ? ib : ia;
              const mine = picking === 'a' ? ia : ib;
              const taken = index === other;
              return (
                <Row
                  key={`${blockKey(o.block)}:${o.seanceId}`}
                  title={optionName(o, options, seances)}
                  meta={`${datesOf(o, options, seances)}${sessionsLabel(o.pointCount)}${o.weeklyRate === null ? ', pas de pente' : ''}`}
                  value={taken ? <span className="text-[14px] font-normal text-faint">déjà en {picking === 'a' ? 'B' : 'A'}</span> : undefined}
                  valueMeta={index === mine ? 'actuelle' : undefined}
                  current={index === mine}
                  muted={taken}
                  onClick={
                    taken
                      ? undefined
                      : () => {
                          setPicked((p) => (picking === 'a' ? { ...p, a: index } : { ...p, b: index }));
                          setPicking(null);
                        }
                  }
                />
              );
            })}
        </List>
      </Sheet>
    </>
  );
}

function ComparisonResult({
  executions,
  exerciseId,
  a,
  b,
  aLabel,
  bLabel,
}: {
  executions: ExerciseExecution[];
  exerciseId: string;
  a: BlockSeanceProgression;
  b: BlockSeanceProgression;
  aLabel: string;
  bLabel: string;
}) {
  const result = useMemo(
    () =>
      compareBlockSeances(
        executions,
        exerciseId,
        { block: a.block, seanceId: a.seanceId },
        { block: b.block, seanceId: b.seanceId },
      ),
    [executions, exerciseId, a, b],
  );
  const first = useMemo(() => toWeeklySeries(result.first.curve), [result.first.curve]);
  const second = useMemo(() => toWeeklySeries(result.second.curve), [result.second.curve]);
  const note = rateNote(result.unit);

  return (
    <>
      <div className="px-5 pt-5">
        <ComparisonChart first={first} second={second} firstLabel={aLabel} secondLabel={bLabel} unit={result.unit} />
        <p className="mt-1 text-[13px] text-faint">
          {measureLabel(result.unit)} de la 1ʳᵉ série, semaine par semaine depuis le début de chaque option.
        </p>
      </div>

      <section aria-label="Verdict" className="px-5 pt-5">
        <Verdict
          winner={result.winner}
          a={{ name: `A (${aLabel})`, rate: result.first.weeklyRate, points: result.first.pointCount }}
          b={{ name: `B (${bLabel})`, rate: result.second.weeklyRate, points: result.second.pointCount }}
        />
      </section>
      {note && <p className="px-5 pt-3 text-[14px] leading-[1.45] text-faint">{note}</p>}
      <p className="px-5 pt-3 text-[14px] leading-[1.45] text-faint">
        Une lecture de pentes, pas une preuve : séances, ordre, fréquence et période de l’année changent ensemble.
      </p>
    </>
  );
}

interface VerdictSide {
  name: string;
  rate: number | null;
  points: number;
}

function Verdict({ winner, a, b }: { winner: 'first' | 'second' | 'tie' | null; a: VerdictSide; b: VerdictSide }) {
  const big = 'text-[18px] font-medium leading-[1.4] tracking-[-0.01em] text-ink';
  const small = 'mt-1.5 text-[15px] leading-[1.45] text-muted';
  const rates = `${a.rate === null ? '' : `${formatRate(a.rate)} %/sem en A`}${a.rate !== null && b.rate !== null ? ', ' : ''}${
    b.rate === null ? '' : `${formatRate(b.rate)} %/sem en B`
  }.`;

  // Pas de verdict si une pente manque : on dit laquelle et pourquoi.
  if (winner === null) {
    const thin = [a, b].filter((s) => s.rate === null);
    return (
      <>
        <p className={big}>Pas de verdict.</p>
        <p className={small}>
          {thin.map((s) => s.name).join(' et ')} : pas de pente, il faut des séances sur trois jours différents au moins.
        </p>
      </>
    );
  }
  if (winner === 'tie') {
    return (
      <>
        <p className={big}>Même vitesse des deux côtés.</p>
        <p className={small}>{rates}</p>
      </>
    );
  }
  const w = winner === 'first' ? a : b;
  // La meilleure pente ne « progresse » que si elle monte : entre deux baisses,
  // elle recule le moins (cf. `winnerVerdict`). Un gagnant a toujours une pente.
  return (
    <>
      <p className={big}>
        {w.name} {winnerVerdict(w.rate ?? 0)}.
      </p>
      <p className={small}>{rates}</p>
    </>
  );
}
