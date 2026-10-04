-- The loyalty programme is withdrawn (Eduard, 4 Oct): shops may not want to give discounts, and the
-- new-client offer stays the one discount on Service-Hub.
--   * No new promises: the bookings_offer_loyalty trigger and its helpers are dropped.
--   * my_loyalty(), the cards' and the shop page's loyalty fields go; the owner can no longer set it.
--   * Kept, so nothing is lost: bookings.loyalty_percent / loyalty_level (a discount already promised
--     is still shown to both sides and honored in the quote, list_shop_bookings keeps them) and the
--     shops' loyalty_l1 / loyalty_l2 values (no longer used).

drop trigger bookings_offer_loyalty on public.bookings;
drop function public.bookings_offer_loyalty();
drop function public.my_loyalty();
revoke update (loyalty_l1, loyalty_l2) on public.shops from authenticated;

drop function public.search_card_extras(uuid[], date);
create function public.search_card_extras(p_shop_ids uuid[], p_day date default null)
returns table (shop_id uuid, auto_confirm boolean, free_date date, free_slot text, amenities text[], response text)
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
  select s.id, s.auto_confirm, f.day, to_char(f.slot, 'HH24:MI'), s.amenities, public.shop_response_badge(s.id)
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
      'slot_minutes', v_shop.slot_minutes,
      'amenities', to_jsonb(v_shop.amenities)
    ),
    'response', public.shop_response_badge(p_shop_id),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.url) order by ph.position, ph.created_at)
      from public.shop_photos ph where ph.shop_id = p_shop_id
    ), '[]'::jsonb),
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

drop function public.client_jobs_done_at(uuid, uuid);
drop function public.loyalty_level_for(int);
drop function public.loyalty_percent_at(smallint, smallint, int);

update public.schema_version set version = 57;
