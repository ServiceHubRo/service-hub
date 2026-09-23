#!/usr/bin/env bash
# Regenerates src/data/database.types.ts from the local Supabase stack (`npx supabase start`).
# Run after every migration and commit the result.
set -euo pipefail
out=src/data/database.types.ts
tmp="$(mktemp)"
npx supabase gen types typescript --local --schema public > "$tmp"
{
  echo '// GENERATED from the database schema — do not edit by hand.'
  echo '// Regenerate after every migration: npm run db:types (needs the local Supabase stack: npx supabase start).'
  echo
  cat "$tmp"
} > "$out"
rm "$tmp"
echo "Wrote $out"
