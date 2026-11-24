// Le graphe de l'Analyse, en SVG dessiné à la main (refonte E, prototype
// e/analyse-chart.tsx) : un seul composant pour toutes les courbes de la surface
// (e1RM ou reps d'un exo, séries 2+, deux blocs comparés, durée et BPM).
//
// Ce qu'il dessine, et rien d'autre :
//   - axe X numérique (temps réel en ms, ou semaines), domaine imposé par
//     l'appelant (`xDomain`) pour que deux graphes empilés partagent l'axe ;
//   - axe Y à droite, graduations à pas ronds (1, 2, 2,5, 5 × 10ⁿ : registre
//     U42), grille en filets ;
//   - les séries : traits droits entre les points (aucune interpolation qui
//     inventerait un creux ou une bosse), points pleins tant qu'ils ne se
//     touchent pas (écart moyen au-delà de 6 px ; sinon le dernier seul). La série qui porte la
//     lecture est blanc cassé, les autres grises ET pointillées : jamais la seule
//     couleur pour distinguer deux séries ;
//   - un repère vertical pointillé (le début du bloc de la pente) ;
//   - une ligne horizontale pointillée nommée (le Record), gris, jamais le signal,
//     comprise dans l'axe Y ;
//   - sur un axe en temps (`months`), des graduations au 1er du mois, un mois
//     sur 1, 2, 3, 6 ou 12 selon la largeur, l'année au passage de janvier ;
//   - des traits coupés (`break`) : une pause ou une valeur absente n'est jamais
//     reliée en douce.
// Aucune aire, aucun dégradé, aucun halo, aucune ombre. Le signal ne marque
// qu'une chose : le dernier point, s'il a battu le précédent (`lastUp`, « mieux
// que la dernière fois »). Le curseur est un filet gris et le point choisi un
// disque blanc cassé : le signal n'est ni un curseur ni une couleur de série.
//
// Parcouru au doigt : toucher ou glisser choisit le point le plus proche en X
// (`onSelect`), la souris aussi au survol. Pour les lecteurs d'écran et le
// clavier, le graphe parcouru est un curseur (`role="slider"`) : sa valeur se dit
// en mots (`valueText` : « 70 kg, 14 juin, Lower A »), ← ↓ et → ↑ passent d'un
// point à l'autre, Début et Fin aux extrêmes ; le résumé du graphe le décrit. Un
// graphe qui ne se parcourt pas reste une image nommée par son résumé. Le
// relevé visible vit hors du graphe, chez l'appelant.
//
// Dessiné en pixels réels (largeur mesurée) et non dans un `viewBox` étiré : le
// texte des axes garde ses 13 px à 360 px de large comme à 640.
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { monthTicks } from './chart-time';

export interface ChartPoint {
  x: number;
  y: number;
  /** Coupe le trait avant ce point : une valeur manque juste avant, on ne relie pas en douce. */
  break?: boolean;
}

export interface ChartSeries {
  /** Clé stable (id de séance, « a », « b »…), jamais un libellé. */
  id: string;
  points: ChartPoint[];
  /** `ink` : la série qui porte la lecture ; `muted` : une subordonnée. */
  tone: 'ink' | 'muted';
  /** Trait pointillé (subordonnée d'une superposition). */
  dashed?: boolean;
  /** false : points seuls, sans trait (une mesure par séance, rien à relier). */
  line?: boolean;
  /** Le dernier point a battu le précédent : lui seul prend le signal. */
  lastUp?: boolean;
  /** Étiquette courte au bout du trait (« A », « B »). */
  endLabel?: string;
}

/** Un point choisi : sa série et son rang dans la série. */
export interface ChartSel {
  series: string;
  index: number;
}

const FONT = 13;
/** Largeur moyenne d'un chiffre d'Inter tabulaire à 13 px, marge comprise. */
const CHAR_PX = 7.8;
const STROKE: Record<ChartSeries['tone'], string> = {
  ink: 'var(--color-ink)',
  muted: 'var(--color-muted)',
};
const TEXT_STYLE = { fontVariantNumeric: 'tabular-nums' } as const;

/** Pas rond le plus proche au-dessus de `span / target` : 1, 2, 2,5 ou 5 × 10ⁿ. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Entier tel quel, sinon une décimale à la française (« 2,5 »). */
function defaultYFormat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',');
}

export function Chart({
  series,
  height = 220,
  selected = null,
  onSelect,
  xTicks,
  xDomain,
  yFormat = defaultYFormat,
  yTarget = 4,
  yFromZero = false,
  marker,
  refLine,
  months = false,
  cursorX,
  ariaLabel,
  sliderLabel,
  valueText,
}: {
  series: ChartSeries[];
  height?: number;
  selected?: ChartSel | null;
  onSelect?: (s: ChartSel) => void;
  /** Graduations de l'axe X, déjà libellées ; trop serrées, certaines se taisent. */
  xTicks: { x: number; label: string }[];
  /** Domaine X imposé (deux graphes qui partagent l'axe). Par défaut, celui des points. */
  xDomain?: [number, number];
  yFormat?: (v: number) => string;
  /** Nombre de graduations Y visé. */
  yTarget?: number;
  /** Axe Y depuis zéro plutôt que serré sur les données (séries 2+). */
  yFromZero?: boolean;
  /** Repère vertical pointillé (début du bloc), avec un mot court en tête. */
  marker?: { x: number; label?: string };
  /** Ligne horizontale pointillée nommée (le Record), comprise dans l'axe Y. */
  refLine?: { y: number; label: string };
  /** Axe X en temps (ms) : graduations au 1er du mois si au moins deux tiennent. */
  months?: boolean;
  /** Curseur à cette abscisse sans point choisi ici (graphe lié à un autre). */
  cursorX?: number;
  /** Résumé du graphe pour les lecteurs d'écran. */
  ariaLabel: string;
  /** Graphe parcouru : nom du curseur (« Point de la courbe »). */
  sliderLabel?: string;
  /** Graphe parcouru : le point choisi en mots (« 70 kg, 14 juin, Lower A »). */
  valueText?: (sel: ChartSel) => string;
}) {
  const descId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Largeur réelle du conteneur. L'observateur rappelle une première fois dès
  // l'observation, avant la peinture : pas d'image à la mauvaise largeur.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0 || width === 0) return null;
    const ys = all.map((p) => p.y);
    if (refLine) ys.push(refLine.y);
    const minY = yFromZero ? Math.min(0, ...ys) : Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxY - minY, Math.abs(maxY) * 0.04, 1);
    const step = niceStep(span, yTarget);
    // Des mesures toutes positives n'ont pas d'axe sous zéro.
    const lo = Math.max(minY >= 0 ? 0 : -Infinity, Math.floor((minY - span * 0.08) / step) * step);
    const hi = Math.ceil((maxY + span * 0.08) / step) * step;
    const yTicks: number[] = [];
    for (let v = lo; v <= hi + step / 1000; v += step) yTicks.push(Math.round(v * 1000) / 1000);
    // Le vrai signe moins, jamais le trait d'union.
    const labels = yTicks.map((v) => yFormat(v).replace('-', '\u2212'));
    const labelled = series.some((s) => s.endLabel);
    const gutter = Math.ceil(Math.max(...labels.map((l) => l.length)) * CHAR_PX) + 10;
    const plot = {
      left: 5,
      right: width - gutter - (labelled ? 18 : 0),
      top: marker?.label ? 22 : 10,
      bottom: height - 26,
    };
    const xs = all.map((p) => p.x);
    const x0 = xDomain ? xDomain[0] : Math.min(...xs);
    const x1 = xDomain ? xDomain[1] : Math.max(...xs);
    const x = (v: number) =>
      x1 === x0 ? (plot.left + plot.right) / 2 : plot.left + ((v - x0) / (x1 - x0)) * (plot.right - plot.left);
    const y = (v: number) => plot.bottom - ((v - lo) / (hi - lo)) * (plot.bottom - plot.top);
    return { x, y, yTicks, labels, plot };
  }, [series, width, height, yTarget, yFromZero, yFormat, xDomain, marker?.label, refLine]);

  // Étiquettes X : on écarte celles qui chevaucheraient la précédente gardée, et
  // on retient la première et la dernière dans le cadre.
  const xLabels = useMemo(() => {
    if (!geo) return [];
    const kept: { px: number; label: string; anchor: 'start' | 'middle' | 'end'; tx: number }[] = [];
    let lastRight = -Infinity;
    // Au mois si l'axe est en temps et qu'au moins deux 1ers du mois tiennent,
    // une étiquette tous les 66 px au plus (le libellé le plus long et son écart) ; sinon les dates de l'appelant.
    const byMonth = months && xDomain ? monthTicks(xDomain, Math.floor((geo.plot.right - geo.plot.left) / 66)) : [];
    const ticks = byMonth.length > 0 ? byMonth : xTicks;
    for (const t of [...ticks].sort((a, b) => a.x - b.x)) {
      const px = geo.x(t.x);
      const w = t.label.length * CHAR_PX;
      let anchor: 'start' | 'middle' | 'end' = 'middle';
      let left = px - w / 2;
      let tx = px;
      if (left < 0) {
        anchor = 'start';
        left = 0;
        tx = 0;
      } else if (px + w / 2 > geo.plot.right) {
        anchor = 'end';
        left = geo.plot.right - w;
        tx = geo.plot.right;
      }
      if (left < lastRight + 10) continue;
      kept.push({ px, label: t.label, anchor, tx });
      lastRight = left + w;
    }
    return kept;
  }, [geo, xTicks, months, xDomain]);

  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || !onSelect || !geo) return;
    const vx = clientX - el.getBoundingClientRect().left;
    let best: ChartSel | null = null;
    let dist = Infinity;
    // Ordre des séries = priorité à égalité : la première gagne.
    for (const s of series) {
      s.points.forEach((p, i) => {
        const d = Math.abs(geo.x(p.x) - vx);
        if (d < dist - 0.01) {
          dist = d;
          best = { series: s.id, index: i };
        }
      });
    }
    const b = best as ChartSel | null;
    if (b && (!selected || b.series !== selected.series || b.index !== selected.index)) onSelect(b);
  };

  // Le curseur au clavier : ← ↓ point précédent, → ↑ suivant, Début et Fin
  // aux extrêmes, dans la série du point choisi.
  const curSeries = series.find((c) => c.id === selected?.series) ?? series[0];
  const curIndex = curSeries ? (selected && selected.series === curSeries.id ? selected.index : curSeries.points.length - 1) : 0;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect || !curSeries || curSeries.points.length === 0) return;
    const last = curSeries.points.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: curIndex - 1,
      ArrowDown: curIndex - 1,
      ArrowRight: curIndex + 1,
      ArrowUp: curIndex + 1,
      Home: 0,
      End: last,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = Math.min(last, Math.max(0, moves[e.key]!));
    if (next !== curIndex || !selected) onSelect({ series: curSeries.id, index: next });
  };
  const interactive = !!onSelect && !!curSeries && curSeries.points.length > 0;

  const selSeries = selected ? series.find((s) => s.id === selected.series) : undefined;
  const selPoint = selected ? selSeries?.points[selected.index] : undefined;
  const selIsUp = !!selSeries?.lastUp && selected?.index === (selSeries?.points.length ?? 0) - 1;
  // Les grises dessous, celle qui porte la lecture par-dessus.
  const drawOrder = [...series].sort((a, b) => (a.tone === 'muted' ? 0 : 1) - (b.tone === 'muted' ? 0 : 1));

  return (
    <div
      ref={box}
      style={{ height }}
      className={`w-full outline-offset-4 ${onSelect ? 'touch-pan-y' : ''}`}
      {...(interactive
        ? {
            role: 'slider',
            tabIndex: 0,
            'aria-label': sliderLabel ?? 'Point de la courbe',
            'aria-describedby': descId,
            'aria-valuemin': 1,
            'aria-valuemax': curSeries!.points.length,
            'aria-valuenow': curIndex + 1,
            'aria-valuetext': valueText ? valueText({ series: curSeries!.id, index: curIndex }) : undefined,
            onKeyDown: onKey,
          }
        : {})}
      onPointerDown={(e) => {
        if (!onSelect) return;
        // Au doigt, le toucher parcourt la courbe sans donner le focus au graphe
        // (pas de contour) ; le clavier garde son arrêt de tabulation.
        if (e.pointerType !== 'mouse') e.preventDefault();
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (onSelect && (e.pointerType === 'mouse' || e.buttons)) pick(e.clientX);
      }}
    >
      {interactive && (
        <p id={descId} className="sr-only">
          {ariaLabel}
        </p>
      )}
      {geo && (
        <svg
          width={width}
          height={height}
          className="block select-none overflow-visible"
          {...(interactive ? { 'aria-hidden': true } : { role: 'img', 'aria-label': ariaLabel })}
        >
          {geo.yTicks.map((v, i) => (
            <g key={v}>
              <line x1={geo.plot.left} x2={geo.plot.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={width} y={geo.y(v) + 4.5} textAnchor="end" fontSize={FONT} fill="var(--color-faint)" style={TEXT_STYLE}>
                {geo.labels[i]}
              </text>
            </g>
          ))}
          {xLabels.map((t) => (
            <text key={`${t.label}-${t.px}`} x={t.tx} y={height - 6} textAnchor={t.anchor} fontSize={FONT} fill="var(--color-faint)" style={TEXT_STYLE}>
              {t.label}
            </text>
          ))}
          {marker && (
            <g>
              <line
                x1={geo.x(marker.x)}
                x2={geo.x(marker.x)}
                y1={geo.plot.top - (marker.label ? 4 : 0)}
                y2={geo.plot.bottom}
                stroke="var(--color-dim)"
                strokeDasharray="2 4"
              />
              {marker.label && (
                <text
                  x={geo.x(marker.x) > geo.plot.right - 60 ? geo.x(marker.x) - 4 : geo.x(marker.x) + 4}
                  y={geo.plot.top - 9}
                  textAnchor={geo.x(marker.x) > geo.plot.right - 60 ? 'end' : 'start'}
                  fontSize={FONT}
                  fill="var(--color-faint)"
                >
                  {marker.label}
                </text>
              )}
            </g>
          )}
          {refLine && (
            <g>
              <line
                x1={geo.plot.left}
                x2={geo.plot.right}
                y1={geo.y(refLine.y)}
                y2={geo.y(refLine.y)}
                stroke="var(--color-muted)"
                strokeDasharray="2 4"
              />
              {/* Sous le trait quand il frôle le haut du tracé : le libellé ne
                  touche jamais la grille. */}
              <text
                x={geo.plot.left}
                y={geo.y(refLine.y) - geo.plot.top < 16 ? geo.y(refLine.y) + 15 : geo.y(refLine.y) - 6}
                fontSize={FONT}
                fill="var(--color-faint)"
                style={TEXT_STYLE}
              >
                {refLine.label}
              </text>
            </g>
          )}
          {(selPoint || cursorX !== undefined) && (
            <line
              x1={geo.x(selPoint?.x ?? cursorX!)}
              x2={geo.x(selPoint?.x ?? cursorX!)}
              y1={geo.plot.top}
              y2={geo.plot.bottom}
              stroke="var(--color-dim)"
            />
          )}
          {drawOrder.map((s) => (
            <g key={s.id}>
              {s.line !== false && s.points.length > 1 && (
                <path
                  d={s.points
                    .map((p, i) => `${i === 0 || p.break ? 'M' : 'L'}${geo.x(p.x).toFixed(1)},${geo.y(p.y).toFixed(1)}`)
                    .join(' ')}
                  fill="none"
                  stroke={STROKE[s.tone]}
                  strokeWidth={s.tone === 'muted' ? 1.5 : 2.25}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              {s.points.map((p, i) => {
                const up = s.lastUp && i === s.points.length - 1;
                // Points serrés (écart moyen de 6 px ou moins) : le trait seul,
                // plus le dernier point ; le point lu a son disque à part.
                const n = s.points.length;
                const dense =
                  s.line !== false && n > 1 && Math.abs(geo.x(s.points[n - 1]!.x) - geo.x(s.points[0]!.x)) / (n - 1) <= 6;
                if (dense && i !== n - 1) return null;
                return (
                  <circle
                    key={i}
                    cx={geo.x(p.x)}
                    cy={geo.y(p.y)}
                    r={up ? 4 : s.line === false ? 3 : s.tone === 'muted' ? 2 : 2.5}
                    fill={up ? 'var(--sig)' : STROKE[s.tone]}
                  />
                );
              })}
              {s.endLabel && s.points.length > 0 && (
                <text
                  x={geo.x(s.points[s.points.length - 1]!.x) + 8}
                  y={geo.y(s.points[s.points.length - 1]!.y) + 4.5}
                  fontSize={FONT}
                  fontWeight={600}
                  fill={STROKE[s.tone]}
                >
                  {s.endLabel}
                </text>
              )}
            </g>
          ))}
          {selPoint && (
            <circle
              cx={geo.x(selPoint.x)}
              cy={geo.y(selPoint.y)}
              r={5.5}
              fill={selIsUp ? 'var(--sig)' : 'var(--color-ink)'}
              stroke="var(--color-bg)"
              strokeWidth={2.5}
            />
          )}
          {/* Zone de capture du pointeur : toute la surface. */}
          <rect x={0} y={0} width={width} height={height} fill="transparent" />
        </svg>
      )}
    </div>
  );
}

/** Échantillon de trait pour une légende, au style de la série. */
export function Swatch({ tone, dashed }: { tone: ChartSeries['tone']; dashed?: boolean }) {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden className="flex-none">
      <line
        x1="1"
        x2="21"
        y1="5"
        y2="5"
        stroke={STROKE[tone]}
        strokeWidth={tone === 'muted' ? 1.5 : 2.25}
        strokeDasharray={dashed ? '5 4' : undefined}
      />
    </svg>
  );
}
