-- T02 · 4/6 — Push subscriptions, notification outbox and log, admin notices, invoices,
-- history reports, Stripe events, phone verifications. ARCHITECTURE §2 (Notifications, Money), §9, §13.

-- ---------------------------------------------------------------------------------------------
-- push_subscriptions — one row per device. The user manages their own rows (upsert by endpoint).
-- ---------------------------------------------------------------------------------------------
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subscription jsonb not null,
  user_agent text check (char_length(user_agent) <= 500),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, subscription, user_agent) on public.push_subscriptions to authenticated;
grant update (subscription, user_agent) on public.push_subscriptions to authenticated;
create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- notification_events (outbox) — written by RPC functions in the same transaction as the change,
-- read by the dispatch-notifications Edge Function (service role). No browser access.
-- ---------------------------------------------------------------------------------------------
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event text not null,
  params jsonb not null default '{}'::jsonb,
  booking_id uuid references public.bookings (id) on delete set null,
  channels text[] not null default array['push']::text[],
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index notification_events_pending_idx on public.notification_events (created_at)
  where processed_at is null;
alter table public.notification_events enable row level security;

create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.notification_events (id) on delete set null,
  user_id uuid references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('push', 'email', 'sms')),
  status text not null,
  error text,
  sent_at timestamptz not null default now()
);
create index notifications_log_user_idx on public.notifications_log (user_id, sent_at desc);
alter table public.notifications_log enable row level security;

grant select on public.notification_events, public.notifications_log to authenticated;
create policy notification_events_select_admin on public.notification_events for select to authenticated
  using (public.is_admin());
create policy notifications_log_select_admin on public.notifications_log for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- notices (admin broadcasts) + notice_reads. A city notice reaches the shops in that city.
-- ---------------------------------------------------------------------------------------------
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('shops', 'clients', 'all', 'city')),
  city text,
  title_ro text not null,
  body_ro text not null,
  title_en text not null,
  body_en text not null,
  send_push boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (audience <> 'city' or city is not null)
);
create index notices_created_idx on public.notices (created_at desc);
alter table public.notices enable row level security;

create function public.can_read_notice(p_audience text, p_city text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_audience
    when 'all' then true
    when 'clients' then exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client')
    when 'shops' then exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role = 'shop')
    when 'city' then exists (
      select 1 from public.shops s
      where s.id = public.my_shop_id() and lower(btrim(s.city)) = lower(btrim(p_city)))
    else false
  end or public.is_admin()
$$;
grant execute on function public.can_read_notice(text, text) to authenticated;

grant select on public.notices to authenticated;
create policy notices_select on public.notices for select to authenticated
  using (public.can_read_notice(audience, city));

create table public.notice_reads (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  notice_id uuid not null references public.notices (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, notice_id)
);
alter table public.notice_reads enable row level security;
grant select on public.notice_reads to authenticated;
grant insert (notice_id) on public.notice_reads to authenticated;
create policy notice_reads_select_own on public.notice_reads for select to authenticated
  using (user_id = auth.uid());
create policy notice_reads_insert_own on public.notice_reads for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.notices n where n.id = notice_id)
  );

-- ---------------------------------------------------------------------------------------------
-- invoices — fiscal records; kept even if the shop is deleted (restrict).
-- ---------------------------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete restrict,
  series text,
  number text,
  amount numeric(10,2) not null check (amount >= 0),
  vat_amount numeric(10,2) not null default 0 check (vat_amount >= 0),
  currency text not null default 'RON',
  issued_at timestamptz,
  pdf_url text,
  provider text,
  provider_ref text,
  stripe_invoice_id text unique,
  status text not null default 'issued',
  created_at timestamptz not null default now(),
  unique (series, number)
);
create index invoices_shop_idx on public.invoices (shop_id, issued_at desc);
alter table public.invoices enable row level security;
grant select on public.invoices to authenticated;
create policy invoices_select on public.invoices for select to authenticated
  using (public.is_shop_owner(shop_id) or public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- history_reports — paid PDF history of one car (§13). Only the Stripe webhook marks it paid.
-- ---------------------------------------------------------------------------------------------
create sequence public.history_report_code_seq;

create function public.next_history_report_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'SH-' || to_char(now() at time zone 'Europe/Bucharest', 'YYYY') || '-' ||
         lpad(nextval('public.history_report_code_seq')::text, 6, '0')
$$;

create table public.history_reports (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.next_history_report_code(),
  client_id uuid references public.profiles (id) on delete cascade,
  car_id uuid references public.cars (id) on delete set null,
  car_snapshot jsonb not null,
  job_count int not null default 0 check (job_count >= 0),
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  period_from date,
  period_to date,
  latest_odometer int,
  odometer_out_of_order boolean not null default false,
  amount_paid numeric(10,2) not null default 0 check (amount_paid >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'generated', 'void')),
  stripe_session_id text unique,
  paid_at timestamptz,
  generated_at timestamptz,
  pdf_url text, -- path inside the private `reports` bucket
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);
create index history_reports_client_idx on public.history_reports (client_id, created_at desc);
alter table public.history_reports enable row level security;
grant select on public.history_reports to authenticated;
create policy history_reports_select on public.history_reports for select to authenticated
  using (client_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- Server-only tables: no grants, no policies.
-- ---------------------------------------------------------------------------------------------
create table public.stripe_events (
  id text primary key, -- Stripe event id; makes the webhook idempotent
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

create table public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index phone_verifications_user_idx on public.phone_verifications (user_id, created_at desc);
alter table public.phone_verifications enable row level security;

update public.schema_version set version = 4;
