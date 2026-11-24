// La pente d'une courbe en clair : signe + mot + chiffre (« ▲ en hausse · +1,2
// %/sem »), dans la teinte de la triade. Sans pente, on dit ce qui manque (le
// nombre de séances du bloc), jamais un zéro ni « pente indispo » (registre U23).
// Remplace l'ancien badge : pas de pastille, pas de fond teinté.
import { Status } from '../../ui';
import type { RatePeriod } from './data';
import { formatRate } from './format';
import { sessionsLabel } from './rate-period';
import { rateVerdict, SLOPE_WORD } from './slope-words';

export function SlopeStatus({
  weeklyRate,
  period,
  short = false,
  size = 11,
  className = '',
}: {
  weeklyRate: number | null;
  period: RatePeriod;
  /** Le chiffre seul, sans le mot (quand il est dit ailleurs). */
  short?: boolean;
  size?: number;
  className?: string;
}) {
  if (weeklyRate === null) {
    // Le chiffre seul attendu : le détail de ce qui manque est écrit ailleurs.
    if (short) return <span className={`text-muted ${className}`}>pas de pente</span>;
    return (
      <span className={`text-muted ${className}`}>
        {period.sessions === 0
          ? `aucune séance${period.since === null ? '' : ' dans le bloc'}`
          : `${sessionsLabel(period.sessions)}, pas encore de pente`}
      </span>
    );
  }
  const v = rateVerdict(weeklyRate);
  const figure = `${formatRate(weeklyRate)} %/sem`;
  return <Status v={v} size={size} className={className} word={short ? figure : `${SLOPE_WORD[v]} · ${figure}`} />;
}
