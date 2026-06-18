// Couche d'accès pour l'import (issue #35).
//
// Câble le VRAI client `supabase` au coeur testé (import.ts) et lit le fichier
// sélectionné par l'utilisateur. La logique pure (parsing + upsert) vit dans
// import.ts et est couverte par TDD ; ici on n'a que le branchement et la
// lecture du fichier.
import { supabase } from '../../lib/supabase';
import { parseImportFile, importUserData } from './import';

/**
 * Lit un File JSON, parse + valide son contenu, puis upsert les données dans le
 * compte courant (RLS). Lève une erreur claire en cas de format invalide ou
 * d'échec Supabase.
 */
export async function restoreFromFile(file: File): Promise<void> {
  const json = await file.text();
  const parsed = parseImportFile(json);
  await importUserData(supabase, parsed);
}
