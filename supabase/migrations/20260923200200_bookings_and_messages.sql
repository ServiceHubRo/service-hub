-- T02 · 3/6 — Client data (cars, favorites), bookings, quotes, reviews, ratings, threads, messages.
-- ARCHITECTURE §2 (Client data, Bookings and quotes, Messages), §3, §8.
-- Every booking/quote/review/message write goes through RPC functions (T03): no browser grants here
-- except the client's own cars.

-- ---------------------------------------------------------------------------------------------
-- cars — owner only. Shops have no access at all.
-- ---------------------------------------------------------------------------------------------
create table public.cars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  make text not null check (char_length(btrim(make)) between 1 and 60),
  model text not null check (char_length(btrim(model)) between 1 and 60),
  year int check (year between 1900 and 2100),
  plate text check (char_length(plate) <= 20),
  plate_norm text generated always as (
    nullif(upper(regexp_replace(coalesce(plate, ''), '[\s-]', '', 'g')), '')
  ) stored,
  vin text check (vin is null or public.is_valid_vin(vin)),
  itp_expiry date,
  rca_expiry date,
  vignette_expiry date,
  -- Thresholds already notified per document and expiry date, e.g. {"itp":{"2026-11-02":[30,7]}}.
  reminded jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cars_owner_idx on public.cars (owner_id);
alter table public.cars enable row level security;

create function public.cars_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.vin := public.normalize_code(new.vin);
  new.plate := nullif(btrim(new.plate), '');
  new.make := btrim(new.make);
  new.model := btrim(new.model);
  return new;
end
$$;
create trigger cars_normalize before insert or update on public.cars
  for each row execute function public.cars_normalize();
create trigger cars_updated_at before update on public.cars
  for each row execute function public.set_updated_at();

grant select, delete on public.cars to authenticated;
grant insert (make, model, year, plate, vin, itp_expiry, rca_expiry, vignette_expiry)
  on public.cars to authenticated;
grant update (make, model, year, plate, vin, itp_expiry, rca_expiry, vignette_expiry)
  on public.cars to authenticated;
create policy cars_select_own on public.cars for select to authenticated
  using (owner_id = auth.uid());
create policy cars_insert_own on public.cars for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client')
  );
create policy cars_update_own on public.cars for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy cars_delete_own on public.cars for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- favorites — a client's own list. Toggled through toggle_favorite() (T03).
-- ---------------------------------------------------------------------------------------------
create table public.favorites (
  client_id uuid not null references public.profiles (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, shop_id)
);
alter table public.favorites enable row level security;
grant select on public.favorites to authenticated;
create policy favorites_select_own on public.favorites for select to authenticated
  using (client_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- bookings — status machine in §3. No insert/update grants for the browser.
-- A shop with bookings cannot be deleted (history must survive); a deleted client leaves the
-- booking with its snapshots and client_id = null.
-- ---------------------------------------------------------------------------------------------
create sequence public.booking_ref_seq;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default public.format_sequence_id('P', nextval('public.booking_ref_seq'), 6),
  shop_id uuid not null references public.shops (id) on delete restrict,
  client_id uuid references public.profiles (id) on delete set null,
  service_id text not null references public.services (id),
  -- Snapshots taken at creation; editing or deleting the car or profile never changes them.
  client_name text,
  client_phone text,
  client_lang text not null default 'ro' check (client_lang in ('ro', 'en')),
  car_id uuid references public.cars (id) on delete set null,
  car_snapshot jsonb not null default '{}'::jsonb,
  -- Local time in Europe/Bucharest.
  date date not null,
  slot time not null,
  note text check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in (
    'pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress',
    'done', 'declined', 'cancelled', 'quote_refused', 'expired', 'no_show'
  )),
  status_changed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  inspection_started_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'shop', 'admin')),
  cancel_reason text check (char_length(cancel_reason) <= 500),
  decline_reason text check (char_length(decline_reason) <= 500),
  work text check (char_length(work) <= 4000),
  cost numeric(10,2) check (cost >= 0),
  odometer int check (odometer between 100 and 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_shop_date_status_idx on public.bookings (shop_id, date, status);
create index bookings_client_created_idx on public.bookings (client_id, created_at desc);
create index bookings_plate_norm_idx on public.bookings ((car_snapshot->>'plate_norm'));
alter table public.bookings enable row level security;
create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

grant select on public.bookings to authenticated;
create policy bookings_select on public.bookings for select to authenticated
  using (client_id = auth.uid() or public.is_shop_member(shop_id) or public.is_admin());

-- Who may read a booking (and its quotes). Answers only about the caller.
create function public.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and (b.client_id = auth.uid() or public.is_shop_member(b.shop_id) or public.is_admin())
  )
$$;
grant execute on function public.can_read_booking(uuid) to authenticated;

-- A client keeps seeing a shop they booked with, even after it stops being public.
create or replace function public.can_read_shop(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_shop_public(p_shop_id)
      or public.is_shop_member(p_shop_id)
      or public.is_admin()
      or exists (
        select 1 from public.bookings b where b.shop_id = p_shop_id and b.client_id = auth.uid()
      )
$$;

-- ---------------------------------------------------------------------------------------------
-- quotes + quote_items — immutable once sent; "edit" = new version, old one `superseded`.
-- ---------------------------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  version int not null check (version >= 1),
  status text not null default 'sent' check (status in (
    'sent', 'accepted', 'partially_accepted', 'refused', 'expired', 'superseded', 'withdrawn'
  )),
  note text check (char_length(note) <= 2000),
  inspection_fee numeric(10,2) not null default 0 check (inspection_fee >= 0),
  total_sent numeric(10,2) not null check (total_sent >= 0),
  total_approved numeric(10,2) check (total_approved >= 0),
  sent_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_at timestamptz,
  sent_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (booking_id, version)
);
alter table public.quotes enable row level security;

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  position int not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  price numeric(10,2) not null check (price >= 0),
  approved boolean, -- null until the client decides
  created_at timestamptz not null default now(),
  unique (quote_id, position)
);
alter table public.quote_items enable row level security;

grant select on public.quotes, public.quote_items to authenticated;
create policy quotes_select on public.quotes for select to authenticated
  using (public.can_read_booking(booking_id));
create policy quote_items_select on public.quote_items for select to authenticated
  using (exists (
    select 1 from public.quotes q where q.id = quote_id and public.can_read_booking(q.booking_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- reviews — one per completed booking. Written, replied to and reported through RPCs (T03).
-- Removed reviews disappear from public lists and from averages.
-- ---------------------------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  client_display_name text not null, -- "Andrei M."
  rating int not null check (rating between 1 and 5),
  text text check (char_length(text) <= 2000),
  reply text check (char_length(reply) <= 2000),
  reply_at timestamptz,
  report_reason text check (report_reason in ('fake', 'abusive', 'wrong_shop', 'personal_data')),
  reported_at timestamptz,
  report_status text check (report_status in ('pending', 'kept', 'removed')),
  report_decided_at timestamptz,
  report_note text,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reviews_shop_created_idx on public.reviews (shop_id, created_at desc);
alter table public.reviews enable row level security;
create trigger reviews_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

grant select on public.reviews to authenticated;
create policy reviews_select on public.reviews for select to authenticated
  using (
    removed_at is null
    or client_id = auth.uid()
    or public.is_shop_member(shop_id)
    or public.is_admin()
  );

-- Weighted rating (§8), one row per shop the reader can see; removed reviews excluded.
create view public.shop_ratings
with (security_invoker = true)
as
select
  s.id as shop_id,
  count(r.id)::int as review_count,
  coalesce(sum(r.rating), 0)::int as rating_sum,
  round(avg(r.rating), 2) as average,
  round(
    (coalesce(sum(r.rating), 0) + ps.ranking_prior_avg * ps.ranking_prior_weight)
      / (count(r.id) + ps.ranking_prior_weight),
    4
  ) as weighted_score
from public.shops s
cross join public.platform_settings ps
left join public.reviews r on r.shop_id = s.id and r.removed_at is null
group by s.id, ps.ranking_prior_avg, ps.ranking_prior_weight;
grant select on public.shop_ratings to authenticated;

-- ---------------------------------------------------------------------------------------------
-- threads + messages — one thread per (shop, client). System messages are an event code +
-- parameters, rendered in the reader's language.
-- ---------------------------------------------------------------------------------------------
create table public.threads (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  client_name text, -- kept in sync with the profile, so shops never read client profiles
  last_message_at timestamptz,
  client_last_read_at timestamptz,
  shop_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (shop_id, client_id)
);
create index threads_client_idx on public.threads (client_id, last_message_at desc);
create index threads_shop_idx on public.threads (shop_id, last_message_at desc);
alter table public.threads enable row level security;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  kind text not null check (kind in ('user', 'system')),
  sender_id uuid references public.profiles (id) on delete set null,
  body text check (char_length(body) <= 4000),
  event text,
  params jsonb not null default '{}'::jsonb,
  booking_id uuid references public.bookings (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'user' and body is not null) or (kind = 'system' and event is not null))
);
create index messages_thread_created_idx on public.messages (thread_id, created_at);
alter table public.messages enable row level security;

create function public.can_read_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.threads t
    where t.id = p_thread_id
      and (t.client_id = auth.uid() or public.is_shop_member(t.shop_id) or public.is_admin())
  )
$$;
grant execute on function public.can_read_thread(uuid) to authenticated;

grant select on public.threads, public.messages to authenticated;
create policy threads_select on public.threads for select to authenticated
  using (client_id = auth.uid() or public.is_shop_member(shop_id) or public.is_admin());
create policy messages_select on public.messages for select to authenticated
  using (public.can_read_thread(thread_id));

-- A client's new name reaches their threads.
create function public.profiles_sync_thread_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.threads set client_name = new.name where client_id = new.id;
  return new;
end
$$;
create trigger profiles_sync_thread_name
  after update of name on public.profiles
  for each row
  when (new.name is distinct from old.name)
  execute function public.profiles_sync_thread_name();

update public.schema_version set version = 3;
