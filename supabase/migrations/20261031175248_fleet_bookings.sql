-- T63d — company bookings and quote approvals (docs/FLEET_PLAN.md §3.3; approved by Eduard on
-- 31 Oct 2026, together with: "doar administratorul are voie să modifice chestii importante în cont,
-- la fel ca la service" — the company's settings, members, rules and subscription stay admin-only).
--
-- · bookings.company_id / company_vehicle_id: a booking made for one of a company's vehicles. For the
--   shop it is an ordinary booking; the member who booked is its client (messages, reminders and the
--   thread stay theirs). Both columns are written only by create_booking.
-- · create_booking(…, p_company_vehicle_id): admin, manager, and a driver for the vehicle assigned to
--   them; the vehicle's details are the car snapshot; company limits (platform_settings.limits
--   fleet_*) replace the personal ones, and personal limits no longer count company bookings.
--   A company in read-only (billing on, trial over) cannot book.
-- · One active booking per vehicle at a shop, whoever in the company booked it.
-- · decide_quote refuses company bookings (`fleet_use_company_approval`): a driver who booked a
--   company car cannot approve its quote, not even through the API.
-- · fleet_decide_quote: admin, or a manager up to the company's limit (`fleet_over_limit {limit}`);
--   then the same path as decide_quote, plus quotes.decided_by_user, a company_quote_decisions row
--   and a company_audit_log row, in one transaction. Open quotes stay decidable in read-only
--   (Eduard's access policy, 31 Oct).
-- · fleet_overview adds the company's bookings (`jobs`): drivers only their vehicles' and their own,
--   without any amount or quote.
-- · fleet_bookable_vehicles(): the company vehicles the caller may book, for the booking flow.
-- · Company bookings are readable (and live) for the members who see all bookings.

-- ---------------------------------------------------------------------------------------------
-- Columns and the decision log
-- ---------------------------------------------------------------------------------------------
alter table public.bookings
  add column company_id uuid references public.companies(id) on delete set null,
  add column company_vehicle_id uuid references public.company_vehicles(id) on delete set null;
create index bookings_company_idx on public.bookings (company_id, date desc) where company_id is not null;
create index bookings_company_vehicle_idx on public.bookings (company_vehicle_id) where company_vehicle_id is not null;

-- Who in the company decided (the person; `decided_by` stays 'client' for the client's side).
alter table public.quotes add column decided_by_user uuid references public.profiles(id) on delete set null;

create table public.company_quote_decisions (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null,
  decision text not null check (decision in ('approved', 'partially_approved', 'refused')),
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index company_quote_decisions_company_idx on public.company_quote_decisions (company_id, created_at desc);
alter table public.company_quote_decisions enable row level security;
-- Read through fleet_overview only; written only by fleet_decide_quote.
revoke all on public.company_quote_decisions from public, anon, authenticated;

-- Members who see all of the company's bookings read their rows (and get them live).
create policy bookings_select_company on public.bookings for select to authenticated
  using (company_id is not null and public.fleet_can(company_id, 'bookings.viewAll'));

-- Company limits (Setări platformă): active bookings in all, at one shop, new ones in 24 hours.
update public.platform_settings
  set limits = limits || '{"fleet_active_bookings_total": 100, "fleet_active_bookings_per_shop": 20, "fleet_new_bookings_per_24h": 30}'::jsonb
where id = 1;

create or replace function public.limit_range(p_key text)
returns int4range
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'active_bookings_per_shop' then int4range(1, 20, '[]')
    when 'active_bookings_total' then int4range(1, 100, '[]')
    when 'new_bookings_per_24h' then int4range(1, 100, '[]')
    when 'messages_per_thread_per_hour' then int4range(1, 500, '[]')
    when 'review_window_days' then int4range(1, 365, '[]')
    when 'quote_versions_max' then int4range(1, 100, '[]')
    when 'no_shows_before_phone' then int4range(1, 20, '[]')
    when 'no_shows_before_ack' then int4range(1, 20, '[]')
    when 'no_show_grace_minutes' then int4range(0, 120, '[]')
    when 'quiet_hours_start' then int4range(0, 23, '[]')
    when 'quiet_hours_end' then int4range(0, 23, '[]')
    when 'promo_per_week' then int4range(0, 7, '[]')
    when 'request_reminder_hours' then int4range(1, 24, '[]')
    when 'company_fix_days' then int4range(1, 90, '[]')
    when 'company_recheck_days' then int4range(7, 365, '[]')
    when 'referral_credits_per_year' then int4range(0, 12, '[]')
    when 'referral_friends_per_report' then int4range(1, 10, '[]')
    when 'fleet_active_bookings_total' then int4range(1, 1000, '[]')
    when 'fleet_active_bookings_per_shop' then int4range(1, 200, '[]')
    when 'fleet_new_bookings_per_24h' then int4range(1, 500, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Rights: a driver books (the vehicle assigned to them only — checked by create_booking)
-- ---------------------------------------------------------------------------------------------
create or replace function public.fleet_role_can(p_role text, p_capability text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'admin' then true
    when 'manager' then p_capability = any (array['vehicles.viewAll','vehicles.manage','bookings.create','bookings.viewAll',
      'quotes.approve','costs.view','costs.manage','reports.view','documents.view','documents.manage','issues.report','issues.manage'])
    when 'driver' then p_capability = any (array['bookings.create','issues.report','documents.view'])
    when 'accountant' then p_capability = any (array['vehicles.viewAll','bookings.viewAll','costs.view','costs.manage',
      'reports.view','documents.view','audit.view'])
    else false
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- One active booking per car at a shop: for a company vehicle, among the company's bookings
-- ---------------------------------------------------------------------------------------------
create or replace function public.bookings_car_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate text := nullif(new.car_snapshot->>'plate_norm', '');
  v_other record;
  v_by_client boolean := new.client_id is not null and auth.uid() = new.client_id;
begin
  if auth.uid() is null or new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  if v_plate is null and new.car_id is null and new.company_vehicle_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('booking-car:' || coalesce(v_plate, new.car_id::text, new.company_vehicle_id::text)));

  select b.ref, b.date, b.slot into v_other
  from public.bookings b
  where b.shop_id = new.shop_id
    and case when new.company_id is not null then b.company_id = new.company_id
             when v_by_client then b.client_id = new.client_id
             else true end
    and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
    and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
         or (new.car_id is not null and b.car_id = new.car_id)
         or (new.company_vehicle_id is not null and b.company_vehicle_id = new.company_vehicle_id))
  order by b.date, b.slot
  limit 1;
  if found then
    perform public.fail('car_already_booked', jsonb_build_object(
      'ref', v_other.ref, 'date', v_other.date, 'slot', to_char(v_other.slot, 'HH24:MI')));
  end if;

  if v_by_client and exists (
    select 1 from public.bookings b
    where b.shop_id <> new.shop_id
      and case when new.company_id is not null then b.company_id = new.company_id else b.client_id = new.client_id end
      and b.date = new.date
      and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
      and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
           or (new.car_id is not null and b.car_id = new.car_id)
           or (new.company_vehicle_id is not null and b.company_vehicle_id = new.company_vehicle_id))) then
    perform public.fail('car_booked_that_day', jsonb_build_object('date', new.date));
  end if;
  return new;
end
$$;
revoke execute on function public.bookings_car_rule() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- create_booking takes a company vehicle (p_company_vehicle_id). Same body as before otherwise.
-- ---------------------------------------------------------------------------------------------
drop function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean);

create function public.create_booking(
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
    if public.company_role(v_company) = 'driver' and v_vehicle.driver_member_id is distinct from public.my_member_id(v_company) then
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
    if p_save_car then
      insert into public.cars (owner_id, make, model, year, plate, vin)
      values (v_me.id, btrim(p_car->>'make'), btrim(p_car->>'model'), v_year, v_plate, v_vin)
      returning * into v_car;
    else
      v_car.make := btrim(p_car->>'make');
      v_car.model := btrim(p_car->>'model');
      v_car.year := v_year;
      v_car.plate := v_plate;
      v_car.plate_norm := nullif(upper(regexp_replace(coalesce(v_plate, ''), '[\s-]', '', 'g')), '');
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

revoke execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid) from public, anon;
grant execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- decide_quote: never for a company booking (R2). Same body as before otherwise.
-- ---------------------------------------------------------------------------------------------
create or replace function public.decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
  v_ids uuid[] := coalesce(p_approved_item_ids, '{}');
  v_lines int;
  v_approved int;
  v_total numeric;
  v_event text;
  v_params jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'decide_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  if v.company_id is not null then
    perform public.fail('fleet_use_company_approval');
  end if;
  perform public.require_status(v, 'quote_sent');

  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  if v_quote.expires_at is not null and v_quote.expires_at <= now() then
    perform public.fail('quote_expired');
  end if;
  select a.choices, a.approved, a.total into v_lines, v_approved, v_total
  from public.apply_quote_answer(v_quote.id, v_ids) a;

  if v_approved = 0 then
    update public.quotes set status = 'refused', total_approved = 0, decided_at = now() where id = v_quote.id;
    update public.bookings set status = 'quote_refused', cost = v_quote.inspection_fee
    where id = v.id returning * into v;
    v_event := 'quote_refused';
    v_params := jsonb_build_object('quote_id', v_quote.id, 'inspection_fee', v_quote.inspection_fee);
  else
    update public.quotes
      set status = case when v_approved = v_lines then 'accepted' else 'partially_accepted' end,
          total_approved = v_total, decided_at = now()
    where id = v_quote.id;
    update public.bookings set status = 'approved' where id = v.id returning * into v;
    v_event := case when v_approved = v_lines then 'quote_accepted' else 'quote_partially_accepted' end;
    v_params := jsonb_build_object('quote_id', v_quote.id, 'total', v_total, 'total_sent', v_quote.total_sent);
  end if;

  perform public.post_booking_event(v, v_event, 'client', v_params);
  perform public.notify_shop(v.shop_id, v_event, public.booking_event_params(v) || v_params, v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- fleet_decide_quote(booking, quote, approved lines, request) — the company's answer to a quote.
-- ---------------------------------------------------------------------------------------------
create function public.fleet_decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_company public.companies%rowtype;
  v_role text;
  v_quote public.quotes%rowtype;
  v_ids uuid[] := coalesce(p_approved_item_ids, '{}');
  v_lines int;
  v_approved int;
  v_total numeric;
  v_event text;
  v_decision text;
  v_params jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_decide_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found or v.company_id is null or public.company_role(v.company_id) is null then
    perform public.fail('booking_not_found');
  end if;
  v_company := public.require_company(v.company_id, 'quotes.approve');
  v_role := public.company_role(v.company_id);
  perform public.require_status(v, 'quote_sent');

  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  if v_quote.expires_at is not null and v_quote.expires_at <= now() then
    perform public.fail('quote_expired');
  end if;
  select a.choices, a.approved, a.total into v_lines, v_approved, v_total
  from public.apply_quote_answer(v_quote.id, v_ids) a;

  -- A manager approves up to the company's limit (none set = no limit); refusing is always allowed.
  if v_approved > 0 and v_role = 'manager' and v_company.manager_approval_limit is not null
     and v_total > v_company.manager_approval_limit then
    perform public.fail('fleet_over_limit', jsonb_build_object('limit', v_company.manager_approval_limit));
  end if;

  if v_approved = 0 then
    update public.quotes set status = 'refused', total_approved = 0, decided_at = now(), decided_by_user = auth.uid()
    where id = v_quote.id;
    update public.bookings set status = 'quote_refused', cost = v_quote.inspection_fee
    where id = v.id returning * into v;
    v_event := 'quote_refused';
    v_decision := 'refused';
    v_params := jsonb_build_object('quote_id', v_quote.id, 'inspection_fee', v_quote.inspection_fee);
  else
    update public.quotes
      set status = case when v_approved = v_lines then 'accepted' else 'partially_accepted' end,
          total_approved = v_total, decided_at = now(), decided_by_user = auth.uid()
    where id = v_quote.id;
    update public.bookings set status = 'approved' where id = v.id returning * into v;
    v_event := case when v_approved = v_lines then 'quote_accepted' else 'quote_partially_accepted' end;
    v_decision := case when v_approved = v_lines then 'approved' else 'partially_approved' end;
    v_params := jsonb_build_object('quote_id', v_quote.id, 'total', v_total, 'total_sent', v_quote.total_sent);
  end if;

  insert into public.company_quote_decisions (company_id, booking_id, quote_id, user_id, role, decision, amount)
  values (v.company_id, v.id, v_quote.id, auth.uid(), v_role, v_decision, coalesce(v_total, 0));
  perform public.company_audit(v.company_id, 'quote_decided', 'booking', v.id, null,
    jsonb_build_object('quote_id', v_quote.id, 'decision', v_decision, 'amount', coalesce(v_total, 0)));

  perform public.post_booking_event(v, v_event, 'client', v_params);
  perform public.notify_shop(v.shop_id, v_event, public.booking_event_params(v) || v_params, v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.fleet_decide_quote(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.fleet_decide_quote(uuid, uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------
-- One company booking as the fleet screens read it (src/lib/fleet/types.ts FleetJob). Without
-- money (a driver): no cost and no quote.
create function public.fleet_job_json(b public.bookings, p_money boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'vehicle_id', b.company_vehicle_id, 'status', b.status,
    'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'), 'created_at', b.created_at, 'done_at', b.done_at,
    'shop_id', b.shop_id, 'shop_name', s.name, 'shop_city', s.city,
    'service_category', sv.category_key, 'service_name_ro', sv.name_ro, 'service_name_en', sv.name_en,
    'extra_services', public.service_names(b.extra_service_ids),
    'booked_by', b.client_id, 'booked_by_name', coalesce(b.client_name, ''),
    'cost', case when p_money then b.cost end,
    'odometer', b.odometer, 'work', b.work, 'warranty_until', b.warranty_until,
    'quote', case when p_money then (
      select jsonb_build_object(
        'id', q.id, 'version', q.version, 'status', q.status, 'note', q.note,
        'inspection_fee', q.inspection_fee, 'total_sent', q.total_sent, 'total_approved', q.total_approved,
        'sent_at', q.sent_at, 'expires_at', q.expires_at, 'decided_at', q.decided_at,
        'vat_rate', q.vat_rate, 'est_hours', q.est_hours,
        'decided_by_member', q.decided_by_user, 'decided_by_name', dp.name,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'kind', qi.kind,
                   'brand', qi.brand, 'quantity', qi.quantity, 'unit_price', qi.unit_price,
                   'variant', qi.variant, 'option_group', qi.option_group, 'approved', qi.approved)
                 order by qi.position)
          from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb))
      from public.quotes q
      left join public.profiles dp on dp.id = q.decided_by_user
      where q.booking_id = b.id and q.status not in ('superseded', 'withdrawn')
      order by q.version desc
      limit 1) end)
  from public.shops s, public.services sv
  where s.id = b.shop_id and sv.id = b.service_id
$$;
revoke execute on function public.fleet_job_json(public.bookings, boolean) from public, anon, authenticated;

create or replace function public.fleet_overview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_role text;
  v_me uuid;
  v_all boolean;
  v_team boolean;
  v_money boolean;
  v_bookings boolean;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  v_role := public.company_role(p_company);
  if v_company.id is null or v_role is null then
    perform public.fail('company_not_found');
  end if;
  v_me := public.my_member_id(p_company);
  v_all := public.fleet_role_can(v_role, 'vehicles.viewAll');
  v_team := public.fleet_role_can(v_role, 'members.manage') or public.fleet_role_can(v_role, 'vehicles.manage');
  v_money := public.fleet_role_can(v_role, 'costs.view');
  v_bookings := public.fleet_role_can(v_role, 'bookings.viewAll');
  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'vat_id', v_company.vat_id, 'plan_key', 'none',
      -- Money rules only for those who see money.
      'manager_approval_limit', case when v_money then v_company.manager_approval_limit end,
      'budget', jsonb_build_object(
        'monthly', case when v_money then v_company.budget_monthly end,
        'yearly', case when v_money then v_company.budget_yearly end)),
    'me', jsonb_build_object('member_id', v_me, 'role', v_role),
    'vehicles', coalesce((
      select jsonb_agg(public.vehicle_json(cv) order by cv.created_at, cv.id)
      from public.company_vehicles cv
      where cv.company_id = p_company
        and (v_all or (cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'user_id', m.user_id, 'name', coalesce(p.name, ''),
               'email', lower(coalesce(u.email, m.invited_email)), 'role', m.role, 'accepted_at', m.accepted_at)
             order by m.accepted_at nulls last, m.invited_at)
      from public.company_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.company_id = p_company and (v_team or m.user_id = auth.uid())
    ), '[]'::jsonb),
    -- The company's bookings (T63d): all for those who see all; a driver those of the vehicles
    -- assigned to them and their own, without amounts.
    'jobs', coalesce((
      select jsonb_agg(public.fleet_job_json(b, v_money) order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      where b.company_id = p_company
        and (v_bookings
             or b.client_id = auth.uid()
             or b.company_vehicle_id in (
               select cv.id from public.company_vehicles cv
               where cv.company_id = p_company and cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    -- Expenses and issues arrive with T63e / T63f.
    'expenses', '[]'::jsonb,
    'issues', '[]'::jsonb
  );
end
$$;

-- The company vehicles the caller may book, grouped by company (the booking flow's car step).
-- Empty when fleets are off for the caller.
create function public.fleet_bookable_vehicles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.my_fleet_access() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'company_id', c.id, 'company_name', c.name, 'read_only', public.company_read_only(c.id),
             'vehicles', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', cv.id, 'make', cv.make, 'model', cv.model, 'year', cv.year, 'plate', cv.plate)
                      order by cv.plate nulls last, cv.make, cv.model, cv.id), '[]'::jsonb)
               from public.company_vehicles cv
               where cv.company_id = c.id and cv.archived_at is null
                 and (m.role <> 'driver' or cv.driver_member_id = m.id)))
           order by c.name, c.id)
    from public.company_members m
    join public.companies c on c.id = m.company_id and c.archived_at is null
    where m.user_id = auth.uid() and m.accepted_at is not null
      and public.fleet_role_can(m.role, 'bookings.create')
  ), '[]'::jsonb);
end
$$;
revoke execute on function public.fleet_bookable_vehicles() from public, anon;
grant execute on function public.fleet_bookable_vehicles() to authenticated;

update public.schema_version set version = 95;
