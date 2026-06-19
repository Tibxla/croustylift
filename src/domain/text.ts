// Normalisation de texte pour la recherche (issue #57).
//
// Source unique du « pliage » des accents : minuscule + suppression des
// diacritiques, pour une recherche insensible à la casse ET aux accents. Pur
// (sans React ni Supabase), testé (cf. text.test.ts). À utiliser des deux côtés
// d'un `includes` : on plie la requête ET le nom comparé.

/** Minuscule + suppression des diacritiques pour une recherche insensible aux accents et à la casse. */
export function foldAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
