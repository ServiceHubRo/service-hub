-- T02 · 2/6 — Identity, shops, catalog tables, subscriptions, access helpers, sign-up trigger.
-- ARCHITECTURE §2 (Identity, Catalog, Money/subscriptions), §5, §15.

-- ---------------------------------------------------------------------------------------------
-- profiles — one per auth user. Created only by the sign-up trigger below.
-- ---------------------------------------------------------------------------------------------
create sequence public.display_id_client_seq;
create sequence public.display_id_shop_seq;
create sequence public.display_id_admin_seq;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('client', 'shop', 'admin')),
  display_id text not null unique,
  name text check (char_length(name) <= 120),
  phone text check (char_length(phone) <= 32),
  lang text not null default 'ro' check (lang in ('ro', 'en')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  phone_verified_by_admin boolean not null default false,
  suspended boolean not null default false,
  terms_version text,
  terms_accepted_at timestamptz,
  push_prompt_dismissed_at timestamptz,
  location_prompt_dismissed_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- A new phone number is an unverified phone number.
create function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
    new.phone_verified_by_admin := false;
  end if;
  return new;
end
$$;
create trigger profiles_before_update before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ---------------------------------------------------------------------------------------------
-- shops — public profile and booking rules. No secret columns here (fiscal data: shop_billing).
-- ---------------------------------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 2000),
  logo_url text,
  street text check (char_length(street) <= 200),
  city text not null check (char_length(city) <= 80),
  county text check (char_length(county) <= 80),
  postal_code text check (postal_code is null or public.is_valid_postal_code(postal_code)),
  phone text check (char_length(phone) <= 32),
  phone2 text check (char_length(phone2) <= 32),
  website text check (char_length(website) <= 300),
  facebook text check (char_length(facebook) <= 300),
  year_established int check (year_established between 1900 and 2100),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  lang text not null default 'ro' check (lang in ('ro', 'en')),
  daily_capacity int not null default 5 check (daily_capacity between 1 and 100),
  cars_per_slot int not null default 1 check (cars_per_slot between 1 and 20),
  slot_minutes int not null default 60 check (slot_minutes in (30, 60)),
  min_notice_hours int not null default 2 check (min_notice_hours between 0 and 168),
  max_advance_days int not null default 30 check (max_advance_days between 1 and 365),
  cancel_deadline_hours int not null default 2 check (cancel_deadline_hours between 0 and 168),
  inspection_fee numeric(10,2) not null default 0 check (inspection_fee >= 0),
  sms_on_new_booking boolean not null default false,
  daily_digest boolean not null default false,
  -- Controlled by the system / admin only (no update grant).
  active boolean not null default true,
  suspended boolean not null default false,
  setup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shops_city_idx on public.shops (city);
alter table public.shops enable row level security;
create trigger shops_updated_at before update on public.shops
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- shop_billing — fiscal data. Owner + admin only, never public. Row created at shop sign-up.
-- ---------------------------------------------------------------------------------------------
create table public.shop_billing (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  legal_name text check (char_length(legal_name) <= 200),
  vat_id text check (vat_id is null or public.is_valid_cui(vat_id)),
  reg_com text check (reg_com is null or public.is_valid_regcom(reg_com)),
  legal_address text check (char_length(legal_address) <= 300),
  vat_payer boolean not null default false,
  bank_name text check (char_length(bank_name) <= 120),
  iban text check (iban is null or public.is_valid_iban(iban)),
  billing_email text check (billing_email is null or billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  legal_rep text check (char_length(legal_rep) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shop_billing enable row level security;

-- Stores codes in one canonical form: `RO14872301`, `J08/1245/2009`, `RO49AAAA…`.
create function public.shop_billing_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.vat_id := public.normalize_code(new.vat_id);
  new.reg_com := public.normalize_code(new.reg_com);
  new.iban := public.normalize_code(new.iban);
  new.billing_email := nullif(lower(btrim(new.billing_email)), '');
  return new;
end
$$;
create trigger shop_billing_normalize before insert or update on public.shop_billing
  for each row execute function public.shop_billing_normalize();
create trigger shop_billing_updated_at before update on public.shop_billing
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Opening hours (one row per weekday, created at sign-up) and closures (holidays, leave).
-- ---------------------------------------------------------------------------------------------
create table public.shop_hours (
  shop_id uuid not null references public.shops (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  primary key (shop_id, weekday),
  check (is_closed or (open_time is not null and close_time is not null and open_time < close_time))
);
alter table public.shop_hours enable row level security;

create table public.shop_closures (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  label text check (char_length(label) <= 120),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index shop_closures_shop_idx on public.shop_closures (shop_id, end_date);
alter table public.shop_closures enable row level security;

-- ---------------------------------------------------------------------------------------------
-- shop_staff — who operates a shop. The owner row is created at sign-up; staff rows by the
-- invite flow (T05). A person belongs to at most one shop.
-- ---------------------------------------------------------------------------------------------
create table public.shop_staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid unique references public.profiles (id) on delete cascade,
  invited_email text,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  invite_token_hash text,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index shop_staff_one_owner_idx on public.shop_staff (shop_id) where role = 'owner';
alter table public.shop_staff enable row level security;

-- ---------------------------------------------------------------------------------------------
-- subscriptions — one per shop. Written only by the Stripe webhook function or admin (T14, T16b).
-- ---------------------------------------------------------------------------------------------
create table public.subscriptions (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'inactive')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  price_ron numeric(10,2) not null check (price_ron >= 0),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Service catalog. Seeded from docs/service-catalog.json by a generated migration.
-- Service ids never change; disabled services stay valid on old bookings.
-- ---------------------------------------------------------------------------------------------
create table public.service_categories (
  key text primary key,
  name_ro text not null,
  name_en text not null,
  position int not null default 0,
  enabled boolean not null default true
);
alter table public.service_categories enable row level security;

create table public.services (
  id text primary key,
  category_key text not null references public.service_categories (key),
  icon text,
  name_ro text not null,
  name_en text not null,
  position int not null default 0,
  enabled boolean not null default true
);
create index services_category_idx on public.services (category_key, position);
alter table public.services enable row level security;

create table public.shop_services (
  shop_id uuid not null references public.shops (id) on delete cascade,
  service_id text not null references public.services (id),
  created_at timestamptz not null default now(),
  primary key (shop_id, service_id)
);
create index shop_services_service_idx on public.shop_services (service_id);
alter table public.shop_services enable row level security;

-- ---------------------------------------------------------------------------------------------
-- admin_audit_log — every admin write inserts here, inside the same function.
-- ---------------------------------------------------------------------------------------------
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Access helpers used by the policies. security definer so they can look at membership rows the
-- caller cannot read; each answers only about the caller (auth.uid()).
-- ---------------------------------------------------------------------------------------------
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  )
$$;

create function public.my_shop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select st.shop_id from public.shop_staff st
  where st.user_id = auth.uid() and st.accepted_at is not null
$$;

create function public.is_shop_member(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shop_staff st
    where st.shop_id = p_shop_id and st.user_id = auth.uid() and st.accepted_at is not null
  )
$$;

create function public.is_shop_owner(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shops s where s.id = p_shop_id and s.owner_id = auth.uid()
  )
$$;

-- Who appears in search and can receive bookings (§5).
create function public.is_shop_public(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.shops s
    join public.profiles o on o.id = s.owner_id
    join public.subscriptions sub on sub.shop_id = s.id
    where s.id = p_shop_id
      and s.active
      and not s.suspended
      and not o.suspended
      and o.email_verified_at is not null
      and (o.phone_verified_at is not null or o.phone_verified_by_admin)
      and sub.status in ('trial', 'active', 'past_due')
      and (sub.status <> 'trial' or sub.trial_ends_at > now())
      and exists (
        select 1 from public.shop_services ss
        join public.services sv on sv.id = ss.service_id
        where ss.shop_id = s.id and sv.enabled
      )
      and exists (
        select 1 from public.shop_hours h where h.shop_id = s.id and not h.is_closed
      )
  )
$$;

-- Who may read a shop's public rows. Extended in the next migration with
-- "clients who have a booking with that shop".
create function public.can_read_shop(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_shop_public(p_shop_id)
      or public.is_shop_member(p_shop_id)
      or public.is_admin()
$$;

grant execute on function
  public.is_admin(),
  public.my_shop_id(),
  public.is_shop_member(uuid),
  public.is_shop_owner(uuid),
  public.is_shop_public(uuid),
  public.can_read_shop(uuid)
to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Grants and policies. Browser writes are limited to the columns listed here; everything else
-- (role, verification, active, suspended, subscription) changes only through functions.
-- ---------------------------------------------------------------------------------------------

-- profiles: own row (admin: all). Editable: name, phone, language, prompt dismissals.
grant select on public.profiles to authenticated;
grant update (name, phone, lang, push_prompt_dismissed_at, location_prompt_dismissed_at)
  on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- shops: public ones to every signed-in user; own shop always. Members edit public data and rules.
grant select on public.shops to authenticated;
grant update (
  name, description, logo_url, street, city, county, postal_code, phone, phone2, website,
  facebook, year_established, latitude, longitude, lang, daily_capacity, cars_per_slot,
  slot_minutes, min_notice_hours, max_advance_days, cancel_deadline_hours, inspection_fee,
  sms_on_new_booking, daily_digest
) on public.shops to authenticated;
create policy shops_select on public.shops for select to authenticated
  using (public.can_read_shop(id));
create policy shops_update_member on public.shops for update to authenticated
  using (public.is_shop_member(id)) with check (public.is_shop_member(id));

-- shop_billing: owner reads and edits, admin reads. Staff and clients see nothing.
grant select on public.shop_billing to authenticated;
grant update (
  legal_name, vat_id, reg_com, legal_address, vat_payer, bank_name, iban, billing_email, legal_rep
) on public.shop_billing to authenticated;
create policy shop_billing_select on public.shop_billing for select to authenticated
  using (public.is_shop_owner(shop_id) or public.is_admin());
create policy shop_billing_update_owner on public.shop_billing for update to authenticated
  using (public.is_shop_owner(shop_id)) with check (public.is_shop_owner(shop_id));

-- shop_hours: readable with the shop; members edit the 7 existing rows.
grant select on public.shop_hours to authenticated;
grant update (is_closed, open_time, close_time) on public.shop_hours to authenticated;
create policy shop_hours_select on public.shop_hours for select to authenticated
  using (public.can_read_shop(shop_id));
create policy shop_hours_update_member on public.shop_hours for update to authenticated
  using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));

-- shop_closures: readable with the shop; members add, edit, delete.
grant select, delete on public.shop_closures to authenticated;
grant insert (shop_id, start_date, end_date, label) on public.shop_closures to authenticated;
grant update (start_date, end_date, label) on public.shop_closures to authenticated;
create policy shop_closures_select on public.shop_closures for select to authenticated
  using (public.can_read_shop(shop_id));
create policy shop_closures_insert_member on public.shop_closures for insert to authenticated
  with check (public.is_shop_member(shop_id));
create policy shop_closures_update_member on public.shop_closures for update to authenticated
  using (public.is_shop_member(shop_id)) with check (public.is_shop_member(shop_id));
create policy shop_closures_delete_member on public.shop_closures for delete to authenticated
  using (public.is_shop_member(shop_id));

-- shop_staff: members see their team (never the invite token hash); the owner removes staff.
grant select (id, shop_id, user_id, invited_email, role, invited_at, accepted_at, created_at)
  on public.shop_staff to authenticated;
grant delete on public.shop_staff to authenticated;
create policy shop_staff_select on public.shop_staff for select to authenticated
  using (user_id = auth.uid() or public.is_shop_member(shop_id) or public.is_admin());
create policy shop_staff_delete_owner on public.shop_staff for delete to authenticated
  using (role = 'staff' and public.is_shop_owner(shop_id));

-- subscriptions: owner and admin read. No browser writes.
grant select on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_shop_owner(shop_id) or public.is_admin());

-- Catalog: readable by everyone, including signed-out visitors. Admin edits via functions (T16b).
grant select on public.service_categories, public.services to anon, authenticated;
create policy service_categories_read on public.service_categories for select to anon, authenticated
  using (true);
create policy services_read on public.services for select to anon, authenticated
  using (true);

-- shop_services: readable with the shop; members pick enabled services.
grant select, delete on public.shop_services to authenticated;
grant insert (shop_id, service_id) on public.shop_services to authenticated;
create policy shop_services_select on public.shop_services for select to authenticated
  using (public.can_read_shop(shop_id));
create policy shop_services_insert_member on public.shop_services for insert to authenticated
  with check (
    public.is_shop_member(shop_id)
    and exists (select 1 from public.services sv where sv.id = service_id and sv.enabled)
  );
create policy shop_services_delete_member on public.shop_services for delete to authenticated
  using (public.is_shop_member(shop_id));

-- admin_audit_log: admin reads. Written only inside admin functions.
grant select on public.admin_audit_log to authenticated;
create policy admin_audit_log_select on public.admin_audit_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- Sign-up (§15). Builds the profile from the sign-up metadata; for a shop also the shop, its
-- default hours, the empty billing row, the trial subscription and the owner staff row.
-- The role may only be `client` or `shop`: anything else becomes `client`. Never `admin`.
-- ---------------------------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := case when meta->>'role' in ('client', 'shop') then meta->>'role' else 'client' end;
  v_lang text := case when meta->>'lang' in ('ro', 'en') then meta->>'lang' else 'ro' end;
  v_name text := left(nullif(btrim(meta->>'name'), ''), 120);
  v_phone text := left(nullif(btrim(meta->>'phone'), ''), 32);
  v_terms text := left(nullif(btrim(meta->>'terms_version'), ''), 32);
  v_settings public.platform_settings%rowtype;
  v_shop_id uuid;
begin
  insert into public.profiles (
    id, role, display_id, name, phone, lang, email_verified_at, terms_version, terms_accepted_at
  ) values (
    new.id,
    v_role,
    case v_role
      when 'shop' then public.format_sequence_id('S', nextval('public.display_id_shop_seq'))
      else public.format_sequence_id('C', nextval('public.display_id_client_seq'))
    end,
    v_name,
    v_phone,
    v_lang,
    new.email_confirmed_at,
    v_terms,
    case when v_terms is not null then now() end
  );

  if v_role = 'shop' then
    select * into v_settings from public.platform_settings where id = 1;

    insert into public.shops (
      owner_id, name, city, phone, lang, daily_capacity, cars_per_slot, slot_minutes,
      min_notice_hours, max_advance_days, cancel_deadline_hours
    ) values (
      new.id,
      coalesce(left(nullif(btrim(meta->>'shop_name'), ''), 120), v_name, 'Service'),
      coalesce(left(nullif(btrim(meta->>'city'), ''), 80), ''),
      v_phone,
      v_lang,
      v_settings.default_daily_capacity,
      v_settings.default_cars_per_slot,
      v_settings.default_slot_minutes,
      v_settings.default_min_notice_hours,
      v_settings.default_max_advance_days,
      v_settings.default_cancel_deadline_hours
    )
    returning id into v_shop_id;

    -- Mon–Fri 08:00–18:00, Sat–Sun closed.
    insert into public.shop_hours (shop_id, weekday, is_closed, open_time, close_time)
    select v_shop_id, d, d in (0, 6),
           case when d in (0, 6) then null else time '08:00' end,
           case when d in (0, 6) then null else time '18:00' end
    from generate_series(0, 6) as d;

    insert into public.shop_billing (shop_id, billing_email) values (v_shop_id, new.email);

    insert into public.subscriptions (shop_id, status, trial_ends_at, price_ron)
    values (v_shop_id, 'trial', now() + make_interval(days => v_settings.trial_days),
            v_settings.subscription_price_ron);

    insert into public.shop_staff (shop_id, user_id, invited_email, role, accepted_at)
    values (v_shop_id, new.id, new.email, 'owner', now());
  end if;

  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- email_verified_at follows auth.users.email_confirmed_at.
create function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
  return new;
end
$$;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (new.email_confirmed_at is distinct from old.email_confirmed_at)
  execute function public.handle_user_email_confirmed();

-- ---------------------------------------------------------------------------------------------
-- promote_to_admin(email) — the only way to create an admin. Run by Eduard in the SQL Editor
-- after creating a normal client account. Not callable through the API by any role.
-- ---------------------------------------------------------------------------------------------
create function public.promote_to_admin(p_email text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_profile public.profiles%rowtype;
  v_display text;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'promote_to_admin: no account with email %', p_email;
  end if;

  select * into v_profile from public.profiles where id = v_id for update;
  if v_profile.role = 'admin' then
    return v_profile.display_id;
  end if;
  if v_profile.role = 'shop' then
    raise exception 'promote_to_admin: % is a shop account; create a separate client account for the admin', p_email;
  end if;

  v_display := public.format_sequence_id('A', nextval('public.display_id_admin_seq'));
  update public.profiles set role = 'admin', display_id = v_display where id = v_id;

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
  values (v_id, 'promote_to_admin', 'profile', v_id::text,
          jsonb_build_object('role', v_profile.role, 'display_id', v_profile.display_id),
          jsonb_build_object('role', 'admin', 'display_id', v_display));

  return v_display;
end
$$;
revoke execute on function public.promote_to_admin(text) from public, anon, authenticated, service_role;

update public.schema_version set version = 2;
