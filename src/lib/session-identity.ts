// Qui est connecté, à l'instant, côté serveur — sans dépendre de supabase-js.
//
// supabase-js résout le jeton à CHAQUE requête. Une lecture en plusieurs
// requêtes (pagination, lib/fetch-all) ou une passe de flush (capture/sync)
// peut donc commencer sous un compte et finir sous un autre
// (Déconnexion puis Connexion pendant le trajet), ou partir sans session du
// tout : après un refresh de jeton raté, les requêtes partent avec la clé
// publique et la RLS répond « aucune ligne » SANS erreur.
//
// La couche d'auth (AuthProvider) pose ici le lecteur de session ; la pagination
// le consulte pour refuser un résultat qui n'est plus celui du compte de départ,
// le flush pour ne rien envoyer sans compte vérifié. Sans lecteur posé (tests,
// modules purs), rien n'est vérifié.

type SessionUserReader = () => Promise<string | null>;

let reader: SessionUserReader | null = null;

/** Pose (ou retire, avec `null`) le lecteur de session. */
export function setSessionUserReader(next: SessionUserReader | null): void {
  reader = next;
}

/**
 * L'id de l'utilisateur de la session courante, `null` sans session vérifiée.
 * `undefined` = aucun lecteur posé : l'appelant ne vérifie rien.
 */
export async function sessionUserId(): Promise<string | null | undefined> {
  return reader ? reader() : undefined;
}
