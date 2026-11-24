// La page d'un exo (refonte E, prototype e/analyse-exo.tsx) : la courbe e1RM de
// la 1ʳᵉ série (reps effectives pour un exo jamais chargé), parcourue au doigt.
//
// En tête, le relevé du point choisi (le plus récent par défaut) : sa mesure, sa
// date, sa séance ; à droite la pente du BLOC EN COURS de la séance en tête.
// Sous la courbe, la période de cette pente en clair (« Pente : bloc en cours
// depuis le 3 nov. · 4 séances »), et ce qui manque quand il n'y en a pas. Puis
// la légende-contrôle (une ligne par séance, toucher masque ou affiche sa
// courbe ; retenu sur l'appareil), les séries 2+ sur le même axe, les séries
// du point choisi (« point de la courbe » sur la 1ʳᵉ, e1RM par ligne, kg
// soulevés) avec un lien vers sa séance au journal, les faits datés (Record,
// charge la plus lourde, écart depuis la 1ʳᵉ séance), et la comparaison.
//
// La courbe vient de l'analyse déjà chargée ; les séries d'un point, le Record
// et les faits viennent des exécutions de l'exo, relues à l'ouverture
// (`loadExerciseExecutions`) : `ExerciseAnalysis` n'a que des points.
import { useEffect, useState } from 'react';
import { Icon, List, Row, ScreenHeader, SecondaryButton, SectionTitle, Sign, Status, TextLink } from '../../ui';
import type { ExerciseExecution } from '../../domain/types';
import { liftedKg } from '../../domain/lifted';
import { errorMessage } from '../../lib/error-message';
import { formatE1rm, formatWeight } from '../capture/format';
import { loadExerciseExecutions } from './data';
import { formatInt } from './format';
import { exerciseFacts, gapBreaks, pointExecutions, secondaryBreaks, setMeasure } from './point-detail';
import { loadHiddenCurves, saveHiddenCurves } from '../../lib/local-prefs';
import type { ExerciseAnalysis, SeanceCurve } from './data';
import { Swatch, type ChartSel } from './Chart';
import { cardTimeAxis, lastBeatsPrevious } from './chart-time';
import { curveKey, toggleHidden, visibleCurves } from './curve-visibility';
import { E1rmChart } from './E1rmChart';
import { formatDay, rateCaption, sessionsLabel } from './rate-period';
import { SecondaryChart } from './SecondaryChart';
import { SlopeStatus } from './SlopeStatus';
import { measureLabel, rateNote, secondaryLabel, zeroLoadHolesLabel } from './unit-label';

export function ExercisePage({
  analysis,
  onBack,
  onCompare,
  onOpenSession,
  loadExecutions = loadExerciseExecutions,
}: {
  analysis: ExerciseAnalysis;
  onBack: () => void;
  onCompare: () => void;
  /** Ouvre une séance du journal, par id d'exécution. */
  onOpenSession: (executionId: string) => void;
  /** La lecture des exécutions de l'exo ; un banc de captures y branche ses données. */
  loadExecutions?: (exerciseId: string) => Promise<{ executions: ExerciseExecution[] }>;
}) {
  const { exerciseId, name, seanceCurves, unit } = analysis;
  const year = new Date().getFullYear();
  // Courbes masquées depuis la légende, retenues sur l'appareil pour cet exo
  // (liste des MASQUÉES : une séance neuve apparaît d'elle-même).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadHiddenCurves(exerciseId)));
  const [sel, setSel] = useState<ChartSel | null>(null);
  const allKeys = seanceCurves.map((sc) => curveKey(sc.seanceId));
  const shown = visibleCurves(seanceCurves, hidden);
  const lead = shown[0] ?? null;
  const multi = seanceCurves.length > 1;
  const axis = cardTimeAxis(shown);
  const total = seanceCurves.reduce((n, sc) => n + sc.curve.length, 0);
  const execs = useExecutions(exerciseId, loadExecutions);

  function toggle(key: string) {
    const next = toggleHidden(hidden, key, allKeys);
    setHidden(next);
    setSel(null);
    saveHiddenCurves(exerciseId, [...next].filter((k) => allKeys.includes(k)));
  }

  // Le point lu : celui choisi au doigt, sinon le dernier de la séance en tête.
  const selCurve = (sel && shown.find((sc) => curveKey(sc.seanceId) === sel.series)) || lead;
  const selIndex =
    sel && selCurve && curveKey(selCurve.seanceId) === sel.series ? sel.index : (selCurve?.curve.length ?? 0) - 1;
  const point = selCurve?.curve[selIndex];
  const isLeadLast = !!lead && selCurve === lead && selIndex === lead.curve.length - 1;
  const holes = zeroLoadHolesLabel(analysis.zeroLoadHoles);
  const note = lead?.weeklyRate != null ? rateNote(unit) : null;
  const ready = execs.phase === 'ready' ? execs.executions : null;
  const facts = ready ? exerciseFacts(ready, exerciseId, unit) : null;
  // L'exécution du point lu : même construction que la courbe (point-detail).
  const exec = ready && selCurve ? pointExecutions(ready, exerciseId, selCurve.seanceId, unit)[selIndex] : undefined;
  const cut = shown.some((sc) => gapBreaks(sc.curve).some(Boolean));
  const cut2 = !!lead && secondaryBreaks(lead.secondaryCurve, lead.curve).some(Boolean);
  const fmtValue = (v: number) => (unit === 'reps' ? String(Math.round(v)) : formatE1rm(v));
  const valueText = (s: ChartSel) => {
    const c = shown.find((sc) => curveKey(sc.seanceId) === s.series);
    const p = c?.curve[s.index];
    return p && c ? `${fmtValue(p.e1rm)} ${unit}, ${formatDay(p.date, year)}${multi ? `, ${c.label}` : ''}` : '';
  };

  return (
    <>
      <ScreenHeader
        title={name}
        meta={`${measureLabel(unit)} de la 1ʳᵉ série · ${sessionsLabel(total)}`}
        back={{ label: 'Analyse', onClick: onBack }}
      />

      {!lead || !point || !selCurve ? (
        <p className="mx-5 border-y border-line py-10 text-[17px] leading-[1.45] text-muted">
          Aucune courbe : toutes les 1ʳᵉˢ séries sont à 0 kg. La courbe partira de la première série chargée.
        </p>
      ) : (
        <>
          <section aria-label="Relevé" className="px-5">
            <div className="flex items-end justify-between gap-4">
              <p className="flex items-baseline gap-2" aria-live="polite">
                <span className="tnum text-[56px] font-[650] leading-none tracking-[-0.045em] text-ink">
                  {fmtValue(point.e1rm)}
                </span>
                <span className="text-[22px] font-medium text-muted">{unit}</span>
              </p>
              <dl className="flex-none pb-0.5 text-right">
                <dt className="text-[13px] text-muted">Pente{multi ? `, ${lead.seanceName}` : ''}</dt>
                <dd className="mt-1 text-[16px] font-medium">
                  <SlopeStatus weeklyRate={lead.weeklyRate} period={lead.ratePeriod} short size={12} />
                </dd>
              </dl>
            </div>
            {/* Date et verdict sur toute la largeur, une ligne chacun : la place de
                « mieux que la séance d'avant » est réservée, le graphe ne saute pas
                quand on quitte le dernier point. */}
            <p className="mt-2 text-[14px] text-muted">
              {formatDay(point.date, year)}
              {multi ? ` · ${selCurve.label}` : ''}
            </p>
            <p className="mt-1 h-[21px] whitespace-nowrap text-[14px]">
              {isLeadLast && lastBeatsPrevious(lead.curve) && <Status v="up" word="mieux que la séance d’avant" />}
            </p>
          </section>

          <div className="mt-4 px-5">
            <E1rmChart
              unit={unit}
              axis={axis}
              periodStart={lead.ratePeriod.since}
              series={shown.map((sc) => ({ id: curveKey(sc.seanceId), name: sc.label, curve: sc.curve }))}
              selected={{ series: curveKey(selCurve.seanceId), index: selIndex }}
              onSelect={setSel}
              valueText={valueText}
              record={facts?.record ? { value: facts.record.value, label: `Record ${fmtValue(facts.record.value)}` } : undefined}
            />
            <p className="mt-2 text-[14px] leading-[1.45] text-muted">{rateCaption(lead.ratePeriod, lead.weeklyRate !== null, year)}</p>
            {note && <p className="mt-1 text-[13px] leading-[1.45] text-faint">{note}</p>}
            {holes && <p className="mt-1 text-[13px] leading-[1.45] text-faint">{holes}.</p>}
            {cut && <p className="mt-1 text-[13px] leading-[1.45] text-faint">Trait coupé : plus de trois semaines sans séance.</p>}
          </div>

          {multi && <Legend curves={seanceCurves} shown={shown} onToggle={toggle} year={year} />}

          {lead.secondaryCurve.length > 0 && (
            <section aria-labelledby="exo-series-2">
              <SectionTitle id="exo-series-2" aside={`${secondaryLabel(unit)}${multi ? `, ${lead.seanceName}` : ''}`}>
                Séries 2+
              </SectionTitle>
              <div className="px-5">
                <SecondaryChart curve={lead.secondaryCurve} primary={lead.curve} unit={unit} axis={axis} cursorDate={point.date} />
                <p className="mt-1 text-[13px] leading-[1.45] text-faint">
                  Moyenne des séries après la première : la résistance à la fatigue, pas un record.
                  {cut2 ? ' Trait coupé : pas de série 2+ ce jour-là, ou pas de séance.' : ''}
                </p>
              </div>
            </section>
          )}

          <PointSets
            date={formatDay(point.date, year)}
            exec={exec}
            phase={execs.phase}
            unit={unit}
            onOpenSession={onOpenSession}
          />

          {facts && <Facts facts={facts} lead={lead} unit={unit} year={year} fmtValue={fmtValue} />}

          <div className="px-5 pt-8">
            <SecondaryButton onClick={onCompare} className="w-full">
              Comparer deux blocs
            </SecondaryButton>
          </div>
        </>
      )}
    </>
  );
}

/** Légende-contrôle : une ligne par séance. Toucher masque ou affiche sa courbe ;
 *  la dernière courbe affichée ne se masque pas. Une courbe masquée garde son
 *  nom, barré et éteint : on sait ce qu'on peut ré-afficher. */
function Legend({
  curves,
  shown,
  onToggle,
  year,
}: {
  curves: SeanceCurve[];
  shown: SeanceCurve[];
  onToggle: (key: string) => void;
  year: number;
}) {
  return (
    <ul aria-label="Courbes par séance" className="mt-3 flex flex-col px-5">
      {curves.map((c) => {
        const key = curveKey(c.seanceId);
        const rank = shown.indexOf(c);
        const hidden = rank === -1;
        const lastVisible = !hidden && shown.length === 1;
        const first = c.curve[0];
        const last = c.curve[c.curve.length - 1];
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onToggle(key)}
              disabled={lastVisible}
              aria-pressed={!hidden}
              aria-label={lastVisible ? `${c.label}, seule courbe affichée` : `${hidden ? 'Afficher' : 'Masquer'} la courbe ${c.label}`}
              className="flex min-h-12 w-full items-center gap-3 py-1 text-left active:opacity-70"
            >
              <span className="flex w-[22px] flex-none justify-center">
                {!hidden && <Swatch tone={rank === 0 ? 'ink' : 'muted'} dashed={rank > 0} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={`break-words text-[15px] ${hidden ? 'text-faint line-through' : rank === 0 ? 'font-semibold text-ink' : 'text-muted'}`}
                  >
                    {c.label}
                  </span>
                  {!hidden && <SlopeStatus weeklyRate={c.weeklyRate} period={c.ratePeriod} short className="flex-none text-[14px]" />}
                </span>
                {first && last && (
                  <span className="block text-[14px] text-muted">
                    {sessionsLabel(c.curve.length)}, du {formatDay(first.date, year)} au {formatDay(last.date, year)}
                  </span>
                )}
              </span>
              <span className={`flex-none ${lastVisible ? 'text-dim' : 'text-muted'}`}>
                <Icon name={hidden ? 'eye-off' : 'eye'} />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type ExecLoad = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; executions: ExerciseExecution[] };

/** Les exécutions de l'exo, relues à l'ouverture de sa page (montée par `key`). */
function useExecutions(
  exerciseId: string,
  load: (exerciseId: string) => Promise<{ executions: ExerciseExecution[] }>,
): ExecLoad {
  const [state, setState] = useState<ExecLoad>({ phase: 'loading' });
  useEffect(() => {
    let active = true;
    load(exerciseId).then(
      ({ executions }) => {
        if (active) setState({ phase: 'ready', executions });
      },
      (err: unknown) => {
        if (active) setState({ phase: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [exerciseId, load]);
  return state;
}

const sideWord = (s: 'left' | 'right') => (s === 'left' ? 'gauche' : 'droite');

/** Les séries du point lu, telles que loggées, et le lien vers sa séance. */
function PointSets({
  date,
  exec,
  phase,
  unit,
  onOpenSession,
}: {
  date: string;
  exec: ExerciseExecution | undefined;
  phase: ExecLoad['phase'];
  unit: ExerciseAnalysis['unit'];
  onOpenSession: (executionId: string) => void;
}) {
  const sets = exec ? [...exec.sets].sort((a, b) => a.order - b.order || (a.side ?? '').localeCompare(b.side ?? '')) : [];
  return (
    <section aria-labelledby="exo-series-point">
      <SectionTitle id="exo-series-point" aside={exec ? `${formatInt(liftedKg(exec.sets))} kg soulevés` : undefined}>
        Séries du {date}
      </SectionTitle>
      {phase === 'loading' ? (
        <p role="status" className="border-t border-line px-5 py-3 text-[15px] text-muted">
          Chargement des séries…
        </p>
      ) : !exec ? (
        <p className="border-t border-line px-5 py-3 text-[15px] leading-[1.45] text-muted">
          {phase === 'error' ? 'Séries indisponibles pour l’instant.' : 'Séries introuvables pour ce point.'}
        </p>
      ) : (
        <>
          <List label={`Séries du ${date}`}>
            {sets.map((set) => {
              const m = setMeasure(set, unit);
              const first = set.order === sets[0]!.order;
              return (
                <Row
                  key={`${set.order}-${set.side ?? 'both'}`}
                  lead={set.order}
                  title={`${formatWeight(set.weightKg)} kg × ${set.reps} · RIR ${set.rir}`}
                  meta={[set.side ? sideWord(set.side) : null, first ? 'point de la courbe' : null].filter(Boolean).join(' · ') || undefined}
                  valueMeta={m === null ? 'à 0 kg' : unit === 'reps' ? `${Math.round(m)} reps eff.` : `e1RM ${formatE1rm(m)}`}
                />
              );
            })}
          </List>
          {exec.id && (
            <div className="px-5 pt-1">
              <TextLink onClick={() => onOpenSession(exec.id!)}>Voir au journal</TextLink>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Faits datés, dérivés de l'historique : rien de saisi, tout vérifiable. */
function Facts({
  facts,
  lead,
  unit,
  year,
  fmtValue,
}: {
  facts: ReturnType<typeof exerciseFacts>;
  lead: SeanceCurve;
  unit: ExerciseAnalysis['unit'];
  year: number;
  fmtValue: (v: number) => string;
}) {
  const first = lead.curve[0];
  const last = lead.curve[lead.curve.length - 1];
  const delta = first && last ? Math.round((last.e1rm - first.e1rm) * 10) / 10 : null;
  const unitWord = unit === 'reps' ? 'reps' : 'kg';
  const signed = (d: number) => `${d > 0 ? '+' : d < 0 ? '\u2212' : ''}${fmtValue(Math.abs(d))} ${unitWord}`;
  return (
    <section aria-labelledby="exo-faits">
      <SectionTitle id="exo-faits">Faits</SectionTitle>
      <List label="Faits datés">
        {facts.record && (
          <Row
            title={unit === 'reps' ? 'Record, reps effectives' : 'Record e1RM'}
            meta={`${formatWeight(facts.record.set.weightKg)} kg × ${facts.record.set.reps} · RIR ${facts.record.set.rir}${
              facts.record.date ? `, ${formatDay(facts.record.date, year)}` : ''
            }`}
            value={fmtValue(facts.record.value)}
          />
        )}
        {facts.heaviest && unit === 'kg' && (
          <Row
            title="Charge la plus lourde"
            meta={`${formatWeight(facts.heaviest.weightKg)} kg × ${facts.heaviest.reps}${facts.heaviest.date ? `, ${formatDay(facts.heaviest.date, year)}` : ''}`}
            value={formatWeight(facts.heaviest.weightKg)}
          />
        )}
        {delta !== null && first && lead.curve.length > 1 && (
          <Row
            title={`Depuis la 1ʳᵉ ${lead.seanceName}`}
            meta={`${sessionsLabel(lead.curve.length)} depuis le ${formatDay(first.date, year)}`}
            // Un écart depuis le départ n'est ni une série battue, ni un record, ni
            // une pente : blanc cassé, avec son signe et son chiffre.
            value={
              <span className="inline-flex items-center gap-1 text-ink">
                <Sign v={delta > 0 ? 'up' : delta === 0 ? 'eq' : 'down'} size={12} />
                {signed(delta)}
              </span>
            }
          />
        )}
      </List>
    </section>
  );
}
