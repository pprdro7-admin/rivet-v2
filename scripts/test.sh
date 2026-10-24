#!/usr/bin/env bash
# Build the database from scratch and run every test against it.
#
#   scripts/test.sh                  # starts a throwaway local Postgres (needs Postgres 15+ installed)
#   DATABASE_URL=postgres://... scripts/test.sh   # uses an empty database you provide (CI does this)
#
# Never point DATABASE_URL at a Supabase project: the tests create sample data.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DATABASE_URL:-}" ]]; then
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  export PATH="$PGBIN:$PATH"
  WORK="$(mktemp -d)"
  RUN=""
  if [[ "$(id -u)" == "0" ]]; then chown postgres "$WORK"; RUN="runuser -u postgres --"; fi
  $RUN initdb -D "$WORK/data" -U postgres -A trust >/dev/null
  $RUN pg_ctl -D "$WORK/data" -o "-k $WORK -p 54329 -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
  trap '$RUN pg_ctl -D "$WORK/data" -m immediate stop >/dev/null; rm -rf "$WORK"' EXIT
  DATABASE_URL="postgresql://postgres@/postgres?host=$WORK&port=54329"
fi

run() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; /ERROR\|FAIL/p'; return "${PIPESTATUS[0]}"; }

echo "== Building the database"
run supabase/tests/00_local_supabase_stub.sql
for f in supabase/migrations/*.sql; do echo "   $f"; run "$f"; done
run supabase/seed.sql
run supabase/tests/01_test_helpers.sql
run supabase/tests/02_fixture_co_data.sql

passed=0
for f in supabase/tests/[1-9]*.sql; do
  echo "== $(basename "$f")"
  out="$(run "$f")" || { echo "$out"; echo "FAILED in $f"; exit 1; }
  echo "$out" | sed 's/^/   /'
  passed=$((passed + $(grep -c '^ok - ' <<<"$out")))
done
echo "== All $passed checks passed"
