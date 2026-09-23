-- T02 · 1/6 — Foundation: secure defaults, schema version, shared helpers, validators, platform settings.
-- ARCHITECTURE §2 (Platform), §14, §18.

-- ---------------------------------------------------------------------------------------------
-- Secure defaults. Supabase grants every new table, sequence and function in `public` to the API
-- roles. We turn that off: from here on nothing is reachable from the browser unless a migration
-- grants it explicitly (tables: select/insert/update per column; functions: execute).
-- service_role keeps its defaults (used only by Edge Functions).
-- ---------------------------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- Postgres also lets PUBLIC execute every new function through a global default that a
-- per-schema revoke cannot remove, so this one is global (for the role running migrations).
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------------------------
-- Schema version (§18). One row; every migration ends by setting it to the next integer.
-- ---------------------------------------------------------------------------------------------
create table public.schema_version (
  id int primary key default 1 check (id = 1),
  version int not null
);
insert into public.schema_version (version) values (0);
alter table public.schema_version enable row level security;

create function public.get_schema_version()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select version from public.schema_version where id = 1
$$;
grant execute on function public.get_schema_version() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Small shared helpers
-- ---------------------------------------------------------------------------------------------

-- `C-00001`, `P-000123`: zero-padded, but never truncated once the number outgrows the padding.
create function public.format_sequence_id(p_prefix text, p_number bigint, p_width int default 5)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_prefix || '-' ||
         case when length(p_number::text) >= p_width then p_number::text
              else lpad(p_number::text, p_width, '0') end
$$;

-- Casts text to uuid, or null when it is not one (storage paths, untrusted input).
create function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

-- Keeps `updated_at` honest on every update.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Validators (§14). The same rules live in src/lib/validators.ts; both are tested against
-- tests/fixtures/validator-vectors.json. They ignore spaces and letter case; the tables store the
-- normalized form (triggers below and in later migrations).
-- ---------------------------------------------------------------------------------------------

-- CUI: optional RO prefix, 2–10 digits, control digit with key 753217532.
create function public.is_valid_cui(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
  body text;
  k constant text := '753217532';
  s int := 0;
  c int;
begin
  if p is null then
    return false;
  end if;
  v := upper(regexp_replace(p, '\s', '', 'g'));
  if left(v, 2) = 'RO' then
    v := substr(v, 3);
  end if;
  if v !~ '^[0-9]{2,10}$' then
    return false;
  end if;
  body := lpad(left(v, length(v) - 1), 9, '0');
  for i in 1..9 loop
    s := s + substr(body, i, 1)::int * substr(k, i, 1)::int;
  end loop;
  c := (s * 10) % 11;
  if c = 10 then
    c := 0;
  end if;
  return c = right(v, 1)::int;
end
$$;

-- Trade Register: old `J08/1234/2015` or new (2024+) `J2024000123010`.
create function public.is_valid_regcom(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    upper(regexp_replace(p, '\s', '', 'g')) ~ '^[JFC][0-9]{1,2}/[0-9]{1,7}/[0-9]{4}$'
    or upper(regexp_replace(p, '\s', '', 'g')) ~ '^[JFC][0-9]{13}$',
    false)
$$;

-- Romanian IBAN: RO + 2 digits + 20 alphanumerics, mod-97 = 1.
create function public.is_valid_iban(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
  r text;
  ch text;
  m int := 0;
begin
  if p is null then
    return false;
  end if;
  v := upper(regexp_replace(p, '\s', '', 'g'));
  if v !~ '^RO[0-9]{2}[A-Z0-9]{20}$' then
    return false;
  end if;
  r := substr(v, 5) || substr(v, 1, 4);
  for i in 1..length(r) loop
    ch := substr(r, i, 1);
    if ch ~ '[0-9]' then
      m := (m * 10 + ch::int) % 97;
    else
      m := (m * 100 + ascii(ch) - 55) % 97;
    end if;
  end loop;
  return m = 1;
end
$$;

-- Postal code: exactly 6 digits.
create function public.is_valid_postal_code(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(regexp_replace(p, '\s', '', 'g') ~ '^[0-9]{6}$', false)
$$;

-- VIN: 17 characters, A–Z and 0–9 without I, O, Q.
create function public.is_valid_vin(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(upper(regexp_replace(p, '\s', '', 'g')) ~ '^[A-HJ-NPR-Z0-9]{17}$', false)
$$;

-- Upper-case, no whitespace; empty → null. Used by the normalizing triggers.
create function public.normalize_code(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '')
$$;

grant execute on function
  public.format_sequence_id(text, bigint, int),
  public.try_uuid(text),
  public.is_valid_cui(text),
  public.is_valid_regcom(text),
  public.is_valid_iban(text),
  public.is_valid_postal_code(text),
  public.is_valid_vin(text),
  public.normalize_code(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Platform settings — one row. Readable by signed-in users, written only by admin functions (T16b).
-- Changing a value never alters existing bookings, quotes or subscriptions.
-- ---------------------------------------------------------------------------------------------
create table public.platform_settings (
  id int primary key default 1 check (id = 1),
  subscription_price_ron numeric(10,2) not null default 100 check (subscription_price_ron >= 0),
  trial_days int not null default 90 check (trial_days between 0 and 365),
  quote_expiry_days int not null default 3 check (quote_expiry_days between 1 and 30),
  report_price_ron numeric(10,2) not null default 29 check (report_price_ron >= 0),
  vat_rate_percent numeric(5,2) not null default 0 check (vat_rate_percent between 0 and 100),
  ranking_prior_avg numeric(3,2) not null default 4.3 check (ranking_prior_avg between 1 and 5),
  ranking_prior_weight numeric(6,2) not null default 3 check (ranking_prior_weight > 0),
  default_daily_capacity int not null default 5 check (default_daily_capacity between 1 and 100),
  default_cars_per_slot int not null default 1 check (default_cars_per_slot between 1 and 20),
  default_slot_minutes int not null default 60 check (default_slot_minutes in (30, 60)),
  default_min_notice_hours int not null default 2 check (default_min_notice_hours between 0 and 168),
  default_max_advance_days int not null default 30 check (default_max_advance_days between 1 and 365),
  default_cancel_deadline_hours int not null default 2 check (default_cancel_deadline_hours between 0 and 168),
  limits jsonb not null default '{
    "active_bookings_per_shop": 3,
    "active_bookings_total": 10,
    "new_bookings_per_24h": 5,
    "messages_per_thread_per_hour": 30,
    "review_window_days": 60,
    "quote_versions_max": 20
  }'::jsonb,
  notification_texts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.platform_settings (id) values (1);

alter table public.platform_settings enable row level security;
create policy platform_settings_read on public.platform_settings
  for select to authenticated using (true);
grant select on public.platform_settings to authenticated;

create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Idempotency log (CLAUDE.md §6.7). Written only by RPC functions; purged after 7 days (T12).
-- ---------------------------------------------------------------------------------------------
create table public.request_log (
  request_id uuid primary key,
  user_id uuid,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index request_log_created_at_idx on public.request_log (created_at);
alter table public.request_log enable row level security;

update public.schema_version set version = 1;
