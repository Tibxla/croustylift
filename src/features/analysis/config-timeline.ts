// Construction de la timeline de configurations de template (cf. ADR 0001).
//
// Un BLOC est la période continue durant laquelle la configuration du template
// (routine courante + ses séances versionnées) n'a pas changé. Cette fonction
// PURE transforme le journal des changements de plan en `ConfigChange[]`, que le
// domaine `detectBlocks` découpe ensuite en blocs.
//
// Trois types d'événements ferment/ouvrent un bloc :
//   1. La routine courante change   (une ligne `routine_activations`).
//   2. Une séance DE LA ROUTINE COURANTE est éditée -> nouvelle version
//      (une ligne `seance_versions` dont la séance appartient à la routine
//       courante à cet instant).
//   3. Une séance DE LA ROUTINE COURANTE est archivée ou désarchivée (une ligne
//      `seance_archive_events`, ADR 0017) : elle sort du plan ou y revient. Le
//      journal est daté et append-only, donc désarchiver ne réécrit jamais les
//      blocs passés. Une séance archivée ne compte dans aucune configuration,
//      même quand sa routine redevient courante.
//
// Ce qui ne change JAMAIS la config (donc absent ici par construction) : les
// déviations d'exécution (série annulée/ajoutée, exo skippé/remplacé). On ne lit
// ni `executions` ni `performed_sets` : impossible qu'une déviation crée un bloc.
import type { ConfigChange } from '../../domain/types'

/** Une activation de routine courante (table `routine_activations`). */
export interface ActivationRow {
  /** Timestamp ISO (colonne `activated_at`). */
  activatedAt: string
  routineId: string
}

/** Une nouvelle version de séance (table `seance_versions`). */
export interface SeanceVersionRow {
  /** Timestamp ISO (colonne `created_at`). */
  createdAt: string
  seanceId: string
}

/** Une séance, pour relier une version à sa routine (table `seances`). */
export interface SeanceRow {
  id: string
  routineId: string
}

/** Un archivage (`archived`) ou désarchivage de séance (table `seance_archive_events`). */
export interface SeanceArchiveEventRow {
  /** Timestamp ISO (colonne `occurred_at`). */
  occurredAt: string
  seanceId: string
  archived: boolean
}

export interface ConfigTimelineInput {
  activations: ActivationRow[]
  seanceVersions: SeanceVersionRow[]
  seances: SeanceRow[]
  /** Absent = aucun archivage (comptes et jeux de test d'avant l'ADR 0017). */
  seanceArchiveEvents?: SeanceArchiveEventRow[]
}

// Événement interne unifié, horodaté. `kind` départage les ex aequo : une
// activation s'applique avant une version au même instant, pour que la version
// d'une séance de la routine tout juste activée compte dans la config courante ;
// un archivage passe en dernier (on édite une séance avant de la ranger).
type Event =
  | { ts: string; kind: 'activation'; routineId: string }
  | { ts: string; kind: 'version'; seanceId: string }
  | { ts: string; kind: 'archive'; seanceId: string; archived: boolean }

const KIND_ORDER: Record<Event['kind'], number> = { activation: 0, version: 1, archive: 2 }

/** Jour ISO 'YYYY-MM-DD' extrait d'un timestamp ISO. */
function isoDay(ts: string): string {
  return ts.slice(0, 10)
}

/**
 * Construit la timeline ordonnée des changements de configuration.
 *
 * `configId` est une SIGNATURE de l'état de config (routine courante + nombre de
 * versions actives de chacune de ses séances) : deux états identiques portent le
 * même `configId` (un aller-retour R1->R2->R1 sans édition redonne le 1er id), et
 * deux états distincts en portent un différent.
 *
 * On émet UN `ConfigChange` par événement réel et on laisse `detectBlocks`
 * fusionner les `configId` consécutifs identiques (réactivation de la routine
 * déjà courante, p.ex.) : découper en blocs lui revient, pas à cette couche.
 */
export function buildConfigTimeline(input: ConfigTimelineInput): ConfigChange[] {
  const routineOfSeance = new Map<string, string>()
  for (const s of input.seances) routineOfSeance.set(s.id, s.routineId)

  const events: Event[] = [
    ...input.activations.map(
      (a): Event => ({ ts: a.activatedAt, kind: 'activation', routineId: a.routineId }),
    ),
    ...input.seanceVersions.map(
      (v): Event => ({ ts: v.createdAt, kind: 'version', seanceId: v.seanceId }),
    ),
    ...(input.seanceArchiveEvents ?? []).map(
      (a): Event => ({
        ts: a.occurredAt,
        kind: 'archive',
        seanceId: a.seanceId,
        archived: a.archived,
      }),
    ),
  ]

  // Tri chronologique. Les timestamps ISO s'ordonnent lexicographiquement ; à
  // égalité, l'activation passe avant la version.
  events.sort(
    (a, b) => a.ts.localeCompare(b.ts) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  )

  // État rejoué : routine courante + compteur PERSISTANT de versions par séance
  // (une version éditée le reste, même après un passage par une autre routine).
  let currentRoutineId: string | null = null
  const versionCount = new Map<string, number>()
  // Séances archivées à l'instant rejoué, persistant d'une routine à l'autre.
  const archived = new Set<string>()

  // Signature canonique de l'état courant : routine + ses séances triées avec
  // leur compteur de versions. Déterministe et stable.
  function signature(): string {
    const parts: string[] = []
    for (const [seanceId, routineId] of routineOfSeance) {
      if (routineId !== currentRoutineId || archived.has(seanceId)) continue
      parts.push(`${seanceId}:${versionCount.get(seanceId) ?? 0}`)
    }
    parts.sort()
    return `routine=${currentRoutineId}|${parts.join(',')}`
  }

  const timeline: ConfigChange[] = []

  for (const ev of events) {
    if (ev.kind === 'activation') {
      currentRoutineId = ev.routineId
    } else if (ev.kind === 'archive') {
      // L'état d'archivage se rejoue toujours (il suit la séance d'une routine à
      // l'autre), mais ne change la config que dans la routine courante.
      if (ev.archived) archived.add(ev.seanceId)
      else archived.delete(ev.seanceId)
      const routineId = routineOfSeance.get(ev.seanceId)
      if (currentRoutineId === null || routineId !== currentRoutineId) continue
    } else {
      // Version d'une séance : ne compte que si la séance appartient à la
      // routine courante. Sinon (séance inconnue, hors routine, ou aucune
      // routine encore activée) c'est une édition hors plan actif -> ignorée.
      const routineId = routineOfSeance.get(ev.seanceId)
      if (currentRoutineId === null || routineId !== currentRoutineId) continue
      versionCount.set(ev.seanceId, (versionCount.get(ev.seanceId) ?? 0) + 1)
    }

    timeline.push({ date: isoDay(ev.ts), configId: signature() })
  }

  return timeline
}
