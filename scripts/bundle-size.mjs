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
  'index.js': 91_000, // code de l'app (mesuré : 86 613, refonte E lot 3 : correction et suppression d'une série, Sommaire, fin de séance enrichie et lecture de la semaine ; 80 000 environ avant le lot 3, 78 642 au lot 2, 75 495 au lot 1)
  'react.js': 63_500, // react, react-dom, scheduler (mesuré : 60 608)
  'supabase.js': 57_500, // (mesuré : 54 775)
  'index.css': 9_000, // (mesuré : 8 426 au lot 2 ; 8 629 au lot 1, 9 110 avant E)
  // À la demande.
  'AnalysisScreen.js': 23_100, // code de l'Analyse (mesuré : 21 942 à la finition du lot 4 de la refonte E, séries d'un point, Record et faits datés, curseur accessible ; 19 348 au lot 4, 17 518 avant)
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
