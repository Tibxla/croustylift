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
// ni un jeton périmé (cf. GLOSSARY.md « Session locale » / « Déconnexion »).
// Une révocation côté serveur ne le retire PAS : les données locales survivent
// jusqu'à la re-Connexion du même compte, ou au forçage explicite (ADR 0012).

const STORAGE_KEY = 'croustylift:account';

/** L'identité reconnue localement : de quoi étiqueter caches et écritures. */
export interface LocalAccount {
  userId: string;
  email: string | null;
}

/**
 * Marqueur tenu EN MÉMOIRE quand le stockage a refusé de l'écrire (quota plein,
 * mode privé). Sans lui, l'app tournait connectée mais sans compte reconnu :
 * chaque écriture enfilée partait sans étiquette de compte et ne remontait
 * jamais (l'outbox ne joue que les ops du compte connecté, ADR 0019), et le
 * marqueur d'un compte PRÉCÉDENT, resté dans le stockage, continuait d'être lu.
 * Il prime donc sur le stockage tant qu'il existe, et vit le temps de la page.
 */
let volatileAccount: LocalAccount | null = null;

/** Pose (ou ré-affirme) le marqueur. Si le stockage refuse, il tient en mémoire. */
export function saveLocalAccount(account: LocalAccount): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    volatileAccount = null;
  } catch {
    // Quota plein / mode privé : sans marqueur persisté, l'appareil ne sera pas
    // reconnu hors-ligne après un rechargement. Pour la page en cours, le compte
    // reste reconnu en mémoire (cf. `volatileAccount`).
    volatileAccount = { ...account };
  }
}

/** Lit le marqueur, ou `null` si absent / illisible / de forme inattendue. */
export function loadLocalAccount(): LocalAccount | null {
  if (typeof localStorage === 'undefined') return null;
  if (volatileAccount) return { ...volatileAccount };
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
  volatileAccount = null;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}
