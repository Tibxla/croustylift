#!/usr/bin/env node
// Contrôle de taille du bundle : `npm run size` (après `npm run build`), ou
// `node scripts/bundle-size.mjs <dossier de build>`. Lancé par la CI.
//
// Mesure le poids gzip de chaque chunk JS et CSS et le confronte à un budget.
// Échoue (code 1) si un chunk dépasse le sien, si un chunk budgété a disparu ou
// si un chunk nouveau n'a pas de budget : une dérive ne passe plus inaperçue.
//
// Les budgets sont les tailles mesurées à leur dernière révision, plus 5 %,
// arrondis aux 500 octets les plus proches. Les relever est permis, mais c'est un
// geste délibéré, visible dans le diff. Dernière révision : lot 3 de la refonte E
// (taille mesurée en commentaire de chaque ligne).

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { evaluateBudgets, logicalName } from './bundle-size-lib.mjs'

/** Octets gzip maximum par chunk. */
const BUDGETS = {
  // Chemin critique : chargé au lancement, Capture comprise.
  'index.js': 91_000, // code de l'app, plafond tenu par le chargement à la demande (mesuré : 73 760 au lot 5 de la refonte E, Séances, Exos, Réglages et saisies refusées passés à la demande ; 89 700 au lot 4, tout compris ; 86 613 au lot 3 ; 80 000 environ avant le lot 3, 78 642 au lot 2, 75 495 au lot 1)
  'react.js': 63_500, // react, react-dom, scheduler (mesuré : 60 608)
  'supabase.js': 57_500, // (mesuré : 54 775)
  'index.css': 9_000, // (mesuré : 8 426 au lot 2 ; 8 629 au lot 1, 9 110 avant E)
  // À la demande.
  'AnalysisScreen.js': 23_100, // code de l'Analyse (mesuré : 21 942 à la finition du lot 4 de la refonte E, séries d'un point, Record et faits datés, curseur accessible ; 19 348 au lot 4, 17 518 avant)
  'SeancesScreen.js': 11_400, // routines, page d'une routine, éditeur de séance (mesuré : 10 783 au lot 5)
  'ReglagesScreen.js': 5_700, // (mesuré : 5 420 au lot 5)
  'ExercisesScreen.js': 4_900, // (mesuré : 4 645 au lot 5)
  'RefusedWritesSheet.js': 2_900, // écran des saisies refusées (mesuré : 2 735 au lot 5)
  'ExerciseForm.js': 1_950, // formulaire d'exo, partagé par Exos et l'éditeur de séance (mesuré : 1 829)
  'confirm.js': 850, // confirmation en ligne du kit, partagée par les écrans à la demande (mesuré : 806)
  'useReloadBlockWhile.js': 300, // partagé par Exos et l'éditeur de séance (mesuré : 240)
  'workbox-window.prod.es5.js': 2_500, // enregistrement du service worker (mesuré : 2 357)
}

const dist = resolve(process.argv[2] ?? 'dist')
const assets = join(dist, 'assets')
const sizes = {}
for (const file of readdirSync(assets)) {
  if (!/\.(js|css)$/.test(file)) continue
  const name = logicalName(file)
  sizes[name] = (sizes[name] ?? 0) + gzipSync(readFileSync(join(assets, file)), { level: 9 }).length
}

const { rows, ok } = evaluateBudgets(sizes, BUDGETS)
const kb = (bytes) => (bytes === null ? '-' : `${(bytes / 1000).toFixed(1)} ko`)
console.log('chunk'.padEnd(30), 'gzip'.padStart(10), 'budget'.padStart(10), '  état')
for (const row of rows) {
  console.log(row.name.padEnd(30), kb(row.size).padStart(10), kb(row.max).padStart(10), ` ${row.status}`)
}
process.exit(ok ? 0 : 1)
