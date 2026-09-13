// Préférences d'affichage locales à l'appareil (grilling du 2026-09-13).
//
// Aujourd'hui une seule : les courbes de séance masquées sur la carte d'un exo.
// Préférence d'affichage, pas donnée : elle reste sur l'appareil (pas de table,
// pas d'écriture réseau), scopée au `userId` du marqueur local, et part avec la
// Déconnexion comme le reste des données locales du compte (ADR 0012). Sans
// marqueur, rien n'est lu ni écrit.
import { loadLocalAccount } from './local-account';

const PREFIX = 'croustylift:prefs';

function hiddenCurvesKey(userId: string, exerciseId: string): string {
  return `${PREFIX}:${userId}:hidden-curves:${exerciseId}`;
}

/** Clés des courbes masquées pour cet exo ; `[]` si rien, illisible ou sans compte. */
export function loadHiddenCurves(exerciseId: string): string[] {
  const account = loadLocalAccount();
  if (!account || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(hiddenCurvesKey(account.userId, exerciseId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Retient les courbes masquées de cet exo. Dégrade en silence si le stockage refuse. */
export function saveHiddenCurves(exerciseId: string, keys: readonly string[]): void {
  const account = loadLocalAccount();
  if (!account || typeof localStorage === 'undefined') return;
  try {
    const key = hiddenCurvesKey(account.userId, exerciseId);
    if (keys.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(keys));
  } catch {
    /* quota plein / mode privé : la préférence ne survivra pas au rechargement */
  }
}

/** Purge les préférences de tous les comptes (Déconnexion / forçage). */
export function clearLocalPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(`${PREFIX}:`)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
