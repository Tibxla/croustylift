import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

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

export const supabase = createClient<Database>(url, key)
