// Le graphe BPM moyen + durée de séance (cf. issue #28, DESIGN.md). Deux
// métriques LIÉES sur un même graphe à DOUBLE axe Y : BPM (accent violet, axe
// gauche) et durée (ink-muted, axe droit), pour les lire ensemble sans les
// confondre. L'accent va au BPM (le signal n°1 ici, One Voice Rule), la durée
// reste en encre discrète.
//
// Direction visuelle calquée sur E1rmChart : fond sombre, grille discrète,
// ticks/labels en mono (Readout Rule), axe X = dates. Chaque courbe ignore les
// trous (`connectNulls={false}`) : une séance peut n'avoir que l'une des deux.
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { shortDay } from './chart-time';
import { ACCENT, HAIR, INK_MUTED, READOUT_TICK } from './chart-style';
import type { SessionMetricPoint } from './session-metrics';



// Recharts injecte les props du tooltip à l'exécution ; `content={<… />}` les
// fournit donc vides au typage statique → on les rend partielles.
function SessionMetricsTooltip({
  active,
  payload,
}: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  if (!first) return null;
  const point = first.payload as SessionMetricPoint;
  return (
    <div className="surface-raised rounded-lg px-3 py-2">
      <p className="readout text-[11px] text-ink-muted">{shortDay(point.date)}</p>
      {point.bpmAvg !== null && (
        <p className="readout text-sm font-medium text-accent">
          {Math.round(point.bpmAvg)}
          <span className="ml-1 text-xs font-normal text-ink-muted">bpm</span>
        </p>
      )}
      {point.durationMin !== null && (
        <p className="readout text-sm font-medium text-ink-muted">
          {Math.round(point.durationMin)}
          <span className="ml-1 text-xs font-normal text-ink-muted">min</span>
        </p>
      )}
    </div>
  );
}

/** Résumé textuel pour les lecteurs d'écran (le SVG est muet). */
function describeMetrics(points: SessionMetricPoint[]): string {
  if (points.length === 0) return 'Graphe BPM moyen et durée de séance, aucune donnée.';
  return `BPM moyen et durée de séance sur ${points.length} séances.`;
}

export function SessionMetricsChart({ points }: { points: SessionMetricPoint[] }) {
  return (
    <div className="h-40 w-full" role="img" aria-label={describeMetrics(points)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 4, left: -8 }}>
          <CartesianGrid stroke={HAIR} strokeWidth={1} vertical={false} opacity={0.4} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDay}
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: HAIR }}
            minTickGap={24}
            interval="preserveStartEnd"
          />
          {/* Axe gauche = BPM (accent) ; axe droit = durée (ink-muted). */}
          <YAxis
            yAxisId="bpm"
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={false}
            width={32}
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={(v: number) => `${Math.round(v)}`}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="duration"
            orientation="right"
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={false}
            width={28}
            domain={['dataMin - 5', 'dataMax + 5']}
            tickFormatter={(v: number) => `${Math.round(v)}`}
            allowDecimals={false}
          />
          <Tooltip
            content={<SessionMetricsTooltip />}
            cursor={{ stroke: HAIR, strokeWidth: 1 }}
          />
          <Line
            yAxisId="bpm"
            type="monotone"
            dataKey="bpmAvg"
            name="BPM"
            stroke={ACCENT}
            strokeWidth={2}
            dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="duration"
            type="monotone"
            dataKey="durationMin"
            name="Durée"
            stroke={INK_MUTED}
            strokeWidth={1.5}
            dot={{ r: 2, fill: INK_MUTED, strokeWidth: 0 }}
            activeDot={{ r: 3.5, fill: INK_MUTED, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
