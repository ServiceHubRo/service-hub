-- M7 / T69 — one rule for license plates (Eduard, 6 Nov 2026: approved in docs/FLEET_EXTENSION_PLAN.md).
--
-- The canonical plate: upper case, without whitespace and ASCII punctuation (spaces, dashes, dots,
-- underscores, slashes, …) and the middle dot. Nothing else changes: letters with diacritics and other
-- alphabets stay as typed, so „TÜ AB 123” keeps its Ü. `BV98LGY`, `BV-98-LGY`, `bv 98 lgy`,
-- `B V 98 L G Y` and `BV.98.LGY` are one plate. For plates in A–Z and 0–9 (every Romanian plate)
-- this is the rule `vehicle_key()` and the searches already used; `cars`, `company_vehicles` and
-- bookings removed only spaces and dashes until now. The mirror is src/lib/plate.ts (same vectors in
-- tests/sql/142_plate_rule.sql and tests/unit/plate.test.ts).
--
-- What changes:
--   * plate_norm(text) is the one function; the generated plate_norm columns of cars, company_vehicles
--     and shop_client_cars are re-created on it (the typed plate is never touched);
--   * vehicle_key() uses it;
--   * a new booking's snapshot gets its plate_norm from it (trigger), so every way in agrees;
--   * a plate typed for a car, a company vehicle or a booking is checked: 2–10 letters or digits once
--     the separators are gone, at least one digit (Romanian and foreign plates pass). Existing rows are
--     never rejected: only a new or changed plate is checked. Imports from other programs are kept as
--     they came (normalised, not checked).
-- What does not change: existing bookings' snapshots, imported rows, any typed value.
-- If two active vehicles of one company (or two cars of one shop's imported clients) become equal
-- under the wider rule, re-creating the unique index fails and the migration changes nothing.
-- Rollback: docs/sql/rollback_plate_rule.sql (to be added as a new migration only if needed) re-creates
-- the columns with the previous expression and the previous functions.

-- ------------------------------------------------------------------ the rule
create or replace function public.plate_norm(p_plate text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_plate, ''), '[[:space:]!-/:-@\[-`{-~·]', '', 'g')), '')
$$;

-- A plate someone types: 2–10 letters or digits once the separators are gone, at least one digit.
create function public.plate_valid(p_plate text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.plate_norm(p_plate) ~ '^[0-9A-ZÀ-ɏͰ-ϿЀ-ӿ]{2,10}$'
     and public.plate_norm(p_plate) ~ '[0-9]'
$$;
revoke execute on function public.plate_valid(text) from public, anon;
-- Pure functions over the text given: the generated columns and the checks run them as the signed-in
-- user (a client saving a car), so they may call them; they read nothing.
grant execute on function public.plate_norm(text) to authenticated;
grant execute on function public.plate_valid(text) to authenticated;

-- ------------------------------------------------------------------ the columns, re-created on it
alter table public.cars drop column plate_norm;
alter table public.cars add column plate_norm text generated always as (public.plate_norm(plate)) stored;

drop index if exists public.company_vehicles_plate_idx;
alter table public.company_vehicles drop column plate_norm;
alter table public.company_vehicles add column plate_norm text generated always as (public.plate_norm(plate)) stored;
create unique index company_vehicles_plate_idx on public.company_vehicles (company_id, plate_norm)
  where plate_norm is not null and archived_at is null;

drop index if exists public.shop_client_cars_plate_idx;
alter table public.shop_client_cars drop column plate_norm;
alter table public.shop_client_cars add column plate_norm text generated always as (public.plate_norm(plate)) stored;
create unique index shop_client_cars_plate_idx on public.shop_client_cars (shop_id, plate_norm) where plate_norm is not null;

-- The history's key: the same canonical plate.
create or replace function public.vehicle_key(p_car jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.plate_norm(p_car->>'plate') is not null
      then 'plate:' || public.plate_norm(p_car->>'plate')
    else 'car:' || lower(regexp_replace(btrim(coalesce(p_car->>'make', '')), '\s+', ' ', 'g'))
      || '|' || lower(regexp_replace(btrim(coalesce(p_car->>'model', '')), '\s+', ' ', 'g'))
      || '|' || coalesce(p_car->>'year', '')
  end
$$;

-- ------------------------------------------------------------------ checks on the way in
-- A car of the garage: a new or changed plate must be a plate (the rest of the row is free to change).
create function public.cars_plate_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plate is not null and btrim(new.plate) <> ''
     and (tg_op = 'INSERT' or public.plate_norm(new.plate) is distinct from public.plate_norm(old.plate))
     and not public.plate_valid(new.plate) then
    perform public.fail('car_plate_invalid');
  end if;
  return new;
end
$$;
create trigger cars_plate_check before insert or update of plate on public.cars
  for each row execute function public.cars_plate_check();

-- A company vehicle: the same check, and one active vehicle per canonical plate (named, before the
-- unique index would answer with a bare error).
create function public.company_vehicles_plate_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm text := public.plate_norm(new.plate);
  v_other uuid;
begin
  if v_norm is not null
     and (tg_op = 'INSERT' or v_norm is distinct from public.plate_norm(old.plate)) and not public.plate_valid(new.plate) then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'plate'));
  end if;
  if v_norm is not null and new.archived_at is null then
    select cv.id into v_other from public.company_vehicles cv
    where cv.company_id = new.company_id and cv.id <> new.id and cv.archived_at is null and cv.plate_norm = v_norm
    limit 1;
    if v_other is not null then
      perform public.fail('vehicle_plate_exists', jsonb_build_object('vehicle_id', v_other));
    end if;
  end if;
  return new;
end
$$;
create trigger company_vehicles_plate_check before insert or update of plate, archived_at on public.company_vehicles
  for each row execute function public.company_vehicles_plate_check();

-- A new booking: its snapshot's plate_norm from the one rule (every booking function writes it, each
-- with its own copy of the old expression), and a typed plate checked.
create function public.bookings_plate_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.car_snapshot is not null and jsonb_typeof(new.car_snapshot) = 'object' then
    if coalesce(btrim(new.car_snapshot->>'plate'), '') <> '' and not public.plate_valid(new.car_snapshot->>'plate') then
      perform public.fail('car_plate_invalid');
    end if;
    new.car_snapshot := jsonb_set(new.car_snapshot, '{plate_norm}',
      coalesce(to_jsonb(public.plate_norm(new.car_snapshot->>'plate')), 'null'::jsonb));
  end if;
  return new;
end
$$;
create trigger bookings_plate_snapshot before insert on public.bookings
  for each row execute function public.bookings_plate_snapshot();

-- Imported jobs: normalised the same way, never refused (a shop's old program had its own rules).
create function public.imported_jobs_plate_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.car_snapshot is not null and jsonb_typeof(new.car_snapshot) = 'object' then
    new.car_snapshot := jsonb_set(new.car_snapshot, '{plate_norm}',
      coalesce(to_jsonb(public.plate_norm(new.car_snapshot->>'plate')), 'null'::jsonb));
  end if;
  return new;
end
$$;
create trigger imported_jobs_plate_snapshot before insert on public.imported_jobs
  for each row execute function public.imported_jobs_plate_snapshot();

update public.schema_version set version = 100;
