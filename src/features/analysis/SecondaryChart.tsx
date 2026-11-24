// Le graphe des séries 2+ (cf. domain/secondary-curve.ts) : la moyenne des
// séries de travail après la première, repère de résistance à la fatigue.
// SUBORDONNÉ à la courbe héros : plus bas, trait gris fin, jamais le signal (un
// repère n'est pas un « mieux que la dernière fois »). Même axe temps que la
// courbe du dessus (`cardTimeAxis`), et son curseur suit le point choisi
// au-dessus : la même date tombe à la même abscisse. Son axe Y est le sien,
// libellé, et part de zéro (échelle validée le 2026-11-23, commit cc7e91e) :
// un repère de fatigue, pas une loupe sur ses variations.
import type { CurveUnit, E1rmPoint } from '../../domain/types';
import { Chart } from './Chart';
import { dayToTime, timeTick, type TimeAxis } from './chart-time';
import { secondaryBreaks } from './point-detail';
import { secondaryLabel } from './unit-label';

export function SecondaryChart({
  curve,
  primary,
  unit,
  axis,
  cursorDate,
}: {
  curve: E1rmPoint[];
  /** La courbe héros de la même séance : une séance sans série 2+ coupe le trait. */
  primary: E1rmPoint[];
  unit: CurveUnit;
  /** L'axe temps de la carte, partagé avec la courbe héros. */
  axis: TimeAxis | null;
  /** Le jour choisi sur la courbe héros : le curseur passe ici aussi. */
  cursorDate?: string;
}) {
  const values = curve.map((p) => Math.round(p.e1rm));
  const breaks = secondaryBreaks(curve, primary);
  return (
    <Chart
      series={[{ id: 'series-2', tone: 'muted', points: curve.map((p, k) => ({ x: dayToTime(p.date), y: p.e1rm, break: breaks[k] })) }]}
      height={128}
      yTarget={2}
      yFromZero
      months
      xDomain={axis?.domain}
      xTicks={(axis?.ticks ?? []).map((t) => ({ x: t, label: timeTick(t) }))}
      yFormat={(v) => String(Math.round(v))}
      cursorX={cursorDate ? dayToTime(cursorDate) : undefined}
      ariaLabel={
        values.length === 0
          ? `Séries 2+, ${secondaryLabel(unit)} : aucune donnée.`
          : `Séries 2+, ${secondaryLabel(unit)} sur ${values.length} séances, de ${Math.min(...values)} à ${Math.max(...values)} ${unit}.`
      }
    />
  );
}
