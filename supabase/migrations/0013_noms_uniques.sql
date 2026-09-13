-- 0013 — noms uniques : séance dans sa routine, routine dans le compte.
--
-- Grilling du 2026-09-13 (CONTEXT.md « Séance », « Routine », ADR 0016) : c'est
-- par son nom qu'on choisit une séance en salle, et l'analyse désigne une séance
-- par « séance · routine ». Deux « Push » dans une même routine, ou deux routines
-- « PPL », rendaient ce libellé ambigu.
--
-- Même normalisation que `nameKey` côté client (src/domain/unique-name.ts) :
-- toute suite d'espaces ramenée à un seul, espaces de bord retirés, casse
-- ignorée. Les accents comptent (« Épaules » ≠ « Epaules »).
--
-- Index uniques FONCTIONNELS (une contrainte UNIQUE n'accepte pas d'expression).
-- Posables sans reprise : aucun doublon en base au 2026-09-13. Le client traduit
-- la violation (23505) en message lisible sous le champ.

create unique index seances_routine_name_unique
  on public.seances (routine_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));

create unique index routines_owner_name_unique
  on public.routines (owner_id, lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));
