// Le graphe e1RM — héros de chaque ligne d'exercice (DESIGN.md : « Courbe e1RM
// façon Apple Fitness, sobre, accent violet pour la série de référence »).
//
// Direction visuelle (refonte premium) : trait violet accent (2.5) + aire dégradée
// violet 32 %→0, grille horizontale en hairline, ligne de référence pointillée
// (e1RM de départ), points cerclés et DERNIER point plein accent (le présent).
// Ticks/labels en mono (Readout Rule). Responsive via le conteneur.
import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
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
const BG = 'var(--color-bg)';
const HAIR = 'var(--color-hair)';
const INK_FAINT = 'var(--color-ink-faint)';

/** Police mono tabulaire pour tous les chiffres mesurés (axes, tooltip). */
const READOUT_TICK = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fill: INK_FAINT,
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
    <div className="surface-raised rounded-lg px-3 py-2">
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
  const gradientId = useId();
  const lastIndex = curve.length - 1;
  // e1RM de départ : ligne de référence pointillée, pour LIRE la montée d'un coup.
  const baseline = curve.length > 0 ? curve[0]?.e1rm : undefined;

  // Points cerclés sur la courbe ; le DERNIER (le présent) en disque plein accent.
  // Recharts type le callback `dot` de façon stricte (DotItemDotProps) : on reçoit
  // les coords en `any` et on rend un <circle> nous-mêmes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const { cx, cy, index, key } = props as {
      cx?: number;
      cy?: number;
      index?: number;
      key?: string;
    };
    if (cx == null || cy == null) return <g key={key} />;
    if (index === lastIndex) {
      return <circle key={key} cx={cx} cy={cy} r={5} fill={ACCENT} stroke={BG} strokeWidth={2.5} />;
    }
    return <circle key={key} cx={cx} cy={cy} r={3} fill={BG} stroke={ACCENT} strokeWidth={2} />;
  };

  return (
    <div className="h-40 w-full" role="img" aria-label={describeCurve(curve)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={curve} margin={{ top: 8, right: 20, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={HAIR} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateTick}
            tick={READOUT_TICK}
            tickLine={false}
            axisLine={{ stroke: HAIR }}
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
          {baseline != null && (
            <ReferenceLine y={baseline} stroke={INK_FAINT} strokeDasharray="4 5" strokeWidth={1} />
          )}
          <Tooltip content={<E1rmTooltip />} cursor={{ stroke: HAIR, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="e1rm"
            stroke={ACCENT}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradientId})`}
            dot={renderDot}
            activeDot={{ r: 5, fill: ACCENT, stroke: BG, strokeWidth: 2.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
