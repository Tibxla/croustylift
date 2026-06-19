import type { ConfigChange, Block } from './types'

export function detectBlocks(changes: ConfigChange[]): Block[] {
  // Trie par date sans muter l'entrée. Les dates ISO 'YYYY-MM-DD' s'ordonnent lexicographiquement.
  const sorted = [...changes].sort((a, b) => a.date.localeCompare(b.date))

  // Fusionne les entrées consécutives de même config (redondantes, pas un vrai changement).
  const runs = sorted.filter(
    (change, i) => i === 0 || change.configId !== sorted[i - 1]!.configId,
  )

  return runs.map((run, i) => ({
    configId: run.configId,
    start: run.date,
    end: i + 1 < runs.length ? runs[i + 1]!.date : null,
  }))
}
