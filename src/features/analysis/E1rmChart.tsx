// La courbe héros d'un exo : e1RM de la 1ʳᵉ série (reps effectives pour un exo
// jamais chargé), une courbe PAR SÉANCE où l'exo est fait (issue #67) :
// superposées, jamais mélangées, un même exo n'ayant pas la même perf selon la
// fatigue de la séance.
//
// La séance la plus récemment exécutée parmi les AFFICHÉES (1ʳᵉ du tableau)
// porte la lecture : trait blanc cassé plein. Les autres sont grises et
// pointillées, nommées par la légende de la page (jamais la couleur seule). Le
// signal ne marque que le dernier point de la séance en tête, s'il bat le point
// d'avant de la même séance (« mieux que la dernière fois »).
//
// AXE X en temps réel (chart-time.ts), commun à la courbe et aux séries 2+ de la
// carte (`cardTimeAxis`) : une pause se voit, deux séances aux dates différentes
// s'alignent honnêtement. Un trait vertical pointillé marque le début du bloc
// en cours quand des points le précèdent : ce qui est à sa gauche n'entre pas
// dans la pente.
import type { CurveUnit, E1rmPoint } from '../../domain/types';
import { Chart, type ChartSel, type ChartSeries } from './Chart';
import { dayToTime, lastBeatsPrevious, timeTick, type TimeAxis } from './chart-time';
import { gapBreaks } from './point-detail';
import { measureLabel } from './unit-label';

/** Une courbe nommée : la série d'UNE séance. */
export interface E1rmSeries {
  /** Clé stable (id de séance), jamais le nom : deux séances peuvent porter le même. */
  id: string;
  /** Libellé de la séance. */
  name: string;
  curve: E1rmPoint[];
}

/** Résumé textuel des courbes pour les lecteurs d'écran (le SVG est muet). */
function describeSeries(series: E1rmSeries[], unit: CurveUnit, multi: boolean): string {
  const title = `Courbe ${measureLabel(unit)} de la 1ʳᵉ série`;
  const parts = series
    .filter((s) => s.curve.length > 0)
    .map((s) => {
      const values = s.curve.map((p) => Math.round(p.e1rm));
      return `${multi ? `${s.name} ` : ''}sur ${values.length} séances, de ${Math.min(...values)} à ${Math.max(...values)} ${unit}`;
    });
  return parts.length === 0
    ? `${title}, aucune donnée.`
    : `${title} : ${parts.join(' ; ')}. Glisser ou flèches pour parcourir les points.`;
}

export function E1rmChart({
  series,
  unit,
  axis,
  periodStart,
  selected,
  onSelect,
  record,
  valueText,
  height = 232,
}: {
  /** Les courbes AFFICHÉES, celle qui porte la lecture en tête. */
  series: E1rmSeries[];
  unit: CurveUnit;
  /** L'axe temps de la carte (cf. `cardTimeAxis`), partagé avec les séries 2+. */
  axis: TimeAxis | null;
  /** Jour ISO où s'ouvre le bloc de la pente : repère vertical s'il tombe dans la courbe. */
  periodStart?: string | null;
  selected: ChartSel | null;
  onSelect: (s: ChartSel) => void;
  /** Le Record personnel (même unité), en ligne pointillée nommée. */
  record?: { value: number; label: string };
  /** Le point choisi en mots, pour le curseur des lecteurs d'écran. */
  valueText: (sel: ChartSel) => string;
  height?: number;
}) {
  const populated = series.filter((s) => s.curve.length > 0);
  const accent = populated[0];
  const firstT = accent?.curve[0] ? dayToTime(accent.curve[0].date) : null;
  const startT = periodStart != null ? dayToTime(periodStart) : null;
  // Le repère n'a de sens que DANS le tracé : après le premier point (sinon toute
  // la courbe est dans le bloc) et avant la fin de l'axe (sinon rien n'est dedans).
  const lastT = axis?.domain[1] ?? null;
  const marker =
    startT !== null && firstT !== null && lastT !== null && startT > firstT && startT <= lastT
      ? { x: startT, label: 'bloc' }
      : undefined;

  const chartSeries: ChartSeries[] = populated.map((s, i) => {
    const breaks = gapBreaks(s.curve);
    return {
    id: s.id,
    tone: i === 0 ? 'ink' : 'muted',
    dashed: i > 0,
    lastUp: i === 0 && lastBeatsPrevious(s.curve),
    // Une pause de plus de trois semaines coupe le trait : pas de tendance inventée.
    points: s.curve.map((p, k) => ({ x: dayToTime(p.date), y: p.e1rm, break: breaks[k] })),
    };
  });

  return (
    <Chart
      series={chartSeries}
      height={height}
      selected={selected}
      onSelect={onSelect}
      xDomain={axis?.domain}
      xTicks={(axis?.ticks ?? []).map((t) => ({ x: t, label: timeTick(t) }))}
      yFormat={(v) => String(Math.round(v))}
      marker={marker}
      refLine={record ? { y: record.value, label: record.label } : undefined}
      months
      ariaLabel={describeSeries(series, unit, populated.length > 1)}
      sliderLabel={`Point de la courbe ${measureLabel(unit)}`}
      valueText={valueText}
    />
  );
}
