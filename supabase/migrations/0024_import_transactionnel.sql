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
--   - Routines : c'est l'état FINAL du fichier qui est jugé, pas chaque
--     écriture en chemin. Les archivages NOUVEAUX (routine active en base,
--     archivée dans le fichier) sont différés : les routines sont écrites sans
--     eux, puis leurs activations, puis seulement les archivages. Écrits au fil
--     des tables, ils refusaient une sauvegarde valide : fichier « A archivée,
--     B courante », base où A est redevenue courante depuis (B supprimée) ;
--     archiver A avant d'avoir rendu l'activation de B heurtait la règle de la
--     migration 0021 (la routine courante ne s'archive pas). Un désarchivage,
--     lui, s'applique tout de suite : il ne peut que rendre une activation
--     permise. Un fichier dont l'état final laisse pour courante une routine
--     archivée reste refusé en entier, une fois 0021 appliquée.
--   - Verrou du compte : celui de la migration 0021, pris d'emblée et sous la
--     même clé, pour qu'un archivage ou une activation venu d'un autre appareil
--     passe avant ou après l'import, jamais au milieu. Il est écrit ici en
--     toutes lettres : la fonction marche que 0021 soit appliquée ou non.
--
-- Pendant l'import, le trigger `log_seance_archive` se tait : l'état
-- `archived_at` et le journal viennent tous deux du fichier. Sans cela,
-- restaurer une sauvegarde dont l'état d'archivage différait de la base ajoutait
-- toujours un événement daté de la restauration, même quand le journal du
-- fichier racontait déjà cet état. Le signal est un paramètre local à la
-- transaction, que seule cette fonction pose : l'API ne permet pas à un client
-- de le poser lui-même.
--
-- Le journal ne se réécrit pas : les événements déjà en base restent, ceux du
-- fichier s'y ajoutent. Si la base a connu un archivage ou un désarchivage
-- APRÈS la sauvegarde, le dernier événement du journal fusionné contredit
-- l'état restauré, et l'Analyse (qui rejoue le journal) compterait une séance
-- que le plan masque, ou l'inverse. En fin d'import, chaque séance du fichier
-- est donc RAPPROCHÉE : si son dernier événement ne dit pas son état
-- `archived_at`, un événement correctif est ajouté. Sans divergence, rien n'est
-- écrit, et réimporter n'ajoute donc rien.
--   - « Dernier » s'entend comme dans l'Analyse : par `occurred_at`, puis par
--     `id` à égalité (elle lit le journal trié par id et le retrie par date).
--   - Le correctif est daté APRÈS verrouillage des séances, à l'horloge réelle
--     (`clock_timestamp()`, pas l'heure de début de la transaction), et toujours
--     strictement après l'événement qu'il corrige : un archivage validé par un
--     autre appareil pendant l'import ne peut pas se retrouver « après » lui.
--   - Un événement du fichier daté dans le futur est ramené à l'instant de
--     l'import : la base date elle-même ses événements, une date future ne
--     peut venir que d'un fichier retouché, et elle primerait indéfiniment.
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
-- ORDRE (voir supabase/tests/ORDRE.md) : cette migration passe AVANT le
-- déploiement du client qui appelle la fonction, et la migration 0022 (journal
-- en insertion seule) APRÈS ce déploiement et le passage des anciens clients.
-- La fonction marche dans les deux états de la policy du journal : elle n'y
-- fait que des insertions. Elle marche aussi avant et après la migration 0021
-- (routine courante jamais archivée), qui passe elle aussi après le client.
--
-- RISQUE : faible pour la base (une fonction ajoutée, un trigger qui gagne une
-- sortie anticipée).
-- Limite d'usage : tout l'import tient dans une requête, donc sous le délai
-- d'instruction du rôle `authenticated` (8 s par défaut chez Supabase, à confirmer) ; un
-- historique de plusieurs dizaines de milliers de séries reste loin en dessous.

begin;

-- Attente bornée : un verrou pris ailleurs fait échouer la migration (à
-- relancer) au lieu de geler l'app derrière elle.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  v_owner uuid;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'import_user_data : un objet JSON est attendu (une clé par table).'
      using errcode = '22023';
  end if;

  perform set_config('croustylift.import', 'on', true);

  -- Verrou du compte (même clé que `lock_current_routine`, migration 0021) :
  -- celui de l'appelant, et ceux que portent les routines et les activations du
  -- fichier (sous `service_role`, il n'y a pas d'appelant). Ordre fixe.
  for v_owner in
    select distinct s.owner_id from (
      select (select auth.uid()) as owner_id
      union all
      select (l.ligne ->> 'owner_id')::uuid
      from jsonb_array_elements(
        case when jsonb_typeof(p_data -> 'routines') = 'array' then p_data -> 'routines' else '[]'::jsonb end
        || case when jsonb_typeof(p_data -> 'routine_activations') = 'array'
             then p_data -> 'routine_activations' else '[]'::jsonb end
      ) as l(ligne)
      where jsonb_typeof(l.ligne) = 'object'
    ) s
    where s.owner_id is not null
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('croustylift.routine_courante:' || v_owner::text, 0)
    );
  end loop;

  foreach v_table in array v_tables loop
    -- Routines et activations du fichier sont écrites (`seances` vient juste
    -- après elles) : les archivages différés s'appliquent maintenant, sur un
    -- compte dont la routine courante est déjà celle du fichier. Placé AVANT
    -- les sorties anticipées ci-dessous : il passe même si le fichier ne porte
    -- ni activation ni séance.
    if v_table = 'seances' and jsonb_typeof(p_data -> 'routines') = 'array' then
      update public.routines r
        set archived_at = f.archived_at
        from jsonb_populate_recordset(null::public.routines, p_data -> 'routines') f
        where r.id = f.id
          and f.archived_at is not null
          and r.archived_at is null;
    end if;

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
      string_agg(
        case
          -- Archivage nouveau d'une routine : différé (cf. en-tête). Une routine
          -- active en base le reste ici ; une routine archivée prend la valeur
          -- du fichier (autre date, ou désarchivage).
          when v_table = 'routines' and a.attname = 'archived_at'
            then 'archived_at = case when cible.archived_at is null then null else excluded.archived_at end'
          else format('%1$I = excluded.%1$I', a.attname)
        end,
        ', ' order by a.attnum
      ) filter (where a.attname <> 'id'),
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

    -- Journal : aucun événement daté dans le futur.
    if v_table = 'seance_archive_events' then
      select jsonb_agg(
        case
          when jsonb_typeof(l.ligne) = 'object'
               and (l.ligne ->> 'occurred_at')::timestamptz > clock_timestamp()
            then jsonb_set(l.ligne, '{occurred_at}', to_jsonb(clock_timestamp()))
          else l.ligne
        end
      ) into v_rows
      from jsonb_array_elements(v_rows) as l(ligne);
    end if;

    if v_table = 'dated_notes' then
      delete from public.dated_notes d
        using jsonb_populate_recordset(null::public.dated_notes, v_rows) f
        where d.execution_id = f.execution_id
          and d.exercise_id = f.exercise_id
          and d.id <> f.id;
    end if;

    execute format(
      'insert into public.%1$I as cible (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do %3$s',
      v_table,
      v_cols,
      case
        when v_table = 'seance_archive_events' or v_set is null then 'nothing'
        else 'update set ' || v_set
      end
    ) using v_rows;
  end loop;

  -- Rapprochement du journal et de l'état : un événement correctif par séance
  -- du fichier dont le dernier événement contredit `archived_at`.
  if jsonb_typeof(p_data -> 'seances') = 'array' then
    -- Les séances du fichier sont verrouillées : aucun archivage concurrent ne
    -- peut plus s'intercaler entre la lecture du journal et le correctif.
    perform 1 from public.seances s
      where s.id in (
        select (l.ligne ->> 'id')::uuid
        from jsonb_array_elements(p_data -> 'seances') as l(ligne)
      )
      order by s.id
      for update;

    insert into public.seance_archive_events (owner_id, seance_id, archived, occurred_at)
    select s.owner_id, s.id, s.archived_at is not null,
           greatest(clock_timestamp(), dernier.occurred_at + interval '1 microsecond')
    from public.seances s
    left join lateral (
      select e.archived, e.occurred_at from public.seance_archive_events e
      where e.seance_id = s.id
      order by e.occurred_at desc, e.id desc
      limit 1
    ) dernier on true
    where s.id in (
        select (l.ligne ->> 'id')::uuid
        from jsonb_array_elements(p_data -> 'seances') as l(ligne)
      )
      and (s.archived_at is not null) is distinct from coalesce(dernier.archived, false);
  end if;

  perform set_config('croustylift.import', '', true);
end;
$$;

revoke execute on function public.import_user_data(jsonb) from public, anon;
grant execute on function public.import_user_data(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
