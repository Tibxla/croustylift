// Libellé humain d'un bloc pour la comparaison.
//
// Un bloc n'a pas de nom (il est dérivé, jamais déclaré, cf. ADR 0001) : on
// l'identifie par sa plage de dates, en mono court 'JJ/MM' comme les axes des
// graphes (Readout Rule de DESIGN.md). Un bloc en cours (end null) se lit
// « ... → en cours ». Pas de tiret long (préférence produit ferme).
import type { Block } from '../../domain/types'

/** 'YYYY-MM-DD' → 'JJ/MM'. Renvoie l'entrée telle quelle si elle est mal formée. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-')
  if (!month || !day) return iso
  return `${day}/${month}`
}

/** Plage de dates lisible d'un bloc, p.ex. « 05/01 → 10/02 » ou « 10/02 → en cours ». */
export function blockLabel(block: Block): string {
  const end = block.end === null ? 'en cours' : shortDay(block.end)
  return `${shortDay(block.start)} → ${end}`
}
