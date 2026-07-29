// Formatage des readouts (Readout Rule) — chiffres mesurés en FR (virgule décimale).
import type { Range, PerformedSet } from '../../domain/types';

/** Poids en kg, virgule décimale FR, sans zéro inutile : 82.5 -> "82,5", 80 -> "80". */
export function formatWeight(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return rounded.toString().replace('.', ',');
}

/** Une fourchette : "8-12" si min≠max, sinon "3" si min===max. */
export function formatRange(range: Range): string {
  return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

/** La cible prescrite en une ligne : "3-4 × 8-12 @ RIR 1-2". */
export function formatPrescription(sets: Range, reps: Range, rir: Range): string {
  return `${formatRange(sets)} × ${formatRange(reps)} @ RIR ${formatRange(rir)}`;
}

/** Une série loggée en ligne mono : "82,5 × 8 @ RIR 2". */
export function formatSet(set: PerformedSet): string {
  return `${formatWeight(set.weightKg)} × ${set.reps} @ RIR ${set.rir}`;
}

/** Un décompte de séries en équivalent-série (demi-série possible) : "1", "0,5", "1,5". */
export function formatSetCount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toString().replace('.', ',');
}

/** e1RM arrondi à 0,5 kg, format FR : "94,4". */
export function formatE1rm(value: number): string {
  const half = Math.round(value * 2) / 2;
  return formatWeight(half);
}

/**
 * Jours calendaires entre deux dates ISO 'YYYY-MM-DD' (`b - a`). Calcul en LOCAL
 * sur la seule partie calendaire (Date(y, m-1, d)) : le DST ne décale jamais le
 * compte (l'arrondi absorbe l'heure d'été/hiver).
 */
export function daysBetween(aIso: string, bIso: string): number {
  const parse = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime();
  };
  return Math.round((parse(bIso) - parse(aIso)) / 86_400_000);
}

/**
 * Ancienneté d'une date en langage courant, pour le repère « Dernière fois tu
 * notais » (décision 2026-07-29 : une note repère est TOUJOURS datée — sans ça,
 * rien ne dit si « dernière fois » remonte à 3 jours ou 3 mois) : « hier »,
 * « il y a N jours / semaines / mois ». Une date future ou du jour (ne devrait
 * pas arriver, le repère est borné à la veille) retombe sur « aujourd'hui ».
 */
export function formatRelativeDay(dateIso: string, todayIso: string): string {
  const days = daysBetween(dateIso, todayIso);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  // Semaines jusqu'à ~2 mois réels : « il y a 1 mois » n'apparaît jamais (ambigu
  // avec 4-6 semaines), on passe aux mois quand l'arrondi en donne au moins 2.
  if (days < 61) {
    const weeks = Math.round(days / 7);
    return `il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;
  }
  return `il y a ${Math.round(days / 30.44)} mois`;
}
