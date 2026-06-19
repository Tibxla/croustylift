// Le graphe e1RM — héros de chaque ligne d'exercice (DESIGN.md : « Courbe e1RM
// façon Apple Fitness, sobre, accent violet pour la série de référence »).
//
// Direction visuelle : ligne violet accent sur fond sombre, grille discrète,
// ticks/labels en mono (Readout Rule), axe X = dates, axe Y = e1RM (kg).
// Responsive via le conteneur. Tooltip sobre. Aucune décoration.
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
import type { E1rmPoint } from '../../domain/types';

// On lit les tokens OKLCH directement : le SVG de Recharts accepte
// `stroke="var(--color-…)"`, donc l'accent reste la SEULE source de vérité.
const ACCENT = 'var(--color-accent)';
const LINE = 'var(--color-line)';
const INK_MUTED = 'var(--color-ink-muted)';

/** Police mono tabulaire pour tous les chiffres mesurés (axes, tooltip). */
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
function E1rmTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  if (!first) return null;
  const point = first.payload as E1rmPoint;
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 shadow-lg">
      <p className="readout text-[11px] text-ink-muted">{formatDateTick(point.date)}</p>
      <p className="readout text-sm font-medium text-ink">
        {Math.round(point.e1rm)}
        <span className="ml-1 text-xs font-normal text-ink-muted">kg</span>
      </p>
    </div>
  );
}

/** Résumé textuel de la courbe pour les lecteurs d'écran (le SVG est muet). */
function describeCurve(curve: E1rmPoint[]): string {
  if (curve.length === 0) return 'Courbe e1RM de la 1ʳᵉ série, aucune donnée.';
  const values = curve.map((p) => p.e1rm);
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  return `Courbe e1RM de la 1ʳᵉ série sur ${curve.length} séances, de ${min} à ${max} kg.`;
}

export function E1rmChart({ curve }: { curve: E1rmPoint[] }) {
  return (
    <div className="h-40 w-full" role="img" aria-label={describeCurve(curve)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={curve}
          margin={{ top: 8, right: 20, bottom: 4, left: -8 }}
        >
          <CartesianGrid
            stroke={LINE}
            strokeWidth={1}
            vertical={false}
            opacity={0.4}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateTick}
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: LINE }}
            minTickGap={24}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={false}
            width={36}
            domain={['dataMin - 3', 'dataMax + 3']}
            tickFormatter={(v: number) => `${Math.round(v)}`}
            allowDecimals={false}
          />
          <Tooltip
            content={<E1rmTooltip />}
            cursor={{ stroke: LINE, strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey="e1rm"
            stroke={ACCENT}
            strokeWidth={2}
            dot={{ r: 2.5, fill: ACCENT, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
