-- Instant confirmation and free places (T28a, Eduard 3 oct — "like Booking, for car shops").
--   * shops.auto_confirm (the owner's choice, off by default): a request for a free place is
--     confirmed at once, in the same transaction that counted the place (create_booking), so the
--     client knows on the spot. Not for a client with a no-show in the last 90 days: that request
--     waits for the shop as before. The shop is told the booking came in confirmed.
--   * search_card_extras(shops, day): for the search cards and the shop page, whether a shop
--     confirms at once and its first free place — on the day asked, or within the next 14 days —
--     by the same rules as get_availability for a client (hours, closures, minimum notice, how far
--     ahead, the day's capacity, cars per slot). A day filter narrows the list; it never reorders.

alter table public.shops add column auto_confirm boolean not null default false;
grant update (auto_confirm) on public.shops to authenticated;

-- A client who may be confirmed at once: no no-show in the last 90 days (§6).
create function public.instant_for_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.bookings b
    where b.client_id = p_client_id and b.status = 'no_show'
      and b.date > public.bucharest_today() - 90)
$$;
revoke execute on function public.instant_for_client(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_booking(p_shop_id uuid, p_service_id text, p_date date, p_slot time without time zone, p_request_id uuid, p_car_id uuid DEFAULT NULL::uuid, p_car jsonb DEFAULT NULL::jsonb, p_save_car boolean DEFAULT false, p_note text DEFAULT NULL::text, p_extra_service_ids text[] DEFAULT '{}'::text[], p_share_history boolean DEFAULT false)
 RETURNS bookings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;

CREATE OR REPLACE FUNCTION public.get_shop_page(p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_shop public.shops%rowtype;
  v_today date := public.bucharest_today();
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or not public.can_read_shop(p_shop_id) then
    perform public.fail('shop_not_found');
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'description', v_shop.description,
      'logo_url', v_shop.logo_url,
      'street', v_shop.street,
      'city', v_shop.city,
      'county', v_shop.county,
      'phone', v_shop.phone,
      'phone2', v_shop.phone2,
      'website', v_shop.website,
      'facebook', v_shop.facebook,
      'year_established', v_shop.year_established,
      'latitude', v_shop.latitude,
      'longitude', v_shop.longitude,
      'daily_capacity', v_shop.daily_capacity,
      'cars_per_slot', v_shop.cars_per_slot,
      'min_notice_hours', v_shop.min_notice_hours,
      'max_advance_days', v_shop.max_advance_days,
      'cancel_deadline_hours', v_shop.cancel_deadline_hours,
      'inspection_fee', v_shop.inspection_fee,
      'auto_confirm', v_shop.auto_confirm,
      'slot_minutes', v_shop.slot_minutes
    ),
    'bookable', public.is_shop_public(p_shop_id),
    'is_favorite', exists (select 1 from public.favorites f where f.client_id = auth.uid() and f.shop_id = p_shop_id),
    'rating', (
      select jsonb_build_object('review_count', count(*)::int, 'average', round(avg(r.rating), 2))
      from public.reviews r where r.shop_id = p_shop_id and r.removed_at is null
    ),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday', h.weekday,
               'is_closed', h.is_closed,
               'open_time', to_char(h.open_time, 'HH24:MI'),
               'close_time', to_char(h.close_time, 'HH24:MI'))
             order by h.weekday)
      from public.shop_hours h where h.shop_id = p_shop_id
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', c.start_date, 'end_date', c.end_date, 'label', c.label)
             order by c.start_date, c.end_date)
      from public.shop_closures c where c.shop_id = p_shop_id and c.end_date >= v_today
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'icon', sv.icon, 'name_ro', sv.name_ro, 'name_en', sv.name_en,
               'category_key', c.key, 'category_ro', c.name_ro, 'category_en', c.name_en)
             order by c.position, sv.position)
      from public.shop_services ss
      join public.services sv on sv.id = ss.service_id and sv.enabled
      join public.service_categories c on c.key = sv.category_key
      where ss.shop_id = p_shop_id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'display_name', x.client_display_name, 'rating', x.rating, 'text', x.text,
               'created_at', x.created_at, 'reply', x.reply, 'reply_at', x.reply_at)
             order by x.created_at desc)
      from (
        select r.* from public.reviews r
        where r.shop_id = p_shop_id and r.removed_at is null
        order by r.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end
$$;

create function public.search_card_extras(p_shop_ids uuid[], p_day date default null)
returns table (shop_id uuid, auto_confirm boolean, free_date date, free_slot text)
language sql
stable
security definer
set search_path = ''
as $$
  with ids as (
    select distinct x as id from unnest(coalesce(p_shop_ids, '{}')) with ordinality u(x, n) where n <= 100
  ),
  win as (
    select coalesce(p_day, public.bucharest_today()) as first,
           case when p_day is null then 14 else 1 end as days
  )
  select s.id, s.auto_confirm, f.day, to_char(f.slot, 'HH24:MI')
  from ids
  join public.shops s on s.id = ids.id
  cross join win
  left join lateral (
    select d.day, t::time as slot
    from generate_series(0, win.days - 1) i
    cross join lateral (select win.first + i as day) d
    join public.shop_hours h on h.shop_id = s.id and h.weekday = extract(dow from d.day)::int and not h.is_closed
    cross join lateral generate_series(d.day + h.open_time,
                                       d.day + h.close_time - make_interval(mins => s.slot_minutes),
                                       make_interval(mins => s.slot_minutes)) t
    where d.day >= public.bucharest_today()
      and d.day <= public.bucharest_today() + s.max_advance_days
      and not exists (select 1 from public.shop_closures c
                      where c.shop_id = s.id and d.day between c.start_date and c.end_date)
      and public.slot_starts_at(d.day, t::time) >= now() + make_interval(hours => s.min_notice_hours)
      and (select count(*) from public.bookings b
           where b.shop_id = s.id and b.date = d.day and public.is_active_status(b.status)) < s.daily_capacity
      and (select count(*) from public.bookings b
           where b.shop_id = s.id and b.date = d.day and b.slot = t::time
             and public.is_active_status(b.status)) < s.cars_per_slot
    order by d.day, t
    limit 1
  ) f on true
  where public.is_shop_public(s.id)
$$;
revoke execute on function public.search_card_extras(uuid[], date) from public, anon;
grant execute on function public.search_card_extras(uuid[], date) to authenticated;

update public.schema_version set version = 51;
