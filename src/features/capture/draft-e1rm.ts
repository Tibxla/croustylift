// e1RM du brouillon de série en Capture (grilling du 2026-09-13).
//
// Affiché pendant qu'on règle poids, reps et RIR, AVANT de valider : sert à
// viser (« 102,5 × 6, ça bat la dernière fois ? »). Volontairement un chiffre
// seul, jamais un verdict « battrait / égaliserait » : le RIR compte comme des
// reps (ADR 0013), et un badge qui s'allume à +1 de RIR pousserait à gonfler
// l'auto-évaluation, donc à fausser les pentes d'analyse. Le verdict reste celui
// de la série réellement faite (ADR 0010).
import { estimateE1rm } from '../../domain/e1rm';

/** e1RM des valeurs réglées, ou `null` quand il n'y a rien de sensé à afficher. */
export function draftE1rm(weightKg: number, reps: number, rir: number): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  try {
    return estimateE1rm(weightKg, reps, rir);
  } catch {
    return null;
  }
}
