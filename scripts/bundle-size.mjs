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
// geste délibéré, visible dans le diff. Dernière révision : fusion du registre d'écritures du 25/11 (index.js à 89 000) ; avant, correctifs de la branche d'intégration du 24/11, budgets au ras élargis à la mesure + 10 % (SeancesScreen.js, seance-meta-load.js, use-dated-load.js)
// (taille mesurée en commentaire de chaque ligne).

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { evaluateBudgets, logicalName } from './bundle-size-lib.mjs'

/** Octets gzip maximum par chunk. */
const BUDGETS = {
  // Chemin critique : chargé au lancement, Capture comprise.
  'index.js': 89_000, // code de l'app, tenu par le chargement à la demande (mesuré : 84 691 le 2026-11-25, à la fusion du registre d'écritures dans l'intégration, budget relevé à la mesure + 5 % ; 80 122 sur la branche du registre seule, sans journal de secours, ADR 0025, reprise de l'ancien format comprise, à retirer après le 2026-12-31 ; 78 100 après les lots UX et UI de l'audit du 24/11, reps reprises, garde du double toucher, copies datées ; 73 760 au lot 5 de la refonte E, Séances, Exos, Réglages et saisies refusées passés à la demande ; 89 700 au lot 4, tout compris ; 86 613 au lot 3 ; 80 000 environ avant le lot 3, 78 642 au lot 2, 75 495 au lot 1)
  'react.js': 63_500, // react, react-dom, scheduler (mesuré : 60 608)
  'supabase.js': 57_500, // (mesuré : 54 775)
  'index.css': 8_200, // (mesuré : 7 832 à la fusion de la navigation collée sous l'île, bande du bord comprise, 25/11, budget relevé à la mesure + 5 % ; 7 746 aux groupes arrondis et pastilles, 25/11 ; 7 437 avant ; 7 053 au nettoyage du code mort ; 8 426 au lot 2, 8 629 au lot 1, 9 110 avant E)
  // À la demande.
  'AnalysisScreen.js': 25_000, // code de l'Analyse (mesuré : 23 781 au lot UX hors Salle, statuts du Journal face à la Référence, aide sur les mots, copies datées ; 21 942 à la finition du lot 4 de la refonte E, séries d'un point, Record et faits datés, curseur accessible ; 19 348 au lot 4, 17 518 avant)
  'SeancesScreen.js': 15_200, // routines, page d'une routine, éditeur de séance (mesuré : 13 802 aux correctifs d'intégration, verrou de réordonnancement et « Réessayer », refus d'un ordre dépassé ; 13 106 à l'intuitivité de Séances, ⋯ et feuilles d'actions, ligne d'état, catalogue ouvert ; 11 277 avant ; 10 783 au lot 5)
  'ReglagesScreen.js': 5_700, // (mesuré : 5 420 au lot 5)
  'ExercisesScreen.js': 5_200, // (mesuré : 4 925 au lot 5, usage local d'un exo compris)
  'RefusedWritesSheet.js': 3_300, // écran des saisies refusées (mesuré : 3 131 au lot 5, motifs et saisies retenues compris)
  'NoteSheet.js': 2_100, // formulaire d'exo et feuille de note, partagés par Exos et l'éditeur de séance (mesuré : 1 998 au nettoyage du code mort, note sortie du formulaire ; 2 139 avant ; 1 792 pour le formulaire seul, alors chunk ExerciseForm.js)
  'confirm.js': 850, // confirmation en ligne du kit, partagée par les écrans à la demande (mesuré : 806)
  'useReloadBlockWhile.js': 300, // partagé par Exos et l'éditeur de séance (mesuré : 240)
  'seance-meta-load.js': 910, // « dernière fois mardi » de « Quelle séance ? », lu à part (mesuré : 821 aux correctifs d'intégration, amorce depuis la copie et réponses sous garde d'ordre ; 800 avant)
  'seance-dirty.js': 1_650, // copies datées des écrans au calme et garde de sortie des éditeurs, partagées par Séances et l'Analyse ; Rollup nomme ce chunk d'après la garde depuis que le shell ne l'importe plus (retour à l'endroit quitté, 25/11 : 1 506 ; avant, use-dated-load.js seul : 556 aux correctifs d'intégration, 525 avant)
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
