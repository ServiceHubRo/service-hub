-- T03 · 1/3 — Booking engine: shared RPC plumbing (errors, idempotency, thread messages, outbox),
-- the bookings safety trigger (never in the past, capacity), availability, and the booking
-- transitions up to the inspection. ARCHITECTURE §3, §4, §5, §6.
--
-- Every RPC here: security definer, search_path pinned, checks the caller, locks the booking row,
-- validates the current status, records p_request_id, writes the thread message and the outbox
-- event in the same transaction, and raises only stable error codes (message = code, detail = JSON
-- parameters) that src/data/rpc.ts maps to translated text.

-- ---------------------------------------------------------------------------------------------
-- Errors
-- ---------------------------------------------------------------------------------------------

-- Raises a business error: message = stable code, detail = JSON parameters for the translation.
create function public.fail(p_code text, p_params jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = coalesce(p_params, '{}'::jsonb)::text;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Time. Booking date + slot are local Europe/Bucharest wall-clock time.
-- ---------------------------------------------------------------------------------------------
create function public.slot_starts_at(p_date date, p_slot time)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_date + p_slot) at time zone 'Europe/Bucharest'
$$;

create function public.bucharest_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Bucharest')::date
$$;

-- Active statuses count toward capacity and the abuse limits (§3).
create function public.is_active_status(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
$$;

-- A limit from platform_settings.limits, with the documented default if the key is missing.
create function public.app_limit(p_key text, p_default int)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce((select (ps.limits->>p_key)::int from public.platform_settings ps where ps.id = 1), p_default)
$$;

-- ---------------------------------------------------------------------------------------------
-- Caller checks
-- ---------------------------------------------------------------------------------------------

-- The signed-in caller's profile; refuses anonymous and suspended accounts.
create function public.require_caller()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  select * into v from public.profiles where id = auth.uid();
  if not found then
    perform public.fail('not_signed_in');
  end if;
  if v.suspended then
    perform public.fail('account_suspended');
  end if;
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Idempotency (CLAUDE.md §6.7). request_begin claims the request id for this caller and function;
-- a second call with the same id waits for the first to commit and gets its stored result.
-- If the first call failed, its claim was rolled back with it, so a retry runs normally.
-- ---------------------------------------------------------------------------------------------
create function public.request_begin(p_request_id uuid, p_fn text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v public.request_log%rowtype;
begin
  if p_request_id is null then
    perform public.fail('request_id_required');
  end if;
  insert into public.request_log (request_id, user_id, fn)
  values (p_request_id, auth.uid(), p_fn)
  on conflict (request_id) do nothing;
  if found then
    return null; -- first time: go ahead
  end if;
  select * into v from public.request_log where request_id = p_request_id;
  if v.user_id is distinct from auth.uid() or v.fn <> p_fn then
    perform public.fail('request_id_reused');
  end if;
  return coalesce(v.result, 'null'::jsonb);
end
$$;

create function public.request_finish(p_request_id uuid, p_result jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.request_log set result = p_result where request_id = p_request_id
$$;

-- ---------------------------------------------------------------------------------------------
-- Threads, automatic messages, outbox
-- ---------------------------------------------------------------------------------------------

-- The one thread of a (shop, client) pair, created on demand.
create function public.ensure_thread(p_shop_id uuid, p_client_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.threads where shop_id = p_shop_id and client_id = p_client_id;
  if v_id is null then
    insert into public.threads (shop_id, client_id, client_name)
    values (p_shop_id, p_client_id, (select name from public.profiles where id = p_client_id))
    on conflict (shop_id, client_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.threads where shop_id = p_shop_id and client_id = p_client_id;
    end if;
  end if;
  return v_id;
end
$$;

-- Automatic message (event + parameters, rendered in the reader's language) in the booking's
-- thread. `params.by` says who caused it (client / shop / admin / system), so the UI does not count
-- it as unread for that side.
create function public.post_booking_event(p_booking public.bookings, p_event text, p_by text, p_params jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_thread uuid;
begin
  if p_booking.client_id is null then
    return; -- client account deleted: no thread to write into
  end if;
  v_thread := public.ensure_thread(p_booking.shop_id, p_booking.client_id);
  insert into public.messages (thread_id, kind, event, params, booking_id)
  values (v_thread, 'system', p_event,
          jsonb_build_object('ref', p_booking.ref, 'by', p_by) || coalesce(p_params, '{}'::jsonb),
          p_booking.id);
  update public.threads set last_message_at = now() where id = v_thread;
end
$$;

-- Outbox event for one recipient (dispatched by the notifications Edge Function, T12).
create function public.notify_user(p_user_id uuid, p_event text, p_params jsonb, p_booking_id uuid,
                                   p_channels text[] default array['push'])
returns void
language sql
set search_path = ''
as $$
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  select p_user_id, p_event, coalesce(p_params, '{}'::jsonb), p_booking_id, p_channels
  where p_user_id is not null
$$;

-- Outbox event for every member of a shop except the one who caused it. The owner's copy may
-- carry extra channels (SMS for a new booking request).
create function public.notify_shop(p_shop_id uuid, p_event text, p_params jsonb, p_booking_id uuid,
                                   p_owner_channels text[] default array['push'])
returns void
language sql
set search_path = ''
as $$
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  select st.user_id, p_event, coalesce(p_params, '{}'::jsonb), p_booking_id,
         case when st.role = 'owner' then p_owner_channels else array['push'] end
  from public.shop_staff st
  where st.shop_id = p_shop_id
    and st.user_id is not null
    and st.accepted_at is not null
    and st.user_id is distinct from auth.uid()
$$;

-- Parameters every booking notification carries, so the dispatcher can render it without joins.
create function public.booking_event_params(p_booking public.bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'booking_id', p_booking.id,
    'ref', p_booking.ref,
    'shop_id', p_booking.shop_id,
    'shop_name', (select s.name from public.shops s where s.id = p_booking.shop_id),
    'client_name', p_booking.client_name,
    'service_id', p_booking.service_id,
    'date', p_booking.date,
    'slot', to_char(p_booking.slot, 'HH24:MI'),
    'make', p_booking.car_snapshot->>'make',
    'model', p_booking.car_snapshot->>'model',
    'plate', p_booking.car_snapshot->>'plate'
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Booking row access for the RPCs: locks the row and checks the caller's side.
-- ---------------------------------------------------------------------------------------------
create function public.lock_booking_as_shop(p_booking_id uuid)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
begin
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  if not public.is_shop_member(v.shop_id) then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;

create function public.lock_booking_as_client(p_booking_id uuid)
returns public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
begin
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  if v.client_id is distinct from auth.uid() then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;

create function public.require_status(p_booking public.bookings, variadic p_allowed text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not (p_booking.status = any (p_allowed)) then
    perform public.fail('wrong_status', jsonb_build_object('status', p_booking.status));
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Slot rules (§4). Raises the first rule a (date, slot) breaks for this shop, or returns quietly.
-- Client rules also apply the shop's minimum notice and maximum advance; a shop rescheduling its
-- own booking is bound only by its hours, closures and capacity. The caller must already hold the
-- shop row lock, so the counts cannot change before the write.
-- ---------------------------------------------------------------------------------------------
create function public.check_slot(p_shop public.shops, p_date date, p_slot time, p_exclude_booking uuid,
                                  p_client_rules boolean)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hours public.shop_hours%rowtype;
  v_start timestamptz := public.slot_starts_at(p_date, p_slot);
  v_day int;
  v_at_slot int;
begin
  if p_date is null or p_slot is null then
    perform public.fail('invalid_slot');
  end if;
  if v_start <= now() then
    perform public.fail('past_slot');
  end if;
  if p_client_rules then
    if v_start < now() + make_interval(hours => p_shop.min_notice_hours) then
      perform public.fail('too_soon', jsonb_build_object('hours', p_shop.min_notice_hours));
    end if;
    if p_date > public.bucharest_today() + p_shop.max_advance_days then
      perform public.fail('too_far', jsonb_build_object('days', p_shop.max_advance_days));
    end if;
  end if;

  select * into v_hours from public.shop_hours
  where shop_id = p_shop.id and weekday = extract(dow from p_date)::int;
  if not found or v_hours.is_closed then
    perform public.fail('shop_closed');
  end if;
  if exists (select 1 from public.shop_closures c
             where c.shop_id = p_shop.id and p_date between c.start_date and c.end_date) then
    perform public.fail('shop_closed');
  end if;
  -- On the shop's grid: open_time, open_time + slot, … up to close_time − slot.
  if p_slot < v_hours.open_time
     or extract(epoch from p_slot) + p_shop.slot_minutes * 60 > extract(epoch from v_hours.close_time)
     or (extract(epoch from (p_slot - v_hours.open_time))::int / 60) % p_shop.slot_minutes <> 0 then
    perform public.fail('invalid_slot');
  end if;

  select count(*) filter (where true), count(*) filter (where b.slot = p_slot)
    into v_day, v_at_slot
  from public.bookings b
  where b.shop_id = p_shop.id and b.date = p_date and public.is_active_status(b.status)
    and b.id is distinct from p_exclude_booking;
  if v_day >= p_shop.daily_capacity then
    perform public.fail('day_full');
  end if;
  if v_at_slot >= p_shop.cars_per_slot then
    perform public.fail('slot_full');
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Safety net on the table itself: whatever path writes a booking (RPC, service role, SQL editor),
-- an active booking can never be placed in the past or beyond the day / slot capacity.
-- Checked when a booking becomes active or moves (date, slot, shop). Status changes of a booking
-- that stays where it is are not re-checked, so today's car can still be inspected after 09:00,
-- and finished bookings in the past (history, demo seed) load freely.
-- ---------------------------------------------------------------------------------------------
create function public.bookings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_day int;
  v_at_slot int;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;

  if not public.is_active_status(new.status) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and public.is_active_status(old.status)
     and new.shop_id = old.shop_id and new.date = old.date and new.slot = old.slot then
    return new;
  end if;

  if public.slot_starts_at(new.date, new.slot) <= now() then
    perform public.fail('past_slot');
  end if;

  -- Serializes concurrent writers for this shop (the RPCs already hold this lock).
  select * into v_shop from public.shops where id = new.shop_id for no key update;
  select count(*), count(*) filter (where b.slot = new.slot)
    into v_day, v_at_slot
  from public.bookings b
  where b.shop_id = new.shop_id and b.date = new.date and public.is_active_status(b.status)
    and b.id <> new.id;
  if v_day >= v_shop.daily_capacity then
    perform public.fail('day_full');
  end if;
  if v_at_slot >= v_shop.cars_per_slot then
    perform public.fail('slot_full');
  end if;
  return new;
end
$$;

create trigger bookings_guard before insert or update on public.bookings
  for each row execute function public.bookings_guard();

-- ---------------------------------------------------------------------------------------------
-- get_availability(shop, from, days[, slots_for]) — the UI never counts bookings itself (§4).
-- Returns {"days": [...], "slots": [...]}:
--   day:  {date, bookable, places_left, reason}   reason: closed | closure | too_far | full | no_slots
--   slot: {time, taken, capacity, available, reason}   reason: past | too_soon | full
-- `slots` is filled only when p_slots_for is given. Members of the shop get the shop rules
-- (no minimum notice, no maximum advance), everyone else the client rules.
-- ---------------------------------------------------------------------------------------------
create function public.get_availability(p_shop_id uuid, p_from date default null, p_days int default 14,
                                        p_slots_for date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_member boolean;
  v_today date := public.bucharest_today();
  v_from date := greatest(coalesce(p_from, public.bucharest_today()), public.bucharest_today());
  v_days int := least(greatest(coalesce(p_days, 14), 1), 366);
  v_notice interval;
  v_max_date date;
  v_result_days jsonb;
  v_result_slots jsonb := '[]'::jsonb;
begin
  perform public.require_caller();
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or not public.can_read_shop(p_shop_id) then
    perform public.fail('shop_not_found');
  end if;
  v_member := public.is_shop_member(p_shop_id);
  v_notice := case when v_member then interval '0' else make_interval(hours => v_shop.min_notice_hours) end;
  v_max_date := case when v_member then v_today + 366 else v_today + v_shop.max_advance_days end;

  with days as (
    select v_from + i as day from generate_series(0, v_days - 1) i
  ),
  day_info as (
    select
      dy.day,
      h.is_closed or h.weekday is null as closed,
      exists (select 1 from public.shop_closures c
              where c.shop_id = p_shop_id and dy.day between c.start_date and c.end_date) as closure,
      h.open_time, h.close_time,
      (select count(*) from public.bookings b
       where b.shop_id = p_shop_id and b.date = dy.day and public.is_active_status(b.status))::int as booked
    from days dy
    left join public.shop_hours h on h.shop_id = p_shop_id and h.weekday = extract(dow from dy.day)::int
  ),
  slot_info as (
    select di.day, s.t::time as slot
    from day_info di
    cross join lateral generate_series(
      di.day + di.open_time,
      di.day + di.close_time - make_interval(mins => v_shop.slot_minutes),
      make_interval(mins => v_shop.slot_minutes)) s(t)
    where not di.closed and not di.closure
  ),
  free_slots as (
    select si.day, count(*)::int as n
    from slot_info si
    where public.slot_starts_at(si.day, si.slot) >= now() + v_notice
      and (select count(*) from public.bookings b
           where b.shop_id = p_shop_id and b.date = si.day and b.slot = si.slot
             and public.is_active_status(b.status)) < v_shop.cars_per_slot
    group by si.day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', di.day,
      'places_left', greatest(v_shop.daily_capacity - di.booked, 0),
      'reason', r.reason,
      'bookable', r.reason is null
    ) order by di.day), '[]'::jsonb)
  into v_result_days
  from day_info di
  left join free_slots fs on fs.day = di.day
  cross join lateral (select case
      when di.closed then 'closed'
      when di.closure then 'closure'
      when di.day > v_max_date then 'too_far'
      when di.booked >= v_shop.daily_capacity then 'full'
      when coalesce(fs.n, 0) = 0 then 'no_slots'
    end as reason) r;

  if p_slots_for is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'time', to_char(x.slot, 'HH24:MI'),
        'taken', x.taken,
        'capacity', v_shop.cars_per_slot,
        'reason', x.reason,
        'available', x.reason is null
      ) order by x.slot), '[]'::jsonb)
    into v_result_slots
    from (
      select s.t::time as slot, tk.taken,
             case
               when public.slot_starts_at(p_slots_for, s.t::time) <= now() then 'past'
               when public.slot_starts_at(p_slots_for, s.t::time) < now() + v_notice then 'too_soon'
               when tk.taken >= v_shop.cars_per_slot then 'full'
               when day_booked.n >= v_shop.daily_capacity then 'full'
               when p_slots_for > v_max_date then 'too_far'
             end as reason
      from public.shop_hours h
      cross join lateral generate_series(
        p_slots_for + h.open_time,
        p_slots_for + h.close_time - make_interval(mins => v_shop.slot_minutes),
        make_interval(mins => v_shop.slot_minutes)) s(t)
      cross join lateral (
        select count(*)::int as taken from public.bookings b
        where b.shop_id = p_shop_id and b.date = p_slots_for and b.slot = s.t::time
          and public.is_active_status(b.status)) tk
      cross join lateral (
        select count(*)::int as n from public.bookings b
        where b.shop_id = p_shop_id and b.date = p_slots_for and public.is_active_status(b.status)) day_booked
      where h.shop_id = p_shop_id
        and h.weekday = extract(dow from p_slots_for)::int
        and not h.is_closed
        and not exists (select 1 from public.shop_closures c
                        where c.shop_id = p_shop_id and p_slots_for between c.start_date and c.end_date)
    ) x;
  end if;

  return jsonb_build_object('days', v_result_days, 'slots', v_result_slots);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- create_booking — client → pending (§3, §4, §5, §6).
-- Car: p_car_id (from the garage) or p_car {make, model, year, plate, vin}; p_save_car stores the
-- typed car in the garage. The booking snapshots the client and the car.
-- ---------------------------------------------------------------------------------------------
create function public.create_booking(
  p_shop_id uuid,
  p_service_id text,
  p_date date,
  p_slot time,
  p_request_id uuid,
  p_car_id uuid default null,
  p_car jsonb default null,
  p_save_car boolean default false,
  p_note text default null
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
  v_snapshot jsonb;
  v_note text := nullif(btrim(p_note), '');
  v_booking public.bookings%rowtype;
  v_year int;
  v_plate text;
  v_vin text;
  v_params jsonb;
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

  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  -- Car: from the garage, or typed in.
  if p_car_id is not null then
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

  -- Abuse limits (§6).
  if (select count(*) from public.bookings b
      where b.client_id = v_me.id and b.shop_id = p_shop_id and public.is_active_status(b.status))
     >= public.app_limit('active_bookings_per_shop', 3) then
    perform public.fail('limit_active_shop', jsonb_build_object('limit', public.app_limit('active_bookings_per_shop', 3)));
  end if;
  if (select count(*) from public.bookings b
      where b.client_id = v_me.id and public.is_active_status(b.status))
     >= public.app_limit('active_bookings_total', 10) then
    perform public.fail('limit_active_total', jsonb_build_object('limit', public.app_limit('active_bookings_total', 10)));
  end if;
  if (select count(*) from public.bookings b
      where b.client_id = v_me.id and b.created_at > now() - interval '24 hours')
     >= public.app_limit('new_bookings_per_24h', 5) then
    perform public.fail('limit_daily', jsonb_build_object('limit', public.app_limit('new_bookings_per_24h', 5)));
  end if;

  insert into public.bookings (
    shop_id, client_id, service_id, client_name, client_phone, client_lang, car_id, car_snapshot,
    date, slot, note, status
  ) values (
    p_shop_id, v_me.id, p_service_id, v_me.name, v_me.phone, v_me.lang, v_car.id, v_snapshot,
    p_date, p_slot, v_note, 'pending'
  )
  returning * into v_booking;

  v_params := public.booking_event_params(v_booking);
  perform public.post_booking_event(v_booking, 'booking_requested', 'client');
  perform public.notify_shop(v_booking.shop_id, 'booking_requested', v_params, v_booking.id,
    case when v_shop.sms_on_new_booking then array['push', 'sms'] else array['push'] end);

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Shop: confirm, decline, reschedule, cancel, no-show, start inspection.
-- ---------------------------------------------------------------------------------------------
create function public.confirm_booking(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'confirm_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'pending');

  update public.bookings set status = 'confirmed', confirmed_at = now()
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'booking_confirmed', 'shop',
    jsonb_build_object('date', v.date, 'slot', to_char(v.slot, 'HH24:MI')));
  perform public.notify_user(v.client_id, 'booking_confirmed', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

create function public.decline_booking(p_booking_id uuid, p_request_id uuid, p_reason text default null)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'decline_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'pending');
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;

  update public.bookings set status = 'declined', decline_reason = v_reason
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'booking_declined', 'shop',
    jsonb_strip_nulls(jsonb_build_object('reason', v_reason)));
  perform public.notify_user(v.client_id, 'booking_declined',
    public.booking_event_params(v) || jsonb_strip_nulls(jsonb_build_object('reason', v_reason)), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- pending / confirmed → confirmed on a new day and time. Re-checks the slot at submit; on
-- past_slot / day_full / slot_full the booking is left exactly as it was.
create function public.reschedule_booking(p_booking_id uuid, p_date date, p_slot time, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_shop public.shops%rowtype;
  v_old_date date;
  v_old_slot time;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'reschedule_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'pending', 'confirmed');

  select * into v_shop from public.shops where id = v.shop_id for no key update;
  perform public.check_slot(v_shop, p_date, p_slot, v.id, false);

  v_old_date := v.date;
  v_old_slot := v.slot;
  update public.bookings
    set status = 'confirmed', date = p_date, slot = p_slot,
        confirmed_at = coalesce(confirmed_at, now()), reminder_sent_at = null
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'booking_rescheduled', 'shop', jsonb_build_object(
    'old_date', v_old_date, 'old_slot', to_char(v_old_slot, 'HH24:MI'),
    'date', v.date, 'slot', to_char(v.slot, 'HH24:MI')));
  perform public.notify_user(v.client_id, 'booking_rescheduled',
    public.booking_event_params(v) || jsonb_build_object('old_date', v_old_date, 'old_slot', to_char(v_old_slot, 'HH24:MI')),
    v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- Client cancels. A pending request can always be withdrawn; a confirmed booking only before
-- date + slot − cancel_deadline_hours (0 = any time).
create function public.cancel_booking(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_deadline int;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'cancel_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_client(p_booking_id);
  perform public.require_status(v, 'pending', 'confirmed');

  select cancel_deadline_hours into v_deadline from public.shops where id = v.shop_id;
  if v.status = 'confirmed' and v_deadline > 0
     and now() > public.slot_starts_at(v.date, v.slot) - make_interval(hours => v_deadline) then
    perform public.fail('cancel_deadline_passed', jsonb_build_object('hours', v_deadline));
  end if;

  update public.bookings set status = 'cancelled', cancelled_by = 'client', cancelled_at = now()
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'booking_cancelled_client', 'client');
  perform public.notify_shop(v.shop_id, 'booking_cancelled_client', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- Shop cancels a confirmed booking; the reason is required and goes into the message.
create function public.shop_cancel_booking(p_booking_id uuid, p_reason text, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'shop_cancel_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'confirmed');
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;

  update public.bookings
    set status = 'cancelled', cancelled_by = 'shop', cancelled_at = now(), cancel_reason = v_reason
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'booking_cancelled_shop', 'shop', jsonb_build_object('reason', v_reason));
  perform public.notify_user(v.client_id, 'booking_cancelled_shop',
    public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- Confirmed → no_show, only once the slot time has passed.
create function public.mark_no_show(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'mark_no_show');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'confirmed');
  if public.slot_starts_at(v.date, v.slot) > now() then
    perform public.fail('too_early');
  end if;

  update public.bookings set status = 'no_show' where id = v.id returning * into v;

  perform public.post_booking_event(v, 'no_show', 'shop');
  perform public.notify_user(v.client_id, 'no_show', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- Confirmed → in_inspection: the car has arrived.
create function public.start_inspection(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'start_inspection');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'confirmed');

  update public.bookings set status = 'in_inspection', inspection_started_at = now()
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'inspection_started', 'shop');
  perform public.notify_user(v.client_id, 'inspection_started', public.booking_event_params(v), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin: any active booking → cancelled, with a reason; both sides notified; audit log.
-- ---------------------------------------------------------------------------------------------
create function public.admin_force_cancel(p_booking_id uuid, p_reason text, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_before jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_params jsonb;
begin
  perform public.require_caller();
  if not public.is_admin() then
    perform public.fail('not_allowed');
  end if;
  v_seen := public.request_begin(p_request_id, 'admin_force_cancel');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  if not public.is_active_status(v.status) then
    perform public.fail('wrong_status', jsonb_build_object('status', v.status));
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  v_before := jsonb_build_object('status', v.status);

  -- A quote still waiting for the client is closed with the booking.
  update public.quotes set status = 'withdrawn', decided_at = now()
  where booking_id = v.id and status = 'sent';
  update public.bookings
    set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), cancel_reason = v_reason
  where id = v.id returning * into v;

  v_params := public.booking_event_params(v) || jsonb_build_object('reason', v_reason);
  perform public.post_booking_event(v, 'booking_cancelled_admin', 'admin', jsonb_build_object('reason', v_reason));
  perform public.notify_user(v.client_id, 'booking_cancelled_admin', v_params, v.id);
  perform public.notify_shop(v.shop_id, 'booking_cancelled_admin', v_params, v.id);
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
  values (auth.uid(), 'admin_force_cancel', 'booking', v.id::text, v_before,
          jsonb_build_object('status', v.status, 'reason', v_reason));
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

grant execute on function
  public.get_availability(uuid, date, int, date),
  public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text),
  public.confirm_booking(uuid, uuid),
  public.decline_booking(uuid, uuid, text),
  public.reschedule_booking(uuid, date, time, uuid),
  public.cancel_booking(uuid, uuid),
  public.shop_cancel_booking(uuid, text, uuid),
  public.mark_no_show(uuid, uuid),
  public.start_inspection(uuid, uuid),
  public.admin_force_cancel(uuid, text, uuid)
to authenticated;

update public.schema_version set version = 7;
