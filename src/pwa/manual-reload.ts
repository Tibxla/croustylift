// Le bouton « Recharger l'app » de l'écran d'erreur (ErrorBoundary) : un
// rechargement demandé à la main, mais qui passe par les mêmes gardes de perte
// que la reprise automatique d'un chunk introuvable (`recoverFromChunkFailure`,
// register.ts). Tant que des saisies ne tiennent qu'en mémoire (stockage plein)
// ou qu'un brouillon ou une écriture est en cours, recharger les détruirait :
// on ne recharge pas, on dit pourquoi.
//
// Une séance en cours n'empêche pas ce rechargement-là : son état est écrit sur
// l'appareil (sinon une garde « non persisté » le signale), et l'utilisateur le
// demande lui-même. La reprise automatique, elle, ne l'interrompt pas.
import { UNPERSISTED_CAPTURE_BLOCK, UNPERSISTED_WRITES_BLOCK } from './reload-guards'

export type ManualReloadVerdict = 'reload' | 'unsaved' | 'busy'

export function manualReloadVerdict(blockers: readonly string[]): ManualReloadVerdict {
  if (blockers.includes(UNPERSISTED_WRITES_BLOCK) || blockers.includes(UNPERSISTED_CAPTURE_BLOCK)) return 'unsaved'
  return blockers.length > 0 ? 'busy' : 'reload'
}
