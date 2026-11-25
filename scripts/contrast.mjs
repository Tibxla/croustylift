#!/usr/bin/env node
// Contrastes WCAG des tokens de couleur (src/index.css) : `npm run contrast`.
//
// C'est la preuve chiffrée des ratios cités dans DESIGN.md et dans index.css.
// Chaque encre est mesurée sur les fonds où du texte se pose (bg, raise), puis
// le texte du bouton principal sur son blanc cassé, et chaque couleur de signal prédéfinie
// (src/settings/signal-presets.json) sur le fond et sur les feuilles.
//
// Seuil : 4,5:1 (AA, texte courant). Les paires marquées « exigé » font échouer
// le script (code 1) si elles passent dessous. `dim` est un repère non textuel,
// mesuré pour information : `--strict` l'exige aussi.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hexContrast, parseHexTokens } from './contrast-lib.mjs'

const AA = 4.5
const strict = process.argv.includes('--strict')
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const tokens = parseHexTokens(read('../src/index.css'))
const presets = JSON.parse(read('../src/settings/signal-presets.json'))

const BACKGROUNDS = ['bg', 'raise', 'group', 'group-sheet']
const INKS = [
  { name: 'ink', required: true },
  { name: 'muted', required: true },
  { name: 'faint', required: true },
  { name: 'dim', required: false },
]
const pairs = [
  ...INKS.flatMap((ink) =>
    BACKGROUNDS.map((bg) => ({ fg: tokens[ink.name], bg: tokens[bg], label: `${ink.name} / ${bg}`, required: ink.required })),
  ),
  // Feuille des saisies refusées : la date « Refusée le … » (14 px, gris discret) sur le fond levé.
  { fg: tokens.faint, bg: tokens.raise, label: 'date de refus / raise', required: true },
  // Bouton principal : libellé noir et ligne secondaire sur le blanc cassé, libellé pressé sur le gris.
  { fg: tokens.bg, bg: tokens.ink, label: 'bg / ink', required: true },
  { fg: tokens['on-ink'], bg: tokens.ink, label: 'on-ink / ink', required: true },
  { fg: tokens.bg, bg: tokens.muted, label: 'bg / muted', required: true },
  ...presets.flatMap((p) =>
    BACKGROUNDS.map((bg) => ({ fg: p.hex, bg: tokens[bg], label: `signal ${p.name} / ${bg}`, required: true })),
  ),
]

let failed = false
console.log('texte / fond'.padEnd(34), 'ratio'.padStart(7), '  verdict')
for (const { fg, bg, label, required } of pairs) {
  if (!fg || !bg) {
    console.error(`token introuvable pour ${label}`)
    failed = true
    continue
  }
  const ratio = hexContrast(fg, bg)
  const ok = ratio >= AA
  const enforced = required || strict
  if (!ok && enforced) failed = true
  const verdict = ok ? 'AA' : enforced ? 'SOUS AA (exigé)' : 'sous AA (informatif)'
  console.log(label.padEnd(34), `${ratio.toFixed(2)}:1`.padStart(7), ` ${verdict}`)
}
process.exit(failed ? 1 : 0)
