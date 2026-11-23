#!/usr/bin/env bash
# Banc d'essai LOCAL des migrations : un Postgres jetable dans Docker, jamais la
# prod, aucune commande supabase. Rejoue 0001 à 0014 sur une base vide, pose un
# jeu d'essai, puis applique chaque migration suivante DEUX fois (rejouabilité),
# son test de contrôle en lecture, et enfin les essais d'écriture refusée.
#
#   supabase/tests/banc/lancer.sh
#
# Le conteneur (512 Mo, sans réseau) est supprimé à la fin, même en cas d'échec.
set -euo pipefail

cd "$(dirname "$0")/../.."
NOM=croustylift-banc-pg
# Même version majeure que la prod (PostgreSQL 17.6 au 2026-11-23).
IMAGE=${BANC_IMAGE:-postgres:17-alpine}

docker rm -f "$NOM" >/dev/null 2>&1 || true
docker run -d --rm --name "$NOM" --memory 512m --network none \
  -e POSTGRES_PASSWORD=banc "$IMAGE" >/dev/null
trap 'docker rm -f "$NOM" >/dev/null 2>&1 || true' EXIT

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

for f in migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  [ "$n" -le 0014 ] && continue
  echo "== $(basename "$f") (deux passes)"
  sql "$f" >/dev/null
  sql "$f" >/dev/null
  t=$(ls tests/"$n"_*.sql 2>/dev/null || true)
  if [ -n "$t" ]; then
    echo "-- $(basename "$t")"
    sql "$t" -A -t | tee /dev/stderr | { ! grep -q 'ECHEC'; }
  fi
done

echo "== essais d'écriture refusée"
sql tests/banc/02_refus.sql -A -t | grep -v '^$'
echo "== banc vert"
