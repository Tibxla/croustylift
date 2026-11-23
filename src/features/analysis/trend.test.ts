import { describe, expect, it } from 'vitest'
import { winnerVerdict } from './trend'

// Le verdict d'une comparaison dit ce que fait la MEILLEURE pente, pas toujours
// « progresse » : entre −1,0 et −3,1 %/sem, personne ne progresse.
describe('winnerVerdict', () => {
  it('une pente gagnante en hausse : elle progresse le plus vite', () => {
    expect(winnerVerdict(2.3)).toBe('progresse le plus vite')
  })

  it('une pente gagnante dans la zone de stagnation : elle tient le mieux', () => {
    expect(winnerVerdict(0.3)).toBe('tient le mieux')
    expect(winnerVerdict(-0.4)).toBe('tient le mieux')
  })

  it('une pente gagnante en baisse : elle recule le moins', () => {
    expect(winnerVerdict(-1.01)).toBe('recule le moins')
  })
})
