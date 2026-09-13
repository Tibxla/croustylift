// Coeur de l'import / restauration JSON (issue #35).
//
// Pendant exact de export.ts : les fonctions testables (parsing + upsert) sont
// PURES ou à CLIENT INJECTÉ, sans jamais importer lib/supabase. La couche app
// (data.ts) câble le vrai client. Trois étapes :
//   1. `parseImportFile(json)` : parse + valide structurellement le JSON brut
//      (version de format vérifiée, tables présentes, tableaux bien formés). Pure.
//   2. `importUserData(client, parsed)` : upsert idempotent table par table dans
//      l'ordre parents -> enfants (ADR 0003 : UUID client, last-write-wins).
//      RLS côté serveur garantit que les lignes tombent dans le compte courant :
//      on n'écrit jamais owner_id / user_id explicitement (déjà dans les lignes
//      brutes ; RLS valide l'appartenance).
//
// Idempotence : chaque table est upsertée avec `onConflict: 'id'`. Réimporter
// le même fichier deux fois ne crée pas de doublons ; la ligne existante est
// remplacée (last-write-wins sur updated_at, conforme ADR 0003).
//
// Exos de base exclus : un fichier export ne contient que des exos perso
// (owner_id non null), comme le précise docs/export-format.md. L'import les
// réinsère tels quels.

import { EXPORT_FORMAT_VERSION, EXPORT_TABLES, type CollectedData, type Row } from './export';

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
// Surface MINIMALE du client Supabase dont l'import a besoin : `from(table)
// .upsert(rows, { onConflict })`. Le vrai client la satisfait sans cast.

export interface ImportClient {
  from(table: string): {
    upsert(
      rows: Row[],
      options: { onConflict: string; ignoreDuplicates?: boolean },
    ): PromiseLike<{
      data: unknown;
      error: { message: string } | null;
    }>;
  };
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

// --- Upsert (client injecté) --------------------------------------------------

/**
 * Restaure les données d'un export dans le compte courant (RLS).
 *
 * Les tables sont traitées dans l'ordre EXPORT_TABLES (parents -> enfants) pour
 * respecter les clés étrangères. Les tables vides sont sautées. L'upsert se fait
 * sur `onConflict: 'id'` (UUID client, ADR 0003) : idempotent, ré-importer le
 * même fichier ne crée pas de doublons.
 *
 * Une erreur Supabase sur n'importe quelle table interrompt l'import (pas
 * d'import partiel silencieux).
 */
export async function importUserData(client: ImportClient, parsed: ParsedImport): Promise<void> {
  for (const table of EXPORT_TABLES) {
    const rows = parsed.data[table];
    if (rows.length === 0) continue;

    const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
}
