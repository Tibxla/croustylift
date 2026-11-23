// Couche d'accès pour l'import (issue #35).
//
// Câble le VRAI client `supabase` au coeur testé (import.ts) et lit le fichier
// sélectionné par l'utilisateur. La logique pure (parsing, mise à niveau des
// lignes) vit dans import.ts et est couverte par TDD ; ici on n'a que le
// branchement et la lecture du fichier.
import type { Json } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';
import { parseImportFile, importUserData, type ImportClient } from './import';

/**
 * Le vrai client, réduit à l'appel dont l'import a besoin. Les lignes viennent
 * d'un `JSON.parse` : elles sont du JSON par construction, d'où le cast.
 */
const importClient: ImportClient = {
  rpc: (fn, args) => supabase.rpc(fn, { p_data: args.p_data as unknown as Json }),
};

/**
 * Lit un File JSON, parse + valide son contenu, puis restaure les données dans
 * le compte courant (RLS), en une transaction : en cas d'échec, rien n'est
 * écrit. Lève une erreur claire en cas de format invalide ou d'échec Supabase.
 */
export async function restoreFromFile(file: File): Promise<void> {
  const json = await file.text();
  const parsed = parseImportFile(json);
  await importUserData(importClient, parsed);
}
