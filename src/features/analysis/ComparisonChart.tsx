// Superposition de DEUX options comparées (cf. issue #6, ADR 0016) : chaque
// courbe e1RM (ou reps effectives) ramenée à « semaine 0 = son premier point »
// (`toWeeklySeries`), pour que leurs PENTES se lisent l'une sur l'autre malgré
// des mois d'écart.
//
// Pas de couleur de gagnant : le verdict s'écrit en mots sous le graphe, et le
// signal ne sert qu'à « mieux que la dernière fois ». A est gris pointillé, B
// blanc cassé plein, chacun nommé au bout de son trait (« A », « B ») et dans
// les lignes d'option au-dessus : jamais la couleur seule.
import type { CurveUnit } from '../../domain/types';
import { Chart } from './Chart';
import { weekLabel, type WeeklyPoint } from './comparison-series';
import { measureLabel } from './unit-label';

/** Graduations de semaines à pas réguliers : toutes jusqu'à 8, puis une sur 2, 4 ou 8. */
function weekTicks(maxWeek: number): { x: number; label: string }[] {
  const last = Math.max(0, Math.floor(maxWeek));
  const step = last <= 8 ? 1 : last <= 16 ? 2 : last <= 32 ? 4 : 8;
  const ticks: { x: number; label: string }[] = [];
  for (let w = 0; w <= last; w += step) ticks.push({ x: w, label: weekLabel(w) });
  return ticks;
}

export function ComparisonChart({
  first,
  second,
  firstLabel,
  secondLabel,
  unit,
}: {
  first: WeeklyPoint[];
  second: WeeklyPoint[];
  /** Libellés humains des deux options (lecteurs d'écran). */
  firstLabel: string;
  secondLabel: string;
  unit: CurveUnit;
}) {
  const maxWeek = Math.max(0, ...first.map((p) => p.week), ...second.map((p) => p.week));
  return (
    <Chart
      series={[
        { id: 'a', tone: 'muted', dashed: true, endLabel: 'A', points: first.map((p) => ({ x: p.week, y: p.e1rm })) },
        { id: 'b', tone: 'ink', endLabel: 'B', points: second.map((p) => ({ x: p.week, y: p.e1rm })) },
      ]}
      height={200}
      xDomain={[0, Math.max(maxWeek, 1)]}
      xTicks={weekTicks(maxWeek)}
      yFormat={(v) => String(Math.round(v))}
      ariaLabel={`${measureLabel(unit)} de la 1ʳᵉ série, semaine par semaine depuis le début de chaque option. A : ${firstLabel}, ${first.length} séances. B : ${secondLabel}, ${second.length} séances.`}
    />
  );
}
