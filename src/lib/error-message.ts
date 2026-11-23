// Le texte à afficher pour une erreur attrapée.
//
// Les couches data relancent l'objet d'erreur de PostgREST TEL QUEL (`if (error)
// throw error`) : un objet simple `{ code, message, details, hint }`, pas une
// `Error`. `String(err)` en faisait « [object Object] » à l'écran, y compris
// quand la base avait écrit un motif précis en français (triggers des
// migrations 0019b, 0020, 0021). On lit donc son champ `message`.
//
// L'objet relancé n'est pas transformé pour autant : la file de la Capture lit
// son `code` SQLSTATE brut (`isPermanentRejection`, features/capture/outbox.ts).

/** Le message d'une erreur attrapée, qu'elle soit une `Error` ou un objet PostgREST. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const { message } = err as { message?: unknown }
    if (typeof message === 'string' && message !== '') return message
  }
  return String(err)
}
