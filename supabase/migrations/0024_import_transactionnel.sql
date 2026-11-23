-- 0024 : restauration d'une sauvegarde en une seule transaction (audit du 2026-11-22, X20).
--
-- L'import upsertait les douze tables l'une après l'autre, une requête par
-- table : un échec en cours de route laissait les tables précédentes écrites,
-- soit un compte à moitié restauré.
--
-- `import_user_data(p_data)` reçoit le champ `data` de la sauvegarde (une clé
-- par table, lignes brutes, cf. docs/export-format.md) et écrit tout dans la
-- transaction de l'appel : tout passe, ou rien n'est écrit.
--
--   - SECURITY INVOKER : la RLS de l'appelant s'applique à chaque ligne, comme
--     pour l'ancien upsert. Une ligne d'un autre compte fait échouer l'import.
--   - Les tables et leur ordre (parents avant enfants) sont FIGÉS dans la
--     fonction : aucun nom de table ne vient du fichier.
--   - Les colonnes écrites sont celles de la table que le fichier porte : une
--     colonne absente du fichier (sauvegarde plus ancienne que la colonne) garde
--     sa valeur par défaut, une clé inconnue de la table est ignorée.
--   - `on conflict (id) do update` : réimporter le même fichier ne crée aucun
--     doublon (ADR 0003). Le journal des archivages fait exception, en
--     `do nothing` : il ne se réécrit pas (migration 0022).
--   - Notes datées : une note de la base qui occupe, sous un autre id, le
--     couple (exécution, exercice) d'une note du fichier est retirée avant
--     l'écriture. Le fichier gagne, comme pour toute ligne restaurée ; sans
--     cela l'unicité de la migration 0018 refuserait tout l'import.
--
-- Pendant l'import, le trigger `log_seance_archive` se tait : l'état
-- `archived_at` et le journal viennent tous deux du fichier. Sans cela,
-- restaurer une sauvegarde dont l'état d'archivage différait de la base ajoutait
-- un événement daté de la restauration, donc une coupure de bloc de trop. Le
-- signal est un paramètre local à la transaction, que seule cette fonction
-- pose : l'API ne permet pas à un client de le poser lui-même.
--
-- Appel côté client : `supabase.rpc('import_user_data', { p_data })`.
--
-- Rejouable (`create or replace`). Aucune donnée touchée, rien à contrôler dans
-- les lignes.
--
-- CONTRÔLE PRÉALABLE (lecture seule). Attendu : `log_seance_archive` présente
-- (elle est redéfinie ici), `import_user_data` absente.
--
--   select p.oid::regprocedure, p.prosecdef, p.proconfig from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('log_seance_archive', 'import_user_data');
--
-- RISQUE : faible pour la base (une fonction ajoutée, un trigger qui gagne une
-- sortie anticipée). À appliquer AVANT de déployer le client qui l'appelle.
-- Limite d'usage : tout l'import tient dans une requête, donc sous le délai
-- d'instruction du rôle `authenticated` (8 s par défaut chez Supabase, à confirmer) ; un
-- historique de plusieurs dizaines de milliers de séries reste loin en dessous.

begin;

-- 1. Le trigger d'archivage se tait pendant un import ------------------------

create or replace function public.log_seance_archive()
returns trigger
language plpgsql
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
begin
  -- Import d'une sauvegarde (`import_user_data`) : l'état et le journal viennent
  -- du fichier, tels quels.
  if coalesce(current_setting('croustylift.import', true), '') = 'on' then
    return new;
  end if;

  if (new.archived_at is null) = (old.archived_at is null) then
    new.archived_at = old.archived_at;
    return new;
  end if;

  if new.archived_at is not null then
    new.archived_at = now();
  end if;

  insert into public.seance_archive_events (owner_id, seance_id, archived, occurred_at)
  values (new.owner_id, new.id, new.archived_at is not null, now());

  return new;
end;
$$;

-- 2. L'import ------------------------------------------------------------------

create or replace function public.import_user_data(p_data jsonb)
returns void
language plpgsql
security invoker
set search_path = ''  -- durcit le search_path (advisor function_search_path_mutable)
as $$
declare
  -- Parents avant enfants : même ordre que EXPORT_TABLES côté client.
  v_tables constant text[] := array[
    'exercises', 'exercise_notes', 'exercise_overrides', 'routines',
    'routine_activations', 'seances', 'seance_archive_events', 'seance_versions',
    'prescriptions', 'executions', 'performed_sets', 'dated_notes'
  ];
  v_table text;
  v_rows jsonb;
  v_cols text;
  v_set text;
  v_has_id boolean;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'import_user_data : un objet JSON est attendu (une clé par table).'
      using errcode = '22023';
  end if;

  perform set_config('croustylift.import', 'on', true);

  foreach v_table in array v_tables loop
    v_rows := p_data -> v_table;
    if v_rows is null or jsonb_typeof(v_rows) = 'null' then
      continue;
    end if;
    if jsonb_typeof(v_rows) <> 'array' then
      raise exception 'import_user_data : la table % doit être un tableau.', v_table
        using errcode = '22023';
    end if;
    if jsonb_array_length(v_rows) = 0 then
      continue;
    end if;

    -- Colonnes de la table que porte au moins une ligne du fichier.
    select
      string_agg(format('%I', a.attname), ', ' order by a.attnum),
      string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
        filter (where a.attname <> 'id'),
      coalesce(bool_or(a.attname = 'id'), false)
    into v_cols, v_set, v_has_id
    from pg_catalog.pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attname in (
        select jsonb_object_keys(ligne)
        from jsonb_array_elements(v_rows) as l(ligne)
        where jsonb_typeof(ligne) = 'object'
      );

    if not v_has_id then
      raise exception 'import_user_data : les lignes de % ne portent pas d''id.', v_table
        using errcode = '22023';
    end if;

    if v_table = 'dated_notes' then
      delete from public.dated_notes d
        using jsonb_populate_recordset(null::public.dated_notes, v_rows) f
        where d.execution_id = f.execution_id
          and d.exercise_id = f.exercise_id
          and d.id <> f.id;
    end if;

    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do %3$s',
      v_table,
      v_cols,
      case
        when v_table = 'seance_archive_events' or v_set is null then 'nothing'
        else 'update set ' || v_set
      end
    ) using v_rows;
  end loop;

  perform set_config('croustylift.import', '', true);
end;
$$;

revoke execute on function public.import_user_data(jsonb) from public, anon;
grant execute on function public.import_user_data(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
