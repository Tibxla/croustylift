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
  it('bilatéral : une ligne sous le numéro, poids en quatre chiffres et RIR ; le nom lu garde la valeur exacte', () => {
    const html = render([{ order: 1, weightKg: 171.25, reps: 8, rir: 1 }], false, null, 4);
    // « 171,2×8 », puis le RIR en gris après une espace fine.
    expect(html).toMatch(/171,2×8<span[^>]*>\u2009R1</);
    expect(html).toMatch(/126,2×12<span[^>]*>\u2009R4</);
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

  it('une valeur trop longue (reps à trois chiffres, RIR à deux) est rognée dans sa case, sans déborder sur la voisine', () => {
    const html = render([{ order: 1, weightKg: 126.25, reps: 120, rir: 10 }], false, null, 4);
    // La forme validée reste la même : « 126,2×120 », puis le RIR après une espace fine.
    expect(html).toMatch(/126,2×120<span[^>]*>\u2009R10</);
    // La ligne de valeur ne se coupe pas et ne déborde pas : elle se rogne en « … ».
    const valueLine = /<span aria-hidden="true" class="([^"]*)"><span class="underline/.exec(html)?.[1] ?? '';
    expect(valueLine.split(' ')).toEqual(expect.arrayContaining(['whitespace-nowrap', 'overflow-hidden', 'text-ellipsis']));
    // Le filet souligné (4 px sous la ligne) n'est pas rogné : la boîte rognée
    // descend de 2 px sans changer la hauteur de la bande.
    expect(valueLine.split(' ')).toEqual(expect.arrayContaining(['pb-0.5', '-mb-0.5']));
  });
});
