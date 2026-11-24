// Tests du ⋯ des séances et des routines : qui voit quelle action, et quand un
// geste demande confirmation.
import { describe, expect, it } from 'vitest';
import { menuLabel, routineMenu, seanceMenu } from './object-actions';

const keys = (items: { key: string }[]) => items.map((i) => i.key);
const confirmOf = (items: { key: string; confirm: string }[], key: string) => items.find((i) => i.key === key)?.confirm;

describe('seanceMenu', () => {
  it('jamais faite : renommer, dupliquer, supprimer (confirmé, perte en lien)', () => {
    const items = seanceMenu({ executed: false, inCurrentRoutine: false, hasExercises: true });
    expect(keys(items)).toEqual(['rename', 'duplicate', 'delete']);
    expect(confirmOf(items, 'delete')).toBe('destructive');
  });

  it('supprimer reste confirmé dans la routine courante', () => {
    const items = seanceMenu({ executed: false, inCurrentRoutine: true, hasExercises: true });
    expect(confirmOf(items, 'delete')).toBe('destructive');
  });

  it('déjà faite, hors routine courante : archiver part sans confirmation', () => {
    const items = seanceMenu({ executed: true, inCurrentRoutine: false, hasExercises: true });
    expect(keys(items)).toEqual(['rename', 'duplicate', 'archive']);
    expect(confirmOf(items, 'archive')).toBe('none');
  });

  it('déjà faite, dans la routine courante : archiver est confirmé (un bloc commence)', () => {
    const items = seanceMenu({ executed: true, inCurrentRoutine: true, hasExercises: true });
    expect(confirmOf(items, 'archive')).toBe('plain');
  });

  it('depuis l’éditeur avec une saisie non enregistrée : archiver l’abandonne, confirmé en perte', () => {
    expect(confirmOf(seanceMenu({ executed: true, inCurrentRoutine: false, hasExercises: true, unsavedEdits: true }), 'archive')).toBe(
      'destructive',
    );
    expect(confirmOf(seanceMenu({ executed: true, inCurrentRoutine: true, hasExercises: true, unsavedEdits: true }), 'archive')).toBe(
      'destructive',
    );
  });

  it('sans exo enregistré : rien à copier, pas de Dupliquer', () => {
    expect(keys(seanceMenu({ executed: false, inCurrentRoutine: false, hasExercises: false }))).toEqual(['rename', 'delete']);
  });

  it('renommer et dupliquer ne demandent jamais de confirmation', () => {
    const items = seanceMenu({ executed: true, inCurrentRoutine: true, hasExercises: true, unsavedEdits: true });
    expect(confirmOf(items, 'rename')).toBe('none');
    expect(confirmOf(items, 'duplicate')).toBe('none');
  });
});

describe('routineMenu', () => {
  it('autre routine déjà faite : renommer, définir courante et archiver, tous deux confirmés', () => {
    const menu = routineMenu({ executed: true, isCurrent: false, archived: false });
    expect(keys(menu.items)).toEqual(['rename', 'set-current', 'archive']);
    expect(confirmOf(menu.items, 'set-current')).toBe('plain');
    expect(confirmOf(menu.items, 'archive')).toBe('plain');
    expect(menu.currentNote).toBe(false);
  });

  it('autre routine jamais faite : supprimer, confirmé en perte', () => {
    const menu = routineMenu({ executed: false, isCurrent: false, archived: false });
    expect(keys(menu.items)).toEqual(['rename', 'set-current', 'delete']);
    expect(confirmOf(menu.items, 'delete')).toBe('destructive');
  });

  it('routine courante : renommer seulement, et la note qui dit pourquoi', () => {
    for (const executed of [true, false]) {
      const menu = routineMenu({ executed, isCurrent: true, archived: false });
      expect(keys(menu.items)).toEqual(['rename']);
      expect(menu.currentNote).toBe(true);
    }
  });

  it('routine archivée : aucune action dans le ⋯ (Désarchiver est sur la ligne)', () => {
    expect(routineMenu({ executed: true, isCurrent: false, archived: true })).toEqual({ items: [], currentNote: false });
  });
});

describe('menuLabel', () => {
  it('nomme les actions puis l’objet', () => {
    expect(menuLabel(['rename', 'duplicate', 'archive'], 'Upper A')).toBe('Renommer, dupliquer ou archiver Upper A');
    expect(menuLabel(['rename'], 'Test')).toBe('Renommer Test');
    expect(menuLabel(['rename', 'set-current', 'delete'], 'PPL')).toBe('Renommer, définir comme courante ou supprimer PPL');
  });
});
