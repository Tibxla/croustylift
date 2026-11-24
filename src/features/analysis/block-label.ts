// Libellés humains d'une option de comparaison de blocs.
//
// Un bloc n'a pas de nom (il est dérivé, jamais déclaré, cf. ADR 0001) : on
// l'identifie par sa période, en dates courtes 'JJ/MM' comme les axes des
// graphes. Un bloc en cours (end null) se lit depuis son début. Pas de tiret
// long (préférence produit ferme).
import type { Block } from '../../domain/types'
import { shortDay } from './chart-time'

/** La période d'un bloc en mots : « du 05/01 au 10/02 », ou « depuis le 10/02 » s'il est en cours. */
export function blockPeriodLabel(block: Block): string {
  return block.end === null ? `depuis le ${shortDay(block.start)}` : `du ${shortDay(block.start)} au ${shortDay(block.end)}`
}

/**
 * « Push · PPL v2 » : la séance d'une option de comparaison, toujours avec sa
 * routine, puisque le menu mêle des blocs de routines différentes (ADR 0016) et
 * qu'un nom de séance n'est unique que dans sa routine.
 */
export function seanceRoutineLabel(
  seance: { name: string; routineName: string | null } | undefined,
): string {
  if (!seance) return '(séance inconnue)'
  return seance.routineName ? `${seance.name} · ${seance.routineName}` : seance.name
}
