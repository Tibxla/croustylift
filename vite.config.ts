/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Mise a jour automatique du service worker sans confirmation utilisateur.
      // Adapte a un contexte salle de sport : on ne peut pas se permettre un
      // prompt "Nouvelle version disponible" entre deux series.
      registerType: 'autoUpdate',

      // Precache l'integralite du shell statique genere par Vite.
      // Les requetes Supabase (api.supabase.co / *.supabase.co) ne sont PAS
      // incluses : elles passent toujours par le reseau (network-first ou
      // network-only implicite, aucune route workbox ne les couvre).
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,ttf,svg,png,ico,webp}'],
        // Exclure explicitement les appels Supabase du cache SW.
        // La write-queue offline (outbox.ts) gere la persistance des ecritures ;
        // le SW n'a pas a s'en meler.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Toute requete vers l'API Supabase : network-only.
            // Si le reseau est absent, la requete echoue proprement et
            // l'outbox prend le relai pour les ecritures.
            urlPattern: /^https:\/\/[a-z]+\.supabase\.co\//,
            handler: 'NetworkOnly',
          },
        ],
      },

      manifest: {
        name: 'Croustylift',
        short_name: 'Croustylift',
        description: 'Tracker de musculation, capture zero-friction en salle.',
        lang: 'fr',
        // display standalone : se comporte comme une app native (pas de barre
        // de navigation navigateur), essentiel pour "Ajouter a l'ecran d'accueil".
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // Couleurs coherentes avec DESIGN.md : Noir d'instrument + violet electrique.
        theme_color: '#7c3aed',
        background_color: '#0d0d12',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            // Icone maskable : l'OS l'affiche dans un masque (cercle/squircle).
            // SVG plein-bord avec le logo dans la zone de securite centrale (~80%),
            // pour ne pas etre rogne. Remplace l'ancien PNG qui DUPLIQUAIT l'icone
            // normale (coins arrondis -> logo rogne par le masque).
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    // Les worktrees résiduels (.claude/worktrees) contiennent des copies du repo :
    // sans cette exclusion, vitest globbe leurs *.test.ts et teste du code périmé /
    // double-compte. On garde les exclusions par défaut + .claude.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
