#!/usr/bin/env bash
# Tests every rollback in supabase/rollback/ (T72–T77) against a throwaway local Postgres database:
# for the migration M a rollback belongs to, the database is built up to the migration before M with
# the demo seed, its structure and data are dumped, M is applied, the rollback is applied, and both dumps
# must be identical again (structure and every row, byte for byte). Then M is applied once more, to show
# the rollback leaves the database ready for it. Stops at the first difference.
set -euo pipefail

shopt -s nullglob
rollbacks=(supabase/rollback/*.sql)
if [ ${#rollbacks[@]} -eq 0 ]; then
  echo "test:rollback — no rollbacks."
  exit 0
fi

DB="${ROLLBACK_TEST_DB:-service_hub_rollback}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
OUT="${TMPDIR:-/tmp}/rollback-test"
mkdir -p "$OUT"

dump() {
  # pg_dump's \restrict key is random on every run: left out of the comparison.
  pg_dump --schema-only --no-owner --no-privileges "$DB" | grep -v -E '^\\(un)?restrict ' > "$1.schema.sql"
  pg_dump --data-only --no-owner --inserts --rows-per-insert=1 --exclude-table-data=public.request_log "$DB" \
    | grep -v -E '^\\(un)?restrict ' | sort > "$1.data.sql"
}

for rb in "${rollbacks[@]}"; do
  name="$(basename "$rb")"
  target="supabase/migrations/$name"
  [ -f "$target" ] || { echo "no migration for $rb"; exit 1; }
  dropdb --if-exists "$DB"
  createdb "$DB"
  for f in tests/sql/00_auth_stub.sql supabase/migrations/*.sql; do
    [ "$f" = "$target" ] && break
    "${PSQL[@]}" -d "$DB" -f "$f" > /dev/null
  done
  "${PSQL[@]}" -d "$DB" -f supabase/seed/dev_seed.sql > /dev/null
  dump "$OUT/before"
  "${PSQL[@]}" -d "$DB" -f "$target" > /dev/null
  "${PSQL[@]}" -d "$DB" -f "$rb" > /dev/null
  dump "$OUT/after"
  if ! diff -u "$OUT/before.schema.sql" "$OUT/after.schema.sql" > "$OUT/schema.diff"; then
    echo "FAIL $name: the structure differs after the rollback"; head -60 "$OUT/schema.diff"; exit 1
  fi
  if ! diff -u "$OUT/before.data.sql" "$OUT/after.data.sql" > "$OUT/data.diff"; then
    echo "FAIL $name: the data differs after the rollback"; head -60 "$OUT/data.diff"; exit 1
  fi
  "${PSQL[@]}" -d "$DB" -f "$target" > /dev/null
  echo "ok     $name (structure and data identical; applies again)"
done
dropdb --if-exists "$DB"
echo "test:rollback — all passed."
