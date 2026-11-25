// La bande unilatérale, rendue en HTML statique : une case par série présente,
// et le brouillon dans la case que vise le côté courant.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { UniSetBand } from './SetBand';

const L = (order: number, reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side: 'left' });
const R = (order: number, reps = 10): PerformedSet => ({ order, weightKg: 12, reps, rir: 2, side: 'right' });
const draft = { weightKg: 14, reps: 8, rir: 1 };

/** Les libellés des cases, dans l'ordre (case à bouton : celui du bouton). */
function cells(sets: PerformedSet[], side: 'left' | 'right', plannedMax: number): string[] {
  const html = renderToStaticMarkup(
    <UniSetBand
      sets={sets}
      setIds={sets.map((_, i) => `id${i}`)}
      badges={sets.map(() => null)}
      draft={draft}
      side={side}
      plannedMax={plannedMax}
      onEdit={() => {}}
    />,
  );
  return html
    .split('<li')
    .slice(1)
    .map((chunk) => {
      const tag = chunk.slice(0, chunk.indexOf('>'));
      const label = /aria-label="([^"]*)"/.exec(tag)?.[1] ?? /<button[^>]*aria-label="([^"]*)"/.exec(chunk)?.[1] ?? '';
      return label.replace(/&#x27;|&#39;/g, '’');
    });
}

describe('UniSetBand', () => {
  it('deux droites au même rang (doublon venu d’un autre appareil) : les deux se voient et se corrigent', () => {
    const labels = cells([L(1), R(1, 10), R(1, 7)], 'left', 2);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe('Corriger la série 1, gauche 12 × 10, droite 12 × 10');
    expect(labels[1]).toBe('Corriger la série 2, gauche à faire, droite 12 × 7');
    expect(labels[2]).toBe('Série 3 en cours, gauche à faire, droite à faire');
  });

  it('trois gauches sur un exo prévu à deux séries : trois cases loggées, la 4e en cours à gauche', () => {
    const labels = cells([L(1, 10), L(2, 9), L(3, 8)], 'left', 2);
    expect(labels).toHaveLength(4);
    expect(labels[2]).toBe('Corriger la série 3, gauche 12 × 8, droite à faire');
    expect(labels[3]).toBe('Série 4 en cours, gauche à faire, droite à faire');
  });

  it('trois gauches, côté droit choisi : la 3e série est la case en cours, le brouillon à droite', () => {
    const labels = cells([L(1, 10), L(2, 9), L(3, 8)], 'right', 2);
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe('Corriger la série 1, gauche 12 × 10, droite à faire');
    expect(labels[2]).toBe('Corriger la série 3 en cours, gauche 12 × 8, droite à faire');
  });

  it('cas courant : une série complète, la suivante entamée à gauche, droite choisie', () => {
    const labels = cells([L(1), R(1), L(2)], 'right', 3);
    expect(labels).toHaveLength(3);
    expect(labels[1]).toBe('Corriger la série 2 en cours, gauche 12 × 10, droite à faire');
    expect(labels[2]).toBe('Série 3, gauche à faire, droite à faire');
  });
});
