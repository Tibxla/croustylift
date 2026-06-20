// BPM moyen + durée de séance dans le temps (cf. issue #28, brainstorm-intent.md
// §4 « BPM et durée affichés sur le même graphe (métriques liées) »). Ces deux
// mesures sont capturées par séance (`executions.bpm_avg`, `executions.duration_min`)
// mais n'étaient jamais affichées. On les rend LIÉES sur un même graphe.
//
// Les deux métriques sont OPTIONNELLES (durée auto-chronométrée, BPM saisi à la
// main et facultatif, cf. §4) : un point existe dès qu'AU MOINS une des deux est
// présente, l'autre restant `null` (un trou sur sa courbe, pas un zéro). Une
// exécution sans aucune des deux ne produit pas de point ; si AUCUNE n'en a, le
// résultat est [] et l'UI n'affiche pas de graphe. Pure, sans dépendance réseau.
//
// GARDE « exécution vide » (cf. CONTEXT.md « Exécution ») : une exécution SANS
// série n'est pas une exécution réelle — elle ne produit aucun point, même si elle
// porte une durée. Sans cette garde, une orpheline (clôture partie à zéro série,
// cf. fix racine de `handleFinish`) afficherait une durée fantôme sur le graphe
// alors qu'elle n'apparaît même pas au journal (qui exige déjà des séries).

/** Une exécution lue, dans sa forme brute (bpm/durée optionnels). */
export interface RawExecutionMetric {
  /** Date ISO 'YYYY-MM-DD'. */
  date: string
  bpmAvg: number | null
  durationMin: number | null
  /** L'exécution a-t-elle au moins une série loggée ? Sinon : pas un point (orpheline). */
  hasSets: boolean
}

/** Un point du graphe BPM/durée : la date + les deux métriques (l'une peut manquer). */
export interface SessionMetricPoint {
  /** Date ISO 'YYYY-MM-DD'. */
  date: string
  bpmAvg: number | null
  durationMin: number | null
}

/**
 * Dérive les points BPM/durée des exécutions : garde celles qui ont au moins une
 * des deux métriques, triées par date CROISSANTE (axe temporel, comme les autres
 * graphes de l'analyse). Pure.
 */
export function buildSessionMetrics(
  executions: RawExecutionMetric[],
): SessionMetricPoint[] {
  const points = executions.flatMap((execution) => {
    // Exécution vide (aucune série) : jamais un point, même avec une durée.
    if (!execution.hasSets) {
      return []
    }
    if (execution.bpmAvg === null && execution.durationMin === null) {
      return []
    }
    return [
      {
        date: execution.date,
        bpmAvg: execution.bpmAvg,
        durationMin: execution.durationMin,
      },
    ]
  })

  // Dates ISO 'YYYY-MM-DD' : l'ordre lexicographique est l'ordre chronologique.
  return points.sort((a, b) => a.date.localeCompare(b.date))
}
