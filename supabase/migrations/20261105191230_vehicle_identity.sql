-- T66 — one logical vehicle per owner (approved by Eduard on 5 Nov 2026: "Fă ce trebuie. Dar logic";
-- the proposal: refuse a copy in the same garage and the same company, offer the car already there;
-- no check between different owners or companies, which would reveal another's data).
--
-- · Identity: the VIN when there is one (valid, normalized); else the plate (normalized), never make
--   or model. Two cars with the same plate but two different VINs are two cars (a plate moved).
-- · Garage (cars): a second car with the same identity for the same owner is refused
--   (`car_duplicate {car_id}`, the car already there) — on every path, by a trigger; the cars that
--   are already duplicated stay (nothing is deleted or merged automatically) and can be merged by
--   their owner (merge_cars, logged in car_merges).
-- · Bookings, the walk-in claim and the shops' imports reuse the car already in the garage.
-- · Company vehicles: the same VIN twice among a company's active vehicles is refused
--   (`vehicle_vin_exists`), like the plate since T63c.
-- · The history follows the garage car (car_id) as well as the plate: a new plate does not cut it.
-- · admin_vehicle_duplicates() lists what looks duplicated today, for a decision, never a change.
-- · Shops are untouched: a shop works on its bookings; no copy of the car is made for a shop.

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
create function public.plate_norm(p_plate text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p_plate, ''), '[\s-]', '', 'g')), '')
$$;
revoke execute on function public.plate_norm(text) from public, anon, authenticated;

-- The owner's car that is the same vehicle: the same VIN first; else the same plate, unless both
-- carry two different VINs. Null when none. `p_except`: the car being edited.
create function public.car_match(p_owner uuid, p_vin text, p_plate_norm text, p_except uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.cars c
  where c.owner_id = p_owner and c.id is distinct from p_except
    and ((p_vin is not null and c.vin = p_vin)
         or (p_plate_norm is not null and c.plate_norm = p_plate_norm
             and not (p_vin is not null and c.vin is not null and c.vin <> p_vin)))
  order by (p_vin is not null and c.vin = p_vin) desc, c.created_at, c.id
  limit 1
$$;
revoke execute on function public.car_match(uuid, text, text, uuid) from public, anon, authenticated;

-- Every path into the garage (the app's form, bookings, claims, imports): no second copy.
create function public.cars_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
begin
  if tg_op = 'UPDATE'
     and public.normalize_code(new.vin) is not distinct from public.normalize_code(old.vin)
     and public.plate_norm(new.plate) is not distinct from public.plate_norm(old.plate) then
    return new;
  end if;
  -- Two requests for the same owner at the same moment wait for each other.
  perform pg_advisory_xact_lock(hashtext('car-owner:' || new.owner_id::text));
  v_other := public.car_match(new.owner_id, public.normalize_code(new.vin), public.plate_norm(new.plate), new.id);
  if v_other is not null then
    perform public.fail('car_duplicate', jsonb_build_object('car_id', v_other));
  end if;
  return new;
end
$$;
revoke execute on function public.cars_identity() from public, anon, authenticated;
create trigger cars_identity before insert or update of vin, plate on public.cars
  for each row execute function public.cars_identity();

-- A company's active vehicles: one per VIN (the plate is one per company since T63c).
create function public.company_vehicles_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vin text := public.normalize_code(new.vin);
  v_other uuid;
begin
  if v_vin is null or new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and public.normalize_code(old.vin) is not distinct from v_vin and old.archived_at is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('company-vin:' || new.company_id::text));
  select cv.id into v_other from public.company_vehicles cv
  where cv.company_id = new.company_id and cv.id <> new.id and cv.archived_at is null and public.normalize_code(cv.vin) = v_vin
  limit 1;
  if v_other is not null then
    perform public.fail('vehicle_vin_exists', jsonb_build_object('vehicle_id', v_other));
  end if;
  return new;
end
$$;
revoke execute on function public.company_vehicles_identity() from public, anon, authenticated;
create trigger company_vehicles_identity before insert or update of vin, archived_at on public.company_vehicles
  for each row execute function public.company_vehicles_identity();

-- ---------------------------------------------------------------------------------------------
-- The paths that add cars reuse the one already there
-- ---------------------------------------------------------------------------------------------
-- create_booking: a typed car that is already in the garage is that car.
create or replace function public.create_booking(
  p_shop_id uuid,
  p_service_id text,
  p_date date,
  p_slot time,
  p_request_id uuid,
  p_car_id uuid default null,
  p_car jsonb default null,
  p_save_car boolean default false,
  p_note text default null,
  p_extra_service_ids text[] default '{}',
  p_share_history boolean default false,
  p_company_vehicle_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_car public.cars%rowtype;
  v_vehicle public.company_vehicles%rowtype;
  v_company uuid;
  v_snapshot jsonb;
  v_note text := nullif(btrim(p_note), '');
  v_booking public.bookings%rowtype;
  v_year int;
  v_plate text;
  v_vin text;
  v_params jsonb;
  v_extra text[] := coalesce(p_extra_service_ids, '{}');
  v_share boolean := coalesce(p_share_history, false);
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'create_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;

  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  if v_me.email_verified_at is null then
    perform public.fail('email_not_verified');
  end if;

  -- One booking at a time per client, so the limits below cannot be raced.
  perform 1 from public.profiles where id = v_me.id for no key update;

  -- A company vehicle (T63d): a member who may book, the vehicle assigned to them if a driver.
  if p_company_vehicle_id is not null then
    if p_car_id is not null or p_car is not null then
      perform public.fail('car_invalid');
    end if;
    perform public.require_fleet_client();
    select * into v_vehicle from public.company_vehicles where id = p_company_vehicle_id;
    if not found or public.company_role(v_vehicle.company_id) is null then
      perform public.fail('vehicle_not_found');
    end if;
    v_company := v_vehicle.company_id;
    perform public.require_company(v_company, 'bookings.create');
    if not public.fleet_can(v_company, 'vehicles.viewAll') and v_vehicle.driver_member_id is distinct from public.my_member_id(v_company) then
      perform public.fail('not_allowed');
    end if;
    if v_vehicle.archived_at is not null then
      perform public.fail('vehicle_archived');
    end if;
    if public.company_read_only(v_company) then
      perform public.fail('fleet_read_only');
    end if;
    -- One company booking at a time, so the company limits cannot be raced either.
    perform 1 from public.companies where id = v_company for no key update;
  end if;

  -- One writer at a time per shop, so capacity cannot be raced (§4).
  select * into v_shop from public.shops where id = p_shop_id for no key update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if not public.is_shop_public(p_shop_id) then
    perform public.fail('shop_unavailable');
  end if;

  if not exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = p_shop_id and ss.service_id = p_service_id and sv.enabled
  ) then
    perform public.fail('service_unavailable');
  end if;

  -- More services in the same booking (T21): up to 5 in all, each once, each offered by the shop.
  -- Still one car, one time and one place of the day's capacity.
  if cardinality(v_extra) > 4 then
    perform public.fail('too_many_services', jsonb_build_object('limit', 5));
  end if;
  if p_service_id = any (v_extra)
     or cardinality(v_extra) <> (select count(distinct x) from unnest(v_extra) x)
     or exists (
       select 1 from unnest(v_extra) x
       where x is null or not exists (
         select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
         where ss.shop_id = p_shop_id and ss.service_id = x and sv.enabled)) then
    perform public.fail('service_unavailable');
  end if;

  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  -- Car: the company vehicle, from the garage, or typed in.
  if v_company is not null then
    v_car.make := v_vehicle.make;
    v_car.model := v_vehicle.model;
    v_car.year := v_vehicle.year;
    v_car.plate := v_vehicle.plate;
    v_car.plate_norm := v_vehicle.plate_norm;
    v_car.vin := v_vehicle.vin;
  elsif p_car_id is not null then
    select * into v_car from public.cars where id = p_car_id and owner_id = v_me.id;
    if not found then
      perform public.fail('car_not_found');
    end if;
  elsif p_car is not null and jsonb_typeof(p_car) = 'object' then
    if coalesce(btrim(p_car->>'make'), '') = '' or coalesce(btrim(p_car->>'model'), '') = '' then
      perform public.fail('car_required');
    end if;
    v_year := case when coalesce(p_car->>'year', '') ~ '^\d{4}$' then (p_car->>'year')::int end;
    if coalesce(p_car->>'year', '') <> '' and (v_year is null or v_year not between 1900 and 2100) then
      perform public.fail('car_year_invalid');
    end if;
    v_plate := nullif(btrim(p_car->>'plate'), '');
    if char_length(v_plate) > 20 then
      perform public.fail('car_plate_invalid');
    end if;
    v_vin := public.normalize_code(p_car->>'vin');
    if v_vin is not null and not public.is_valid_vin(v_vin) then
      perform public.fail('car_vin_invalid');
    end if;
    if char_length(btrim(p_car->>'make')) > 60 or char_length(btrim(p_car->>'model')) > 60 then
      perform public.fail('car_invalid');
    end if;
    -- The same car already in the garage (its VIN, else its plate — T66): that car, never a copy,
    -- whether or not "Salvează în garaj" was ticked; the booking and the history stay on one car.
    select * into v_car from public.cars c
    where c.id = public.car_match(v_me.id, v_vin, public.plate_norm(v_plate), null);
    if found then
      null;
    elsif p_save_car then
      insert into public.cars (owner_id, make, model, year, plate, vin)
      values (v_me.id, btrim(p_car->>'make'), btrim(p_car->>'model'), v_year, v_plate, v_vin)
      returning * into v_car;
    else
      v_car.make := btrim(p_car->>'make');
      v_car.model := btrim(p_car->>'model');
      v_car.year := v_year;
      v_car.plate := v_plate;
      v_car.plate_norm := public.plate_norm(v_plate);
      v_car.vin := v_vin;
    end if;
  else
    perform public.fail('car_required');
  end if;
  v_snapshot := jsonb_build_object(
    'make', v_car.make, 'model', v_car.model, 'year', v_car.year, 'plate', v_car.plate,
    'plate_norm', v_car.plate_norm, 'vin', v_car.vin);

  perform public.check_slot(v_shop, p_date, p_slot, null, true);

  -- Abuse limits (§6): the company's for a company vehicle, the person's otherwise.
  if v_company is not null then
    if (select count(*) from public.bookings b
        where b.company_id = v_company and b.shop_id = p_shop_id and public.is_active_status(b.status))
       >= public.app_limit('fleet_active_bookings_per_shop', 20) then
      perform public.fail('fleet_limit_active_shop', jsonb_build_object('limit', public.app_limit('fleet_active_bookings_per_shop', 20)));
    end if;
    if (select count(*) from public.bookings b
        where b.company_id = v_company and public.is_active_status(b.status))
       >= public.app_limit('fleet_active_bookings_total', 100) then
      perform public.fail('fleet_limit_active_total', jsonb_build_object('limit', public.app_limit('fleet_active_bookings_total', 100)));
    end if;
    if (select count(*) from public.bookings b
        where b.company_id = v_company and b.created_at > now() - interval '24 hours')
       >= public.app_limit('fleet_new_bookings_per_24h', 30) then
      perform public.fail('fleet_limit_daily', jsonb_build_object('limit', public.app_limit('fleet_new_bookings_per_24h', 30)));
    end if;
  else
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and b.shop_id = p_shop_id and public.is_active_status(b.status))
       >= public.app_limit('active_bookings_per_shop', 3) then
      perform public.fail('limit_active_shop', jsonb_build_object('limit', public.app_limit('active_bookings_per_shop', 3)));
    end if;
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and public.is_active_status(b.status))
       >= public.app_limit('active_bookings_total', 10) then
      perform public.fail('limit_active_total', jsonb_build_object('limit', public.app_limit('active_bookings_total', 10)));
    end if;
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and b.created_at > now() - interval '24 hours')
       >= public.app_limit('new_bookings_per_24h', 5) then
      perform public.fail('limit_daily', jsonb_build_object('limit', public.app_limit('new_bookings_per_24h', 5)));
    end if;
  end if;

  insert into public.bookings (
    shop_id, client_id, service_id, extra_service_ids, client_name, client_phone, client_lang, car_id, car_snapshot,
    date, slot, note, status, share_history, share_history_at, company_id, company_vehicle_id
  ) values (
    p_shop_id, v_me.id, p_service_id, v_extra, v_me.name, v_me.phone, v_me.lang, v_car.id, v_snapshot,
    p_date, p_slot, v_note, 'pending', v_share, case when v_share then now() end, v_company, v_vehicle.id
  )
  returning * into v_booking;

  v_params := public.booking_event_params(v_booking);
  perform public.post_booking_event(v_booking, 'booking_requested', 'client');
  -- Instant confirmation (T28a): the shop chose it, and the client has no no-show in the last 90
  -- days. The place was just counted under the shop's lock, so it is the shop's yes at once:
  -- confirmed in the same transaction, the client told, the shop told it came in confirmed.
  if v_shop.auto_confirm and public.instant_for_client(v_me.id) then
    update public.bookings set status = 'confirmed', confirmed_at = now()
    where id = v_booking.id returning * into v_booking;
    perform public.post_booking_event(v_booking, 'booking_auto_confirmed', 'system',
      jsonb_build_object('date', v_booking.date, 'slot', to_char(v_booking.slot, 'HH24:MI')));
    perform public.notify_user(v_booking.client_id, 'booking_confirmed',
      public.booking_event_params(v_booking) || jsonb_build_object('auto', true), v_booking.id);
    perform public.notify_shop(v_booking.shop_id, 'booking_auto_confirmed', v_params, v_booking.id,
      case when v_shop.sms_on_new_booking then array['push', 'sms'] else array['push'] end);
  else
    perform public.notify_shop(v_booking.shop_id, 'booking_requested', v_params, v_booking.id,
      case when v_shop.sms_on_new_booking then array['push', 'sms'] else array['push'] end);
  end if;

  if v_company is not null then
    perform public.company_audit(v_company, 'booking_created', 'booking', v_booking.id, null,
      jsonb_build_object('vehicle_id', v_vehicle.id, 'shop_id', p_shop_id, 'date', p_date, 'slot', to_char(p_slot, 'HH24:MI')));
  end if;

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;

-- claim_booking: the claimed booking's car into the garage once (VIN or plate).
create or replace function public.claim_booking(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v public.bookings%rowtype;
  v_my_email text;
  v_phone_ok boolean;
  v_email_ok boolean;
  v_count int := 0;
  r public.bookings%rowtype;
  v_car uuid;
begin
  v_me := public.require_caller();
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  select * into v from public.bookings
  where source = 'shop' and invite_token = p_token and char_length(coalesce(p_token, '')) = 16
  for no key update;
  if not found then
    perform public.fail('invite_not_found');
  end if;
  if v.client_id = v_me.id then
    return jsonb_build_object('booking_id', v.id, 'claimed', 0);
  end if;
  if v.client_id is not null then
    perform public.fail('invite_used');
  end if;

  select u.email into v_my_email from auth.users u where u.id = v_me.id;
  v_phone_ok := (v_me.phone_verified_at is not null or v_me.phone_verified_by_admin)
    and public.account_fingerprint('phone', v_me.phone) = public.account_fingerprint('phone', v.client_phone);
  v_email_ok := v.client_email is not null and v_me.email_verified_at is not null
    and lower(v_my_email) = v.client_email;
  if not v_phone_ok and not v_email_ok then
    if public.account_fingerprint('phone', v_me.phone) = public.account_fingerprint('phone', v.client_phone) then
      perform public.fail('phone_not_verified');
    end if;
    perform public.fail('invite_mismatch');
  end if;

  -- This booking, and, with the phone verified, every other one shops added for it.
  for r in
    select * from public.bookings b
    where b.source = 'shop' and b.client_id is null
      and (b.id = v.id
           or (v_phone_ok and public.account_fingerprint('phone', b.client_phone)
                              = public.account_fingerprint('phone', v_me.phone)))
    order by b.created_at
    for no key update
  loop
    -- The car into the garage, once: the same VIN, else the same plate (T66).
    v_car := public.car_match(v_me.id, public.normalize_code(r.car_snapshot->>'vin'), nullif(r.car_snapshot->>'plate_norm', ''), null);
    if v_car is null then
      insert into public.cars (owner_id, make, model, year, plate, vin)
      values (v_me.id, r.car_snapshot->>'make', r.car_snapshot->>'model', (r.car_snapshot->>'year')::int,
              r.car_snapshot->>'plate', r.car_snapshot->>'vin')
      returning id into v_car;
    end if;
    update public.bookings
      set client_id = v_me.id, car_id = v_car, claimed_at = now(), client_lang = v_me.lang
    where id = r.id;
    perform public.ensure_thread(r.shop_id, v_me.id);
    v_count := v_count + 1;
    v_car := null;
  end loop;

  return jsonb_build_object('booking_id', v.id, 'claimed', v_count);
end
$$;

-- The shops' imported cars into a verified client's garage (T31b): one by one, each skipped when
-- the garage already has it (VIN or plate), so an import never stops on a car already there.
create or replace function public.link_imported(p_profile uuid, p_shop uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cars int := 0;
  r record;
begin
  update public.shop_clients sc
    set client_id = p.id
  from public.profiles p
  where sc.client_id is null
    and public.phone_digits(sc.phone) = public.phone_digits(p.phone)
    and p.role = 'client'
    and p.deleted_at is null
    and (p.phone_verified_at is not null or p.phone_verified_by_admin)
    and (p_profile is null or p.id = p_profile)
    and (p_shop is null or sc.shop_id = p_shop);

  for r in
    select c.id, sc.client_id as owner_id, c.make, c.model, c.year, c.plate, c.vin, c.plate_norm
    from public.shop_client_cars c
    join public.shop_clients sc on sc.id = c.client_id
    where sc.client_id is not null
      and c.added_to_garage_at is null
      and (p_profile is null or sc.client_id = p_profile)
      and (p_shop is null or c.shop_id = p_shop)
    order by sc.client_id, c.id
  loop
    -- Already in the garage: by VIN or plate, or (a car without either) by make and model.
    continue when public.car_match(r.owner_id, public.normalize_code(r.vin), r.plate_norm, null) is not null;
    continue when r.plate_norm is null and public.normalize_code(r.vin) is null and exists (
      select 1 from public.cars x
      where x.owner_id = r.owner_id and lower(x.make) = lower(r.make) and lower(x.model) = lower(coalesce(nullif(r.model, ''), '—')));
    insert into public.cars (owner_id, make, model, year, plate, vin)
    values (r.owner_id, r.make, coalesce(nullif(btrim(r.model), ''), '—'), r.year, r.plate, r.vin);
    v_cars := v_cars + 1;
  end loop;

  update public.shop_client_cars c
    set added_to_garage_at = now()
  from public.shop_clients sc
  where sc.id = c.client_id
    and sc.client_id is not null
    and c.added_to_garage_at is null
    and (p_profile is null or sc.client_id = p_profile)
    and (p_shop is null or c.shop_id = p_shop);
  return v_cars;
end
$$;
revoke execute on function public.link_imported(uuid, uuid) from public, anon, authenticated;

-- report_jobs: the history report follows the garage car too.
create or replace function public.report_jobs(p_client_id uuid, p_vehicle_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(j.job order by j.sort_at desc, j.id), '[]'::jsonb)
  from (
    select b.id,
           coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
           jsonb_build_object(
             'id', b.id,
             'ref', b.ref,
             'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
             'shop_name', s.name,
             'shop_city', s.city,
             'service_id', b.service_id,
             'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
             'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
             'items', coalesce((
               select jsonb_agg(qi.name order by qi.position)
               from public.quote_items qi
               where qi.quote_id = (
                 select q.id from public.quotes q
                 where q.booking_id = b.id and q.status in ('accepted', 'partially_accepted')
                 order by q.version desc limit 1)
                 and qi.approved), '[]'::jsonb),
             'work', nullif(btrim(b.work), ''),
             'odometer', b.odometer,
             'cost', b.cost,
             'warranty_months', b.warranty_months,
             'warranty_until', b.warranty_until
           ) as job
    from public.bookings b
    left join public.shops s on s.id = b.shop_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = p_client_id
      and b.status = 'done'
      -- The jobs remembered under the car's plate, and those linked to the garage car itself, so a
      -- new plate never cuts the history (T66).
      and (public.vehicle_key(b.car_snapshot) = p_vehicle_key
           or b.car_id in (select c.id from public.cars c
                           where c.owner_id = p_client_id and public.vehicle_key(to_jsonb(c)) = p_vehicle_key))
  ) j
$$;

-- ---------------------------------------------------------------------------------------------
-- Duplicates that exist already: reported, merged only by their owner, logged
-- ---------------------------------------------------------------------------------------------
create table public.car_merges (
  id bigint generated always as identity primary key,
  owner_id uuid references public.profiles(id) on delete cascade,
  kept_car_id uuid not null,
  -- The whole removed car as it was, and what moved to the kept one: enough to undo by hand.
  dropped_car jsonb not null,
  moved_bookings uuid[] not null default '{}',
  moved_reports uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.car_merges enable row level security;
grant select on public.car_merges to authenticated;
create policy car_merges_own on public.car_merges for select to authenticated using (owner_id = auth.uid() or public.is_admin());

-- merge_cars(keep, drop, request): the owner keeps one of two copies of the same car. Only cars that
-- are the same vehicle by the rule above (`car_merge_invalid` otherwise); the kept car takes what it
-- lacks from the other (VIN, year, document dates, oil), the bookings and reports move to it, the
-- copy goes. One transaction, logged.
create function public.merge_cars(p_keep uuid, p_drop uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_keep public.cars%rowtype;
  v_drop public.cars%rowtype;
  v_bookings uuid[];
  v_reports uuid[];
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'merge_cars');
  if v_seen is not null then
    return v_seen;
  end if;
  perform pg_advisory_xact_lock(hashtext('car-owner:' || auth.uid()::text));
  select * into v_keep from public.cars where id = p_keep and owner_id = auth.uid() for update;
  select * into v_drop from public.cars where id = p_drop and owner_id = auth.uid() for update;
  if v_keep.id is null or v_drop.id is null then
    perform public.fail('car_not_found');
  end if;
  if v_keep.id = v_drop.id
     or not ((v_keep.vin is not null and v_keep.vin = v_drop.vin)
             or (v_keep.plate_norm is not null and v_keep.plate_norm = v_drop.plate_norm
                 and not (v_keep.vin is not null and v_drop.vin is not null and v_keep.vin <> v_drop.vin))) then
    perform public.fail('car_merge_invalid');
  end if;

  -- What moves, read first for the log, then moved.
  select coalesce(array_agg(b.id order by b.id), '{}') into v_bookings from public.bookings b where b.car_id = v_drop.id;
  select coalesce(array_agg(h.id order by h.id), '{}') into v_reports from public.history_reports h where h.car_id = v_drop.id;
  update public.bookings set car_id = v_keep.id where car_id = v_drop.id;
  update public.history_reports set car_id = v_keep.id where car_id = v_drop.id;

  insert into public.car_merges (owner_id, kept_car_id, dropped_car, moved_bookings, moved_reports)
  values (auth.uid(), v_keep.id, to_jsonb(v_drop), v_bookings, v_reports);
  delete from public.cars where id = v_drop.id;
  -- The copy is gone: now the kept car may take what it lacked.
  update public.cars set
    vin = coalesce(v_keep.vin, v_drop.vin),
    year = coalesce(v_keep.year, v_drop.year),
    itp_expiry = coalesce(v_keep.itp_expiry, v_drop.itp_expiry),
    rca_expiry = coalesce(v_keep.rca_expiry, v_drop.rca_expiry),
    vignette_expiry = coalesce(v_keep.vignette_expiry, v_drop.vignette_expiry)
  where id = v_keep.id;
  v_result := jsonb_build_object('kept', v_keep.id, 'dropped', v_drop.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.merge_cars(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_cars(uuid, uuid, uuid) to authenticated;

-- What looks duplicated today (Admin): the same owner's cars with the same VIN or plate, a company's
-- active vehicles with the same VIN. A list for a decision; nothing is changed.
-- Two records are one car: the same VIN; else the same plate, unless both carry two different VINs.
create function public.car_same(p_vin_a text, p_plate_a text, p_vin_b text, p_plate_b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_vin_a is not null and p_vin_a = p_vin_b)
      or (p_plate_a is not null and p_plate_a = p_plate_b and not (p_vin_a is not null and p_vin_b is not null and p_vin_a <> p_vin_b))
$$;
revoke execute on function public.car_same(text, text, text, text) from public, anon, authenticated;

create function public.admin_vehicle_duplicates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'personal', coalesce((
      -- One group per car that has copies, anchored on its oldest record (the rule of car_match).
      select jsonb_agg(g order by g->>'email', g->>'key')
      from (
        select jsonb_build_object(
                 'owner_id', a.owner_id,
                 'email', (select lower(u.email) from auth.users u where u.id = a.owner_id),
                 'key', coalesce(a.vin, a.plate_norm),
                 'cars', (select jsonb_agg(jsonb_build_object('id', c.id, 'make', c.make, 'model', c.model, 'plate', c.plate, 'vin', c.vin,
                            'bookings', (select count(*) from public.bookings b where b.car_id = c.id)) order by c.created_at, c.id)
                          from public.cars c
                          where c.owner_id = a.owner_id and (c.id = a.id or public.car_same(a.vin, a.plate_norm, c.vin, c.plate_norm)))) g
        from public.cars a
        where exists (select 1 from public.cars d where d.owner_id = a.owner_id and d.id <> a.id
                        and public.car_same(a.vin, a.plate_norm, d.vin, d.plate_norm))
          and not exists (select 1 from public.cars d where d.owner_id = a.owner_id and (d.created_at, d.id) < (a.created_at, a.id)
                            and public.car_same(a.vin, a.plate_norm, d.vin, d.plate_norm))
      ) x), '[]'::jsonb),
    'company', coalesce((
      select jsonb_agg(g order by g->>'company', g->>'vin')
      from (
        select jsonb_build_object(
                 'company_id', cv.company_id,
                 'company', (select co.name from public.companies co where co.id = cv.company_id),
                 'vin', public.normalize_code(cv.vin),
                 'vehicles', jsonb_agg(jsonb_build_object('id', cv.id, 'make', cv.make, 'model', cv.model, 'plate', cv.plate) order by cv.created_at)) g
        from public.company_vehicles cv
        where cv.archived_at is null and cv.vin is not null
        group by cv.company_id, public.normalize_code(cv.vin)
        having count(*) > 1
      ) y), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_vehicle_duplicates() from public, anon;
grant execute on function public.admin_vehicle_duplicates() to authenticated;

update public.schema_version set version = 99;
