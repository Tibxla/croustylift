// Le graphe e1RM — héros de chaque ligne d'exercice (DESIGN.md : « Courbe e1RM
// façon Apple Fitness, sobre, accent violet pour la série de référence »).
//
// UNE COURBE PAR SÉANCE (issue #67, décision 2026-07-31) : un même exo n'a pas
// la même perf selon le contexte de fatigue de la séance — les courbes se
// SUPERPOSENT au lieu de se mélanger. La palette n'a pas de couleurs
// catégorielles (One Voice Rule) : la séance la plus récemment exécutée (1ʳᵉ du
// tableau) garde l'identité signature — trait accent 2.5 + aire dégradée violet
// 32 %→0, points cerclés, dernier point plein — et les autres se subordonnent
// en ink-muted (2ᵉ, trait plein fin) puis ink-faint POINTILLÉ (3ᵉ+) : jamais la
// couleur seule ne distingue deux séries (dataviz), le style de trait + la
// légende + le tooltip nominatif s'en chargent. Une légende apparaît dès 2
// séries (jamais pour une seule). Grille hairline, ligne de référence pointillée
// (e1RM de départ de la séance accent), ticks/labels en mono (Readout Rule).
//
// AXE X : catégoriel pour une série seule (rendu historique inchangé, un pas
// par séance), NUMÉRIQUE en temps réel pour la superposition — les séances ont
// des dates différentes, seul un axe numérique aligne honnêtement leurs points
// (un axe catégoriel concaténerait les dates série par série, hors chronologie).
import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
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
const INK_MUTED = 'var(--color-ink-muted)';
const INK_FAINT = 'var(--color-ink-faint)';

/** Police mono tabulaire pour tous les chiffres mesurés (axes, tooltip). */
const READOUT_TICK = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fill: INK_FAINT,
  fontVariant: 'tabular-nums',
} as const;

/** Une courbe e1RM nommée : la série d'UNE séance. La 1ʳᵉ passée porte l'accent. */
export interface E1rmSeries {
  /**
   * Clé stable de la courbe (id de séance). Jamais le nom : deux séances peuvent
   * porter le même nom dans deux routines, et deux clés React identiques
   * faisaient disparaître une ligne.
   */
  id: string;
  /** Libellé de la séance (légende + tooltip). */
  name: string;
  curve: E1rmPoint[];
}

/** Une entrée de légende : une courbe de la carte, affichée ou masquée. */
export interface E1rmLegendEntry {
  id: string;
  name: string;
  hidden: boolean;
}

/**
 * Légende-contrôle : toutes les courbes de la carte, masquées comprises, pour
 * pouvoir les ré-afficher. `onToggle` masque ou affiche ; la dernière courbe
 * visible ne se masque pas (cf. curve-visibility).
 */
export interface E1rmLegend {
  entries: E1rmLegendEntry[];
  onToggle: (id: string) => void;
}

/** Style d'une série selon son rang : accent (héros) puis subordonnées. */
interface SeriesStyle {
  stroke: string;
  strokeWidth: number;
  /** Pointillé pour la 3ᵉ+ : le style de trait distingue, jamais la couleur seule. */
  strokeDasharray?: string;
}

function styleFor(index: number): SeriesStyle {
  if (index === 0) return { stroke: ACCENT, strokeWidth: 2.5 };
  if (index === 1) return { stroke: INK_MUTED, strokeWidth: 1.75 };
  return { stroke: INK_FAINT, strokeWidth: 1.5, strokeDasharray: '4 3' };
}

/** 'YYYY-MM-DD' → 'JJ/MM' (mono, court : l'axe X ne doit jamais déborder). */
function formatDateTick(iso: string): string {
  const [, month, day] = iso.split('-');
  if (!month || !day) return iso;
  return `${day}/${month}`;
}

/** Tick de l'axe temps numérique (superposition) : epoch ms → 'JJ/MM'. */
function formatTimeTick(t: number): string {
  return formatDateTick(new Date(t).toISOString().slice(0, 10));
}

/** Un point daté + son abscisse numérique (axe temps de la superposition). */
type TimedPoint = E1rmPoint & { t: number };

function toTimed(curve: E1rmPoint[]): TimedPoint[] {
  // Date.parse('YYYY-MM-DD') = minuit UTC : cohérent avec formatTimeTick (ISO).
  return curve.map((p) => ({ ...p, t: Date.parse(p.date) }));
}

// Recharts injecte les props du tooltip à l'exécution ; `content={<… />}` les
// fournit donc vides au typage statique → on les rend partielles.
function E1rmTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  if (!first) return null;
  const point = first.payload as E1rmPoint;
  const named = payload.length > 1 || typeof first.name === 'string';
  return (
    <div className="surface-raised rounded-lg px-3 py-2">
      <p className="readout text-[11px] text-ink-muted">{formatDateTick(point.date)}</p>
      {payload.map((entry, i) => {
        const p = entry.payload as E1rmPoint;
        return (
          <p key={i} className="readout text-sm font-medium text-ink">
            {named && typeof entry.name === 'string' && (
              <span className="text-xs font-normal text-ink-muted">{entry.name} </span>
            )}
            {Math.round(p.e1rm)}
            <span className="ml-1 text-xs font-normal text-ink-muted">kg</span>
          </p>
        );
      })}
    </div>
  );
}

/** Résumé textuel des courbes pour les lecteurs d'écran (le SVG est muet). */
function describeSeries(series: E1rmSeries[]): string {
  const populated = series.filter((s) => s.curve.length > 0);
  if (populated.length === 0) return 'Courbe e1RM de la 1ʳᵉ série, aucune donnée.';
  if (populated.length === 1) {
    const only = populated[0]!;
    const values = only.curve.map((p) => p.e1rm);
    const min = Math.round(Math.min(...values));
    const max = Math.round(Math.max(...values));
    return `Courbe e1RM de la 1ʳᵉ série sur ${only.curve.length} séances, de ${min} à ${max} kg.`;
  }
  const parts = populated.map((s) => {
    const values = s.curve.map((p) => p.e1rm);
    return `${s.name} sur ${s.curve.length} exécutions, de ${Math.round(Math.min(...values))} à ${Math.round(Math.max(...values))} kg`;
  });
  return `Courbes e1RM de la 1ʳᵉ série par séance : ${parts.join(' ; ')}.`;
}

export function E1rmChart({
  series,
  legend,
}: {
  /** Les courbes AFFICHÉES, accent en tête. */
  series: E1rmSeries[];
  /** Absente, ou une seule entrée : pas de légende. */
  legend?: E1rmLegend;
}) {
  const gradientId = useId();
  const populated = series.filter((s) => s.curve.length > 0);
  const accentSeries = populated[0] ?? { id: '', name: '', curve: [] };
  const accentCurve = accentSeries.curve;
  const lastIndex = accentCurve.length - 1;
  // e1RM de départ (séance accent) : ligne de référence pointillée, pour LIRE la
  // montée d'un coup. Les subordonnées n'en posent pas (une seule référence).
  const baseline = accentCurve.length > 0 ? accentCurve[0]?.e1rm : undefined;
  const multi = populated.length > 1;

  // Points cerclés sur la courbe accent ; le DERNIER (le présent) en disque plein.
  // Recharts type le callback `dot` de façon stricte (DotItemDotProps) : on reçoit
  // les coords en `any` et on rend un <circle> nous-mêmes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderAccentDot = (props: any) => {
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

  const gradient = (
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
      </linearGradient>
    </defs>
  );

  const yAxis = (
    <YAxis
      tick={READOUT_TICK}
      tickLine={false}
      axisLine={false}
      width={36}
      domain={['dataMin - 3', 'dataMax + 3']}
      tickFormatter={(v: number) => `${Math.round(v)}`}
      allowDecimals={false}
    />
  );

  return (
    <div>
      <div className="h-40 w-full" role="img" aria-label={describeSeries(series)}>
        <ResponsiveContainer width="100%" height="100%">
          {multi ? (
            // SUPERPOSITION : axe temps numérique (dates différentes par séance),
            // subordonnées d'abord (dessous), l'accent par-dessus, façon
            // ComparisonChart. Chaque série porte son propre `data`.
            <ComposedChart margin={{ top: 8, right: 20, bottom: 4, left: -8 }}>
              {gradient}
              <CartesianGrid stroke={HAIR} strokeWidth={1} vertical={false} />
              <XAxis
                type="number"
                dataKey="t"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTimeTick}
                tick={READOUT_TICK}
                tickLine={false}
                axisLine={{ stroke: HAIR }}
                minTickGap={24}
                interval="preserveStartEnd"
              />
              {yAxis}
              {baseline != null && (
                <ReferenceLine y={baseline} stroke={INK_FAINT} strokeDasharray="4 5" strokeWidth={1} />
              )}
              <Tooltip content={<E1rmTooltip />} cursor={{ stroke: HAIR, strokeWidth: 1 }} />
              {populated
                .slice(1)
                .map((s, i) => {
                  const style = styleFor(i + 1);
                  return (
                    <Line
                      key={s.id}
                      name={s.name}
                      data={toTimed(s.curve)}
                      type="monotone"
                      dataKey="e1rm"
                      stroke={style.stroke}
                      strokeWidth={style.strokeWidth}
                      strokeDasharray={style.strokeDasharray}
                      dot={{ r: 2, fill: style.stroke, strokeWidth: 0 }}
                      isAnimationActive={false}
                    />
                  );
                })
                .reverse()}
              <Area
                name={accentSeries.name}
                data={toTimed(accentCurve)}
                type="monotone"
                dataKey="e1rm"
                stroke={ACCENT}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradientId})`}
                dot={renderAccentDot}
                activeDot={{ r: 5, fill: ACCENT, stroke: BG, strokeWidth: 2.5 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          ) : (
            // UNE seule séance : rendu signature historique inchangé (axe
            // catégoriel, un pas par exécution), sans légende.
            <ComposedChart data={accentCurve} margin={{ top: 8, right: 20, bottom: 4, left: -8 }}>
              {gradient}
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
              {yAxis}
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
                dot={renderAccentDot}
                activeDot={{ r: 5, fill: ACCENT, stroke: BG, strokeWidth: 2.5 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Légende dès 2 courbes sur la carte, masquées comprises (jamais pour une
          seule : le libellé sous la carte la nomme). Chaque entrée est un bouton
          qui masque ou affiche sa courbe. Le SWATCH reproduit le STYLE du trait
          selon son rang parmi les courbes affichées (plein / pointillé), pas
          seulement sa couleur : deux gris restent distinguables. */}
      {legend && legend.entries.length > 1 && (
        <ul className="-mx-1 mt-1 flex flex-wrap items-center gap-x-2">
          {legend.entries.map((entry) => {
            const rank = populated.findIndex((s) => s.id === entry.id);
            const lastVisible = !entry.hidden && populated.length <= 1;
            return (
              <SeriesLegendItem
                key={entry.id}
                label={entry.name}
                style={rank >= 0 ? styleFor(rank) : null}
                accent={rank === 0}
                hidden={entry.hidden}
                lastVisible={lastVisible}
                onToggle={() => legend.onToggle(entry.id)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Entrée de légende cliquable : disque plein pour l'accent, segment de trait
 * (style réel) sinon, anneau vide quand la courbe est masquée. Une courbe
 * masquée garde son nom lisible, barré et estompé : on sait ce qu'on peut
 * ré-afficher. La dernière courbe visible ne se masque pas.
 */
function SeriesLegendItem({
  label,
  style,
  accent,
  hidden,
  lastVisible,
  onToggle,
}: {
  label: string;
  /** `null` = courbe masquée (pas de rang parmi les affichées). */
  style: SeriesStyle | null;
  accent: boolean;
  hidden: boolean;
  lastVisible: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={lastVisible}
        aria-pressed={!hidden}
        aria-label={
          lastVisible
            ? `${label}, seule courbe affichée`
            : `${hidden ? 'Afficher' : 'Masquer'} la courbe ${label}`
        }
        className="flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 transition active:scale-[0.97] disabled:active:scale-100"
      >
        {hidden || style === null ? (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full border border-ink-faint"
            aria-hidden="true"
          />
        ) : accent ? (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: style.stroke }}
            aria-hidden="true"
          />
        ) : (
          <svg width="14" height="4" aria-hidden="true" className="shrink-0">
            <line
              x1="0"
              y1="2"
              x2="14"
              y2="2"
              stroke={style.stroke}
              strokeWidth={2}
              strokeDasharray={style.strokeDasharray}
            />
          </svg>
        )}
        <span
          className={`readout text-[11px] ${
            hidden ? 'text-ink-faint line-through' : 'text-ink-muted'
          }`}
        >
          {label}
        </span>
      </button>
    </li>
  );
}
