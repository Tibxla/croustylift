// Couche d'accès / orchestration de l'export (issue #8).
//
// Câble le VRAI client `supabase` au coeur testé (`export.ts`) et déclenche le
// téléchargement navigateur. Le coeur (collecte + sérialisation) reste pur et
// couvert par TDD ; ici on n'a que le branchement et l'effet de bord DOM.
import { supabase } from '../../lib/supabase';
import {
  buildExport,
  collectUserData,
  serializeExport,
  type UserDataExport,
} from './export';

/**
 * Collecte toutes les données de l'utilisateur (RLS) et les enveloppe dans le
 * format d'export versionné. `exportedAt` est posé maintenant (ISO UTC).
 */
export async function exportUserData(): Promise<UserDataExport> {
  const collected = await collectUserData(supabase);
  return buildExport(collected, new Date().toISOString());
}

/** Nom de fichier du backup, horodaté à la date locale : `croustylift-backup-AAAA-MM-JJ.json`. */
export function exportFilename(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `croustylift-backup-${year}-${month}-${day}.json`;
}

/**
 * Exporte puis déclenche le téléchargement du JSON dans le navigateur. Construit
 * un Blob, fabrique une URL objet, clique un lien `download` synthétique, puis
 * révoque l'URL (sinon le Blob fuiterait en mémoire jusqu'au reload).
 */
export async function downloadUserData(): Promise<void> {
  const data = await exportUserData();
  const json = serializeExport(data);

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
