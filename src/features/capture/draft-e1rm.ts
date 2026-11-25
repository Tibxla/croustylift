// e1RM du brouillon de série en Capture (grilling du 2026-09-13), et sa position
// en direct (choix de l'utilisateur du 25/11).
//
// MESURE. Pendant qu'on règle poids, reps et RIR, AVANT de valider, l'instrument
// affiche l'e1RM des valeurs réglées (ou les reps effectives à 0 kg,
// `perfReadout`) : il sert à viser (« 102,5 × 6, ça passe la dernière fois ? »).
//
// POSITION EN DIRECT (25/11, ADR 0010 amendé le 2026-11-25). Sous « Dernière
// fois » (la Référence du même rang et du même côté) et sous « Record » (le record
// e1RM COURANT, séries du jour comprises), un indicateur dit où se tient le
// brouillon : « ▲ +3,2 au-dessus », « ▬ à égalité » ou « ▼ −6,3 en dessous »
// (`draftScore`, draft-score.ts).
//   - Même juge que les badges, `comparePerformance` : e1RM exact, seuils
//     stricts, reps effectives à 0 kg des deux côtés. À valeurs égales, ce que
//     dit l'indicateur avant le log est ce que dira le badge après.
//   - Des mots de POSITION et un écart signé, jamais un verdict : « battue »,
//     « égalée » et « record » restent réservés aux séries faites.
//   - ▲ au SIGNAL dès le réglage, ▬ en blanc cassé, ▼ en gris.
//
// RISQUE ACCEPTÉ, le 25/11. Le RIR compte comme des reps (ADR 0013) : un ▲ qui
// s'allume à +1 de RIR peut pousser à gonfler l'auto-évaluation, donc à fausser
// les pentes d'analyse. C'est pour cela que, depuis septembre, la mesure était un
// chiffre seul, sans signe ni couleur. L'utilisateur a choisi le ▲ au signal en
// connaissance de ce risque (« je préfère le jaune »), sur prototype (variante A4
// de la saisie). Ce qui le borne : des mots de position plutôt qu'un verdict,
// l'écart chiffré, et aucun « battue » avant le log.
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
