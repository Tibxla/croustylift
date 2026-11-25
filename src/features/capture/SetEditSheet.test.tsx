// La feuille de correction d'une série, rendue en HTML statique (la vraie
// `Sheet` passe par un portail : remplacée ici par son contenu à plat). On y lit
// le choix « Gauche · Droite » : présent seulement en unilatéral, quand l'autre
// côté du même rang est libre ; le côté de la ligne coché.
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PerformedSet } from '../../domain/types';
import type { SessionExercise } from './fixtures';
import { SetEditSheet } from './SetEditSheet';
import type { ExerciseProgress } from './state';

vi.mock('../../ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui')>()),
  Sheet: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => (
    <section aria-label={title}>
      {children}
      {footer}
    </section>
  ),
}));

const set = (order: number, side?: 'left' | 'right', reps = 10): PerformedSet => ({
  order,
  weightKg: 12,
  reps,
  rir: 2,
  ...(side ? { side } : {}),
});

function exercise(unilateral: boolean, reference: PerformedSet[] | null = null): SessionExercise {
  return {
    exerciseId: 'curl',
    name: 'Curl',
    unilateral,
    prescription: { sets: { min: 3, max: 3 }, reps: { min: 8, max: 12 }, rir: { min: 1, max: 2 } },
    reference,
  } as SessionExercise;
}

function render(ex: SessionExercise, sets: PerformedSet[], setId: string): string {
  const progress: ExerciseProgress = { sets, setIds: sets.map((_, i) => `id${i}`), skipped: false };
  return renderToStaticMarkup(
    <SetEditSheet
      exercise={ex}
      progress={progress}
      setId={setId}
      onSave={() => {}}
      onChangeSide={() => {}}
      onDelete={() => {}}
      onClose={() => {}}
    />,
  );
}

/** Le groupe « Côté de la série » et l'option cochée, ou null s'il n'est pas rendu. */
function sideChoice(html: string): { checked: string[] } | null {
  const at = html.indexOf('aria-label="Côté de la série"');
  if (at === -1) return null;
  const group = html.slice(at, html.indexOf('</div>', at));
  const checked = [...group.matchAll(/aria-checked="true"[^>]*>([^<]+)</g)].map((m) => m[1]!);
  return { checked };
}

describe('SetEditSheet · choix Gauche · Droite', () => {
  it('exo bilatéral : aucun choix de côté', () => {
    expect(sideChoice(render(exercise(false), [set(1), set(2)], 'id1'))).toBeNull();
  });

  it('unilatéral, l’autre côté du rang libre : le choix est là, le côté de la ligne coché', () => {
    // Série 1 complète, série 2 saisie à gauche seulement : on corrige la gauche 2.
    const html = render(exercise(true), [set(1, 'left'), set(1, 'right'), set(2, 'left')], 'id2');
    expect(sideChoice(html)).toEqual({ checked: ['Gauche'] });
    expect(html).toContain('aria-label="Série 2, gauche · Curl"');
  });

  it('unilatéral, une droite seule : Droite cochée', () => {
    const html = render(exercise(true), [set(1, 'right')], 'id0');
    expect(sideChoice(html)).toEqual({ checked: ['Droite'] });
  });

  it('unilatéral, l’autre côté du rang déjà pris : rien, pas même grisé', () => {
    const sets = [set(1, 'left'), set(1, 'right'), set(2, 'left')];
    expect(sideChoice(render(exercise(true), sets, 'id0'))).toBeNull();
    expect(sideChoice(render(exercise(true), sets, 'id1'))).toBeNull();
    expect(render(exercise(true), sets, 'id0')).not.toContain('Droite<');
  });

  it('avec le choix, la Référence du côté de la ligne reste lue sur la même ligne', () => {
    const ref = [set(1, 'left', 9), set(1, 'right', 8), set(2, 'left', 11), set(2, 'right', 7)];
    const html = render(exercise(true, ref), [set(1, 'left'), set(1, 'right'), set(2, 'left')], 'id2');
    expect(html).toContain('réf. série 2');
    expect(html).toContain('12 × 11 · RIR 2');
  });
});
