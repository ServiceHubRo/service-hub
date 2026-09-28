-- T21 — several services in one booking. The client ticks up to 5 services on step 1; it is still
-- one booking: one car, one time, one place of the day's capacity. `service_id` stays the first
-- service (search matches, reviews, reports by service keep working); the others are in
-- `extra_service_ids`, in the order they were ticked. Services are never deleted (ids never
-- change), so the ids are enough; names come from the catalog.

alter table public.bookings
  add column extra_service_ids text[] not null default '{}' check (cardinality(extra_service_ids) <= 4);

-- The names of some services, in the given order: [{id, name_ro, name_en, icon}].
create function public.service_names(p_ids text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'icon', sv.icon)
                            order by u.ord), '[]'::jsonb)
  from unnest(coalesce(p_ids, '{}')) with ordinality as u(id, ord)
  join public.services sv on sv.id = u.id
$$;

-- Every service of a booking in one line, in one language: "Schimb ulei + filtru ulei, Plăcuțe frână"
-- (a comma between services: some names have a "+" of their own).
create function public.services_label(p_service_id text, p_extra text[], p_lang text)
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(case when p_lang = 'en' then sv.name_en else sv.name_ro end, ', ' order by u.ord)
  from unnest(array[p_service_id] || coalesce(p_extra, '{}')) with ordinality as u(id, ord)
  join public.services sv on sv.id = u.id
$$;


-- A reminder for the next service is kept per service now: one booking can have several.
alter table public.client_reminders add column service_id text not null default '';
update public.client_reminders cr set service_id = b.service_id
from public.bookings b where b.id = cr.booking_id and cr.kind = 'service';
alter table public.client_reminders drop constraint client_reminders_pkey;
alter table public.client_reminders add primary key (booking_id, kind, service_id);

-- ---------------------------------------------------------------------------------------------
-- create_booking takes the added services (p_extra_service_ids).
-- ---------------------------------------------------------------------------------------------
drop function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text);

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
  p_extra_service_ids text[] default '{}'
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
    date, slot, note, status
  ) values (
    p_shop_id, v_me.id, p_service_id, v_extra, v_me.name, v_me.phone, v_me.lang, v_car.id, v_snapshot,
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

grant execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[]) to authenticated;

-- Notifications say how many services were added ("Schimb ulei și încă 2").
create or replace function public.booking_event_params(p_booking public.bookings)
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
    'extra_count', cardinality(p_booking.extra_service_ids),
    'date', p_booking.date,
    'slot', to_char(p_booking.slot, 'HH24:MI'),
    'make', p_booking.car_snapshot->>'make',
    'model', p_booking.car_snapshot->>'model',
    'plate', p_booking.car_snapshot->>'plate'
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Everything that shows a booking's service shows all of them.
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
          'extra_services', public.service_names(b.extra_service_ids),
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
          'extra_services', public.service_names(b.extra_service_ids),
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
             'cost', b.cost
           ) as job
    from public.bookings b
    left join public.shops s on s.id = b.shop_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = p_client_id
      and b.status = 'done'
      and public.vehicle_key(b.car_snapshot) = p_vehicle_key
  ) j
$$;

create or replace function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_thread uuid;
begin
  perform public.require_admin();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  select t.id into v_thread from public.threads t where t.shop_id = v.shop_id and t.client_id = v.client_id;

  return jsonb_build_object(
    'booking', to_jsonb(v) || jsonb_build_object('slot', to_char(v.slot, 'HH24:MI')),
    'service', (select jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'icon', sv.icon)
                from public.services sv where sv.id = v.service_id),
    'extra_services', public.service_names(v.extra_service_ids),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'phone', s.phone,
                      'display_id', o.display_id)
             from public.shops s join public.profiles o on o.id = s.owner_id where s.id = v.shop_id),
    'client', (select jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'phone', p.phone,
                        'email', public.account_email(p.id), 'no_shows', public.client_no_show_count(p.id, 90))
               from public.profiles p where p.id = v.client_id),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'note', q.note,
               'inspection_fee', q.inspection_fee, 'total_sent', q.total_sent, 'total_approved', q.total_approved,
               'sent_at', q.sent_at, 'expires_at', q.expires_at, 'decided_at', q.decided_at,
               'items', coalesce((select jsonb_agg(jsonb_build_object('id', qi.id, 'name', qi.name, 'price', qi.price,
                                     'approved', qi.approved) order by qi.position)
                                  from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb))
             order by q.version desc)
      from public.quotes q where q.booking_id = v.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'reply', r.reply,
                        'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
               from public.reviews r where r.booking_id = v.id),
    'thread_id', v_thread,
    'messages', case when v_thread is null then '[]'::jsonb else public.admin_thread_messages(v_thread) end,
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

create or replace function public.admin_list_bookings(
  p_statuses text[] default null,
  p_shop_id uuid default null,
  p_client_id uuid default null,
  p_from date default null,
  p_to date default null,
  p_q text default null,
  p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(public.fold_text(btrim(coalesce(p_q, ''))), '');
  v_plate text := nullif(regexp_replace(upper(coalesce(p_q, '')), '[^A-Z0-9]', '', 'g'), '');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  perform public.require_admin();
  return (
    with matched as (
      select b.*, s.name as shop_name, s.city as shop_city
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      where (p_statuses is null or cardinality(p_statuses) = 0 or b.status = any (p_statuses))
        and (p_shop_id is null or b.shop_id = p_shop_id)
        and (p_client_id is null or b.client_id = p_client_id)
        and (p_from is null or b.date >= p_from)
        and (p_to is null or b.date <= p_to)
        and (v_q is null
             or b.ref ilike '%' || btrim(p_q) || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_q || '%'
             or public.fold_text(s.name) like '%' || v_q || '%')
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'bookings', coalesce((
        select jsonb_agg(x.item order by x.date desc, x.slot desc, x.id) from (
          select m.date, m.slot, m.id, jsonb_build_object(
              'id', m.id, 'ref', m.ref, 'status', m.status, 'date', m.date, 'slot', to_char(m.slot, 'HH24:MI'),
              'shop_id', m.shop_id, 'shop_name', m.shop_name, 'shop_city', m.shop_city,
              'client_id', m.client_id, 'client_name', m.client_name,
              'client_display_id', (select p.display_id from public.profiles p where p.id = m.client_id),
              'service_id', m.service_id, 'service_ro', public.services_label(m.service_id, m.extra_service_ids, 'ro'),
              'service_en', public.services_label(m.service_id, m.extra_service_ids, 'en'), 'service_icon', sv.icon,
              'car_snapshot', m.car_snapshot, 'cost', m.cost, 'created_at', m.created_at) as item
          from matched m left join public.services sv on sv.id = m.service_id
          order by m.date desc, m.slot desc, m.id
          limit v_limit) x), '[]'::jsonb))
  );
end
$$;

create or replace function public.admin_export(p_kind text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_statuses text[];
  v_q text;
  v_fold text;
  v_plate text;
  v_rows jsonb;
begin
  perform public.require_admin();
  if p_kind = 'shops' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'street', s.street, 'county', s.county, 'postal_code', s.postal_code,
          'rating', r.average, 'review_count', coalesce(r.review_count, 0),
          'bookings', (select count(*) from public.bookings b where b.shop_id = s.id),
          'price_ron', sub.price_ron)
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_shops()) with ordinality l
      join public.shops s on s.id = (l.value->>'id')::uuid
      left join public.shop_ratings r on r.shop_id = s.id
      left join public.subscriptions sub on sub.shop_id = s.id), '[]'::jsonb);
  elsif p_kind = 'clients' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'lang', p.lang,
          'cars', (select count(*) from public.cars c where c.owner_id = p.id))
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_clients()) with ordinality l
      join public.profiles p on p.id = (l.value->>'id')::uuid), '[]'::jsonb);
  elsif p_kind = 'subscriptions' then
    v_rows := public.admin_subscription_rows();
  elsif p_kind = 'bookings' then
    v_statuses := case when jsonb_typeof(f->'statuses') = 'array'
                       then array(select jsonb_array_elements_text(f->'statuses')) end;
    v_q := public.clean_text(f->>'q');
    v_fold := public.fold_text(v_q);
    v_plate := nullif(regexp_replace(upper(coalesce(v_q, '')), '[^A-Z0-9]', '', 'g'), '');
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'ref', b.ref, 'status', b.status, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
          'created_at', b.created_at, 'shop_name', s.name, 'shop_city', s.city,
          'client_display_id', cp.display_id, 'client_name', b.client_name, 'client_phone', b.client_phone,
          'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
          'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
          'make', b.car_snapshot->>'make', 'model', b.car_snapshot->>'model', 'year', b.car_snapshot->>'year',
          'plate', b.car_snapshot->>'plate', 'vin', b.car_snapshot->>'vin',
          'odometer', b.odometer, 'cost', b.cost, 'cancelled_by', b.cancelled_by,
          'reason', coalesce(b.cancel_reason, b.decline_reason))
        order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.profiles cp on cp.id = b.client_id
      left join public.services sv on sv.id = b.service_id
      where (v_statuses is null or cardinality(v_statuses) = 0 or b.status = any (v_statuses))
        and (public.try_uuid(f->>'shop_id') is null or b.shop_id = public.try_uuid(f->>'shop_id'))
        and (public.try_uuid(f->>'client_id') is null or b.client_id = public.try_uuid(f->>'client_id'))
        and (f->>'from' is null or b.date >= (f->>'from')::date)
        and (f->>'to' is null or b.date <= (f->>'to')::date)
        and (v_q is null
             or b.ref ilike '%' || v_q || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_fold || '%'
             or public.fold_text(s.name) like '%' || v_fold || '%')), '[]'::jsonb);
  elsif p_kind = 'reviews' then
    v_q := public.fold_text(public.clean_text(f->>'q'));
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'created_at', r.created_at, 'shop_name', s.name, 'shop_city', s.city, 'ref', b.ref,
          'client_display_id', cp.display_id, 'client_display_name', r.client_display_name,
          'rating', r.rating, 'text', r.text, 'reply', r.reply,
          'report_reason', r.report_reason, 'reported_at', r.reported_at, 'report_status', r.report_status,
          'removed_at', r.removed_at)
        order by r.created_at desc, r.id)
      from public.reviews r
      join public.shops s on s.id = r.shop_id
      left join public.bookings b on b.id = r.booking_id
      left join public.profiles cp on cp.id = r.client_id
      where v_q is null
         or public.fold_text(coalesce(r.text, '')) like '%' || v_q || '%'
         or public.fold_text(coalesce(r.reply, '')) like '%' || v_q || '%'
         or public.fold_text(s.name) like '%' || v_q || '%'
         or public.fold_text(r.client_display_name) like '%' || v_q || '%'), '[]'::jsonb);
  else
    perform public.fail('kind_invalid');
  end if;

  perform public.admin_audit_key('export', 'export', p_kind, null,
    jsonb_build_object('kind', p_kind, 'filters', f, 'rows', jsonb_array_length(v_rows)));
  return v_rows;
end
$$;

create or replace function public.admin_get_client(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  perform public.require_admin();
  select * into v from public.profiles where id = p_user_id and role = 'client';
  if not found then
    perform public.fail('not_found');
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v.id,
      'display_id', v.display_id,
      'name', v.name,
      'phone', v.phone,
      'email', public.account_email(v.id),
      'lang', v.lang,
      'email_verified_at', v.email_verified_at,
      'suspended', v.suspended,
      'deleted_at', v.deleted_at,
      'created_at', v.created_at,
      'terms_version', v.terms_version,
      'last_active_at', public.last_seen(v.id)),
    'no_shows', public.client_no_show_count(v.id, 90),
    'cars', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'make', c.make, 'model', c.model, 'year', c.year,
               'plate', c.plate, 'vin', c.vin, 'itp_expiry', c.itp_expiry, 'rca_expiry', c.rca_expiry,
               'vignette_expiry', c.vignette_expiry)
             order by c.created_at)
      from public.cars c where c.owner_id = v.id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date,
               'slot', to_char(b.slot, 'HH24:MI'), 'shop_id', b.shop_id, 'shop_name', s.name,
               'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
               'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'), 'car_snapshot', b.car_snapshot, 'cost', b.cost)
             order by b.created_at desc)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.services sv on sv.id = b.service_id
      where b.client_id = v.id), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'shop_name', s.name,
               'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
             order by r.created_at desc)
      from public.reviews r join public.shops s on s.id = r.shop_id
      where r.client_id = v.id), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'shop_id', t.shop_id, 'shop_name', s.name,
               'last_message_at', t.last_message_at,
               'messages', (select count(*) from public.messages m where m.thread_id = t.id))
             order by t.last_message_at desc nulls last)
      from public.threads t join public.shops s on s.id = t.shop_id
      where t.client_id = v.id), '[]'::jsonb),
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

create or replace function public.admin_get_shop(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_owner public.profiles%rowtype;
begin
  perform public.require_admin();
  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  select * into v_owner from public.profiles where id = v_shop.owner_id;

  return jsonb_build_object(
    'shop', to_jsonb(v_shop),
    'owner', jsonb_build_object(
      'id', v_owner.id,
      'display_id', v_owner.display_id,
      'name', v_owner.name,
      'phone', v_owner.phone,
      'email', public.account_email(v_owner.id),
      'lang', v_owner.lang,
      'email_verified_at', v_owner.email_verified_at,
      'phone_verified_at', v_owner.phone_verified_at,
      'phone_verified_by_admin', v_owner.phone_verified_by_admin,
      'suspended', v_owner.suspended,
      'deleted_at', v_owner.deleted_at,
      'created_at', v_owner.created_at,
      'last_active_at', public.last_seen(v_owner.id)),
    'state', public.shop_state(v_shop.id),
    'public', public.is_shop_public(v_shop.id),
    'reasons', to_jsonb(public.shop_hidden_reasons(v_shop.id)),
    'billing', (select to_jsonb(b) from public.shop_billing b where b.shop_id = v_shop.id),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'is_closed', h.is_closed,
               'open_time', to_char(h.open_time, 'HH24:MI'), 'close_time', to_char(h.close_time, 'HH24:MI'))
             order by h.weekday)
      from public.shop_hours h where h.shop_id = v_shop.id), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', c.start_date, 'end_date', c.end_date, 'label', c.label)
             order by c.start_date)
      from public.shop_closures c where c.shop_id = v_shop.id and c.end_date >= public.bucharest_today()), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'enabled', sv.enabled)
             order by sv.position, sv.id)
      from public.shop_services ss join public.services sv on sv.id = ss.service_id
      where ss.shop_id = v_shop.id), '[]'::jsonb),
    'subscription', (select to_jsonb(sub) - 'trial_reminded' - 'payment_failed_key'
                     from public.subscriptions sub where sub.shop_id = v_shop.id),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'currency', i.currency, 'status', i.status,
               'issued_at', coalesce(i.issued_at, i.created_at), 'provider_ref', i.provider_ref,
               'receipt_url', i.receipt_url, 'series', i.series, 'number', i.number)
             order by coalesce(i.issued_at, i.created_at) desc)
      from public.invoices i where i.shop_id = v_shop.id), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'role', st.role, 'user_id', st.user_id,
               'display_id', p.display_id, 'name', p.name,
               'email', coalesce(public.account_email(st.user_id), st.invited_email),
               'invited_at', st.invited_at, 'accepted_at', st.accepted_at)
             order by st.role desc, st.invited_at)
      from public.shop_staff st left join public.profiles p on p.id = st.user_id
      where st.shop_id = v_shop.id), '[]'::jsonb),
    'rating', (select jsonb_build_object('average', r.average, 'review_count', r.review_count)
               from public.shop_ratings r where r.shop_id = v_shop.id),
    'booking_counts', coalesce((
      select jsonb_object_agg(status, n) from (
        select b.status, count(*) as n from public.bookings b where b.shop_id = v_shop.id group by b.status) c), '{}'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(x.item order by x.created_at desc) from (
        select b.created_at, jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date,
                 'slot', to_char(b.slot, 'HH24:MI'), 'client_name', b.client_name,
                 'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
                 'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'), 'car_snapshot', b.car_snapshot) as item
        from public.bookings b left join public.services sv on sv.id = b.service_id
        where b.shop_id = v_shop.id
        order by b.created_at desc limit 20) x), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'reply', r.reply,
               'client_display_name', r.client_display_name, 'report_status', r.report_status,
               'report_reason', r.report_reason, 'removed_at', r.removed_at, 'created_at', r.created_at)
             order by r.created_at desc)
      from public.reviews r where r.shop_id = v_shop.id), '[]'::jsonb),
    'audit', public.audit_entries(array[v_shop.id::text, v_owner.id::text]));
end
$$;

create or replace function public.admin_list_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'name_ro', c.name_ro,
        'name_en', c.name_en,
        'position', c.position,
        'enabled', c.enabled,
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', sv.id,
              'category_key', sv.category_key,
              'icon', sv.icon,
              'name_ro', sv.name_ro,
              'name_en', sv.name_en,
              'position', sv.position,
              'enabled', sv.enabled,
              'reminder_months', sv.reminder_months,
              'shops', (select count(*) from public.shop_services ss where ss.service_id = sv.id),
              'bookings', (select count(*) from public.bookings b where b.service_id = sv.id or sv.id = any (b.extra_service_ids))
            ) order by sv.position, sv.id)
          from public.services sv where sv.category_key = c.key), '[]'::jsonb)
      ) order by c.position, c.key)
    from public.service_categories c
  ), '[]'::jsonb);
end
$$;

create or replace function public.send_service_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    -- Every service of a booking counts, the first one and those added to it (T21).
    select distinct on (bk.client_id, bk.car_id, u.service_id)
           bk.id, bk.client_id, bk.car_id, bk.shop_id, bk.car_snapshot, u.service_id, sv.reminder_months,
           (bk.done_at at time zone 'Europe/Bucharest')::date as done_day
    from public.bookings bk
    cross join lateral unnest(array[bk.service_id] || bk.extra_service_ids) as u(service_id)
    join public.services sv on sv.id = u.service_id and sv.reminder_months is not null and sv.enabled
    join public.cars c on c.id = bk.car_id and c.owner_id = bk.client_id
    join public.profiles p on p.id = bk.client_id and p.deleted_at is null and p.service_reminders and not p.suspended
    where bk.status = 'done' and bk.done_at is not null
    order by bk.client_id, bk.car_id, u.service_id, bk.done_at desc
  loop
    continue when (r.done_day + make_interval(months => r.reminder_months))::date - 14 > p_today;
    continue when (r.done_day + make_interval(months => r.reminder_months))::date + 30 < p_today;
    -- Already booked for it: nothing to remind.
    continue when exists (
      select 1 from public.bookings a
      where a.client_id = r.client_id and a.car_id = r.car_id
        and (a.service_id = r.service_id or r.service_id = any (a.extra_service_ids))
        and a.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress'));
    insert into public.client_reminders (booking_id, kind, service_id) values (r.id, 'service', r.service_id)
      on conflict do nothing;
    continue when not found;
    perform public.notify_user(r.client_id, 'service_due', jsonb_build_object(
      'booking_id', r.id, 'shop_id', r.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = r.shop_id),
      'service_id', r.service_id, 'car_id', r.car_id,
      'make', r.car_snapshot->>'make', 'model', r.car_snapshot->>'model', 'plate', r.car_snapshot->>'plate',
      'last_done', r.done_day,
      'due', (r.done_day + make_interval(months => r.reminder_months))::date), r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

update public.schema_version set version = 38;
