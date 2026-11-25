// La bande des séries, rendue en HTML statique : ce qui s'écrit sous chaque
// numéro (une ligne, poids tronqué, RIR) et ce que lit le lecteur d'écran (la
// valeur exacte).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import { bandCells } from './set-band';
import { SetBand } from './SetBand';

const draft = { weightKg: 126.25, reps: 12, rir: 4 };

function render(sets: PerformedSet[], unilateral: boolean, side: 'left' | 'right' | null, plannedMax: number) {
  const setIds = sets.map((_, i) => `id${i}`);
  return renderToStaticMarkup(
    <SetBand
      cells={bandCells({ sets, setIds, plannedMax, unilateral, side })}
      badges={sets.map((_, i) => (i === 0 ? { axis: 'reference', verdict: 'battu' } : null))}
      draft={draft}
      unilateral={unilateral}
      onEdit={() => {}}
    />,
  );
}

/** Les noms lus des cases, dans l'ordre (case à bouton : celui du bouton). */
function names(html: string): string[] {
  return html
    .split('<li')
    .slice(1)
    .map((chunk) => {
      const tag = chunk.slice(0, chunk.indexOf('>'));
      return (/aria-label="([^"]*)"/.exec(tag)?.[1] ?? /<button[^>]*aria-label="([^"]*)"/.exec(chunk)?.[1] ?? '').replace(/&#x27;|&#39;/g, '’');
    });
}

describe('SetBand', () => {
  it('bilatéral : une ligne sous le numéro, poids tronqué et RIR ; le nom lu garde la valeur exacte', () => {
    const html = render([{ order: 1, weightKg: 171.25, reps: 8, rir: 1 }], false, null, 4);
    expect(html).toContain('171×8 · R1');
    expect(html).toContain('126×12 · R4');
    expect(names(html)).toEqual([
      'Corriger la série 1, 171,25 kilos, 8 reps, RIR 1, battue',
      'Série 2 en cours, 126,25 kilos, 12 reps, RIR 4',
      'Série 3, à faire',
      'Série 4, à faire',
    ]);
  });

  it('unilatéral : une case par côté, « 1 G » puis « 1 D », le côté dans le nom lu', () => {
    const html = render([{ order: 1, weightKg: 12, reps: 10, rir: 2, side: 'left' }], true, 'right', 2);
    expect(html).toContain('>1 G<');
    expect(names(html)).toEqual([
      'Corriger la série 1, gauche, 12 kilos, 10 reps, RIR 2, battue',
      'Série 1 en cours, droite, 126,25 kilos, 12 reps, RIR 4',
      'Série 2, gauche, à faire',
      'Série 2, droite, à faire',
    ]);
  });
});
