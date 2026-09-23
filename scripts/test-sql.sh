#!/usr/bin/env bash
# Runs the database tests (CLAUDE.md §9) against a throwaway local Postgres database:
# auth stub → every migration in order → tests/sql/*.sql. Stops at the first error.
set -euo pipefail

shopt -s nullglob
migrations=(supabase/migrations/*.sql)
tests=(tests/sql/[0-9]*.sql)

if [ ${#migrations[@]} -eq 0 ]; then
  echo "test:sql — no migrations yet, nothing to test."
  exit 0
fi

DB="${SQL_TEST_DB:-service_hub_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

dropdb --if-exists "$DB"
createdb "$DB"

for f in tests/sql/00_*.sql "${migrations[@]}"; do
  echo "apply  $f"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

for f in "${tests[@]}"; do
  case "$f" in tests/sql/00_*) continue ;; esac
  echo "test   $f"
  "${PSQL[@]}" -d "$DB" -o /dev/null -f "$f"
done

# The demo seed must keep loading on top of every migration.
echo "seed   supabase/seed/dev_seed.sql"
"${PSQL[@]}" -d "$DB" -o /dev/null -f supabase/seed/dev_seed.sql

echo "test:sql — all passed."
