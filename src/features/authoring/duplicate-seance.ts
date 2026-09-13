// Duplication de séance (ADR 0015) — logique PURE.
//
// Ce fichier n'importe RIEN de Supabase : le catalogue des séances copiables et
// la transformation des prescriptions se testent sans réseau ni .env (cf.
// duplicate-seance.test.ts). L'orchestration des lectures / inserts vit dans
// data.ts, qui ne fait que brancher ces fonctions sur les requêtes.
//
// Deux règles portées ici, toutes deux dictées par l'ADR 0015 :
//   - la copie ne reprend que le TEMPLATE (exos + fourchettes). Les champs
//     joints ou fusionnés per-user que porte une prescription éditable (nom de
//     l'exo, muscles, unilatéral) ne sont PAS copiés : ils se relisent à
//     l'affichage, et les figer reviendrait à couler un override personnel dans
//     le template. `PrescriptionInput` ne les contient pas — le strip est donc
//     structurel, pas une omission à surveiller.
//   - la copie REPOSITIONNE à l'index plutôt que de reprendre les `position` de
//     la source : une source aux positions trouées (suppressions successives)
//     donnerait sinon une copie trouée.
import type { EditablePrescription, PrescriptionInput } from './data';

// =====================================================================
// Le contenu copié
// =====================================================================

/**
 * Convertit les prescriptions de la version courante d'une séance source en
 * prescriptions à insérer dans la copie : triées par position source, puis
 * renumérotées 0, 1, 2… Une source vide donne une copie vide (séance sans exo,
 * état valide — c'est ce que `createSeance` produit déjà).
 */
export function toDuplicatedPrescriptions(
  source: EditablePrescription[],
): PrescriptionInput[] {
  return [...source]
    .sort((a, b) => a.position - b.position)
    .map((presc, index) => ({
      exerciseId: presc.exerciseId,
      position: index,
      sets: presc.sets,
      reps: presc.reps,
      rir: presc.rir,
    }));
}

// =====================================================================
// Le catalogue des séances copiables
// =====================================================================

/** Une séance proposée comme source de copie, avec de quoi la situer et la juger. */
export interface SeanceCatalogEntry {
  seanceId: string;
  seanceName: string;
  routineId: string;
  routineName: string;
  /** La séance appartient-elle à la routine courante ? (sert au tri et au libellé) */
  isCurrentRoutine: boolean;
  /** Nombre d'exos de sa version courante. 0 = séance vide, affichée quand même. */
  exerciseCount: number;
  /**
   * Séance archivée, ou dans une routine archivée (ADR 0017). Elle reste
   * copiable : son contenu peut resservir dans une nouvelle routine.
   */
  isArchived: boolean;
}

/** Les lignes brutes dont le catalogue se déduit (formes minimales, pas les Row complètes). */
export interface CatalogSources {
  routines: { id: string; name: string; archived_at?: string | null }[];
  seances: {
    id: string;
    name: string;
    routine_id: string;
    position: number;
    archived_at?: string | null;
  }[];
  versions: { id: string; seance_id: string; version: number }[];
  prescriptions: { seance_version_id: string }[];
  currentRoutineId: string | null;
}

/**
 * Id de la version COURANTE (numéro le plus élevé) de chaque séance. Miroir pur
 * de `getCurrentVersionId`, appliqué à toutes les séances d'un coup pour éviter
 * une requête par séance.
 *
 * Exporté parce que la couche data s'en sert AVANT de requêter les
 * prescriptions : `seance_versions` est append-only (ADR 0001), donc filtrer sur
 * toutes les versions ferait grossir la requête avec l'âge du compte alors que
 * seules les versions courantes sont comptées.
 */
export function currentVersionIdBySeance(
  versions: CatalogSources['versions'],
): Map<string, string> {
  const best = new Map<string, { id: string; version: number }>();
  for (const version of versions) {
    const known = best.get(version.seance_id);
    if (!known || version.version > known.version) {
      best.set(version.seance_id, { id: version.id, version: version.version });
    }
  }
  return new Map([...best].map(([seanceId, v]) => [seanceId, v.id]));
}

/**
 * Assemble le catalogue des séances copiables, ordonné pour le sélecteur :
 * routine courante d'abord, puis les autres routines dans l'ordre reçu (le plus
 * ancien d'abord, cf. `listRoutines`) ; à l'intérieur d'une routine, les séances
 * par position croissante, `id` en départage pour rester déterministe.
 *
 * Une séance SANS exercice reste listée, avec `exerciseCount` à 0 : la filtrer
 * ferait disparaître une séance que l'utilisateur cherche sans lui dire pourquoi.
 * Une routine sans séance ne produit aucune entrée (rien à en dire).
 */
export function buildSeanceCatalog(sources: CatalogSources): SeanceCatalogEntry[] {
  const versionIdOf = currentVersionIdBySeance(sources.versions);

  const countByVersion = new Map<string, number>();
  for (const presc of sources.prescriptions) {
    countByVersion.set(
      presc.seance_version_id,
      (countByVersion.get(presc.seance_version_id) ?? 0) + 1,
    );
  }

  const routineRank = new Map(sources.routines.map((routine, index) => [routine.id, index]));
  const routineName = new Map(sources.routines.map((routine) => [routine.id, routine.name]));
  const archivedRoutines = new Set(
    sources.routines.filter((routine) => routine.archived_at).map((routine) => routine.id),
  );

  const sortable = sources.seances
    .filter((seance) => routineName.has(seance.routine_id))
    .map((seance) => {
      const versionId = versionIdOf.get(seance.id);
      const entry: SeanceCatalogEntry = {
        seanceId: seance.id,
        seanceName: seance.name,
        routineId: seance.routine_id,
        routineName: routineName.get(seance.routine_id) ?? '',
        isCurrentRoutine: seance.routine_id === sources.currentRoutineId,
        exerciseCount: versionId ? (countByVersion.get(versionId) ?? 0) : 0,
        isArchived: Boolean(seance.archived_at) || archivedRoutines.has(seance.routine_id),
      };
      return {
        entry,
        rank: routineRank.get(seance.routine_id) ?? Number.MAX_SAFE_INTEGER,
        position: seance.position,
      };
    });

  sortable.sort((a, b) => {
    if (a.entry.isCurrentRoutine !== b.entry.isCurrentRoutine) {
      return a.entry.isCurrentRoutine ? -1 : 1;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.position !== b.position) return a.position - b.position;
    return a.entry.seanceId.localeCompare(b.entry.seanceId);
  });

  return sortable.map((item) => item.entry);
}
