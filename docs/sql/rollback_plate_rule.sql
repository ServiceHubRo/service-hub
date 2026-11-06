-- Rollback of migration 20261106062557_plate_rule (M7). NOT a migration: if M7 has to be undone,
-- copy this into a new migration (`npx supabase migration new revert_plate_rule`). It restores the
-- previous rule (spaces and dashes only for the columns, A–Z/0–9 for the history key) and removes the
-- checks. No typed value was changed by M7, so nothing else needs restoring; bookings created while
-- M7 was on keep the plate_norm it gave them in their snapshot.

drop trigger if exists bookings_plate_snapshot on public.bookings;
drop trigger if exists imported_jobs_plate_snapshot on public.imported_jobs;
drop trigger if exists cars_plate_check on public.cars;
drop trigger if exists company_vehicles_plate_check on public.company_vehicles;
drop function if exists public.bookings_plate_snapshot();
drop function if exists public.imported_jobs_plate_snapshot();
drop function if exists public.cars_plate_check();
drop function if exists public.company_vehicles_plate_check();
drop function if exists public.plate_valid(text);

create or replace function public.plate_norm(p_plate text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p_plate, ''), '[\s-]', '', 'g')), '')
$$;

alter table public.cars drop column plate_norm;
alter table public.cars add column plate_norm text generated always as (
  nullif(upper(regexp_replace(coalesce(plate, ''), '[\s-]', '', 'g')), '')) stored;

drop index if exists public.company_vehicles_plate_idx;
alter table public.company_vehicles drop column plate_norm;
alter table public.company_vehicles add column plate_norm text generated always as (
  nullif(upper(regexp_replace(coalesce(plate, ''), '[\s-]', '', 'g')), '')) stored;
create unique index company_vehicles_plate_idx on public.company_vehicles (company_id, plate_norm)
  where plate_norm is not null and archived_at is null;

drop index if exists public.shop_client_cars_plate_idx;
alter table public.shop_client_cars drop column plate_norm;
alter table public.shop_client_cars add column plate_norm text generated always as (
  nullif(regexp_replace(upper(coalesce(plate, '')), '[^A-Z0-9]', '', 'g'), '')) stored;
create unique index shop_client_cars_plate_idx on public.shop_client_cars (shop_id, plate_norm) where plate_norm is not null;

create or replace function public.vehicle_key(p_car jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when regexp_replace(upper(coalesce(p_car->>'plate', '')), '[^A-Z0-9]', '', 'g') <> ''
      then 'plate:' || regexp_replace(upper(coalesce(p_car->>'plate', '')), '[^A-Z0-9]', '', 'g')
    else 'car:' || lower(regexp_replace(btrim(coalesce(p_car->>'make', '')), '\s+', ' ', 'g'))
      || '|' || lower(regexp_replace(btrim(coalesce(p_car->>'model', '')), '\s+', ' ', 'g'))
      || '|' || coalesce(p_car->>'year', '')
  end
$$;

-- Set schema_version to the next integer (never back), and EXPECTED_SCHEMA_VERSION in src/lib/schema.ts.
