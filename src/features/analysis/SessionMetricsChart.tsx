// Durée et BPM moyen dans le temps (cf. issue #28) : deux PETITS graphes
// empilés qui partagent l'axe du temps et le même doigt, jamais un graphe à deux
// axes Y (deux échelles sur un tracé se lisent l'une pour l'autre). Points
// seuls : une mesure par séance, rien d'interpolé. Une séance sans BPM n'a pas
// de point dans le second, et le curseur y passe quand même : un trou reste un
// trou, jamais un zéro.
//
// Le relevé au-dessus suit le point choisi (le plus récent par défaut).
import { useState } from 'react';
import type { E1rmPoint } from '../../domain/types';
import { Chart, type ChartSel } from './Chart';
import { dayToTime, timeAxis, timeTick } from './chart-time';
import { formatDuration } from './format';
import { formatDay } from './rate-period';
import type { SessionMetricPoint } from './session-metrics';

export function SessionMetricsChart({ points }: { points: SessionMetricPoint[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  if (points.length === 0) return null;
  const k = Math.min(picked ?? points.length - 1, points.length - 1);
  const p = points[k]!;
  const year = new Date().getFullYear();
  // L'axe commun : `timeAxis` lit des points datés, la valeur n'y compte pas.
  const axis = timeAxis([points.map((m): E1rmPoint => ({ date: m.date, e1rm: 0 }))]);
  const ticks = (axis?.ticks ?? []).map((t) => ({ x: t, label: timeTick(t) }));
  // Chaque graphe garde le rang de la séance dans `points`, pour lier le doigt.
  const duration = points.flatMap((m, at) => (m.durationMin === null ? [] : [{ x: dayToTime(m.date), y: m.durationMin, at }]));
  const bpm = points.flatMap((m, at) => (m.bpmAvg === null ? [] : [{ x: dayToTime(m.date), y: m.bpmAvg, at }]));
  const selIn = (list: { at: number }[], id: string): ChartSel | null => {
    const i = list.findIndex((q) => q.at === k);
    return i >= 0 ? { series: id, index: i } : null;
  };
  const cursor = dayToTime(p.date);

  return (
    <div>
      <p className="flex items-baseline justify-between gap-3 px-5" aria-live="polite">
        <span className="text-[15px] text-muted">{formatDay(p.date, year)}</span>
        <span className="text-[17px] font-medium text-ink">
          {p.durationMin !== null ? formatDuration(p.durationMin) : <span className="font-normal text-muted">durée non notée</span>}
          <span className="text-muted"> · </span>
          {p.bpmAvg !== null ? <span className="tnum">{Math.round(p.bpmAvg)} BPM</span> : <span className="font-normal text-muted">BPM non saisi</span>}
        </span>
      </p>
      <div className="mt-3 px-5">
        <p className="text-[14px] text-muted">Durée, en minutes</p>
        {duration.length === 0 ? (
          <p className="py-4 text-[15px] text-muted">Aucune durée notée pour l’instant.</p>
        ) : (
          <Chart
            series={[{ id: 'duree', tone: 'ink', line: false, points: duration }]}
            selected={selIn(duration, 'duree')}
            onSelect={(s) => setPicked(duration[s.index]!.at)}
            cursorX={cursor}
            xDomain={axis?.domain}
            xTicks={ticks}
            yFormat={(v) => String(Math.round(v))}
            yTarget={2}
            height={112}
            months
            sliderLabel="Durée d’une séance"
            valueText={(sel) => {
              const m = points[duration[sel.index]!.at]!;
              return `${formatDuration(m.durationMin ?? 0)}, ${formatDay(m.date, year)}`;
            }}
            ariaLabel={`Durée de ${duration.length} séances. Glisser ou flèches pour parcourir.`}
          />
        )}
        <p className="mt-3 text-[14px] text-muted">BPM moyen, quand il a été saisi</p>
        {bpm.length === 0 ? (
          <p className="py-4 text-[15px] text-muted">Aucun BPM saisi pour l’instant.</p>
        ) : (
          <Chart
            series={[{ id: 'bpm', tone: 'ink', line: false, points: bpm }]}
            selected={selIn(bpm, 'bpm')}
            onSelect={(s) => setPicked(bpm[s.index]!.at)}
            cursorX={cursor}
            xDomain={axis?.domain}
            xTicks={ticks}
            yFormat={(v) => String(Math.round(v))}
            yTarget={2}
            height={112}
            months
            sliderLabel="BPM moyen d’une séance"
            valueText={(sel) => {
              const m = points[bpm[sel.index]!.at]!;
              return `${Math.round(m.bpmAvg ?? 0)} BPM, ${formatDay(m.date, year)}`;
            }}
            ariaLabel={`BPM moyen de ${bpm.length} séances. Glisser ou flèches pour parcourir.`}
          />
        )}
      </div>
    </div>
  );
}
