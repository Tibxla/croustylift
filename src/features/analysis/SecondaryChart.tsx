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
  type TooltipContentProps,
} from 'recharts';
import type { E1rmPoint } from '../../domain/types';

const LINE = 'var(--color-line)';
const INK_MUTED = 'var(--color-ink-muted)';

/** Police mono tabulaire pour les chiffres mesurés (axe, tooltip). */
const READOUT_TICK = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fill: INK_MUTED,
  fontVariant: 'tabular-nums',
} as const;

/** 'YYYY-MM-DD' → 'JJ/MM' (mono, court : l'axe X ne doit jamais déborder). */
function formatDateTick(iso: string): string {
  const [, month, day] = iso.split('-');
  if (!month || !day) return iso;
  return `${day}/${month}`;
}

// Recharts injecte les props du tooltip à l'exécution ; `content={<… />}` les
// fournit donc vides au typage statique → on les rend partielles.
function SecondaryTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as E1rmPoint;
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-lg">
      <p className="readout text-[11px] text-ink-muted">{formatDateTick(point.date)}</p>
      <p className="readout text-sm font-medium text-ink-muted">
        {Math.round(point.e1rm)}
        <span className="ml-1 text-xs font-normal text-ink-muted">kg moy.</span>
      </p>
    </div>
  );
}

export function SecondaryChart({ curve }: { curve: E1rmPoint[] }) {
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={curve} margin={{ top: 6, right: 20, bottom: 2, left: -8 }}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDateTick}
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            minTickGap={24}
            interval="preserveStartEnd"
          />
          <Tooltip
            content={<SecondaryTooltip />}
            cursor={{ stroke: LINE, strokeWidth: 1 }}
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
