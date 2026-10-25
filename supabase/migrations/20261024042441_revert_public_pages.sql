-- T43 withdrawn (Eduard, 24 Oct 2026): the public pages for search engines are not wanted. This
-- undoes migration `public_pages` exactly; it had reached only the test project (its pull request
-- was never merged), and both files are kept so every project's migration history matches.
-- Nothing else is touched: the shop addresses it added are dropped with it.

-- The visitor's availability: signed-in only again, as before.
revoke execute on function public.get_availability(uuid, date, integer, date, uuid) from anon;
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

-- The shop's own link: without the address of the public page, as before.
create or replace function public.shop_link_preview(p_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.id is null or not public.is_shop_public(s.id) then null else jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'city', s.city,
    'street', s.street,
    'logo_url', s.logo_url,
    'rating', (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.shop_id = s.id and r.removed_at is null),
    'review_count', (select count(*) from public.reviews r where r.shop_id = s.id and r.removed_at is null)
  ) end
  from (select p_shop_id as id) x
  left join public.shops s on s.id = x.id
$$;

drop function public.public_city_page(text);
drop function public.public_cities();
drop function public.public_shop_page(text);
drop function public.public_shop_json(uuid);

drop trigger shops_keep_slug on public.shops;
drop trigger shops_set_slug on public.shops;
drop function public.shops_keep_slug();
drop function public.shops_set_slug();
drop function public.shop_free_slug(uuid, text);
drop function public.shop_slug_base(text, text);
drop function public.slugify(text);

drop table public.shop_slugs;
alter table public.shops drop column slug;

update public.schema_version set version = 85;
