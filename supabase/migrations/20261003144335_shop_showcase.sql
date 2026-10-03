-- The shop's window (T28b, "like Booking, for car shops"): photos of the workshop, facilities the
-- client can filter by, and how quickly the shop answers requests.
--   * shop_photos: up to 10 per shop, in the public bucket shop-photos under `<shop_id>/…` (images,
--     5 MB; the app shrinks them before uploading). Every signed-in user who may read the shop sees
--     them; the shop's members add, order and remove them.
--   * shops.amenities: from a fixed list, set by the owner.
--   * shop_response_badge(shop): 'hour' (answers within an hour) or 'hours' (within 4 hours), from
--     the requests of the last 90 days the shop itself answered (confirmed or declined; an instant
--     confirmation is no answer) — only with at least 3 such answers and at most 1 in 5 requests
--     left unanswered; else null. Shown on the search cards and the shop page.
--   search_card_extras (T28a) also answers the amenities and the badge, for the cards and filters.

-- ---------------------------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy shop_photos_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-photos' and public.is_shop_member(public.try_uuid((storage.foldername(name))[1])));
create policy shop_photos_files_select on storage.objects for select to authenticated
  using (bucket_id = 'shop-photos' and public.is_shop_member(public.try_uuid((storage.foldername(name))[1])));
create policy shop_photos_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'shop-photos' and public.is_shop_member(public.try_uuid((storage.foldername(name))[1])));

create table public.shop_photos (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  path text not null check (char_length(path) <= 300),
  url text not null check (char_length(url) <= 1000),
  position int not null default 0 check (position between 0 and 1000),
  created_at timestamptz not null default now(),
  unique (shop_id, path)
);
create index shop_photos_shop_idx on public.shop_photos (shop_id, position, created_at);
alter table public.shop_photos enable row level security;

create policy shop_photos_read on public.shop_photos for select to authenticated
  using (public.can_read_shop(shop_id));
create policy shop_photos_add on public.shop_photos for insert to authenticated
  with check (public.is_shop_member(shop_id)
              and path like shop_id::text || '/%'
              and url like '%/storage/v1/object/public/shop-photos/' || shop_id::text || '/%');
create policy shop_photos_order on public.shop_photos for update to authenticated
  using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
create policy shop_photos_remove on public.shop_photos for delete to authenticated
  using (public.is_shop_member(shop_id));
grant select, delete on public.shop_photos to authenticated;
grant insert (shop_id, path, url, position) on public.shop_photos to authenticated;
grant update (position) on public.shop_photos to authenticated;

-- At most 10 photos a shop (counted under the shop's lock).
create function public.shop_photos_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Someone else's shop is refused by the row's policy; only a member is counted against.
  if not public.is_shop_member(new.shop_id) then
    return new;
  end if;
  perform 1 from public.shops where id = new.shop_id for no key update;
  if (select count(*) from public.shop_photos where shop_id = new.shop_id) >= 10 then
    perform public.fail('too_many_photos', jsonb_build_object('limit', 10));
  end if;
  return new;
end
$$;
create trigger shop_photos_limit before insert on public.shop_photos
  for each row execute function public.shop_photos_limit();

-- ---------------------------------------------------------------------------------------------
-- Facilities
-- ---------------------------------------------------------------------------------------------
alter table public.shops add column amenities text[] not null default '{}'
  check (amenities <@ array['waiting_room', 'wifi', 'coffee', 'courtesy_car', 'card_payment', 'pickup', 'hybrid_ev', 'warranty']::text[] and cardinality(amenities) <= 8);
grant update (amenities) on public.shops to authenticated;

-- ---------------------------------------------------------------------------------------------
-- How quickly the shop answers
-- ---------------------------------------------------------------------------------------------
create function public.shop_response_badge(p_shop_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with req as (
    select case
             -- Confirmed by the shop (an instant confirmation has confirmed_at = created_at).
             when b.confirmed_at is not null and b.confirmed_at <> b.created_at then b.confirmed_at - b.created_at
             when b.status = 'declined' then b.status_changed_at - b.created_at
           end as took,
           b.closed_reason = 'unanswered' as missed
    from public.bookings b
    where b.shop_id = p_shop_id
      and b.created_at > now() - interval '90 days'
      and (b.confirmed_at is distinct from b.created_at)
      and (b.confirmed_at is not null or b.status = 'declined' or b.closed_reason = 'unanswered')
  ),
  s as (
    select count(*) filter (where took is not null) as answered,
           count(*) filter (where missed) as missed,
           percentile_cont(0.5) within group (order by extract(epoch from took)) filter (where took is not null) as median_s
    from req
  )
  select case
           when s.answered < 3 or s.missed * 5 > s.answered + s.missed then null
           when s.median_s <= 3600 then 'hour'
           when s.median_s <= 4 * 3600 then 'hours'
         end
  from s
$$;
revoke execute on function public.shop_response_badge(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The search cards (T28a) with the facilities and the badge
-- ---------------------------------------------------------------------------------------------
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

update public.schema_version set version = 52;
