import { describe, expect, it } from 'vitest'
import { heroLabel, measureLabel, secondaryLabel, zeroLoadHolesLabel } from './unit-label'

describe('libellés de l’unité d’une courbe', () => {
  it('un exo jamais chargé dit « reps », jamais « e1RM »', () => {
    expect(measureLabel('reps')).toBe('reps eff.')
    expect(heroLabel('reps')).toBe('Reps effectives')
    expect(secondaryLabel('reps')).toBe('reps eff. moyennes')
    for (const label of [measureLabel('reps'), heroLabel('reps'), secondaryLabel('reps')]) {
      expect(label).not.toMatch(/e1RM/)
    }
  })

  it('le cas général garde l’e1RM', () => {
    expect(measureLabel('kg')).toBe('e1RM')
    expect(heroLabel('kg')).toBe('e1RM estimé')
    expect(secondaryLabel('kg')).toBe('e1RM moyen')
  })

  it('les séances à 0 kg hors d’une courbe en kilos sont dites, accord compris', () => {
    expect(zeroLoadHolesLabel(0)).toBeNull()
    expect(zeroLoadHolesLabel(1)).toBe('1 séance à 0 kg hors courbe')
    expect(zeroLoadHolesLabel(3)).toBe('3 séances à 0 kg hors courbe')
  })
})
