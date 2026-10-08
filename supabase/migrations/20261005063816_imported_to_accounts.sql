-- T31b: a client whose phone a shop imported (T31a) finds, once the phone is confirmed, the cars
-- in the Garage and the old jobs in each car's history, marked as imported by that shop.
--
-- The tie is the confirmed phone only (a code by SMS, or the admin): never an unconfirmed one, so a
-- number typed by someone else cannot open another person's history. It is made when the phone is
-- confirmed (or changed while confirmed) and after each import chunk, for the clients already
-- there. Each imported car goes to the Garage once (`added_to_garage_at`): one the client deletes
-- does not come back with a later import. Nothing is ever sent to the client.

alter table public.shop_clients add column client_id uuid references public.profiles (id) on delete set null;
create index shop_clients_client_idx on public.shop_clients (client_id) where client_id is not null;
alter table public.shop_client_cars add column added_to_garage_at timestamptz;

-- A phone as digits, the way people write it: `0722 111 222`, `+40 722…`, `0040…` → `40722111222`.
create function public.phone_digits(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(case
    when d ~ '^0[237][0-9]{8}$' then '4' || d
    when d ~ '^00' then substr(d, 3)
    else d end, '')
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x
$$;
-- Index expression on profiles: whoever updates a profile row evaluates it.
revoke execute on function public.phone_digits(text) from public, anon;
grant execute on function public.phone_digits(text) to authenticated;
create index profiles_phone_digits_idx on public.profiles (public.phone_digits(phone)) where phone is not null;

-- Ties the shops' imported clients to the confirmed client accounts with the same phone, for one
-- account (p_profile) or one shop (p_shop), then puts their cars in the Garage. Returns the cars added.
create function public.link_imported(p_profile uuid, p_shop uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cars int;
begin
  update public.shop_clients sc
    set client_id = p.id
  from public.profiles p
  where sc.client_id is null
    and public.phone_digits(sc.phone) = public.phone_digits(p.phone)
    and p.role = 'client'
    and p.deleted_at is null
    and (p.phone_verified_at is not null or p.phone_verified_by_admin)
    and (p_profile is null or p.id = p_profile)
    and (p_shop is null or sc.shop_id = p_shop);

  with eligible as (
    select c.id, sc.client_id as owner_id, c.make, c.model, c.year, c.plate, c.vin, c.plate_norm
    from public.shop_client_cars c
    join public.shop_clients sc on sc.id = c.client_id
    where sc.client_id is not null
      and c.added_to_garage_at is null
      and (p_profile is null or sc.client_id = p_profile)
      and (p_shop is null or c.shop_id = p_shop)
  ), fresh as (
    -- One per car (the same plate from two shops comes once), none already in the Garage.
    select distinct on (e.owner_id, coalesce(e.plate_norm, lower(e.make) || '|' || lower(e.model))) e.*
    from eligible e
    where not exists (
      select 1 from public.cars x
      where x.owner_id = e.owner_id
        and (case when e.plate_norm is not null
                  then regexp_replace(upper(coalesce(x.plate, '')), '[^A-Z0-9]', '', 'g') = e.plate_norm
                  else lower(x.make) = lower(e.make) and lower(x.model) = lower(coalesce(nullif(e.model, ''), '—')) end))
    order by e.owner_id, coalesce(e.plate_norm, lower(e.make) || '|' || lower(e.model)), e.id
  ), added as (
    insert into public.cars (owner_id, make, model, year, plate, vin)
    select owner_id, make, coalesce(nullif(btrim(model), ''), '—'), year, plate, vin from fresh
    returning id
  )
  select count(*) into v_cars from added;

  update public.shop_client_cars c
    set added_to_garage_at = now()
  from public.shop_clients sc
  where sc.id = c.client_id
    and sc.client_id is not null
    and c.added_to_garage_at is null
    and (p_profile is null or sc.client_id = p_profile)
    and (p_shop is null or c.shop_id = p_shop);
  return v_cars;
end
$$;
revoke execute on function public.link_imported(uuid, uuid) from public, anon, authenticated;

-- When a client's phone becomes confirmed (or changes while confirmed).
create function public.profiles_link_imported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A changed number lets go of what the old one had brought (confirmed again or not).
  if old.phone is distinct from new.phone then
    update public.shop_clients set client_id = null
    where client_id = new.id and public.phone_digits(phone) is distinct from public.phone_digits(new.phone);
  end if;
  if new.role = 'client' and new.phone is not null and new.deleted_at is null
     and (new.phone_verified_at is not null or new.phone_verified_by_admin)
     and (old.phone is distinct from new.phone
          or (old.phone_verified_at is null and not old.phone_verified_by_admin)) then
    perform public.link_imported(new.id, null);
  end if;
  return new;
end
$$;
revoke execute on function public.profiles_link_imported() from public, anon, authenticated;
create trigger profiles_link_imported after update of phone, phone_verified_at, phone_verified_by_admin on public.profiles
  for each row execute function public.profiles_link_imported();

-- After each chunk of an import, the clients already on Service-Hub get theirs.
create function public.shop_imports_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.row_count > old.row_count then
    perform public.link_imported(null, new.shop_id);
  end if;
  return new;
end
$$;
revoke execute on function public.shop_imports_link() from public, anon, authenticated;
create trigger shop_imports_link after update of row_count on public.shop_imports
  for each row execute function public.shop_imports_link();

-- The client's imported jobs: day, work, odometer, amount, the car as the file had it, and the shop.
create function public.my_imported_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_reader();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', j.id,
        'day', j.day,
        'work', j.work,
        'odometer', j.odometer,
        'cost', j.cost,
        'car_snapshot', j.car_snapshot,
        'shop_id', s.id,
        'shop_name', s.name,
        'shop_city', s.city
      ) order by j.day desc, j.id desc)
    from public.imported_jobs j
    join public.shop_clients sc on sc.id = j.client_id
    join public.shops s on s.id = j.shop_id
    where sc.client_id = auth.uid()), '[]'::jsonb);
end
$$;
revoke execute on function public.my_imported_jobs() from public, anon;
grant execute on function public.my_imported_jobs() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The shop's own link (T31b): `/atelier/<id>` opens for anyone, signed in or not.
-- ---------------------------------------------------------------------------------------------
create function public.shop_link_preview(p_shop_id uuid)
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
revoke execute on function public.shop_link_preview(uuid) from public;
grant execute on function public.shop_link_preview(uuid) to anon, authenticated;

update public.schema_version set version = 63;
