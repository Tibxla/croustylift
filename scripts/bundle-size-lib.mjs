// Budget de taille du bundle : fonctions pures, testées (bundle-size-lib.test.mjs).

/**
 * Nom logique d'un fichier de build : `assets/index-DB2gw0h3.js` -> `index.js`.
 * Le hash de contenu (8 caractères ajoutés par Vite) est retiré pour qu'un
 * budget désigne le même chunk d'un build à l'autre.
 */
export function logicalName(file) {
  const base = file.split('/').pop() ?? file
  return base.replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1')
}

/**
 * Confronte des tailles mesurées à des budgets.
 * `sizes` : `{ nom logique: octets gzip }` ; `budgets` : `{ nom logique: octets max }`.
 * Un chunk budgété absent du build est une erreur (renommage non répercuté), un
 * chunk JS ou CSS sans budget aussi (nouveau chunk à budgéter sciemment).
 */
export function evaluateBudgets(sizes, budgets) {
  const rows = []
  for (const [name, max] of Object.entries(budgets)) {
    const size = sizes[name]
    if (size === undefined) rows.push({ name, size: null, max, status: 'absent' })
    else rows.push({ name, size, max, status: size <= max ? 'ok' : 'dépassé' })
  }
  for (const [name, size] of Object.entries(sizes)) {
    if (!(name in budgets)) rows.push({ name, size, max: null, status: 'sans budget' })
  }
  return { rows, ok: rows.every((row) => row.status === 'ok') }
}
