-- A suspended account can still sign in and read (the promise on the admin screen: "can sign in and
-- read, but can't book, send messages or write reviews"): search, shop pages, availability,
-- conversations, bookings, history, reports. Writes keep require_caller(), which refuses a
-- suspended account with `account_suspended` (booking, cancelling, messages, reviews, quotes...).
--
-- require_reader(): who is calling, without the suspension check. The functions below are their
-- current definitions with require_caller() swapped for require_reader(); nothing else changes.

create or replace function public.require_reader()
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
  return v;
end
$$;

revoke all on function public.require_reader() from public, anon, authenticated;

-- search_cities
CREATE OR REPLACE FUNCTION public.search_cities()
 RETURNS TABLE(city text, shop_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_reader();
  return query
  select
    (array_agg(btrim(s.city) order by (lower(btrim(s.city)) = public.fold_text(btrim(s.city))), btrim(s.city)))[1],
    count(*)::int
  from public.shops s
  where public.is_shop_public(s.id) and btrim(s.city) <> ''
  group by public.fold_text(btrim(s.city))
  order by count(*) desc, 1;
end
$function$;

-- search_shops
CREATE OR REPLACE FUNCTION public.search_shops(p_q text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_sort text DEFAULT 'rating'::text)
 RETURNS TABLE(shop_id uuid, name text, city text, street text, logo_url text, latitude double precision, longitude double precision, review_count integer, average numeric, weighted_score numeric, service_count integer, matched_service_id text, matched_service_ro text, matched_service_en text, distance_km double precision, is_favorite boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_words text[] := public.search_words(p_q);
  v_cat text := nullif(btrim(p_category), '');
  v_city text := public.fold_text(nullif(btrim(p_city), ''));
  v_lat double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end;
  v_lng double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end;
  v_by_distance boolean;
begin
  perform public.require_reader();
  v_by_distance := p_sort = 'distance' and v_lat is not null;
  if cardinality(v_words) = 0 then
    v_words := null;
  end if;

  return query
  with offered as (
    select ss.shop_id, sv.id, sv.name_ro, sv.name_en, sv.category_key,
           public.fold_text(sv.name_ro || ' ' || sv.name_en) as own_name,
           public.fold_text(sv.name_ro || ' ' || sv.name_en || ' ' || c.name_ro || ' ' || c.name_en) as haystack,
           row_number() over (partition by ss.shop_id order by c.position, sv.position) as ord
    from public.shop_services ss
    join public.services sv on sv.id = ss.service_id and sv.enabled
    join public.service_categories c on c.key = sv.category_key
  ),
  shops as (
    select s.*,
           -- the words the shop's name and city do not cover
           array(select w from unnest(v_words) w
                 where position(w in public.fold_text(s.name || ' ' || s.city)) = 0) as rest
    from public.shops s
    where public.is_shop_public(s.id)
      and (v_city is null or public.fold_text(btrim(s.city)) = v_city)
      and (v_cat is null or exists (select 1 from offered o where o.shop_id = s.id and o.category_key = v_cat))
  ),
  hits as (
    select sh.*, v_words is not null and cardinality(sh.rest) = 0 as text_hit,
           m.id as m_id, m.name_ro as m_name_ro, m.name_en as m_name_en
    from shops sh
    left join lateral (
      select o.id, o.name_ro, o.name_en from offered o
      where o.shop_id = sh.id
        and case
              when v_words is not null and cardinality(sh.rest) > 0 then
                not exists (select 1 from unnest(sh.rest) w where position(w in o.haystack) = 0)
              else o.category_key = v_cat
            end
      order by (v_cat is not null and o.category_key = v_cat) desc,
               not exists (select 1 from unnest(sh.rest) w where position(w in o.own_name) = 0) desc,
               o.ord
      limit 1
    ) m on true
  )
  select
    h.id, h.name, h.city, h.street, h.logo_url, h.latitude, h.longitude,
    r.review_count, r.average, r.weighted_score,
    (select count(*)::int from offered o where o.shop_id = h.id),
    h.m_id, h.m_name_ro, h.m_name_en,
    case when v_lat is not null and h.latitude is not null and h.longitude is not null then
      2 * 6371 * asin(sqrt(
        power(sin(radians(h.latitude - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(h.latitude)) * power(sin(radians(h.longitude - v_lng) / 2), 2)))
    end,
    exists (select 1 from public.favorites f where f.client_id = auth.uid() and f.shop_id = h.id)
  from hits h
  join public.shop_ratings r on r.shop_id = h.id
  where v_words is null or h.text_hit or h.m_id is not null
  order by
    case when v_by_distance then
      2 * 6371 * asin(sqrt(
        power(sin(radians(h.latitude - v_lat) / 2), 2)
        + cos(radians(v_lat)) * cos(radians(h.latitude)) * power(sin(radians(h.longitude - v_lng) / 2), 2)))
    end asc nulls last,
    r.weighted_score desc, r.review_count desc, lower(h.name) asc, h.id
  limit 500;
end
$function$;

-- get_shop_page
CREATE OR REPLACE FUNCTION public.get_shop_page(p_shop_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'inspection_fee', v_shop.inspection_fee
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
$function$;

-- get_availability
CREATE OR REPLACE FUNCTION public.get_availability(p_shop_id uuid, p_from date DEFAULT NULL::date, p_days integer DEFAULT 14, p_slots_for date DEFAULT NULL::date, p_exclude_booking uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop public.shops%rowtype;
  v_member boolean;
  v_exclude uuid;
  v_today date := public.bucharest_today();
  v_from date := greatest(coalesce(p_from, public.bucharest_today()), public.bucharest_today());
  v_days int := least(greatest(coalesce(p_days, 14), 1), 366);
  v_notice interval;
  v_max_date date;
  v_result_days jsonb;
  v_result_slots jsonb := '[]'::jsonb;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or not public.can_read_shop(p_shop_id) then
    perform public.fail('shop_not_found');
  end if;
  v_member := public.is_shop_member(p_shop_id);
  v_notice := case when v_member then interval '0' else make_interval(hours => v_shop.min_notice_hours) end;
  v_max_date := case when v_member then v_today + 366 else v_today + v_shop.max_advance_days end;
  if v_member and p_exclude_booking is not null then
    select b.id into v_exclude from public.bookings b where b.id = p_exclude_booking and b.shop_id = p_shop_id;
  end if;

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
       where b.shop_id = p_shop_id and b.date = dy.day and public.is_active_status(b.status)
         and b.id is distinct from v_exclude)::int as booked
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
             and public.is_active_status(b.status) and b.id is distinct from v_exclude) < v_shop.cars_per_slot
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
          and public.is_active_status(b.status) and b.id is distinct from v_exclude) tk
      cross join lateral (
        select count(*)::int as n from public.bookings b
        where b.shop_id = p_shop_id and b.date = p_slots_for and public.is_active_status(b.status)
          and b.id is distinct from v_exclude) day_booked
      where h.shop_id = p_shop_id
        and h.weekday = extract(dow from p_slots_for)::int
        and not h.is_closed
        and not exists (select 1 from public.shop_closures c
                        where c.shop_id = p_shop_id and p_slots_for between c.start_date and c.end_date)
    ) x;
  end if;

  return jsonb_build_object('days', v_result_days, 'slots', v_result_slots);
end
$function$;

-- list_threads
CREATE OR REPLACE FUNCTION public.list_threads()
 RETURNS TABLE(thread_id uuid, shop_id uuid, client_id uuid, shop_name text, shop_logo_url text, client_name text, last_message_at timestamp with time zone, last_kind text, last_body text, last_event text, last_params jsonb, last_own boolean, unread integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_me public.profiles%rowtype;
  v_side text;
  v_shop uuid;
begin
  v_me := public.require_reader();
  if v_me.role = 'client' then
    v_side := 'client';
  elsif v_me.role = 'shop' then
    v_side := 'shop';
    v_shop := public.my_shop_id();
    if v_shop is null then
      return; -- a member removed from their shop has no conversations
    end if;
  else
    return;
  end if;

  return query
  select
    t.id, t.shop_id, t.client_id, s.name, s.logo_url, t.client_name, t.last_message_at,
    lm.kind, lm.body, lm.event, case when lm.kind = 'system' then lm.params end,
    public.message_is_own_side(lm, t.client_id, v_side),
    (select count(*)::int from public.messages m
     where m.thread_id = t.id
       and m.created_at > coalesce(case when v_side = 'client' then t.client_last_read_at else t.shop_last_read_at end,
                                   '-infinity'::timestamptz)
       and not public.message_is_own_side(m, t.client_id, v_side))
  from public.threads t
  join public.shops s on s.id = t.shop_id
  left join lateral (
    select m.* from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where (v_side = 'client' and t.client_id = v_me.id)
     or (v_side = 'shop' and t.shop_id = v_shop)
  order by t.last_message_at desc nulls last, t.created_at desc;
end
$function$;

-- booking_thread
CREATE OR REPLACE FUNCTION public.booking_thread(p_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.bookings%rowtype;
  v_thread uuid;
begin
  perform public.require_reader();
  select * into v from public.bookings where id = p_booking_id;
  if not found or not (v.client_id = auth.uid() or public.is_shop_member(v.shop_id)) then
    perform public.fail('booking_not_found');
  end if;
  select t.id into v_thread from public.threads t where t.shop_id = v.shop_id and t.client_id = v.client_id;
  if v_thread is null then
    perform public.fail('thread_not_found');
  end if;
  return v_thread;
end
$function$;

-- mark_thread_read
CREATE OR REPLACE FUNCTION public.mark_thread_read(p_thread_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread public.threads%rowtype;
  v_now timestamptz := now();
begin
  perform public.require_reader();
  select * into v_thread from public.threads where id = p_thread_id;
  if not found then
    perform public.fail('thread_not_found');
  end if;
  if v_thread.client_id = auth.uid() then
    update public.threads set client_last_read_at = v_now where id = p_thread_id;
  elsif public.is_shop_member(v_thread.shop_id) then
    update public.threads set shop_last_read_at = v_now where id = p_thread_id;
  else
    perform public.fail('not_allowed');
  end if;
  return v_now;
end
$function$;

-- history_report_preview
CREATE OR REPLACE FUNCTION public.history_report_preview(p_car_id uuid DEFAULT NULL::uuid, p_booking_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_vehicle jsonb;
  v_jobs jsonb;
begin
  v_me := public.require_reader();
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  v_vehicle := public.report_vehicle(v_me.id, p_car_id, p_booking_id);
  v_jobs := public.report_jobs(v_me.id, v_vehicle->>'key');
  return jsonb_build_object(
    'car_id', v_vehicle->'car_id',
    'car', v_vehicle->'car',
    'jobs', v_jobs,
    'facts', public.report_facts(v_jobs),
    'price', (select report_price_ron from public.platform_settings where id = 1));
end
$function$;

-- last_odometer_for_booking
CREATE OR REPLACE FUNCTION public.last_odometer_for_booking(p_booking_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.bookings%rowtype;
begin
  perform public.require_reader();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  if not public.is_shop_member(v.shop_id) then
    perform public.fail('not_allowed');
  end if;
  return public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
end
$function$;

-- list_shop_bookings
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
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'client_account', p.display_id,
          'client_no_shows', case when b.client_id is null then 0 else (
            select count(*)::int from public.bookings x
            where x.client_id = b.client_id and x.status = 'no_show'
              and x.date > public.bucharest_today() - 90) end,
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

-- list_shop_history
CREATE OR REPLACE FUNCTION public.list_shop_history()
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
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name),
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
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'has_client', b.client_id is not null,
          'car_snapshot', b.car_snapshot,
          'odometer', b.odometer,
          'work', b.work,
          'cost', b.cost,
          'done_at', b.done_at,
          'cancelled_by', b.cancelled_by,
          'cancel_reason', b.cancel_reason,
          'ended_at', e.ended_at,
          'quote', q.quote
        ) order by e.ended_at desc, b.id)
      from public.bookings b
      cross join lateral (select coalesce(b.done_at, b.cancelled_at, b.status_changed_at) as ended_at) e
      left join public.services s on s.id = b.service_id
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
            'decided_at', qq.decided_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
                order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and case b.status
                when 'done' then qq.status in ('accepted', 'partially_accepted')
                when 'quote_refused' then qq.status = 'refused'
                when 'expired' then qq.status = 'expired'
                else false
              end
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused', 'expired', 'cancelled', 'no_show')
    ), '[]'::jsonb)
  );
end
$function$;

-- list_shop_staff
CREATE OR REPLACE FUNCTION public.list_shop_staff()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop uuid;
begin
  perform public.require_reader();
  v_shop := public.require_my_shop();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', st.id,
             'role', st.role,
             'name', p.name,
             'email', lower(coalesce(u.email, st.invited_email)),
             'invited_at', st.invited_at,
             'accepted_at', st.accepted_at,
             'expired', st.accepted_at is null and st.invited_at <= now() - interval '14 days',
             'is_me', st.user_id = auth.uid())
           order by st.role = 'staff', st.accepted_at is null, st.invited_at), '[]'::jsonb)
    from public.shop_staff st
    left join public.profiles p on p.id = st.user_id
    left join auth.users u on u.id = st.user_id
    where st.shop_id = v_shop
  );
end
$function$;

-- client_no_show_count
CREATE OR REPLACE FUNCTION public.client_no_show_count(p_client_id uuid, p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_reader();
  if not (
    p_client_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.bookings b
               where b.client_id = p_client_id and public.is_shop_member(b.shop_id))
  ) then
    perform public.fail('not_allowed');
  end if;
  return (
    select count(*)::int from public.bookings b
    where b.client_id = p_client_id and b.status = 'no_show'
      and b.date > public.bucharest_today() - least(greatest(coalesce(p_days, 90), 1), 3650)
  );
end
$function$;

-- my_phone_verification
CREATE OR REPLACE FUNCTION public.my_phone_verification()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_last public.phone_verifications%rowtype;
begin
  v_me := public.require_reader();
  select * into v_last from public.phone_verifications
  where user_id = v_me.id and verified_at is null and phone = v_me.phone
    and expires_at > now() and attempts < 5
  order by created_at desc limit 1;
  return jsonb_build_object(
    'phone', v_me.phone,
    'verified', v_me.phone_verified_at is not null or v_me.phone_verified_by_admin,
    'code_sent_at', v_last.created_at,
    'expires_at', v_last.expires_at,
    'resend_in', case when v_last.id is null then 0
                      else greatest(0, ceil(extract(epoch from v_last.created_at + interval '60 seconds' - now()))::int) end);
end
$function$;

-- get_shop_setup
CREATE OR REPLACE FUNCTION public.get_shop_setup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop public.shops%rowtype;
  v_owner public.profiles%rowtype;
  v_sub public.subscriptions%rowtype;
  v_billing public.shop_billing%rowtype;
  v_settings public.platform_settings%rowtype;
  v_is_owner boolean;
  v_services boolean;
  v_open_day boolean;
  v_phone boolean;
  v_sub_ok boolean;
  v_reasons text[] := '{}';
  v_billing_complete boolean;
  v_result jsonb;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();
  select * into v_owner from public.profiles where id = v_shop.owner_id;
  select * into v_sub from public.subscriptions where shop_id = v_shop.id;
  select * into v_settings from public.platform_settings where id = 1;
  v_is_owner := v_shop.owner_id = auth.uid();

  v_services := exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = v_shop.id and sv.enabled
  );
  v_open_day := exists (select 1 from public.shop_hours h where h.shop_id = v_shop.id and not h.is_closed);
  v_phone := v_owner.phone_verified_at is not null or v_owner.phone_verified_by_admin;
  v_sub_ok := v_sub.shop_id is not null and public.subscription_ok(v_sub.status, v_sub.trial_ends_at, v_sub.stripe_status);

  if v_owner.suspended then v_reasons := array_append(v_reasons, 'account_suspended'); end if;
  if v_shop.suspended then v_reasons := array_append(v_reasons, 'shop_suspended'); end if;
  if not v_shop.active and v_sub_ok then v_reasons := array_append(v_reasons, 'shop_inactive'); end if;
  if not v_sub_ok then v_reasons := array_append(v_reasons, 'subscription_inactive'); end if;
  if v_owner.email_verified_at is null then v_reasons := array_append(v_reasons, 'email_unverified'); end if;
  if not v_phone then v_reasons := array_append(v_reasons, 'phone_unverified'); end if;
  if not v_services then v_reasons := array_append(v_reasons, 'no_services'); end if;
  if not v_open_day then v_reasons := array_append(v_reasons, 'no_open_days'); end if;

  if v_shop.setup_completed_at is null
     and v_services and v_shop.hours_reviewed_at is not null
     and v_shop.capacity_reviewed_at is not null and v_phone then
    update public.shops set setup_completed_at = now() where id = v_shop.id
      returning * into v_shop;
  end if;

  v_result := jsonb_build_object(
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'is_owner', v_is_owner,
    'daily_capacity', v_shop.daily_capacity,
    'steps', jsonb_build_object(
      'services', v_services,
      'hours', v_shop.hours_reviewed_at is not null,
      'capacity', v_shop.capacity_reviewed_at is not null,
      'phone', v_phone),
    'owner_phone', v_owner.phone,
    'setup_completed', v_shop.setup_completed_at is not null,
    'public', public.is_shop_public(v_shop.id),
    'reasons', to_jsonb(v_reasons),
    'subscription_status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at
  );

  if v_is_owner then
    select * into v_billing from public.shop_billing where shop_id = v_shop.id;
    v_billing_complete := coalesce(nullif(btrim(v_billing.legal_name), '') is not null
      and v_billing.vat_id is not null and v_billing.reg_com is not null
      and nullif(btrim(v_billing.legal_address), '') is not null
      and v_billing.billing_email is not null, false);
    v_result := v_result || jsonb_build_object(
      'billing', jsonb_build_object(
        'complete', v_billing_complete,
        'reminder', not v_billing_complete
          and v_sub.status = 'trial'
          and now() >= v_sub.trial_ends_at - make_interval(days => greatest(v_settings.trial_days - 60, 0))
          and (v_shop.billing_reminder_dismissed_at is null
               or v_shop.billing_reminder_dismissed_at < now() - interval '7 days')),
      'subscription', jsonb_build_object(
        'status', v_sub.status,
        'trial_ends_at', v_sub.trial_ends_at,
        'card_given', coalesce(v_sub.stripe_status in ('trialing', 'active', 'past_due'), false),
        'ended_reason', v_sub.ended_reason));
  end if;

  return v_result;
end
$function$;

-- shop_reports
CREATE OR REPLACE FUNCTION public.shop_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shop public.shops%rowtype;
  v_today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();
  if v_shop.owner_id is distinct from auth.uid() then
    return null;
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'daily_capacity', v_shop.daily_capacity,
      'since', (v_shop.created_at at time zone 'Europe/Bucharest')::date
    ),
    'open_weekdays', coalesce((
      select jsonb_agg(h.weekday order by h.weekday)
      from public.shop_hours h
      where h.shop_id = v_shop.id and not h.is_closed
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start', c.start_date, 'end', c.end_date) order by c.start_date)
      from public.shop_closures c
      where c.shop_id = v_shop.id
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'ended_at', coalesce(b.done_at, b.status_changed_at),
          'cost', b.cost,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'client', b.client_id,
          'client_name', b.client_name,
          'car_snapshot', b.car_snapshot
        ) order by coalesce(b.done_at, b.status_changed_at) desc, b.id)
      from public.bookings b
      left join public.services s on s.id = b.service_id
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused')
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('status', q.status, 'sent_at', q.sent_at, 'decided_at', q.decided_at)
        order by q.decided_at)
      from public.quotes q
      join public.bookings b on b.id = q.booking_id
      where b.shop_id = v_shop.id
        and q.status in ('accepted', 'partially_accepted', 'refused', 'expired')
        and q.decided_at is not null
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.date, 'cars', d.cars) order by d.date)
      from (
        select b.date, count(*) as cars
        from public.bookings b
        where b.shop_id = v_shop.id
          and b.date <= v_today
          and b.status in ('confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress',
                           'done', 'quote_refused', 'expired')
        group by b.date
      ) d
    ), '[]'::jsonb)
  );
end
$function$;

update public.schema_version set version = 33;
