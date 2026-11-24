import { describe, expect, it } from 'vitest'
import { manualReloadVerdict } from './manual-reload'
import { UNPERSISTED_CAPTURE_BLOCK, UNPERSISTED_WRITES_BLOCK } from './reload-guards'

describe('bouton « Recharger l’app » de l’écran d’erreur', () => {
  it('recharge quand rien ne vit seulement en mémoire', () => {
    expect(manualReloadVerdict([])).toBe('reload')
  })

  it('refuse tant que des saisies ne tiennent qu’en mémoire (stockage plein)', () => {
    expect(manualReloadVerdict([UNPERSISTED_WRITES_BLOCK])).toBe('unsaved')
    expect(manualReloadVerdict(['brouillon-seance', UNPERSISTED_CAPTURE_BLOCK])).toBe('unsaved')
  })

  it('refuse aussi pendant un brouillon ou une écriture en cours, les mêmes gardes que la reprise automatique', () => {
    expect(manualReloadVerdict(['ecriture-plan'])).toBe('busy')
    expect(manualReloadVerdict(['brouillon-seance'])).toBe('busy')
  })
})
