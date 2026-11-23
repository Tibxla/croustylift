#!/usr/bin/env node
// Contrastes WCAG des tokens de couleur (src/index.css) : `npm run contrast`.
//
// C'est la preuve chiffrée des ratios cités dans DESIGN.md et dans index.css.
// Chaque encre est mesurée sur les trois fonds où du texte se pose (bg, surface,
// surface-2), plus le texte du bouton plein sur son fond accent.
//
// Seuil : 4,5:1 (AA, texte courant). Les paires marquées « exigé » font échouer
// le script (code 1) si elles passent dessous. `ink-faint` est un niveau de méta
// discrète, mesuré pour information : `--strict` l'exige aussi.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseOklchTokens, tokenContrast } from './contrast-lib.mjs'

const AA = 4.5
const strict = process.argv.includes('--strict')
const cssPath = fileURLToPath(new URL('../src/index.css', import.meta.url))
const tokens = parseOklchTokens(readFileSync(cssPath, 'utf8'))

const BACKGROUNDS = ['bg', 'surface', 'surface-2']
const INKS = [
  { name: 'ink', required: true },
  { name: 'ink-muted', required: true },
  { name: 'accent-ink', required: true },
  { name: 'good', required: true },
  { name: 'warn', required: true },
  { name: 'ink-faint', required: false },
]
const pairs = [
  ...INKS.flatMap((ink) => BACKGROUNDS.map((bg) => ({ fg: ink.name, bg, required: ink.required }))),
  { fg: 'on-accent', bg: 'accent-strong', required: true },
  { fg: 'on-accent', bg: 'accent', required: false },
]

let failed = false
console.log('texte / fond'.padEnd(34), 'ratio'.padStart(7), '  verdict')
for (const { fg, bg, required } of pairs) {
  if (!tokens[fg] || !tokens[bg]) {
    console.error(`token introuvable : --color-${!tokens[fg] ? fg : bg}`)
    failed = true
    continue
  }
  const ratio = tokenContrast(tokens[fg], tokens[bg])
  const ok = ratio >= AA
  const enforced = required || strict
  if (!ok && enforced) failed = true
  const verdict = ok ? 'AA' : enforced ? 'SOUS AA (exigé)' : 'sous AA (informatif)'
  console.log(`${fg} / ${bg}`.padEnd(34), `${ratio.toFixed(2)}:1`.padStart(7), ` ${verdict}`)
}
process.exit(failed ? 1 : 0)
