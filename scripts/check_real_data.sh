#!/usr/bin/env bash
# Load CO's real Tables 1 and 2 into a throwaway local database and print the counts and RO flags,
# to compare with the v5 workbook. Nothing is kept; the files never enter the repository.
#
#   scripts/check_real_data.sh TABLE1.xlsx TABLE2.xlsx
set -euo pipefail
cd "$(dirname "$0")/.."
T1="$(realpath "$1")"; T2="$(realpath "$2")"

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="$(mktemp -d)"
RUN=""
if [[ "$(id -u)" == "0" ]]; then chown postgres "$WORK"; chmod 755 "$WORK"; RUN="runuser -u postgres --"; fi
$RUN initdb -D "$WORK/data" -U postgres -A trust >/dev/null
$RUN pg_ctl -D "$WORK/data" -o "-k $WORK -p 54330 -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
trap '$RUN pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
export DATABASE_URL="postgresql://postgres@/postgres?host=$WORK&port=54330"

q() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
q -f supabase/tests/00_local_supabase_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do q -f "$f" >/dev/null; done
time python3 scripts/load_co_tables.py SY2025-2026 "$T1" "$T2"

q <<'SQL'
\echo '== Counts'
select (select count(distinct sdo_code) from cycle_schools) as sdos,
       (select count(*) from cycle_schools) as schools,
       (select count(*) from co_buildings) as buildings,
       (select sum(number_of_rooms) from co_buildings) as t1_rooms,
       (select count(*) from co_rooms) as t2_rooms,
       (select count(*) from co_rooms where building_id is null) as rooms_without_building;
\echo '== Building flags'
select regexp_replace(flag, '[0-9]+ room', 'N room') as flag, count(*) from building_flags group by 1 order by 2 desc;
\echo '== Room flags'
select who, flag, count(*) from room_flags group by 1, 2 order by 3 desc;
\echo '== Flagged records'
select count(distinct building_id) as flagged_buildings from building_flags;
select count(distinct room_id) as flagged_rooms from room_flags;
\echo '== Per SDO (as Annex A)'
select s.name as sdo, count(*) as schools, sum(co_buildings) as buildings, sum(co_rooms) as rooms,
       sum(co_instructional_rooms) as instr_rooms, sum(flagged_buildings) as flagged_b, sum(flagged_rooms) as flagged_r
from school_tally t join sdos s on s.code = t.sdo_code group by s.name order by s.name;
\timing on
select count(*) from school_tally;
select * from school_tally where school_id = '117929';
SQL
