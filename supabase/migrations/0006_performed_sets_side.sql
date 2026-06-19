-- Logging unilatéral gauche/droite (issue #46) : une série d'un exo unilatéral
-- est saisie côté gauche PUIS côté droite, avec ses propres poids/reps/RIR. Elle
-- se matérialise en DEUX lignes performed_sets portant le MÊME `set_order` et un
-- `side` distinct ('left'/'right'). Un exo bilatéral reste UNE ligne, `side` null.
--
-- ADDITIF, NON destructif et IDEMPOTENT (rejouable) :
--   - `side` est nullable -> null = bilatéral (rétrocompatible : toutes les
--     lignes existantes restent valides sans réécriture) ;
--   - le check tolère null OU 'left'/'right', rien d'autre.
--
-- NOTE : cette colonne est DÉJÀ appliquée en prod ; ce fichier l'aligne au repo.

alter table public.performed_sets
  add column if not exists side text;

alter table public.performed_sets
  drop constraint if exists performed_sets_side_check;

alter table public.performed_sets
  add constraint performed_sets_side_check
    check (side is null or side in ('left', 'right'));
