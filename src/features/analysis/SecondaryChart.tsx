// Graphe SECONDAIRE : la tendance des séries 2+ (cf. domain/secondary-curve.ts).
// Délibérément SUBORDONNÉ à la courbe primaire (E1rmChart) :
//   - plus petit (h-24 vs h-40),
//   - trait fin en ink-muted, JAMAIS l'accent violet (réservé au signal n°1 par
//     la One Voice Rule de DESIGN.md),
//   - pas de dots, pas d'axe Y, grille muette : c'est un repère, pas le héros.
// Il ne s'affiche que s'il y a des points (l'appelant ne le monte pas sinon).
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { dayToTime, timeTick, type TimeAxis } from './chart-time';
import { secondaryLabel } from './unit-label';
import { HAIR, INK_MUTED, READOUT_TICK } from './chart-style';
import { E1rmTooltip } from './E1rmChart';
import type { CurveUnit, E1rmPoint } from '../../domain/types';



// Recharts injecte les props du tooltip à l'exécution ; `content={<… />}` les
// fournit donc vides au typage statique → on les rend partielles.
/** Résumé textuel de la courbe pour les lecteurs d'écran (le SVG est muet). */
function describeCurve(curve: E1rmPoint[], unit: CurveUnit): string {
  const measure = secondaryLabel(unit);
  if (curve.length === 0) return `Tendance ${measure} des séries 2+, aucune donnée.`;
  const values = curve.map((p) => p.e1rm);
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  return `Tendance ${measure} des séries 2+ sur ${curve.length} séances, de ${min} à ${max} ${unit}.`;
}

export function SecondaryChart({
  curve,
  unit,
  axis,
}: {
  curve: E1rmPoint[];
  unit: CurveUnit;
  /**
   * L'axe temps de la courbe primaire au-dessus : les deux graphes partagent
   * bornes et graduations, une date tombe à la même abscisse dans les deux.
   */
  axis: TimeAxis | null;
}) {
  const data = curve.map((p) => ({ ...p, t: dayToTime(p.date) }));
  return (
    <div className="h-24 w-full" role="img" aria-label={describeCurve(curve, unit)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 20, bottom: 2, left: -8 }}>
          {/* Axe temps réel, comme la primaire (cf. chart-time.ts). */}
          <XAxis
            type="number"
            dataKey="t"
            domain={axis?.domain}
            ticks={axis?.ticks}
            tickFormatter={timeTick}
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: HAIR }}
            minTickGap={24}
            interval="preserveStartEnd"
          />
          {/* Axe Y muet de la largeur de celui de la primaire : il réserve la
              même marge, sans quoi les deux tracés seraient décalés. */}
          <YAxis
            width={36}
            tick={false}
            tickLine={false}
            axisLine={false}
            domain={['dataMin - 1', 'dataMax + 1']}
          />
          <Tooltip
            content={<E1rmTooltip unit={`${unit} moy.`} named={false} />}
            cursor={{ stroke: HAIR, strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="e1rm"
            stroke={INK_MUTED}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: INK_MUTED, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
