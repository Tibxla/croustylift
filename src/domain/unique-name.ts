// Noms uniques des séances et des routines (grilling du 2026-09-13).
//
// Un nom de séance est unique dans sa routine, un nom de routine dans le compte,
// archivées comprises, casse et espaces en trop ignorés (CONTEXT.md « Séance »,
// « Routine ») : c'est par son nom qu'on choisit une séance en salle, et
// « séance · routine » doit désigner une seule séance dans l'analyse. La base
// tient la règle par un index unique sur la même normalisation (migration
// 0013) ; ce module sert au client à proposer un nom libre. Pur, testé.

/** Clé de comparaison d'un nom : espaces en trop retirés, casse ignorée. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Premier nom libre à partir de `base` : `base` lui-même, sinon « base 2 »,
 * « base 3 »… Un `base` déjà numéroté (« Push 2 ») repart de son numéro plutôt
 * que d'empiler « Push 2 2 ».
 */
export function nextFreeName(base: string, taken: readonly string[]): string {
  const clean = base.trim().replace(/\s+/g, ' ');
  const keys = new Set(taken.map(nameKey));
  if (!keys.has(nameKey(clean))) return clean;

  const numbered = /^(.*\S)\s+(\d+)$/.exec(clean);
  const stem = numbered ? numbered[1]! : clean;
  let n = numbered ? Number(numbered[2]) + 1 : 2;
  while (keys.has(nameKey(`${stem} ${n}`))) n++;
  return `${stem} ${n}`;
}
