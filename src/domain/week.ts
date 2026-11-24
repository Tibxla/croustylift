// La SEMAINE des décomptes hebdomadaires : la semaine civile, du lundi au
// dimanche, en dates locales (comme `performed_on`, posé en date locale par la
// Capture). Purs, sur des jours ISO 'YYYY-MM-DD' : aucune heure, donc aucun
// décalage de fuseau ni d'heure d'été.

/** Le lundi (jour ISO) de la semaine civile qui contient `dateIso`. */
export function weekStartIso(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1)
  // getDay : 0 = dimanche … 6 = samedi. Décalage jusqu'au lundi précédent.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const z = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${z(date.getMonth() + 1)}-${z(date.getDate())}`
}
