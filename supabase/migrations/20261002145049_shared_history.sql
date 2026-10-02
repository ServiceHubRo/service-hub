-- T27 — Fișa mașinii: the shop sees one car's file (every job done on it at this shop) and, when the
-- client agrees, what was done on it at other shops through Service-Hub.
--
-- The agreement is per booking (`bookings.share_history`), off unless the client ticks it when
-- booking or turns it on later from Programări; the client can turn it off at any time. Other shops'
-- jobs are shown only while the client has an active booking for that car at this shop with the
-- agreement on, and only what helps the mechanic: the day, the odometer, the services, the accepted
-- quote lines (names) and the work. Never the price, the other shop's name or city.

alter table public.bookings
  add column share_history boolean not null default false,
  -- When the client last changed the agreement (proof of consent, GDPR art. 7).
  add column share_history_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- create_booking takes the agreement (p_share_history). Same body as before otherwise.
-- ---------------------------------------------------------------------------------------------
drop function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[]);

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
  p_share_history boolean default false
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
    shop_id, client_id, service_id, extra_service_ids, client_name, client_phone, client_lang, car_id, car_snapshot,
    date, slot, note, status, share_history, share_history_at
  ) values (
    p_shop_id, v_me.id, p_service_id, v_extra, v_me.name, v_me.phone, v_me.lang, v_car.id, v_snapshot,
    p_date, p_slot, v_note, 'pending', v_share, case when v_share then now() end
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

revoke execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean) from public, anon;
grant execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- set_booking_history_share(booking, share, request_id) — the client turns the agreement on or off
-- for one of their active bookings. A finished booking gives the shop nothing anyway.
-- ---------------------------------------------------------------------------------------------
create function public.set_booking_history_share(p_booking_id uuid, p_share boolean, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_booking public.bookings%rowtype;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'set_booking_history_share');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  if p_share is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'share'));
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or v_booking.client_id is distinct from v_me.id then
    perform public.fail('booking_not_found');
  end if;
  if not public.is_active_status(v_booking.status) then
    perform public.fail('wrong_status');
  end if;

  if v_booking.share_history <> p_share then
    update public.bookings
    set share_history = p_share, share_history_at = now()
    where id = p_booking_id
    returning * into v_booking;
  end if;

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;

revoke execute on function public.set_booking_history_share(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_booking_history_share(uuid, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- shop_vehicle_file(booking) — the car of one of the shop's bookings, for the shop's members:
--   car, client (the booking's snapshots),
--   own:    every finished job on this car at this shop, any client (what Istoric already shows;
--           a car without a plate is matched only within the same client), with the amount,
--   others: the same client's finished jobs on this car at other shops, without price or shop —
--           only while that client has an active booking for this car here with the agreement on,
--   share:  'shared' | 'not_shared' (an active booking, agreement off) | 'no_active'.
-- ---------------------------------------------------------------------------------------------
create function public.shop_vehicle_file(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_key text;
  v_has_plate boolean;
  v_share text;
  v_active_share boolean;
begin
  perform public.require_reader();
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found or not public.is_shop_member(v_booking.shop_id) then
    perform public.fail('booking_not_found');
  end if;

  v_key := public.vehicle_key(v_booking.car_snapshot);
  v_has_plate := v_key like 'plate:%';

  -- The agreement: an active booking of this client for this car at this shop.
  select bool_or(x.share_history) into v_active_share
  from public.bookings x
  where x.shop_id = v_booking.shop_id
    and v_booking.client_id is not null
    and x.client_id = v_booking.client_id
    and public.is_active_status(x.status)
    and public.vehicle_key(x.car_snapshot) = v_key;
  v_share := case when v_active_share is null then 'no_active'
                  when v_active_share then 'shared'
                  else 'not_shared' end;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'car', v_booking.car_snapshot,
    'client_name', v_booking.client_name,
    'client_phone', v_booking.client_phone,
    'has_client', v_booking.client_id is not null,
    'share', v_share,
    'own', coalesce((
      select jsonb_agg(j.job order by j.sort_at desc, j.id)
      from (
        select b.id,
               coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
               jsonb_build_object(
                 'id', b.id,
                 'ref', b.ref,
                 'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
                 'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
                 'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
                 'service_icon', sv.icon,
                 'items', public.accepted_quote_lines(b.id),
                 'work', nullif(btrim(b.work), ''),
                 'odometer', b.odometer,
                 'cost', b.cost,
                 'client_name', b.client_name
               ) as job
        from public.bookings b
        left join public.services sv on sv.id = b.service_id
        where b.shop_id = v_booking.shop_id
          and b.status = 'done'
          and public.vehicle_key(b.car_snapshot) = v_key
          and (v_has_plate or b.client_id = v_booking.client_id)
      ) j), '[]'::jsonb),
    'others', case when v_share <> 'shared' then '[]'::jsonb else coalesce((
      select jsonb_agg(j.job order by j.sort_at desc, j.id)
      from (
        select b.id,
               coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
               jsonb_build_object(
                 'id', b.id,
                 'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
                 'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
                 'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
                 'service_icon', sv.icon,
                 'items', public.accepted_quote_lines(b.id),
                 'work', nullif(btrim(b.work), ''),
                 'odometer', b.odometer
               ) as job
        from public.bookings b
        left join public.services sv on sv.id = b.service_id
        where b.client_id = v_booking.client_id
          and b.shop_id <> v_booking.shop_id
          and b.status = 'done'
          and public.vehicle_key(b.car_snapshot) = v_key
      ) j), '[]'::jsonb) end
  );
end
$$;

-- The names of the accepted lines of a booking's accepted quote (no prices), in order.
create function public.accepted_quote_lines(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(qi.name order by qi.position)
    from public.quote_items qi
    where qi.quote_id = (
      select q.id from public.quotes q
      where q.booking_id = p_booking_id and q.status in ('accepted', 'partially_accepted')
      order by q.version desc limit 1)
      and qi.approved), '[]'::jsonb)
$$;

revoke execute on function public.accepted_quote_lines(uuid) from public, anon, authenticated;
revoke execute on function public.shop_vehicle_file(uuid) from public, anon;
grant execute on function public.shop_vehicle_file(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's bookings say whether the client shares the car's history (the card's line).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_shop_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'city', v_shop.city,
      'daily_capacity', v_shop.daily_capacity,
      'inspection_fee', v_shop.inspection_fee),
    'quote_expiry_days', (select ps.quote_expiry_days from public.platform_settings ps where ps.id = 1),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'date', b.date,
          'slot', to_char(b.slot, 'HH24:MI'),
          'note', b.note,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'service_icon', s.icon,
          'extra_services', public.service_names(b.extra_service_ids),
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'client_account', p.display_id,
          'client_no_shows', case when b.client_id is null then 0 else (
            select count(*)::int from public.bookings x
            where x.client_id = b.client_id and x.status = 'no_show'
              and x.date > public.bucharest_today() - 90) end,
          'offer_percent', b.offer_percent,
          'share_history', b.share_history,
          'car_snapshot', b.car_snapshot,
          'created_at', b.created_at,
          'confirmed_at', b.confirmed_at,
          'inspection_started_at', b.inspection_started_at,
          'started_at', b.started_at,
          'quote', q.quote
        ) order by b.date, b.slot, b.created_at)
      from public.bookings b
      left join public.services s on s.id = b.service_id
      left join public.profiles p on p.id = b.client_id
      left join lateral (
        select jsonb_build_object(
            'id', qq.id,
            'version', qq.version,
            'status', qq.status,
            'note', qq.note,
            'inspection_fee', qq.inspection_fee,
            'total_sent', qq.total_sent,
            'total_approved', qq.total_approved,
            'sent_at', qq.sent_at,
            'expires_at', qq.expires_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
                order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and b.status in ('quote_sent', 'approved', 'in_progress')
          and qq.status in ('sent', 'accepted', 'partially_accepted')
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id and public.is_active_status(b.status)
    ), '[]'::jsonb)
  );
end
$function$;

update public.schema_version set version = 46;
