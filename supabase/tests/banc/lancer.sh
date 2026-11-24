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
ORDRE="0015 0017 0019a 0019b 0019c 0020 0023 0024 0025 0026 0016 0018 0021 0022"
[ "$(echo $ORDRE | wc -w)" = "$(ls migrations | awk '$0 > "0015"' | wc -l)" ] || { echo "ORDRE ne couvre pas toutes les migrations"; exit 1; }

for n in $ORDRE; do
  f=$(ls migrations/"$n"_*.sql)
  if [ "$n" = 0021 ]; then
    # L'import est ouvert au client AVANT 0021 : il doit tenir seul la règle.
    echo "== import avant 0021 : la routine courante reste active sans les triggers"
    sql tests/banc/03_import_avant_0021.sql -A -t | grep -v '^$'
  fi
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

echo "== courses : import croisé avec un archivage, puis avec une suppression (ordre des verrous)"
# Sous le rôle de l'API cette fois : le verrou du compte se prend d'après
# auth.uid(), AVANT tout verrou de ligne (triggers d'instruction de 0021).
B=bbbbbbbb-0000-0000-0000-000000000002
api() { # api <instruction SQL> : une instruction, comme une requête de l'API pour le compte B
  docker exec -i "$NOM" psql -U postgres -q -v ON_ERROR_STOP=1 \
    -c "set role authenticated" -c "set request.jwt.claim.sub = '$B'" -c "$1" 2>&1 || true
}
sql /dev/stdin <<'SQL'
insert into public.routines (id, owner_id, name) values
  ('b0000000-0000-0000-0000-0000000000a3', 'bbbbbbbb-0000-0000-0000-000000000002', 'Troisième'),
  ('b0000000-0000-0000-0000-0000000000a4', 'bbbbbbbb-0000-0000-0000-000000000002', 'Quatrième');
SQL
# Session 1 : un import qui a déjà pris le verrou du compte (tenu 2 s d'avance,
# comme un import occupé sur ses premières tables) et qui écrit ensuite la
# routine. Session 2, entre les deux : archive (ou supprime) cette routine.
# Verrou de ligne pris avant celui du compte, la session 2 tenait la ligne que
# l'import attendait et attendait le verrou que l'import tenait : 40P01.
course_import() { # course_import <id de la routine> <nom> <instruction de la session 2>
  # Le journal de la session 1 reste dans le conteneur, supprimé avec lui.
  docker exec -i "$NOM" sh -c 'psql -U postgres -q -v ON_ERROR_STOP=1 -f - >/tmp/course.log 2>&1' <<SQL &
set role authenticated;
set request.jwt.claim.sub = '$B';
begin;
select public.lock_current_routine('$B');
select pg_sleep(2);
select public.import_user_data('{"routines": [{"id": "$1", "name": "$2 importée"}]}'::jsonb);
commit;
SQL
  sleep 1
  sortie=$(api "$3")
  wait
  sortie="$sortie $(docker exec "$NOM" cat /tmp/course.log)"
}
course_import b0000000-0000-0000-0000-0000000000a3 Troisième \
  "update public.routines set archived_at = now() where id = 'b0000000-0000-0000-0000-0000000000a3'"
etat=$(docker exec -i "$NOM" psql -U postgres -A -t -c \
  "select name || '/' || (archived_at is not null) from public.routines where id = 'b0000000-0000-0000-0000-0000000000a3'")
if echo "$sortie" | grep -qi "deadlock\|ERROR" || [ "$etat" != "Troisième importée/true" ]; then
  echo "ECHEC import croisé avec un archivage : $sortie (état : $etat)"; exit 1
fi
echo "OK    import croisé avec un archivage : l'archivage attend l'import, les deux passent"
course_import b0000000-0000-0000-0000-0000000000a4 Quatrième \
  "delete from public.routines where id = 'b0000000-0000-0000-0000-0000000000a4'"
etat=$(docker exec -i "$NOM" psql -U postgres -A -t -c \
  "select count(*) from public.routines where id = 'b0000000-0000-0000-0000-0000000000a4'")
if echo "$sortie" | grep -qi "deadlock\|ERROR" || [ "$etat" != "0" ]; then
  echo "ECHEC import croisé avec une suppression : $sortie (état : $etat)"; exit 1
fi
echo "OK    import croisé avec une suppression : la suppression attend l'import, les deux passent"

echo "== suppression conditionnelle d'une exécution (0025)"
# Sous le rôle de l'API, compte B. Quatre exécutions : vide, avec une série,
# avec une note, close ; plus celle du compte A (invisible de B).
V=b0000000-0000-0000-0000-000000000051
S=b0000000-0000-0000-0000-000000000052
N=b0000000-0000-0000-0000-000000000053
C=b0000000-0000-0000-0000-000000000054
sql /dev/stdin <<SQL
insert into public.executions (id, owner_id, seance_version_id, performed_on, closed_at) values
  ('$V', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-10', null),
  ('$S', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-11', null),
  ('$N', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-12', null),
  ('$C', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-13', now());
insert into public.performed_sets (id, owner_id, execution_id, exercise_id, set_order, weight_kg, reps, rir) values
  ('b0000000-0000-0000-0000-000000000061', '$B', '$S', 'b0000000-0000-0000-0000-0000000000e1', 1, 20, 10, 1);
insert into public.dated_notes (id, owner_id, execution_id, exercise_id, body) values
  ('b0000000-0000-0000-0000-000000000071', '$B', '$N', 'b0000000-0000-0000-0000-0000000000e1', 'note du banc');
SQL
rend() { # rend <id d'exécution> : ce que la fonction répond au compte B
  docker exec -i "$NOM" psql -U postgres -q -A -t -v ON_ERROR_STOP=1 \
    -c "set role authenticated" -c "set request.jwt.claim.sub = '$B'" \
    -c "select public.delete_execution_if_empty('$1')" 2>&1 | tail -1
}
reste() { docker exec -i "$NOM" psql -U postgres -A -t -c "select count(*) from public.executions where id = '$1'"; }
attendu() { # attendu <libellé> <id> <réponse attendue> <lignes restantes attendues>
  local r; r=$(rend "$2")
  if [ "$r" = "$3" ] && [ "$(reste "$2")" = "$4" ]; then echo "OK    $1 : $r"
  else echo "ECHEC $1 : rendu « $r », reste $(reste "$2")"; exit 1; fi
}
attendu "exécution ouverte et vide" "$V" deleted 0
attendu "la même, rejouée" "$V" absent 0
attendu "exécution avec une série" "$S" kept 1
attendu "exécution avec une note datée" "$N" kept 1
attendu "exécution close et vide" "$C" kept 1
attendu "exécution d'un autre compte" a0000000-0000-0000-0000-000000000011 absent 1
anon=$(docker exec -i "$NOM" psql -U postgres -q -A -t -c "set role anon" \
  -c "select public.delete_execution_if_empty('$C')" 2>&1 || true)
if echo "$anon" | grep -q "permission denied"; then echo "OK    appel sans compte : refusé"
else echo "ECHEC appel sans compte accepté : $anon"; exit 1; fi

# Course 1 : une série s'insère (transaction tenue 3 s) pendant que la
# suppression conditionnelle arrive. Elle doit attendre, VOIR la série, garder.
sql /dev/stdin <<SQL
insert into public.executions (id, owner_id, seance_version_id, performed_on) values
  ('$V', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-10');
SQL
sql /dev/stdin >/dev/null <<SQL &
begin;
insert into public.performed_sets (id, owner_id, execution_id, exercise_id, set_order, weight_kg, reps, rir) values
  ('b0000000-0000-0000-0000-000000000062', '$B', '$V', 'b0000000-0000-0000-0000-0000000000e1', 1, 20, 10, 1);
select pg_sleep(3);
commit;
SQL
sleep 1
r=$(rend "$V")
wait
series=$(docker exec -i "$NOM" psql -U postgres -A -t -c "select count(*) from public.performed_sets where execution_id = '$V'")
if [ "$r" = kept ] && [ "$series" = 1 ]; then
  echo "OK    série insérée pendant la suppression conditionnelle : attendue, vue, exécution gardée"
else
  echo "ECHEC série concurrente : rendu « $r », $series série(s) restante(s)"; exit 1
fi

# Course 2, l'inverse : la suppression d'abord (transaction tenue), la série
# ensuite. La série attend, puis est refusée par sa clé étrangère : rien ne
# part en cascade, et le client la montre comme une saisie refusée.
W=b0000000-0000-0000-0000-000000000055
sql /dev/stdin <<SQL
insert into public.executions (id, owner_id, seance_version_id, performed_on) values
  ('$W', '$B', 'b0000000-0000-0000-0000-0000000000d1', '2026-06-14');
SQL
sql /dev/stdin >/dev/null <<SQL &
set role authenticated;
set request.jwt.claim.sub = '$B';
begin;
select public.delete_execution_if_empty('$W');
select pg_sleep(3);
commit;
SQL
sleep 1
sortie=$(api "insert into public.performed_sets (id, owner_id, execution_id, exercise_id, set_order, weight_kg, reps, rir) values ('b0000000-0000-0000-0000-000000000063', '$B', '$W', 'b0000000-0000-0000-0000-0000000000e1', 1, 20, 10, 1)")
wait
if echo "$sortie" | grep -q "performed_sets_execution_id_fkey\|violates foreign key" && [ "$(reste "$W")" = 0 ]; then
  echo "OK    série arrivée pendant la suppression : attend, puis refusée par sa clé étrangère"
else
  echo "ECHEC série arrivée pendant la suppression : $sortie"; exit 1
fi
echo "== réordonnancement sous révision (0026)"
# Routine PPL du compte A : Push, Pull, Legs. Le client envoie l'ordre qu'il
# AFFICHE et le nouvel ordre ; la base refuse si l'ordre a changé entre-temps.
A=aaaaaaaa-0000-0000-0000-000000000001
R=a0000000-0000-0000-0000-0000000000a1
PUSH=a0000000-0000-0000-0000-0000000000b1
PULL=a0000000-0000-0000-0000-0000000000b2
LEGS=a0000000-0000-0000-0000-0000000000b3
sql /dev/stdin <<SQL
update public.seances set position = case id when '$PUSH' then 0 when '$PULL' then 1 when '$LEGS' then 2 end
  where routine_id = '$R';
SQL
ordre() { docker exec -i "$NOM" psql -U postgres -A -t -c "select string_agg(name, ',' order by position) from public.seances where routine_id = '$R' and archived_at is null"; }
reordonne() { # reordonne <compte> <ordre attendu> <nouvel ordre> : réponse de la base (vide si succès)
  docker exec -i "$NOM" psql -U postgres -q -A -t -v ON_ERROR_STOP=1 \
    -c "set role authenticated" -c "set request.jwt.claim.sub = '$1'" \
    -c "select public.reorder_seances_revision('$R', array[$2]::uuid[], array[$3]::uuid[])" 2>&1 || true
}
r=$(reordonne "$A" "'$PUSH','$PULL','$LEGS'" "'$PULL','$PUSH','$LEGS'")
if [ "$(ordre)" = "Pull,Push,Legs" ] && ! echo "$r" | grep -q ERROR; then echo "OK    ordre affiché à jour : réordonné"
else echo "ECHEC réordonnancement à jour : $r (ordre : $(ordre))"; exit 1; fi
r=$(reordonne "$A" "'$PUSH','$PULL','$LEGS'" "'$PUSH','$LEGS','$PULL'")
if echo "$r" | grep -q "l'ordre a changé" && [ "$(ordre)" = "Pull,Push,Legs" ]; then echo "OK    ordre affiché dépassé : refusé (PT409), rien n'a bougé"
else echo "ECHEC ordre dépassé accepté : $r (ordre : $(ordre))"; exit 1; fi
r=$(docker exec -i "$NOM" psql -U postgres -q -A -t -c "set role anon" \
  -c "select public.reorder_seances_revision('$R', array['$PULL','$PUSH','$LEGS']::uuid[], array['$LEGS','$PULL','$PUSH']::uuid[])" 2>&1 || true)
if echo "$r" | grep -q "permission denied" && [ "$(ordre)" = "Pull,Push,Legs" ]; then echo "OK    appel sans compte : refusé"
else echo "ECHEC appel sans compte : $r (ordre : $(ordre))"; exit 1; fi
r=$(reordonne "$B" "'$PULL','$PUSH','$LEGS'" "'$LEGS','$PULL','$PUSH'")
if echo "$r" | grep -q ERROR && [ "$(ordre)" = "Pull,Push,Legs" ]; then echo "OK    autre compte : refusé, rien n'a bougé"
else echo "ECHEC autre compte accepté : $r (ordre : $(ordre))"; exit 1; fi
# Course : un appareil réordonne (transaction tenue 3 s) ; l'autre, parti du
# même ordre, attend le verrou puis est refusé : son ordre est dépassé.
sql /dev/stdin >/dev/null <<SQL &
set role authenticated;
set request.jwt.claim.sub = '$A';
begin;
select public.reorder_seances_revision('$R', array['$PULL','$PUSH','$LEGS']::uuid[], array['$LEGS','$PULL','$PUSH']::uuid[]);
select pg_sleep(3);
commit;
SQL
sleep 1
r=$(reordonne "$A" "'$PULL','$PUSH','$LEGS'" "'$PUSH','$PULL','$LEGS'")
wait
if echo "$r" | grep -q "l'ordre a changé" && [ "$(ordre)" = "Legs,Pull,Push" ]; then echo "OK    deux appareils en même temps : le second attend, puis est refusé"
else echo "ECHEC course de réordonnancement : $r (ordre : $(ordre))"; exit 1; fi
echo "== ajout de séance pendant un réordonnancement (0026)"
commeA() { # commeA <instruction SQL> : une requête de l'API pour le compte A
  docker exec -i "$NOM" psql -U postgres -q -A -t -v ON_ERROR_STOP=1 \
    -c "set role authenticated" -c "set request.jwt.claim.sub = '$A'" -c "$1" 2>&1 || true
}
position() { docker exec -i "$NOM" psql -U postgres -A -t -c "select position from public.seances where id = '$1'"; }
AJ1=a0000000-0000-0000-0000-0000000000b4
AJ2=a0000000-0000-0000-0000-0000000000b5
# Trois séances à la même position (données anciennes) : la copie du client
# en déduit max + 1 = 1 pour un ajout.
sql /dev/stdin <<SQL
update public.seances set position = 0 where routine_id = '$R';
SQL
# Session 1 : réordonne (ordre affiché aux positions égales) et tient 3 s.
sql /dev/stdin >/dev/null <<SQL &
set role authenticated;
set request.jwt.claim.sub = '$A';
begin;
select public.reorder_seances_revision('$R', array['$PUSH','$PULL','$LEGS']::uuid[], array['$LEGS','$PULL','$PUSH']::uuid[]);
select pg_sleep(3);
commit;
SQL
sleep 1
# Session 2 : ajoute une séance à la position calculée par le client (1).
r=$(commeA "insert into public.seances (id, owner_id, routine_id, name, position) values ('$AJ1', '$A', '$R', 'Ajoutée pendant', 1)")
wait
if [ "$(ordre)" = "Legs,Pull,Push,Ajoutée pendant" ] && [ "$(position "$AJ1")" = 3 ]; then
  echo "OK    ajout pendant un réordonnancement : attend le verrou de la routine, puis se place en fin (position 3)"
else echo "ECHEC ajout concurrent : $r (ordre : $(ordre), position $(position "$AJ1"))"; exit 1; fi
sql /dev/stdin <<SQL
delete from public.seances where id = '$AJ1';
update public.seances set position = 0 where routine_id = '$R';
SQL
r=$(commeA "insert into public.seances (id, owner_id, routine_id, name, position) values ('$AJ2', '$A', '$R', 'Ajoutée ensuite', 0)")
if [ "$(position "$AJ2")" = 1 ]; then echo "OK    trois séances en position 0 puis un ajout : la base le place en fin (1), quelle que soit la position envoyée"
else echo "ECHEC ajout après trois positions égales : $r (position $(position "$AJ2"))"; exit 1; fi
r=$(reordonne "$A" "'$PUSH','$PULL','$LEGS'" "'$LEGS','$PULL','$PUSH'")
if echo "$r" | grep -q "l'ordre a changé" && [ "$(position "$AJ2")" = 1 ]; then echo "OK    réordonner depuis l'ordre d'avant l'ajout : refusé (PT409), l'ajout reste en fin"
else echo "ECHEC réordonnancement qui ignore l'ajout : $r (position $(position "$AJ2"))"; exit 1; fi
commeA "update public.seances set archived_at = now() where id = '$PUSH'" >/dev/null
r=$(commeA "update public.seances set archived_at = null, position = 0 where id = '$PUSH'")
if [ "$(position "$PUSH")" = 2 ]; then echo "OK    séance désarchivée : la base la place en fin (2), quelle que soit la position envoyée"
else echo "ECHEC désarchivage : $r (position $(position "$PUSH"))"; exit 1; fi
echo "== banc vert"
