// Identifiant du build affiché dans le bloc Compte : le déploiement est manuel,
// c'est le seul moyen de savoir depuis un téléphone quel commit tourne.
//
// Vercel fournit le SHA quand le déploiement vient d'un dépôt git ; en local on le
// lit dans git (suffixe « + » si l'arbre porte des modifications non commitées) ;
// faute des deux, « inconnu », la date de build restant affichée à côté.
//
// En `.mjs` et non dans vite.config.ts : ce code touche aux API de Node, que la
// configuration TypeScript du projet ne type pas (pas de `@types/node`).

import { execSync } from 'node:child_process'

export function buildCommit() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA
  if (fromVercel) return fromVercel.slice(0, 7)
  try {
    const run = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const sha = run('git rev-parse --short=7 HEAD')
    const dirty = run('git status --porcelain --untracked-files=no') !== ''
    return sha ? `${sha}${dirty ? '+' : ''}` : 'inconnu'
  } catch {
    return 'inconnu'
  }
}
