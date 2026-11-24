/// <reference types="vitest/config" />
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { buildCommit } from './scripts/build-commit.mjs'

/** Nom du paquet npm d'un module (`@scope/nom` ou `nom`), ou null hors node_modules. */
function packageOf(id: string): string | null {
  const marker = '/node_modules/'
  const at = id.lastIndexOf(marker)
  if (at === -1) return null
  const [first = '', second = ''] = id.slice(at + marker.length).split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(buildCommit()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Le service worker neuf s'active dès son installation (skipWaiting et
      // clientsClaim, posés par `autoUpdate`) : une app installée avec un ancien
      // bundle passe ainsi sur la nouvelle version à sa prochaine ouverture, sans
      // rien avoir à lui demander. En revanche la PAGE ouverte ne se recharge pas
      // d'office : c'est src/pwa/register.ts (`onNeedReload`) qui choisit un
      // moment sans saisie en cours, et qui met à l'abri le chunk paresseux de
      // l'Analyse avant que le précache ne soit remplacé. Aucune invite : pas de
      // « Nouvelle version disponible » entre deux séries.
      registerType: 'autoUpdate',
      // Les icônes du manifest sont déjà prises par `globPatterns` : sans ceci
      // elles figuraient deux fois dans la liste de précache.
      includeManifestIcons: false,

      // Precache l'integralite du shell statique genere par Vite.
      // Les requetes Supabase (*.supabase.co) ne sont PAS precachees : elles
      // passent toujours par le reseau, via la route NetworkOnly declaree dans
      // runtimeCaching ci-dessous.
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
        description: 'Tracker de musculation, capture sans friction en salle.',
        lang: 'fr',
        // display standalone : se comporte comme une app native (pas de barre
        // de navigation navigateur), essentiel pour "Ajouter a l'ecran d'accueil".
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // Le fond de l'app (--color-bg, DESIGN.md) pour les deux : barre du système
        // et écran de lancement se fondent dans le premier écran.
        theme_color: '#100e0c',
        background_color: '#100e0c',
        // Icônes E (public/) : règle graduée blanc cassé, aiguille au signal, sur
        // le fond noir chaud, opaques et pleines (l'OS pose son propre masque).
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
            // Icône maskable : l'OS l'affiche dans un masque (cercle, squircle).
            // Plein bord, logo dans la zone de sécurité centrale (~80 %) pour ne
            // pas être rogné. Le PNG passe en premier : certains lanceurs Android
            // n'acceptent pas de SVG pour ce rôle. Il est rendu depuis le SVG.
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Sépare les gros vendors stables du code applicatif : leur hash ne change
        // pas d'un déploiement à l'autre, le service worker ne retélécharge que le
        // code de l'app. En fonction, et par nom de paquet EXACT : la forme objet
        // (`react: ['react', 'react-dom']`) laissait `react-dom/client` dans le
        // chunk applicatif.
        manualChunks(id) {
          const pkg = packageOf(id)
          if (pkg === null) return undefined
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react'
          if (pkg.startsWith('@supabase/')) return 'supabase'
          return undefined
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Les worktrees résiduels (.claude/worktrees) contiennent des copies du repo :
    // sans cette exclusion, vitest globbe leurs *.test.ts et teste du code périmé /
    // double-compte. On garde les exclusions par défaut + .claude.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    // Un `navigator.locks` par fil : celui de Node est partagé entre les threads
    // du processus, et `--pool=threads` faisait se bloquer deux fichiers de test
    // sur le même verrou de flush (cf. src/test/thread-locks.ts).
    setupFiles: ['./src/test/thread-locks.ts'],
  },
})
