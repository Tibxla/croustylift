#!/usr/bin/env bash
# Banc d'essai LOCAL des migrations : un Postgres jetable dans Docker, jamais la
# prod, aucune commande supabase. Rejoue 0001 à 0014 sur une base vide, pose un
# jeu d'essai, puis applique chaque migration suivante DEUX fois (rejouabilité),
# son test de contrôle en lecture, et enfin les essais d'écriture refusée.
#
#   supabase/tests/banc/lancer.sh
#
# Le conteneur (512 Mo, sans réseau) est supprimé à la fin, même en cas d'échec
# (BANC_GARDER=1 le laisse en place pour un diagnostic).
set -euo pipefail

cd "$(dirname "$0")/../.."
NOM=croustylift-banc-pg
# Même version majeure que la prod (PostgreSQL 17.6 au 2026-11-23).
IMAGE=${BANC_IMAGE:-postgres:17-alpine}

docker rm -f "$NOM" >/dev/null 2>&1 || true
docker run -d --rm --name "$NOM" --memory 512m --network none \
  -e POSTGRES_PASSWORD=banc "$IMAGE" >/dev/null
trap '[ -n "${BANC_GARDER:-}" ] || docker rm -f "$NOM" >/dev/null 2>&1 || true' EXIT

# Le serveur redémarre une fois pendant son initialisation : on attend le vrai.
until docker exec "$NOM" psql -U postgres -h 127.0.0.1 -c 'select 1' >/dev/null 2>&1; do sleep 0.5; done

sql() { # sql <fichier> [options psql]
  local fichier=$1; shift
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$NOM" psql -U postgres -v ON_ERROR_STOP=1 -q "$@" -f - < "$fichier"
}

echo "== bouchons, migrations 0001 à 0014, jeu d'essai"
sql tests/banc/00_bouchons.sql
for f in migrations/00{01,02,03,04,05,06,07,08,09,10,11,12,13,14}_*.sql; do sql "$f" >/dev/null; done
sql tests/banc/01_jeu_d_essai.sql

# Ordre de DÉPLOIEMENT (supabase/tests/ORDRE.md), pas l'ordre des numéros : les
# migrations qui attendent le nouveau client passent en dernier.
ORDRE="0015 0017 0019a 0019b 0019c 0020 0021 0023 0024 0016 0018 0022"
[ "$(echo $ORDRE | wc -w)" = "$(ls migrations | awk '$0 > "0015"' | wc -l)" ] || { echo "ORDRE ne couvre pas toutes les migrations"; exit 1; }

for n in $ORDRE; do
  f=$(ls migrations/"$n"_*.sql)
  echo "== $(basename "$f") (deux passes)"
  sql "$f" >/dev/null
  sql "$f" >/dev/null
  t=$(ls tests/"$n"_*.sql 2>/dev/null || true)
  [ "$n" = 0019c ] && t=$(ls tests/0019_*.sql)
  if [ -n "$t" ]; then
    echo "-- $(basename "$t")"
    sql "$t" -A -t | tee /dev/stderr | { ! grep -q 'ECHEC'; }
  fi
done

echo "== essais d'écriture refusée"
sql tests/banc/02_refus.sql -A -t | grep -v '^$'
echo "== courses : archivage et activation simultanés du même compte"
sql /dev/stdin <<'SQL'
insert into public.routines (id, owner_id, name) values
  ('b0000000-0000-0000-0000-0000000000a2', 'bbbbbbbb-0000-0000-0000-000000000002', 'Seconde');
SQL
# Session 1 : archive « Seconde » (non courante) et garde sa transaction 3 s.
sql /dev/stdin >/dev/null <<'SQL' &
begin;
update public.routines set archived_at = now() where id = 'b0000000-0000-0000-0000-0000000000a2';
select pg_sleep(3);
commit;
SQL
sleep 1
# Session 2 : l'active pendant ce temps. Sans verrou par compte, elle lirait
# l'état d'avant l'archivage et passerait ; elle doit attendre, puis être refusée.
sortie=$(docker exec -i "$NOM" psql -U postgres -q -v ON_ERROR_STOP=1 -c \
  "insert into public.routine_activations (owner_id, routine_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a2')" 2>&1 || true)
if echo "$sortie" | grep -q "routine archivée ne peut pas être la routine courante"; then
  echo "OK    activation concurrente d'une routine en cours d'archivage : attend, puis refusée"
else
  echo "ECHEC activation concurrente acceptée"; exit 1
fi
wait
# L'inverse : l'activation d'abord (transaction tenue), l'archivage ensuite.
sql /dev/stdin <<'SQL'
update public.routines set archived_at = null where id = 'b0000000-0000-0000-0000-0000000000a2';
SQL
sql /dev/stdin >/dev/null <<'SQL' &
begin;
insert into public.routine_activations (owner_id, routine_id) values ('bbbbbbbb-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000a2');
select pg_sleep(3);
commit;
SQL
sleep 1
sortie=$(docker exec -i "$NOM" psql -U postgres -q -v ON_ERROR_STOP=1 -c \
  "update public.routines set archived_at = now() where id = 'b0000000-0000-0000-0000-0000000000a2'" 2>&1 || true)
if echo "$sortie" | grep -q "La routine courante ne s'archive pas"; then
  echo "OK    archivage concurrent d'une routine en cours d'activation : attend, puis refusé"
else
  echo "ECHEC archivage concurrent accepté"; exit 1
fi
wait
echo "== banc vert"
