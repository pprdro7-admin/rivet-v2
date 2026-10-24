#!/usr/bin/env bash
# Run the whole system on this computer, for building and clicking through screens.
#
#   scripts/dev.sh                          # fresh database with the tiny fictional fixture
#   scripts/dev.sh TABLE1.xlsx TABLE2.xlsx  # or with CO's real files (they stay on this computer)
#
# Needs Postgres 15+ and PostgREST (https://postgrest.org, one file) on PATH, and Node 20+.
# Sign-in is replaced by a "sign in as a sample account" list; nothing here touches Supabase.
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
WORK="${DEV_DIR:-$PWD/.dev}"
JWT_SECRET="local-development-secret-not-for-real-use-000000"
rm -rf "$WORK" && mkdir -p "$WORK"
RUN=""
if [[ "$(id -u)" == "0" ]]; then chown postgres "$WORK"; RUN="runuser -u postgres --"; fi
$RUN initdb -D "$WORK/data" -U postgres -A trust >/dev/null
$RUN pg_ctl -D "$WORK/data" -o "-k $WORK -p 54329 -c listen_addresses=localhost" -l "$WORK/pg.log" -w start >/dev/null
trap '$RUN pg_ctl -D "$WORK/data" -m fast stop >/dev/null' EXIT
export DATABASE_URL="postgresql://postgres@localhost:54329/postgres"

run() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
run supabase/tests/00_local_supabase_stub.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
if [[ $# -eq 2 ]]; then
  python3 scripts/load_co_tables.py SY2025-2026 "$1" "$2"
else
  run supabase/tests/02_fixture_co_data.sql
fi
psql "$DATABASE_URL" -X -q -c "create role authenticator login noinherit; grant anon, authenticated to authenticator;"
echo "Database ready."

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgresql://authenticator@localhost:54329/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = 54321
CONF
postgrest "$WORK/postgrest.conf" >"$WORK/postgrest.log" 2>&1 &
trap '$RUN pg_ctl -D "$WORK/data" -m fast stop >/dev/null; kill %1 2>/dev/null' EXIT

cd web
[[ -d node_modules ]] || npm install --no-audit --no-fund
VITE_LOCAL_JWT_SECRET="$JWT_SECRET" npm run dev -- --host 127.0.0.1
