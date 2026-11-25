// Le récap de fin d'exo, rendu en HTML statique (la vraie `Sheet` passe par un
// portail : remplacée ici par son contenu à plat). Demande du 25/11 : après la
// dernière série prévue, on peut passer à l'exo suivant, continuer l'exo, ou
// revenir au Sommaire de la séance.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseRecapSheet } from './ExerciseRecapSheet';

vi.mock('../../ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui')>()),
  Sheet: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => (
    <section aria-label={title}>
      {children}
      <footer>{footer}</footer>
    </section>
  ),
}));

const noop = () => {};

function render(next: string | null) {
  const html = renderToStaticMarkup(
    <ExerciseRecapSheet
      open
      name="Développé couché"
      unilateral={false}
      hasReference={false}
      sets={[]}
      badges={[]}
      completedSets={4}
      setsTarget={{ min: 3, max: 4 }}
      next={next}
      onNext={noop}
      onSommaire={noop}
      onClose={noop}
    />,
  );
  const footer = html.slice(html.indexOf('<footer>'));
  // Libellés des boutons du pied, dans l'ordre (le nom lu quand il y en a un).
  return [...footer.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map((m) => {
    const aria = /aria-label="([^"]*)"/.exec(m[1]!);
    return (aria ? aria[1]! : m[2]!.replace(/<[^>]+>/g, '')).trim();
  });
}

describe('récap de fin d’exo', () => {
  it('propose l’exo suivant, puis continuer l’exo et revenir au Sommaire', () => {
    expect(render('Tirage horizontal')).toEqual(['Exo suivantTirage horizontal', 'Continuer l’exercice', 'Revenir au Sommaire de la séance']);
  });

  it('au dernier exo, le Sommaire devient l’action principale, sans doublon', () => {
    expect(render(null)).toEqual(['Sommaire', 'Continuer l’exercice']);
  });
});
