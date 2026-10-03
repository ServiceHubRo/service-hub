-- Loyal clients (T28c, "like Booking's Genius, without payments through us"). The platform takes no
-- part in the money: a shop chooses whether to give clients with a level a discount on labor, the
-- booking keeps the percent promised (like the new-client offer, T23), and the shop takes it off the
-- quote. Nobody loses what was promised: a later change of the shop's choice or of the client's
-- level never touches a booking already made.
--   * Levels, from the client's finished jobs (done) on Service-Hub in the last 24 months, at any
--     shop: level 1 from 2 jobs, level 2 from 5. Only a shop can finish a job (with the odometer).
--   * shops.loyalty_l1 (5 or 10 %) and loyalty_l2 (5, 10 or 15 %, not less than level 1's), owner only.
--   * bookings.loyalty_percent / loyalty_level, written by a BEFORE INSERT trigger when the booking
--     gets no new-client offer (the two never add up), whatever path creates the booking.
--   * my_loyalty(): the client's level, jobs and how many to the next one.

alter table public.shops
  add column loyalty_l1 smallint check (loyalty_l1 in (5, 10)),
  add column loyalty_l2 smallint check (loyalty_l2 in (5, 10, 15)),
  add constraint shops_loyalty_order check (loyalty_l1 is null or loyalty_l2 is null or loyalty_l2 >= loyalty_l1);
grant update (loyalty_l1, loyalty_l2) on public.shops to authenticated;

alter table public.bookings
  add column loyalty_percent smallint check (loyalty_percent between 1 and 100),
  add column loyalty_level smallint check (loyalty_level in (1, 2));

-- Finished jobs of a client in the last 24 months (0 for anyone else).
create function public.client_jobs_done(p_client_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.bookings b
  where p_client_id is not null and b.client_id = p_client_id and b.status = 'done'
    and b.done_at > now() - interval '730 days'
$$;
revoke execute on function public.client_jobs_done(uuid) from public, anon, authenticated;

create function public.loyalty_level_for(p_jobs int)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when p_jobs >= 5 then 2 when p_jobs >= 2 then 1 else 0 end
$$;
revoke execute on function public.loyalty_level_for(int) from public, anon, authenticated;

-- The percent a shop gives a level: level 2 falls back to level 1's when the shop set only that.
create function public.loyalty_percent_at(p_l1 smallint, p_l2 smallint, p_level int)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_level when 2 then coalesce(p_l2, p_l1) when 1 then p_l1 end
$$;
revoke execute on function public.loyalty_percent_at(smallint, smallint, int) from public, anon, authenticated;

create function public.bookings_offer_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level int;
  v_shop public.shops%rowtype;
begin
  new.loyalty_percent := null;
  new.loyalty_level := null;
  -- Runs after bookings_offer (name order): a new-client offer wins, they never add up.
  if new.client_id is null or new.offer_percent is not null then
    return new;
  end if;
  v_level := public.loyalty_level_for(public.client_jobs_done(new.client_id));
  if v_level = 0 then
    return new;
  end if;
  select * into v_shop from public.shops where id = new.shop_id;
  new.loyalty_percent := public.loyalty_percent_at(v_shop.loyalty_l1, v_shop.loyalty_l2, v_level);
  if new.loyalty_percent is not null then
    new.loyalty_level := v_level;
  end if;
  return new;
end
$$;
create trigger bookings_offer_loyalty before insert on public.bookings
  for each row execute function public.bookings_offer_loyalty();

create function public.my_loyalty()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_jobs int;
  v_level int;
begin
  v_me := public.require_reader();
  v_jobs := case when v_me.role = 'client' then public.client_jobs_done(v_me.id) else 0 end;
  v_level := public.loyalty_level_for(v_jobs);
  return jsonb_build_object(
    'jobs', v_jobs,
    'level', v_level,
    'next_level', case when v_level < 2 then v_level + 1 end,
    'jobs_to_next', case v_level when 0 then 2 - v_jobs when 1 then 5 - v_jobs end,
    'shops', (select count(*) from public.shops s
              where (s.loyalty_l1 is not null or s.loyalty_l2 is not null) and public.is_shop_public(s.id)));
end
$$;
revoke execute on function public.my_loyalty() from public, anon;
grant execute on function public.my_loyalty() to authenticated;

drop function public.search_card_extras(uuid[], date);
create function public.search_card_extras(p_shop_ids uuid[], p_day date default null)
returns table (shop_id uuid, auto_confirm boolean, free_date date, free_slot text, amenities text[], response text,
               loyalty_offered boolean, loyalty smallint)
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
  select s.id, s.auto_confirm, f.day, to_char(f.slot, 'HH24:MI'), s.amenities, public.shop_response_badge(s.id),
         s.loyalty_l1 is not null or s.loyalty_l2 is not null,
         public.loyalty_percent_at(s.loyalty_l1, s.loyalty_l2, me.level)
  from ids
  join public.shops s on s.id = ids.id
  cross join win
  cross join (select public.loyalty_level_for(public.client_jobs_done(auth.uid())) as level) me
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
    'loyalty', jsonb_build_object(
      'l1', v_shop.loyalty_l1,
      'l2', v_shop.loyalty_l2,
      -- The caller's own percent here, by their level now (null when none).
      'yours', public.loyalty_percent_at(v_shop.loyalty_l1, v_shop.loyalty_l2,
                                          public.loyalty_level_for(public.client_jobs_done(auth.uid())))),
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

CREATE OR REPLACE FUNCTION public.list_shop_bookings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
          'loyalty_percent', b.loyalty_percent,
          'loyalty_level', b.loyalty_level,
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
$$;

update public.schema_version set version = 53;
