-- T06 — Client search and the shop page: search matches word by word, the city chips come from the
-- data, the shop page is read in one call with public columns only, and reviews are readable only
-- together with their shop.
-- ARCHITECTURE §2 (reviews), §5, §8; FR §3.1, §3.2; P11, P11b, P16, P16d.

-- ---------------------------------------------------------------------------------------------
-- Reviews: a visible review is readable by whoever may read its shop (search, shop page, clients
-- with a booking there) — no longer by every signed-in user for every shop, public or not.
-- Authors, the shop's members and admin keep seeing removed ones, as before.
-- ---------------------------------------------------------------------------------------------
drop policy reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (
    (removed_at is null and public.can_read_shop(shop_id))
    or client_id = auth.uid()
    or public.is_shop_member(shop_id)
    or public.is_admin()
  );

-- ---------------------------------------------------------------------------------------------
-- Search words: the query folded (no case, no diacritics) and split into words, each with an
-- optional ending — an English plural "s" ("brakes" → "brake") and then a last vowel ("frane" →
-- "fran", "brake" → "brak") — so singular and plural, Romanian and English all meet the catalog.
-- At most 8 words. Same rule as searchWords() in src/lib/text.ts.
-- ---------------------------------------------------------------------------------------------
create function public.search_words(p_q text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select case when char_length(w2) >= 4 and right(w2, 1) in ('a', 'e', 'i', 'o', 'u', 'y') then left(w2, -1) else w2 end
    from (
      select case when char_length(w) >= 5 and right(w, 1) = 's' then left(w, -1) else w end as w2, n
      from regexp_split_to_table(public.fold_text(coalesce(p_q, '')), '[^a-z0-9]+') with ordinality as t(w, n)
      where w <> ''
    ) x
    order by n
    limit 8
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- search_shops, word by word (replaces the T03 version; same signature, same result columns).
-- A shop matches when every word of the query is found in its name or city, or — for the words
-- that are not — in one offered service (its name or its category, RO or EN). So "schimb ulei",
-- "oil change", "brakes" and "frane brasov" all work. When services were needed, the service is
-- named ("Oferă: …"); when the name or city alone matched, no service is named unless the
-- category filter picks one. Public shops only (§5); order is the weighted rating only (§8):
-- score desc, review count desc, name asc — filters narrow, never reorder. "distance" sorts by
-- straight-line distance from (p_lat, p_lng), used for this query only and never stored.
-- ---------------------------------------------------------------------------------------------
create or replace function public.search_shops(
  p_q text default null,
  p_category text default null,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_sort text default 'rating'
)
returns table (
  shop_id uuid,
  name text,
  city text,
  street text,
  logo_url text,
  latitude double precision,
  longitude double precision,
  review_count int,
  average numeric,
  weighted_score numeric,
  service_count int,
  matched_service_id text,
  matched_service_ro text,
  matched_service_en text,
  distance_km double precision,
  is_favorite boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_words text[] := public.search_words(p_q);
  v_cat text := nullif(btrim(p_category), '');
  v_city text := public.fold_text(nullif(btrim(p_city), ''));
  v_lat double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end;
  v_lng double precision := case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end;
  v_by_distance boolean;
begin
  perform public.require_caller();
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
$$;

-- ---------------------------------------------------------------------------------------------
-- search_cities — the cities that have public shops (§5), for the city chips on Caută. Never a
-- hard-coded list. "Brasov", "Brașov" and "Braşov" are one city, shown with diacritics when any
-- shop wrote it that way. Most shops first, then by name.
-- ---------------------------------------------------------------------------------------------
create function public.search_cities()
returns table (city text, shop_count int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_caller();
  return query
  select
    (array_agg(btrim(s.city) order by (lower(btrim(s.city)) = public.fold_text(btrim(s.city))), btrim(s.city)))[1],
    count(*)::int
  from public.shops s
  where public.is_shop_public(s.id) and btrim(s.city) <> ''
  group by public.fold_text(btrim(s.city))
  order by count(*) desc, 1;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- get_shop_page — everything the client's shop page shows (FR §3.2, P11b), in one call:
--   shop      public columns only (never shop_billing, never preferences or internal stamps)
--   bookable  is_shop_public(): false for a shop the caller may still read (a client with an old
--             booking there) but that takes no bookings now
--   rating    review count and average (removed reviews excluded)
--   hours     the seven weekdays; closures from today on (Europe/Bucharest)
--   services  enabled offered services with their category, in catalog order
--   reviews   newest first, visible only, with the shop's public reply; at most 50
-- Fails with shop_not_found when the caller may not read the shop.
-- ---------------------------------------------------------------------------------------------
create function public.get_shop_page(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_today date := public.bucharest_today();
begin
  perform public.require_caller();
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
$$;

grant execute on function
  public.search_cities(),
  public.get_shop_page(uuid)
to authenticated;

update public.schema_version set version = 12;
