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
// aucune série : impossible qu'une déviation crée un bloc. La seule exécution
// connue ici est la PREMIÈRE du compte (`firstExecution`), et seulement pour
// ouvrir le bloc implicite d'un compte qui a capturé avant d'activer une routine.
//
// Chaque changement porte son INSTANT (`at`) et son jour LOCAL (`date`). Les
// blocs se bornent à l'instant (ADR 0001, amendement du 2026-11-23) : une séance
// lancée avant l'édition du plan reste dans l'ancien bloc, quel que soit le
// fuseau où on relit les données. Le jour sert au libellé, et de repli pour les
// exécutions sans lancement horodaté ; il est local parce que `performed_on`
// l'est (daté en UTC, un plan édité à 00 h 30 à Paris tombait la veille).
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

/** La toute première exécution du compte rattachée à une séance. */
export interface FirstExecutionRow {
  /** Jour ISO 'YYYY-MM-DD' de la séance (colonne `performed_on`, heure locale). */
  date: string
  /** Instant ISO du lancement (`started_at`). Absent sur une exécution d'avant la colonne. */
  startedAt?: string
  /** La routine de la séance exécutée. */
  routineId: string
}

export interface ConfigTimelineInput {
  activations: ActivationRow[]
  seanceVersions: SeanceVersionRow[]
  seances: SeanceRow[]
  /** Absent = aucun archivage (comptes et jeux de test d'avant l'ADR 0017). */
  seanceArchiveEvents?: SeanceArchiveEventRow[]
  /**
   * Sert au BLOC IMPLICITE : si cette exécution précède toute activation (routine
   * créée à la main, jamais « définie comme courante », la Capture se repliant
   * dessus), sa routine est tenue pour courante depuis ce jour-là. Sans elle, les
   * séances d'avant la première activation ne tombaient dans aucun bloc.
   */
  firstExecution?: FirstExecutionRow | null
}

// Événement interne unifié, horodaté. `kind` départage les ex aequo : une
// activation s'applique avant une version au même instant, pour que la version
// d'une séance de la routine tout juste activée compte dans la config courante ;
// un archivage passe en dernier (on édite une séance avant de la ranger).
type Event =
  | { ts: string; kind: 'activation'; routineId: string; implicit?: FirstExecutionRow }
  | { ts: string; kind: 'version'; seanceId: string }
  | { ts: string; kind: 'archive'; seanceId: string; archived: boolean }

const KIND_ORDER: Record<Event['kind'], number> = { activation: 0, version: 1, archive: 2 }

/**
 * Jour LOCAL 'YYYY-MM-DD' d'un instant ISO, dans le fuseau de l'appareil, comme
 * `performed_on` (posé en date locale par la Capture). Un timestamp illisible
 * rend ses dix premiers caractères plutôt que de planter.
 */
export function localIsoDay(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Ordre chronologique de deux instants ISO (repli lexicographique si illisibles). */
function compareInstants(a: string, b: string): number {
  const diff = Date.parse(a) - Date.parse(b)
  return Number.isNaN(diff) ? a.localeCompare(b) : diff
}

/**
 * L'événement d'activation IMPLICITE, ou `null` si la première exécution ne
 * précède pas la première activation. Même règle que le rattachement d'une
 * exécution à son bloc : avec un lancement horodaté, on compare les instants ;
 * sans, on compare les jours, et le jour de l'activation lui appartient.
 */
function implicitActivation(
  input: ConfigTimelineInput,
  toDay: (ts: string) => string,
): Event | null {
  const first = input.firstExecution
  if (!first) return null

  const earliest = input.activations
    .map((a) => a.activatedAt)
    .sort(compareInstants)[0]
  if (earliest !== undefined) {
    const before =
      first.startedAt !== undefined
        ? compareInstants(first.startedAt, earliest) < 0
        : first.date < toDay(earliest)
    if (!before) return null
  }

  return {
    // Sans lancement horodaté : minuit local du jour de la séance, pour le tri seul.
    ts: first.startedAt ?? `${first.date}T00:00:00`,
    kind: 'activation',
    routineId: first.routineId,
    implicit: first,
  }
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
export function buildConfigTimeline(
  input: ConfigTimelineInput,
  /** Conversion instant -> jour, injectable pour des tests indépendants du fuseau. */
  toDay: (ts: string) => string = localIsoDay,
): ConfigChange[] {
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

  const implicit = implicitActivation(input, toDay)
  if (implicit) events.push(implicit)

  // Tri chronologique ; à égalité, l'activation passe avant la version.
  events.sort(
    (a, b) => compareInstants(a.ts, b.ts) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
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

    if (ev.kind === 'activation' && ev.implicit) {
      // Bloc implicite : daté du jour de la séance, à l'instant de son lancement
      // s'il est connu.
      const change: ConfigChange = { date: ev.implicit.date, configId: signature() }
      if (ev.implicit.startedAt !== undefined) change.at = ev.implicit.startedAt
      timeline.push(change)
      continue
    }

    timeline.push({ date: toDay(ev.ts), at: ev.ts, configId: signature() })
  }

  return timeline
}
