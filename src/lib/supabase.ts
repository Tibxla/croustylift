import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { fetchWithTimeout } from './fetch-timeout'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !key && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ]
    .filter(Boolean)
    .join(', ')

  throw new Error(
    `Configuration Supabase manquante : ${missing}. ` +
      'Renseigne ces variables dans le fichier .env à la racine du projet.',
  )
}

// Fragment d'URL à l'arrivée (lien d'invitation ou de récupération), relevé
// AVANT la création du client : supabase-js le retire de l'URL une fois la
// session ouverte (cf. auth/arrival-link).
export const arrivalHash = typeof window === 'undefined' ? '' : window.location.hash

// Toute requête du client est bornée dans le temps (cf. lib/fetch-timeout) : sans
// cela un `fetch` qui pend retient la passe de flush en cours et tous les
// flush suivants.
export const supabase = createClient<Database>(url, key, {
  global: { fetch: fetchWithTimeout() },
})

// Clé localStorage où supabase-js persiste sa session (dérivée du sous-domaine
// du projet, cf. SupabaseClient). Utilisée UNIQUEMENT comme purge de secours à
// la Déconnexion forcée hors-ligne (ADR 0012) : supabase-js refuse alors de
// retirer sa session (l'appel réseau échoue avant la purge locale). La garde de
// route, elle, ne lit JAMAIS cette clé — c'est le marqueur local-account qui
// fait foi.
export const supabaseAuthStorageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
