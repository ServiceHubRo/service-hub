-- T43 — public pages for search engines: every public shop at /service/<name>-<city>, the shops of
-- a city at /service-auto/<city> (and per service), readable without an account. The build reads
-- them (anon key) to write the ready-made pages and the sitemap (src/lib/publicPages.ts).
-- Public shop columns only: no fiscal data, nothing about clients (no review texts or names).

-- ---------------------------------------------------------------------------------------------
-- Slugs: lower case, no diacritics, words joined by '-' ("Atelier Demo", "Brașov" → atelier-demo-brasov).
-- ---------------------------------------------------------------------------------------------
create function public.slugify(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(public.fold_text(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-')
$$;
revoke execute on function public.slugify(text) from public, anon, authenticated;

-- <name>-<city>, the city left out when the name already holds it; at most 90 characters.
create function public.shop_slug_base(p_name text, p_city text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := public.slugify(p_name);
  v_city text := public.slugify(p_city);
  v_base text;
begin
  if v_name = '' then
    v_name := 'service';
  end if;
  v_base := case
    when v_city = '' or ('-' || v_name || '-') like ('%-' || v_city || '-%') then v_name
    else v_name || '-' || v_city
  end;
  return btrim(left(v_base, 90), '-');
end
$$;
revoke execute on function public.shop_slug_base(text, text) from public, anon, authenticated;

-- Every address a shop has had: an old link (the shop renamed itself) still finds it, and an
-- address is never given to another shop. Server only.
create table public.shop_slugs (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index shop_slugs_shop_idx on public.shop_slugs (shop_id);
alter table public.shop_slugs enable row level security;

-- The current address. Written by the trigger only (no column grant); readable like the shop.
alter table public.shops add column slug text unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- A free address for the shop: the base, else base-2, base-3, …
create function public.shop_free_slug(p_shop_id uuid, p_base text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_candidate text := p_base;
  v_n int := 1;
begin
  perform pg_advisory_xact_lock(hashtext('shop_slug:' || p_base));
  loop
    exit when not exists (select 1 from public.shops s where s.slug = v_candidate and s.id <> p_shop_id)
          and not exists (select 1 from public.shop_slugs x where x.slug = v_candidate and x.shop_id <> p_shop_id);
    v_n := v_n + 1;
    v_candidate := p_base || '-' || v_n;
  end loop;
  return v_candidate;
end
$$;
revoke execute on function public.shop_free_slug(uuid, text) from public, anon, authenticated;

-- A new shop, or a new name or city: a new address when the base changed (a renamed shop keeps
-- its old address in shop_slugs).
create function public.shops_set_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := public.shop_slug_base(new.name, new.city);
begin
  if tg_op = 'UPDATE' and old.slug is not null
     and (old.slug = v_base or old.slug ~ ('^' || v_base || '-[0-9]+$')) then
    new.slug := old.slug;
  else
    new.slug := public.shop_free_slug(new.id, v_base);
  end if;
  return new;
end
$$;
create trigger shops_set_slug before insert or update of name, city on public.shops
  for each row execute function public.shops_set_slug();

create function public.shops_keep_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is not null and (tg_op = 'INSERT' or new.slug is distinct from old.slug) then
    insert into public.shop_slugs (slug, shop_id) values (new.slug, new.id) on conflict (slug) do nothing;
  end if;
  return null;
end
$$;
create trigger shops_keep_slug after insert or update on public.shops
  for each row execute function public.shops_keep_slug();

-- The shops that exist get theirs, oldest first (the first one keeps the plain address). Nothing
-- else on the row changes (updated_at stays as it was).
alter table public.shops disable trigger shops_updated_at;
do $$
declare
  r record;
begin
  for r in select id, name, city from public.shops order by created_at, id loop
    update public.shops set slug = public.shop_free_slug(r.id, public.shop_slug_base(r.name, r.city)) where id = r.id;
  end loop;
end $$;
alter table public.shops enable trigger shops_updated_at;

-- ---------------------------------------------------------------------------------------------
-- What a public page shows of a shop (one call, public columns only). Not callable from the API.
-- ---------------------------------------------------------------------------------------------
create function public.public_shop_json(p_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shop', jsonb_build_object(
      'id', s.id,
      'slug', s.slug,
      'name', s.name,
      'description', s.description,
      'logo_url', s.logo_url,
      'street', s.street,
      'city', btrim(s.city),
      'city_slug', public.slugify(btrim(s.city)),
      'county', s.county,
      'postal_code', s.postal_code,
      'phone', s.phone,
      'phone2', s.phone2,
      'website', s.website,
      'facebook', s.facebook,
      'year_established', s.year_established,
      'latitude', s.latitude,
      'longitude', s.longitude,
      'daily_capacity', s.daily_capacity,
      'cars_per_slot', s.cars_per_slot,
      'min_notice_hours', s.min_notice_hours,
      'max_advance_days', s.max_advance_days,
      'cancel_deadline_hours', s.cancel_deadline_hours,
      'inspection_fee', s.inspection_fee,
      'auto_confirm', s.auto_confirm,
      'slot_minutes', s.slot_minutes,
      'amenities', to_jsonb(s.amenities),
      'updated_at', s.updated_at
    ),
    'founder', s.founder,
    'response', public.shop_response_badge(s.id),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('id', ph.id, 'url', ph.url) order by ph.position, ph.created_at)
      from public.shop_photos ph where ph.shop_id = s.id
    ), '[]'::jsonb),
    'rating', (
      select jsonb_build_object('review_count', count(*)::int, 'average', round(avg(r.rating), 2))
      from public.reviews r where r.shop_id = s.id and r.removed_at is null
    ),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday', h.weekday,
               'is_closed', h.is_closed,
               'open_time', to_char(h.open_time, 'HH24:MI'),
               'close_time', to_char(h.close_time, 'HH24:MI'))
             order by h.weekday)
      from public.shop_hours h where h.shop_id = s.id
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start_date', c.start_date, 'end_date', c.end_date, 'label', c.label)
             order by c.start_date, c.end_date)
      from public.shop_closures c where c.shop_id = s.id and c.end_date >= public.bucharest_today()
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'slug', public.slugify(sv.name_ro), 'icon', sv.icon, 'name_ro', sv.name_ro, 'name_en', sv.name_en,
               'category_key', c.key, 'category_ro', c.name_ro, 'category_en', c.name_en)
             order by c.position, sv.position)
      from public.shop_services ss
      join public.services sv on sv.id = ss.service_id and sv.enabled
      join public.service_categories c on c.key = sv.category_key
      where ss.shop_id = s.id
    ), '[]'::jsonb),
    -- The shop's offers as a visitor would get them (no account yet: a new client).
    'offers', jsonb_build_object(
      'new_client', case
        when s.new_client_offer is not null
          and (s.new_client_offer_until is null or s.new_client_offer_until >= public.bucharest_today())
        then jsonb_build_object('percent', s.new_client_offer, 'until', s.new_client_offer_until,
          'services', case when s.new_client_offer_services is null then null
                           else public.service_names(s.new_client_offer_services) end) end,
      'quiet_day', case when s.quiet_day_offer is not null and cardinality(s.quiet_days) > 0
        then jsonb_build_object('percent', s.quiet_day_offer, 'days', to_jsonb(s.quiet_days)) end)
  )
  from public.shops s
  where s.id = p_shop_id
$$;
revoke execute on function public.public_shop_json(uuid) from public, anon, authenticated;

-- /service/<slug>: a public shop by its address, current or old (the page then moves to the
-- current one). `shop_not_found` for anything else.
create function public.public_shop_page(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  if p_slug is null or char_length(p_slug) > 120 then
    perform public.fail('shop_not_found');
  end if;
  select s.id into v_shop from public.shops s where s.slug = lower(p_slug);
  if v_shop is null then
    select x.shop_id into v_shop from public.shop_slugs x where x.slug = lower(p_slug);
  end if;
  if v_shop is null or not public.is_shop_public(v_shop) then
    perform public.fail('shop_not_found');
  end if;
  return public.public_shop_json(v_shop);
end
$$;
revoke execute on function public.public_shop_page(text) from public;
grant execute on function public.public_shop_page(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cities: one per spelling-insensitive name, with at least one public shop. The name shown is
-- the spelling with diacritics when there is one.
-- ---------------------------------------------------------------------------------------------
create function public.public_cities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.name, 'shop_count', x.n)
                            order by x.n desc, x.name), '[]'::jsonb)
  from (
    select public.slugify(btrim(s.city)) as slug,
           (array_agg(btrim(s.city) order by (lower(btrim(s.city)) = public.fold_text(btrim(s.city))), btrim(s.city)))[1] as name,
           count(*)::int as n
    from public.shops s
    where public.is_shop_public(s.id) and public.slugify(btrim(s.city)) <> ''
    group by public.slugify(btrim(s.city))
  ) x
$$;
revoke execute on function public.public_cities() from public;
grant execute on function public.public_cities() to anon, authenticated;

-- /service-auto/<city> (and /service-auto/<city>/<service>, filtered in the browser and at build):
-- the public shops of the city in the order of search (weighted rating, §8; never paid), each
-- with the services it offers, and the services offered in the city. `page_not_found` when the
-- city has no public shop.
create function public.public_city_page(p_city_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_name text;
  v_county text;
begin
  if p_city_slug is null or char_length(p_city_slug) > 120 then
    perform public.fail('page_not_found');
  end if;
  select array_agg(s.id),
         (array_agg(btrim(s.city) order by (lower(btrim(s.city)) = public.fold_text(btrim(s.city))), btrim(s.city)))[1],
         mode() within group (order by nullif(btrim(s.county), ''))
  into v_ids, v_name, v_county
  from public.shops s
  where public.slugify(btrim(s.city)) = lower(p_city_slug) and public.is_shop_public(s.id);
  if v_ids is null then
    perform public.fail('page_not_found');
  end if;

  return jsonb_build_object(
    'city', jsonb_build_object('slug', lower(p_city_slug), 'name', v_name, 'county', v_county),
    'shops', (
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'slug', s.slug, 'name', s.name, 'street', s.street, 'city', btrim(s.city),
               'logo_url', s.logo_url, 'latitude', s.latitude, 'longitude', s.longitude,
               'review_count', r.review_count, 'average', r.average, 'founder', s.founder,
               'service_ids', coalesce((
                 select jsonb_agg(ss.service_id order by ss.service_id)
                 from public.shop_services ss
                 join public.services sv on sv.id = ss.service_id and sv.enabled
                 where ss.shop_id = s.id), '[]'::jsonb))
             order by r.weighted_score desc, r.review_count desc, s.name, s.id)
      from public.shops s
      join public.shop_ratings r on r.shop_id = s.id
      where s.id = any (v_ids)
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'slug', public.slugify(x.name_ro), 'icon', x.icon, 'name_ro', x.name_ro, 'name_en', x.name_en,
               'category_key', x.key, 'category_ro', x.category_ro, 'category_en', x.category_en, 'shop_count', x.n)
             order by x.cat_position, x.position)
      from (
        select sv.id, sv.icon, sv.name_ro, sv.name_en, sv.position, c.key, c.name_ro as category_ro,
               c.name_en as category_en, c.position as cat_position, count(*)::int as n
        from public.shop_services ss
        join public.services sv on sv.id = ss.service_id and sv.enabled
        join public.service_categories c on c.key = sv.category_key
        where ss.shop_id = any (v_ids)
        group by sv.id, c.key
      ) x
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.public_city_page(text) from public;
grant execute on function public.public_city_page(text) to anon, authenticated;

-- The shop's own link (/atelier/<id>, T31b) now opens the public page: its address too.
create or replace function public.shop_link_preview(p_shop_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.id is null or not public.is_shop_public(s.id) then null else jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
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

-- get_availability: as before, plus visitors without an account (public shops, client rules).
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
  -- A visitor without an account (the public shop page, T43) sees a public shop by the client rules.
  if auth.uid() is null then
    if not public.is_shop_public(p_shop_id) then
      perform public.fail('shop_not_found');
    end if;
  else
    perform public.require_reader();
  end if;
  select * into v_shop from public.shops where id = p_shop_id;
  if not found or (auth.uid() is not null and not public.can_read_shop(p_shop_id)) then
    perform public.fail('shop_not_found');
  end if;
  v_member := auth.uid() is not null and public.is_shop_member(p_shop_id);
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
-- The visitor's booking steps on the public page (service, day, time; the account is asked for
-- at the last step) read the free places of a public shop.
grant execute on function public.get_availability(uuid, date, integer, date, uuid) to anon;

update public.schema_version set version = 84;
