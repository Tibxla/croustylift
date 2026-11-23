// Coeur de l'import / restauration JSON (issue #35).
//
// Pendant exact de export.ts : les fonctions testables sont PURES ou à CLIENT
// INJECTÉ, sans jamais importer lib/supabase. La couche app (data-import.ts)
// câble le vrai client. Trois étapes :
//   1. `parseImportFile(json)` : parse + valide structurellement le JSON brut
//      (version de format vérifiée, tables présentes, tableaux bien formés). Pure.
//   2. `prepareForRestore(data)` : met à niveau les lignes d'une sauvegarde plus
//      ancienne que le schéma (colonnes apparues depuis, règles durcies). Pure.
//   3. `importUserData(client, parsed)` : UN appel à la fonction de base
//      `import_user_data` (migration 0024), qui écrit les douze tables dans une
//      seule transaction, parents avant enfants. Tout passe, ou rien n'est écrit.
//
// La fonction de base tourne sous la RLS de l'appelant : les lignes ne peuvent
// tomber que dans le compte courant. On n'écrit jamais owner_id / user_id
// nous-mêmes, ils sont déjà dans les lignes brutes et la RLS les vérifie.
//
// Idempotence : chaque ligne est upsertée par son `id` (UUID client, ADR 0003).
// Réimporter le même fichier ne crée pas de doublon, la ligne existante est
// remplacée. Seul le journal des archivages ne se réécrit pas (migration 0022) :
// un événement déjà en base est laissé tel quel. Pendant l'import, le trigger
// d'archivage se tait : l'état `archived_at` et le journal viennent du fichier,
// et la base ajoute un événement correctif si les deux se contredisent.
//
// Exos de base exclus : un fichier d'export ne contient que des exos perso
// (owner_id non null), comme le précise docs/export-format.md.

import { EXPORT_FORMAT_VERSION, EXPORT_TABLES, type CollectedData, type Row } from './export';
import { builtInConstraintViolation } from '../../lib/db-errors';

/** Version de FORMAT courante (= celle de l'export). */
export const IMPORT_FORMAT_VERSION = EXPORT_FORMAT_VERSION;

/** Versions de format que cet importeur sait lire. */
const SUPPORTED_VERSIONS = [1, IMPORT_FORMAT_VERSION] as const;
type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

/**
 * Tables apparues en v2 : absentes d'une sauvegarde v1, qui les précède. On les
 * lit alors comme vides (une sauvegarde v1 n'a connu aucun archivage).
 */
const TABLES_ADDED_IN_V2: readonly string[] = ['seance_archive_events'];

/** Résultat du parsing d'un fichier d'export (même forme que UserDataExport). */
export interface ParsedImport {
  version: SupportedVersion;
  exportedAt: string;
  data: CollectedData;
}

// --- Client injectable --------------------------------------------------------
//
// Surface MINIMALE dont l'import a besoin : l'appel de la fonction de base. La
// couche app (data-import.ts) l'adapte au vrai client.

export interface ImportClient {
  rpc(
    fn: 'import_user_data',
    args: { p_data: CollectedData },
  ): PromiseLike<{ error: { message: string; code?: string } | null }>;
}

// --- Parsing + validation (pure) ----------------------------------------------

/**
 * Parse et valide structurellement un JSON brut de sauvegarde.
 *
 * Lève une erreur claire dans les cas suivants :
 *   - syntaxe JSON invalide
 *   - champ `version` absent, non-entier, ou de valeur inconnue/incompatible
 *   - champ `data` absent ou non-objet
 *   - une table de EXPORT_TABLES absente de `data`
 *   - une table présente mais pas un tableau
 */
export function parseImportFile(json: string): ParsedImport {
  // 1. Parsing syntaxique.
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('JSON invalide : impossible de parser le fichier.');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Le fichier doit être un objet JSON.');
  }

  const obj = raw as Record<string, unknown>;

  // 2. Validation du champ version.
  if (!('version' in obj)) {
    throw new Error('Champ "version" absent du fichier de sauvegarde.');
  }
  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version)) {
    throw new Error('Champ "version" invalide : doit être un entier.');
  }
  if (!(SUPPORTED_VERSIONS as readonly number[]).includes(obj.version)) {
    throw new Error(
      `Version de format ${obj.version} inconnue ou incompatible. Versions prises en charge : ${SUPPORTED_VERSIONS.join(', ')}.`,
    );
  }
  const version = obj.version as SupportedVersion;

  // 3. Validation de data.
  if (!('data' in obj)) {
    throw new Error('Champ "data" absent du fichier de sauvegarde.');
  }
  if (typeof obj.data !== 'object' || obj.data === null || Array.isArray(obj.data)) {
    throw new Error('Champ "data" invalide : doit être un objet.');
  }

  const data = { ...(obj.data as Record<string, unknown>) };

  // 4. Toutes les tables doivent être présentes et être des tableaux. Une
  //    sauvegarde v1 n'a pas les tables apparues en v2 : on les lit vides.
  if (version === 1) {
    for (const table of TABLES_ADDED_IN_V2) {
      if (!(table in data)) data[table] = [];
    }
  }
  for (const table of EXPORT_TABLES) {
    if (!(table in data)) {
      throw new Error(`Table "${table}" absente du fichier de sauvegarde.`);
    }
    if (!Array.isArray(data[table])) {
      throw new Error(`Table "${table}" invalide : doit être un tableau.`);
    }
  }

  return {
    version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    data: data as CollectedData,
  };
}

// --- Mise à niveau des lignes (pure) ------------------------------------------

/**
 * Met les lignes d'une sauvegarde au niveau du schéma courant, sans rien
 * inventer. Une sauvegarde récente en ressort inchangée.
 *
 *   - `exercises` : `unilateral` absent vaut false (défaut de la colonne) ; des
 *     muscles principaux absents ou vides sont repris du groupe musculaire
 *     unique d'avant (`muscle_group`), comme l'a fait la migration 0005. La base
 *     exige au moins un muscle principal (migration 0017).
 *   - `dated_notes` : une seule note par exercice et par exécution (migration
 *     0018). D'un doublon, on garde la note la plus récente, celle que l'app
 *     affichait déjà.
 */
export function prepareForRestore(data: CollectedData): CollectedData {
  return {
    ...data,
    exercises: data.exercises.map(withExerciseDefaults),
    dated_notes: latestNotePerExercise(data.dated_notes),
  };
}

function withExerciseDefaults(row: Row): Row {
  const muscles = row.primary_muscles;
  const hasMuscles = Array.isArray(muscles) && muscles.length > 0;
  const group = row.muscle_group;
  const canFill = typeof group === 'string' && group.trim() !== '';
  if (typeof row.unilateral === 'boolean' && (hasMuscles || !canFill)) return row;
  return {
    ...row,
    unilateral: typeof row.unilateral === 'boolean' ? row.unilateral : false,
    ...(hasMuscles || !canFill ? {} : { primary_muscles: [group] }),
  };
}

function latestNotePerExercise(notes: Row[]): Row[] {
  const latest = new Map<string, Row>();
  for (const note of notes) {
    const key = `${String(note.execution_id)}|${String(note.exercise_id)}`;
    const kept = latest.get(key);
    if (!kept || String(note.created_at ?? '') > String(kept.created_at ?? '')) {
      latest.set(key, note);
    }
  }
  if (latest.size === notes.length) return notes;
  const keep = new Set(latest.values());
  return notes.filter((note) => keep.has(note));
}

// --- Restauration (client injecté) --------------------------------------------

/**
 * Restaure les données d'un export dans le compte courant (RLS), en un seul
 * appel : la fonction de base écrit toutes les tables dans une transaction.
 * Une erreur, sur n'importe quelle ligne de n'importe quelle table, annule
 * tout : le compte reste comme avant l'import.
 *
 * Les tables partent dans l'ordre EXPORT_TABLES ; la fonction de base impose
 * de toute façon le sien (parents avant enfants). Une sauvegarde vide ne fait
 * aucun appel.
 */
export async function importUserData(client: ImportClient, parsed: ParsedImport): Promise<void> {
  const prepared = prepareForRestore(parsed.data);
  const data = Object.fromEntries(
    EXPORT_TABLES.map((table) => [table, prepared[table]]),
  ) as CollectedData;
  if (EXPORT_TABLES.every((table) => data[table].length === 0)) return;

  const { error } = await client.rpc('import_user_data', { p_data: data });
  if (error) throw new Error(importRefusalMessage(error));
}

/**
 * Le message d'un import refusé par la base. Un refus de contrainte intégré de
 * Postgres vient du FICHIER (référence vers une ligne qu'il ne contient pas,
 * valeur hors bornes) : on le dit en français, sans le nom de la contrainte.
 * L'import est une seule transaction (migration 0024) : rien n'a été écrit. Un
 * refus de trigger, déjà en français, passe tel quel (cf. lib/db-errors).
 */
function importRefusalMessage(error: { message: string; code?: string }): string {
  switch (builtInConstraintViolation(error)) {
    case 'foreign-key':
      return 'Import refusé : le fichier fait référence à un élément qu’il ne contient pas. Rien n’a été importé.';
    case 'check':
      return 'Import refusé : le fichier contient une valeur hors des limites acceptées. Rien n’a été importé.';
    default:
      return error.message;
  }
}
