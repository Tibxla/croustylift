-- Contrôle de la migration 0020 (lecture seule).
select case when ok then 'OK' else 'ECHEC' end as verdict, quoi, empeche from (
  select 'trigger check_override_base_exercise' as quoi,
         exists (select 1 from pg_trigger where tgrelid = 'public.exercise_overrides'::regclass
                   and tgname = 'check_override_base_exercise' and tgenabled = 'O' and not tgisinternal) as ok,
         'override posé sur un exo perso, le sien ou celui d''un autre (23514)' as empeche
  union all
  select 'aucun override hors exo de base',
         not exists (select 1 from exercise_overrides o join exercises x on x.id = o.exercise_id where x.owner_id is not null),
         'override sans effet, ou lien vers l''exo d''un autre compte'
) t order by 1 desc, 2;
