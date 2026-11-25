// Valeur du meta `apple-mobile-web-app-status-bar-style` voulue pour ce build
// (variable VITE_BARRE_ETAT), lue par le plugin `barreEtat` de vite.config.ts.
// Absente : index.html garde la sienne.
//
// En `.mjs` pour la même raison que build-commit.mjs : `process` n'est pas typé
// dans la configuration TypeScript du projet (pas de `@types/node`).

const VALEURS = ['black', 'default', 'black-translucent']

export function barreEtatVoulue() {
  const voulu = process.env.VITE_BARRE_ETAT
  if (voulu === undefined || voulu === '') return undefined
  if (!VALEURS.includes(voulu)) {
    throw new Error(`VITE_BARRE_ETAT=${voulu} : attendu ${VALEURS.join(', ')}`)
  }
  return voulu
}
