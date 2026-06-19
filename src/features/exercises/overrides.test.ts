import { describe, it, expect } from 'vitest';
import { mergeRowWithOverride } from './overrides';
import type { Database } from '../../lib/database.types';
import type { ExerciseOverrideValues } from '../../domain/exercise-override';

type ExerciseRow = Database['public']['Tables']['exercises']['Row'];

// Adaptateur snake_case <-> domaine de la couche overrides (issue #50). La RÈGLE
// pure de fusion (`mergeExerciseOverride`) est testée à part (exercise-override.
// test.ts) ; ici on couvre l'ADAPTATEUR `mergeRowWithOverride` : ses replis sur
// les colonnes nullables de la row DB (`unilateral ?? false`, `primary_muscles ??
// []`) et la réécriture snake_case du résultat fusionné. Test PUR (pas de Supabase).

// Le type généré (`database.types.ts`) déclare `unilateral` et `primary_muscles`
// non-null, mais la couche d'accès se protège quand même d'un null renvoyé par la
// base (row partielle / colonne historiquement nullable). On reflète cette
// nullabilité RÉELLE pour exercer les replis, sans `any` ni `@ts-ignore`.
type ExerciseRowMaybeNull = Omit<ExerciseRow, 'unilateral' | 'primary_muscles'> & {
  unilateral: boolean | null;
  primary_muscles: string[] | null;
};

/** Fabrique une row `exercises` ; les colonnes nullables sont à `null` par défaut. */
function exerciseRow(
  overrides: Partial<ExerciseRowMaybeNull> = {},
): ExerciseRow {
  const row: ExerciseRowMaybeNull = {
    id: 'exo-1',
    name: 'Développé couché',
    muscle_group: 'pectoraux',
    owner_id: null,
    unilateral: null,
    primary_muscles: null,
    created_at: '2026-06-18T10:00:00.000Z',
    updated_at: '2026-06-18T10:00:00.000Z',
    ...overrides,
  };
  // La couche d'accès traite ces lignes comme des `ExerciseRow` (cf. le cast
  // `data as ExerciseRow` dans overrides.ts) : on reproduit ce contrat ici.
  return row as ExerciseRow;
}

describe('mergeRowWithOverride', () => {
  it('aucun override (null) : replis des colonnes nullables (unilateral null -> false, primary_muscles null -> [])', () => {
    const row = exerciseRow({ unilateral: null, primary_muscles: null });
    const merged = mergeRowWithOverride(row, null);
    expect(merged.unilateral).toBe(false);
    expect(merged.primary_muscles).toEqual([]);
    // Le reste de la row est inchangé (l'adaptateur ne touche que les 3 champs partagés).
    expect(merged.name).toBe('Développé couché');
    expect(merged.id).toBe('exo-1');
    expect(merged.muscle_group).toBe('pectoraux');
  });

  it('override partiel sur une row aux colonnes nullables : la forme fusionnée porte l\'override et replie le reste', () => {
    // Row de base avec unilateral/primary_muscles réellement à null, override qui
    // ne renseigne QUE le nom : le nom est surchargé, les colonnes nullables
    // tombent sur leurs replis (false / []), pas sur l'override (absent).
    const row = exerciseRow({
      name: 'Développé couché',
      unilateral: null,
      primary_muscles: null,
    });
    const override: ExerciseOverrideValues = { name: 'DC haltères' };
    const merged = mergeRowWithOverride(row, override);
    expect(merged.name).toBe('DC haltères');
    expect(merged.unilateral).toBe(false);
    expect(merged.primary_muscles).toEqual([]);
  });

  it('override partiel (unilateral seul) : surcharge le drapeau, garde les champs de base repliés', () => {
    const row = exerciseRow({
      name: 'Curl',
      unilateral: null,
      primary_muscles: null,
    });
    const override: ExerciseOverrideValues = { unilateral: true };
    const merged = mergeRowWithOverride(row, override);
    expect(merged.unilateral).toBe(true);
    // name pas dans l'override -> base ; primary_muscles pas dans l'override -> repli [].
    expect(merged.name).toBe('Curl');
    expect(merged.primary_muscles).toEqual([]);
  });

  it('row avec valeurs présentes + override partiel sur les muscles : seuls les muscles changent', () => {
    const row = exerciseRow({
      name: 'Développé couché',
      unilateral: true,
      primary_muscles: ['pectoraux'],
    });
    const override: ExerciseOverrideValues = {
      primaryMuscles: ['pectoraux', 'triceps'],
    };
    const merged = mergeRowWithOverride(row, override);
    expect(merged.primary_muscles).toEqual(['pectoraux', 'triceps']);
    expect(merged.name).toBe('Développé couché');
    expect(merged.unilateral).toBe(true);
  });

  it('ne mute pas la row d\'entrée (renvoie une nouvelle row)', () => {
    const row = exerciseRow({ name: 'Squat', unilateral: null, primary_muscles: null });
    mergeRowWithOverride(row, { name: 'Squat bulgare', unilateral: true });
    // La row source garde ses valeurs nullables d'origine.
    expect(row.name).toBe('Squat');
    expect((row as ExerciseRowMaybeNull).unilateral).toBeNull();
    expect((row as ExerciseRowMaybeNull).primary_muscles).toBeNull();
  });
});
