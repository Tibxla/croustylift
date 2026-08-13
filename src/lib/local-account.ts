// Marqueur d'identité local (ADR 0012).
//
// PROBLÈME : hors-ligne, supabase-js renvoie « session null » aussi bien pour
// « personne ne s'est jamais connecté sur cet appareil » que pour « session
// présente mais invérifiable faute de réseau ». La garde de route doit
// distinguer les deux SANS lire le format interne de la clé `sb-*` de
// supabase-js (couplage aux internals, susceptible de bouger à un upgrade).
//
// Le marqueur est posé à la CONNEXION (session validée par le serveur) et
// retiré à la DÉCONNEXION volontaire uniquement — jamais par une panne réseau
// ni un jeton périmé (cf. CONTEXT.md « Session locale » / « Déconnexion »).
// Une révocation côté serveur ne le retire PAS : les données locales survivent
// jusqu'à la re-Connexion du même compte, ou au forçage explicite (ADR 0012).

const STORAGE_KEY = 'croustylift:account';

/** L'identité reconnue localement : de quoi étiqueter caches et écritures. */
export interface LocalAccount {
  userId: string;
  email: string | null;
}

/** Pose (ou ré-affirme) le marqueur. Dégrade en silence si le stockage refuse. */
export function saveLocalAccount(account: LocalAccount): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  } catch {
    // Quota plein / mode privé : sans marqueur persisté, l'appareil ne sera pas
    // reconnu hors-ligne — mais rien ne casse en ligne. On ne bloque pas la Connexion.
  }
}

/** Lit le marqueur, ou `null` si absent / illisible / de forme inattendue. */
export function loadLocalAccount(): LocalAccount | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { userId?: unknown }).userId === 'string'
    ) {
      const email = (parsed as { email?: unknown }).email;
      return {
        userId: (parsed as { userId: string }).userId,
        email: typeof email === 'string' ? email : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Retire le marqueur (Déconnexion, ou forçage de purge). */
export function clearLocalAccount(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
