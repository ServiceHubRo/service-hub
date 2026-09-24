-- T08 — The shop's Panou and Programări (FR §4.1, §4.2).
--   1. list_shop_bookings(): every active booking of the caller's shop with what the cards need, in
--      one read (service names, the client's account id and no-show count, the current quote).
--   2. get_availability(…, p_exclude_booking): when a shop reschedules a booking, the place that
--      booking holds now counts as free — the same rule reschedule_booking applies at submit.

-- ---------------------------------------------------------------------------------------------
-- list_shop_bookings — Panou counters, today's schedule and the Cereri / Programate tabs.
-- Returns {shop: {id, name, city, daily_capacity, inspection_fee}, quote_expiry_days, bookings: [...]}
-- Booking: the booking's own columns (slot as 'HH:MM'), service_ro/en/icon, client_account
-- (display id, e.g. C-00012), client_no_shows (last 90 days, §6) and, from quote_sent on, the
-- quote the booking is working with (the waiting or the accepted version) with its lines.
-- Clients' profiles stay unreadable for shops: only these two facts come out of them.
-- ---------------------------------------------------------------------------------------------
create function public.list_shop_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_caller();
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
$$;

-- ---------------------------------------------------------------------------------------------
-- get_availability — as before (T03, §4), plus p_exclude_booking: for a member of the shop and a
-- booking of that shop, that booking's current place is not counted, so the day and the time it
-- holds now are offered when it is moved (reschedule_booking excludes it the same way). Ignored
-- for anyone else.
-- ---------------------------------------------------------------------------------------------
drop function public.get_availability(uuid, date, int, date);

create function public.get_availability(p_shop_id uuid, p_from date default null, p_days int default 14,
                                        p_slots_for date default null, p_exclude_booking uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  perform public.require_caller();
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
$$;

grant execute on function
  public.list_shop_bookings(),
  public.get_availability(uuid, date, int, date, uuid)
to authenticated;

update public.schema_version set version = 14;
