// La page d'un exo (refonte E, prototype e/analyse-exo.tsx) : la courbe e1RM de
// la 1ʳᵉ série (reps effectives pour un exo jamais chargé), parcourue au doigt.
//
// En tête, le relevé du point choisi (le plus récent par défaut) : sa mesure, sa
// date, sa séance ; à droite la pente du BLOC EN COURS de la séance en tête.
// Sous la courbe, la période de cette pente en clair (« Pente : bloc en cours
// depuis le 3 nov. · 4 séances »), et ce qui manque quand il n'y en a pas. Puis
// la légende-contrôle (une ligne par séance, toucher masque ou affiche sa
// courbe ; retenu sur l'appareil), les séries 2+ sur le même axe, et l'accès à
// la comparaison de deux blocs.
//
// Pur : il prend l'analyse déjà chargée.
import { useState } from 'react';
import { Icon, ScreenHeader, SecondaryButton, SectionTitle, Status } from '../../ui';
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
}: {
  analysis: ExerciseAnalysis;
  onBack: () => void;
  onCompare: () => void;
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
          <section aria-label="Relevé" className="flex items-end justify-between gap-4 px-5">
            <div className="min-w-0" aria-live="polite">
              <p className="flex items-baseline gap-2">
                <span className="tnum text-[56px] font-[650] leading-none tracking-[-0.045em] text-ink">
                  {Math.round(point.e1rm)}
                </span>
                <span className="text-[22px] font-medium text-muted">{unit}</span>
              </p>
              <p className="mt-2 text-[14px] text-muted">
                {formatDay(point.date, year)}
                {multi ? ` · ${selCurve.label}` : ''}
              </p>
              {isLeadLast && lastBeatsPrevious(lead.curve) && (
                <p className="mt-1 text-[14px]">
                  <Status v="up" word="mieux que la séance d’avant" />
                </p>
              )}
            </div>
            <dl className="flex-none pb-0.5 text-right">
              <dt className="text-[13px] text-muted">Pente{multi ? `, ${lead.seanceName}` : ''}</dt>
              <dd className="mt-1 text-[16px] font-medium">
                <SlopeStatus weeklyRate={lead.weeklyRate} period={lead.ratePeriod} short size={12} />
              </dd>
            </dl>
          </section>

          <div className="mt-4 px-5">
            <E1rmChart
              unit={unit}
              axis={axis}
              periodStart={lead.ratePeriod.since}
              series={shown.map((sc) => ({ id: curveKey(sc.seanceId), name: sc.label, curve: sc.curve }))}
              selected={{ series: curveKey(selCurve.seanceId), index: selIndex }}
              onSelect={setSel}
            />
            <p className="mt-2 text-[14px] leading-[1.45] text-muted">{rateCaption(lead.ratePeriod, lead.weeklyRate !== null, year)}</p>
            {note && <p className="mt-1 text-[13px] leading-[1.45] text-faint">{note}</p>}
            {holes && <p className="mt-1 text-[13px] leading-[1.45] text-faint">{holes}.</p>}
          </div>

          {multi && <Legend curves={seanceCurves} shown={shown} onToggle={toggle} year={year} />}

          {lead.secondaryCurve.length > 0 && (
            <section aria-labelledby="exo-series-2">
              <SectionTitle id="exo-series-2" aside={`${secondaryLabel(unit)}${multi ? `, ${lead.seanceName}` : ''}`}>
                Séries 2+
              </SectionTitle>
              <div className="px-5">
                <SecondaryChart curve={lead.secondaryCurve} unit={unit} axis={axis} cursorDate={point.date} />
                <p className="mt-1 text-[13px] leading-[1.45] text-faint">
                  Moyenne des séries après la première : la résistance à la fatigue, pas un record.
                </p>
              </div>
            </section>
          )}

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
