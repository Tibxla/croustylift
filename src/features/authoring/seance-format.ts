// Formats de la surface Séances (routines, séances, éditeur), purs et testés.
//
// Registre U30 : un décompte entier s'écrit sans décimale (« 13-14 », pas
// « 13,0-14,0 ») ; une fraction garde une décimale à virgule (« 5,8 »). Les
// muscles du vocabulaire canonique (en minuscules en base) s'affichent avec une
// capitale. Fourchettes au trait d'union court, jamais de tiret long.
import type { CountRange } from '../../domain/set-count';
import type { EditorRow, FieldValue } from './prescription-edit';

/** Un compte pondéré : entier tel quel, sinon une décimale à virgule. */
export function fmtCount(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

/** Une fourchette de comptes : « 6 », « 5,8-7 », bornes égales après arrondi en une valeur. */
export function fmtCountRange(range: CountRange): string {
  const a = fmtCount(range.min);
  const b = fmtCount(range.max);
  return a === b ? a : `${a}-${b}`;
}

/** Un champ de prescription : « 3 » (fixe) ou « 8-12 » (fourchette). */
export function fmtField(v: FieldValue): string {
  return v.mode === 'fixe' || v.min === v.max ? String(v.min) : `${v.min}-${v.max}`;
}

/** La prescription d'une ligne : « 3 × 8-12 · RIR 2 ». */
export function summarizeRow(row: Pick<EditorRow, 'sets' | 'reps' | 'rir'>): string {
  return `${fmtField(row.sets)} × ${fmtField(row.reps)} · RIR ${fmtField(row.rir)}`;
}

/** Un muscle du vocabulaire canonique, capitale en tête (« Pectoraux »). */
export function muscleLabel(muscle: string): string {
  return muscle ? muscle[0]!.toUpperCase() + muscle.slice(1) : muscle;
}

/** « vide », « 1 exo », « 4 exos ». */
export function exoCount(n: number): string {
  if (n === 0) return 'vide';
  return `${n} exo${n > 1 ? 's' : ''}`;
}

/** « aucune séance », « 1 séance », « 3 séances ». */
export function seanceCount(n: number): string {
  if (n === 0) return 'aucune séance';
  return `${n} séance${n > 1 ? 's' : ''}`;
}

/**
 * Ce qu'une ligne a changé depuis la version enregistrée : `ajouté` (absente de
 * l'enregistré), `modifié` (prescription différente), ou rien.
 */
export function rowChange(saved: readonly EditorRow[], row: EditorRow): 'ajouté' | 'modifié' | null {
  const before = saved.find((r) => r.rowId === row.rowId);
  if (!before) return 'ajouté';
  return summarizeRow(before) !== summarizeRow(row) ? 'modifié' : null;
}

/** Accusé du catalogue de l'éditeur, qui reste ouvert pour ajouter plusieurs
 *  exos à la suite : le dernier ajouté, puis le compte de cette ouverture
 *  (doublons compris, ils sont permis). '' tant que rien n'est ajouté. */
export function addedNote(names: readonly string[]): string {
  const last = names[names.length - 1];
  if (last === undefined) return '';
  return names.length === 1 ? `${last} ajouté à la séance.` : `${last} ajouté · ${names.length} exos ajoutés.`;
}
