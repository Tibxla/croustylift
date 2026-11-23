import type { ConfigChange, Block } from './types'

/** Instant en millisecondes, ou `null` s'il est absent ou illisible. */
function instantMs(at: string | undefined): number | null {
  if (at === undefined) return null
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Ordre chronologique de deux changements : le jour d'abord (ISO 'YYYY-MM-DD',
 * ordre lexicographique), puis l'instant quand les deux en portent un. Deux
 * éditions du plan le même jour s'ordonnent donc par leur heure.
 */
function compareChanges(a: ConfigChange, b: ConfigChange): number {
  const byDay = a.date.localeCompare(b.date)
  if (byDay !== 0) return byDay
  const aMs = instantMs(a.at)
  const bMs = instantMs(b.at)
  return aMs === null || bMs === null ? 0 : aMs - bMs
}

export function detectBlocks(changes: ConfigChange[]): Block[] {
  // Trie sans muter l'entrée (tri stable : à égalité, l'ordre d'entrée tient).
  const sorted = [...changes].sort(compareChanges)

  // Fusionne les entrées consécutives de même config (redondantes, pas un vrai changement).
  const runs = sorted.filter(
    (change, i) => i === 0 || change.configId !== sorted[i - 1]!.configId,
  )

  return runs.map((run, i) => {
    const next = runs[i + 1]
    const block: Block = {
      configId: run.configId,
      start: run.date,
      end: next ? next.date : null,
    }
    // Les instants ne sont posés que s'ils existent : un bloc sans instant reste
    // borné au jour (cf. `executionsInBlock`).
    if (run.at !== undefined) block.startAt = run.at
    if (next?.at !== undefined) block.endAt = next.at
    return block
  })
}

/**
 * Identité d'un bloc dans une liste : son instant de début, à défaut son jour.
 * Le jour seul ne suffit plus, deux blocs peuvent naître le même jour (routine
 * activée le matin, plan retouché l'après-midi) et porter chacun des points.
 */
export function blockKey(block: Block): string {
  return block.startAt ?? block.start
}
