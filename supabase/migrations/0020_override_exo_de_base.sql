-- 0020 : un override ne vise qu'un exo de base (audit du 2026-11-22, X12).
--
-- ADR 0007 : l'override personnalise un exo de BASE pour un utilisateur. Un exo
-- perso se modifie directement. La table acceptait pourtant n'importe quel
-- `exercise_id`, y compris un exo perso, le sien ou celui d'un autre compte.
--
-- Un `check` ne peut pas lire une autre table : c'est un trigger, qui refuse en
-- 23514 (classe 23, ADR 0018). Un exo de base ne change jamais de propriétaire
-- (`exercises_update` exige `owner_id = auth.uid()`), la règle ne peut donc pas
-- être contournée après coup.
--
-- Rejouable. Aucune donnée modifiée : un override existant sur un exo perso
-- fait échouer la migration entière.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : aucune ligne.
--
--   select o.id, o.user_id, o.exercise_id, x.owner_id as proprietaire_exo,
--          x.name as nom_exo, o.name, o.unilateral, o.primary_muscles
--   from exercise_overrides o join exercises x on x.id = o.exercise_id
--   where x.owner_id is not null;
--
-- SI DES LIGNES SORTENT : sur son propre exo perso (`proprietaire_exo = user_id`),
-- reporter à la main dans l'exo les champs non nuls de l'override (`update
-- exercises set name = ..., unilateral = ..., primary_muscles = ... where id = ...`),
-- puis supprimer l'override. Sur l'exo d'un autre compte : le supprimer, il
-- n'a jamais eu d'effet (l'exo n'est pas lisible par ce compte). Appliquer ensuite.
--
-- RISQUE : faible. Le client n'écrit un override que depuis la fiche d'un exo
-- de base.

begin;

do $$
declare
  v_hors_base int;
begin
  select count(*) into v_hors_base
  from public.exercise_overrides o join public.exercises x on x.id = o.exercise_id
  where x.owner_id is not null;
  if v_hors_base > 0 then
    raise exception
      '0020 : % override(s) visent un exo qui n''est pas de base. Voir le contrôle préalable en tête de fichier.',
      v_hors_base;
  end if;
end;
$$;

create or replace function public.check_override_base_exercise()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  if not exists (
    select 1 from public.exercises x
    where x.id = new.exercise_id and x.owner_id is null
  ) then
    raise exception 'Un override ne vise qu''un exo de base (exercice %).', new.exercise_id
      using errcode = '23514', table = tg_table_name, column = 'exercise_id';
  end if;
  return new;
end;
$$;

drop trigger if exists check_override_base_exercise on public.exercise_overrides;
create trigger check_override_base_exercise before insert or update of exercise_id on public.exercise_overrides
  for each row execute function public.check_override_base_exercise();

commit;
