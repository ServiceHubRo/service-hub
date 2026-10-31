-- T64a — Fleet plans, a company's subscription, the plan's limits. docs/FLEET_BILLING_PLAN.md §B–§C,
-- approved by Eduard on 31 Oct 2026 (the access policy; Start = the admin only, members 1 / 10 /
-- unlimited; a 30-day trial of Fleet Business, no card, once per CUI and per creating account;
-- monthly only; Pro = Business + up to 40 vehicles). NO PAYMENTS: no Stripe, no charge, no change to
-- the shops' subscriptions (`subscriptions`, `invoices` untouched).
--
-- · fleet_plans — the plans as rows (prices and limits are the admin's, never in the code)
-- · company_subscriptions — one per company: plan, status, trial dates, the price fixed at start
-- · fleet_trial_claims — one trial per CUI and per creating account
-- · Limits in the database: a new or reopened vehicle and a new member/invitation are refused over
--   the plan's limit (triggers, so every path is covered); nothing is ever deleted or hidden.
-- · Read-only after the trial / an unpaid period applies only once `fleet_billing_enabled` is on
--   (off until payments exist): until then a company is never blocked.

-- ---------------------------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------------------------
alter table public.platform_settings
  add column fleet_trial_days int not null default 30 check (fleet_trial_days between 0 and 365),
  add column fleet_trial_plan text not null default 'fleet_business',
  add column fleet_billing_enabled boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------------------------
create table public.fleet_plans (
  key text primary key check (key ~ '^[a-z_]{3,30}$'),
  name_ro text not null check (char_length(name_ro) between 1 and 60),
  name_en text not null check (char_length(name_en) between 1 and 60),
  price_ron numeric(10,2) check (price_ron >= 0),      -- null = price agreed per company
  vehicle_limit int check (vehicle_limit > 0),          -- null = no fixed limit
  member_limit int check (member_limit > 0),            -- null = unlimited
  features text[] not null default '{}',
  position int not null default 0,
  public boolean not null default true,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.fleet_plans enable row level security;
grant select on public.fleet_plans to authenticated;
create policy fleet_plans_read on public.fleet_plans for select to authenticated using (true);

insert into public.fleet_plans (key, name_ro, name_en, price_ron, vehicle_limit, member_limit, features, position) values
  ('fleet_start', 'Fleet Start', 'Fleet Start', 29, 5, 1,
   array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic'], 1),
  ('fleet_business', 'Fleet Business', 'Fleet Business', 59, 15, 10,
   array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'], 2),
  ('fleet_pro', 'Fleet Pro', 'Fleet Pro', 119, 40, null,
   array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'], 3),
  ('enterprise', 'Enterprise', 'Enterprise', null, null, null,
   array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members', 'reports', 'export_csv', 'budget', 'cost_per_km'], 4);

-- ---------------------------------------------------------------------------------------------
-- A company's subscription
-- ---------------------------------------------------------------------------------------------
create table public.company_subscriptions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_key text not null references public.fleet_plans(key),
  status text not null check (status in ('trial', 'active', 'past_due', 'cancelled', 'inactive')),
  ended_reason text check (ended_reason in ('trial_used', 'trial_ended', 'payment_failed', 'cancelled', 'admin')),
  price_ron numeric(10,2) check (price_ron >= 0),       -- fixed at start (null for a custom price)
  custom_vehicle_limit int check (custom_vehicle_limit > 0),
  custom_member_limit int check (custom_member_limit > 0),
  billing_months int not null default 1 check (billing_months in (1, 3, 6, 12)),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.company_subscriptions enable row level security;
-- Read: the company's admin, manager and accountant (never a driver), and the platform admin.
-- No browser writes at all.
grant select on public.company_subscriptions to authenticated;
create policy company_subscriptions_read on public.company_subscriptions for select to authenticated
  using (public.company_role(company_id) in ('admin', 'manager', 'accountant') or public.is_admin());

create table public.fleet_trial_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  vat_id text,
  claimed_at timestamptz not null default now()
);
create unique index fleet_trial_claims_user_idx on public.fleet_trial_claims (user_id) where user_id is not null;
create unique index fleet_trial_claims_vat_idx on public.fleet_trial_claims (vat_id) where vat_id is not null;
alter table public.fleet_trial_claims enable row level security; -- no grants: server only

-- A new company gets its subscription: the trial when neither its creator nor its CUI had one,
-- else `inactive` (`trial_used`; it pays to continue once payments exist).
create function public.companies_start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ps public.platform_settings%rowtype;
  v_plan public.fleet_plans%rowtype;
  v_used boolean;
begin
  select * into ps from public.platform_settings where id = 1;
  select * into v_plan from public.fleet_plans where key = ps.fleet_trial_plan;
  if not found then
    select * into v_plan from public.fleet_plans where key = 'fleet_business';
  end if;
  v_used := exists (select 1 from public.fleet_trial_claims c where c.user_id = new.created_by)
    or (new.vat_id is not null and exists (select 1 from public.fleet_trial_claims c where c.vat_id = new.vat_id));
  if v_used or ps.fleet_trial_days = 0 then
    insert into public.company_subscriptions (company_id, plan_key, status, ended_reason, price_ron)
    values (new.id, v_plan.key, 'inactive', 'trial_used', v_plan.price_ron);
  else
    insert into public.company_subscriptions (company_id, plan_key, status, price_ron, trial_started_at, trial_ends_at)
    values (new.id, v_plan.key, 'trial', v_plan.price_ron, now(), now() + make_interval(days => ps.fleet_trial_days));
    insert into public.fleet_trial_claims (company_id, user_id, vat_id) values (new.id, new.created_by, new.vat_id);
  end if;
  return new;
end
$$;
revoke execute on function public.companies_start_subscription() from public, anon, authenticated;
create trigger companies_start_subscription after insert on public.companies
  for each row execute function public.companies_start_subscription();

-- The companies made before this migration (tests on the test and real projects): a trial from now.
insert into public.company_subscriptions (company_id, plan_key, status, price_ron, trial_started_at, trial_ends_at)
select c.id, 'fleet_business', 'trial', 59, now(), now() + interval '30 days'
from public.companies c
where not exists (select 1 from public.company_subscriptions s where s.company_id = c.id);
insert into public.fleet_trial_claims (company_id, user_id, vat_id)
select distinct on (c.created_by) c.id, c.created_by, null
from public.companies c
where c.created_by is not null
order by c.created_by, c.created_at
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------
-- The effective plan
-- ---------------------------------------------------------------------------------------------

-- Whether the company is read-only now: only while billing is on, after the trial without payment,
-- an unpaid or a cancelled period (docs/FLEET_BILLING_PLAN.md §C.3; past_due keeps working).
create function public.company_read_only(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select ps.fleet_billing_enabled from public.platform_settings ps where ps.id = 1), false)
     and coalesce((
       select s.status = 'inactive'
           or (s.status = 'trial' and s.trial_ends_at <= now())
           or (s.status = 'cancelled' and coalesce(s.current_period_end, now()) <= now())
       from public.company_subscriptions s where s.company_id = p_company
     ), false)
$$;

-- Everything the plan decides, for the checks and the Abonament page.
create function public.company_plan(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan_key', p.key, 'name_ro', p.name_ro, 'name_en', p.name_en,
    'price_ron', s.price_ron, 'billing_months', s.billing_months,
    'vehicle_limit', coalesce(s.custom_vehicle_limit, p.vehicle_limit),
    'member_limit', coalesce(s.custom_member_limit, p.member_limit),
    'features', to_jsonb(p.features),
    'status', s.status, 'ended_reason', s.ended_reason,
    'trial_started_at', s.trial_started_at, 'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
    'read_only', public.company_read_only(p_company),
    'billing_enabled', coalesce((select ps.fleet_billing_enabled from public.platform_settings ps where ps.id = 1), false))
  from public.company_subscriptions s
  join public.fleet_plans p on p.key = s.plan_key
  where s.company_id = p_company
$$;

create function public.fleet_has_feature(p_company uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p_feature = any (p.features)
    from public.company_subscriptions s join public.fleet_plans p on p.key = s.plan_key
    where s.company_id = p_company
  ), false)
$$;

revoke execute on function public.company_read_only(uuid) from public, anon, authenticated;
revoke execute on function public.company_plan(uuid) from public, anon, authenticated;
revoke execute on function public.fleet_has_feature(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The limits, on every path (triggers inside the functions' transactions; the functions already
-- lock the company row, so two requests cannot pass the last place together)
-- ---------------------------------------------------------------------------------------------
create function public.company_vehicles_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_active int;
begin
  if new.archived_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.archived_at is null then
    return new; -- an edit of an active vehicle never checks the limit
  end if;
  if public.company_read_only(new.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  v_limit := (public.company_plan(new.company_id)->>'vehicle_limit')::int;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_active from public.company_vehicles cv
  where cv.company_id = new.company_id and cv.archived_at is null and cv.id <> new.id;
  if v_active >= v_limit then
    perform public.fail('fleet_vehicle_limit', jsonb_build_object('limit', v_limit, 'active', v_active));
  end if;
  return new;
end
$$;
revoke execute on function public.company_vehicles_plan_limit() from public, anon, authenticated;
create trigger company_vehicles_plan_limit before insert or update of archived_at on public.company_vehicles
  for each row execute function public.company_vehicles_plan_limit();

create function public.company_members_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  -- The creator joining their new company is always allowed.
  if new.role = 'admin' and new.user_id is not null
     and exists (select 1 from public.companies c where c.id = new.company_id and c.created_by = new.user_id)
     and not exists (select 1 from public.company_members m where m.company_id = new.company_id) then
    return new;
  end if;
  if public.company_read_only(new.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  v_limit := (public.company_plan(new.company_id)->>'member_limit')::int;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_count from public.company_members m where m.company_id = new.company_id;
  if v_count >= v_limit then
    perform public.fail('fleet_member_limit', jsonb_build_object('limit', v_limit));
  end if;
  return new;
end
$$;
revoke execute on function public.company_members_plan_limit() from public, anon, authenticated;
create trigger company_members_plan_limit before insert on public.company_members
  for each row execute function public.company_members_plan_limit();

-- Budgets are a Fleet Business feature: a plan without it cannot set one (an existing one stays).
create function public.companies_budget_feature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.budget_monthly is distinct from old.budget_monthly and new.budget_monthly is not null)
     or (new.budget_yearly is distinct from old.budget_yearly and new.budget_yearly is not null) then
    if not public.fleet_has_feature(new.id, 'budget') then
      perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'budget'));
    end if;
  end if;
  return new;
end
$$;
revoke execute on function public.companies_budget_feature() from public, anon, authenticated;
create trigger companies_budget_feature before update on public.companies
  for each row execute function public.companies_budget_feature();

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------

-- The Abonament page: the plan, the usage and the plans to compare. Admin, manager and accountant;
-- a driver gets `not_allowed`.
create function public.fleet_subscription(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform public.require_fleet_client();
  v_role := public.company_role(p_company);
  if v_role is null then
    perform public.fail('company_not_found');
  end if;
  if v_role not in ('admin', 'manager', 'accountant') then
    perform public.fail('not_allowed');
  end if;
  return jsonb_build_object(
    'plan', public.company_plan(p_company),
    'usage', jsonb_build_object(
      'vehicles', (select count(*) from public.company_vehicles cv where cv.company_id = p_company and cv.archived_at is null),
      'members', (select count(*) from public.company_members m where m.company_id = p_company)),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p.key, 'name_ro', p.name_ro, 'name_en', p.name_en, 'price_ron', p.price_ron,
               'vehicle_limit', p.vehicle_limit, 'member_limit', p.member_limit, 'features', to_jsonb(p.features))
             order by p.position, p.key)
      from public.fleet_plans p where p.public and p.active
    ), '[]'::jsonb)
  );
end
$$;
revoke execute on function public.fleet_subscription(uuid) from public, anon;
grant execute on function public.fleet_subscription(uuid) to authenticated;

-- What every member's frame needs (the badge, the banners): the plan's name, status, trial end,
-- limits and whether the company is read-only. No price. Drivers too.
create function public.fleet_plan_summary(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_fleet_client();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  v := public.company_plan(p_company);
  return (v - 'price_ron' - 'billing_months')
    || jsonb_build_object('vehicles', (select count(*) from public.company_vehicles cv where cv.company_id = p_company and cv.archived_at is null));
end
$$;
revoke execute on function public.fleet_plan_summary(uuid) from public, anon;
grant execute on function public.fleet_plan_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Platform admin (second sign-in step required; every change in admin_audit_log)
-- ---------------------------------------------------------------------------------------------
create function public.admin_list_fleet_companies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'name', c.name, 'vat_id', c.vat_id, 'created_at', c.created_at, 'archived_at', c.archived_at,
             'plan', public.company_plan(c.id),
             'vehicles', (select count(*) from public.company_vehicles cv where cv.company_id = c.id and cv.archived_at is null),
             'members', (select count(*) from public.company_members m where m.company_id = c.id and m.accepted_at is not null),
             'admin_email', (select lower(u.email) from public.company_members m join auth.users u on u.id = m.user_id
                             where m.company_id = c.id and m.role = 'admin' order by m.accepted_at limit 1))
           order by c.created_at desc)
    from public.companies c
  ), '[]'::jsonb);
end
$$;

create function public.admin_set_company_plan(p_company uuid, p_plan_key text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.company_subscriptions%rowtype;
  v_plan public.fleet_plans%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_company_plan');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.company_subscriptions where company_id = p_company for update;
  if not found then
    perform public.fail('company_not_found');
  end if;
  select * into v_plan from public.fleet_plans where key = p_plan_key and active;
  if not found then
    perform public.fail('plan_not_found');
  end if;
  update public.company_subscriptions set plan_key = v_plan.key, price_ron = v_plan.price_ron where company_id = p_company;
  perform public.admin_audit('set_company_plan', 'company', p_company,
    jsonb_build_object('plan', v.plan_key, 'price_ron', v.price_ron),
    jsonb_build_object('plan', v_plan.key, 'price_ron', v_plan.price_ron));
  v_result := public.company_plan(p_company);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create function public.admin_extend_company_trial(p_company uuid, p_days int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.company_subscriptions%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_extend_company_trial');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.company_subscriptions where company_id = p_company for update;
  if not found then
    perform public.fail('company_not_found');
  end if;
  if p_days is null or p_days not between 1 and 365 then
    perform public.fail('days_invalid');
  end if;
  if v.status not in ('trial', 'inactive') then
    perform public.fail('wrong_status');
  end if;
  update public.company_subscriptions set
    status = 'trial', ended_reason = null, status_changed_at = now(),
    trial_started_at = coalesce(trial_started_at, now()),
    trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days)
  where company_id = p_company;
  perform public.admin_audit('extend_company_trial', 'company', p_company,
    jsonb_build_object('status', v.status, 'trial_ends_at', v.trial_ends_at),
    jsonb_build_object('days', p_days));
  v_result := public.company_plan(p_company);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- A plan's price and limits (they apply to subscriptions that start afterwards: a running one keeps
-- its fixed price; the limits are the plan's for everyone).
create function public.admin_update_fleet_plan(p_key text, p_price_ron numeric, p_vehicle_limit int, p_member_limit int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.fleet_plans%rowtype;
  v_after public.fleet_plans%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_fleet_plan');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.fleet_plans where key = p_key for update;
  if not found then
    perform public.fail('plan_not_found');
  end if;
  if p_price_ron < 0 or p_price_ron > 100000 or p_vehicle_limit < 1 or p_vehicle_limit > 100000
     or p_member_limit < 1 or p_member_limit > 100000 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'plan'));
  end if;
  update public.fleet_plans
    set price_ron = round(p_price_ron, 2), vehicle_limit = p_vehicle_limit, member_limit = p_member_limit, updated_at = now()
  where key = p_key
  returning * into v_after;
  perform public.admin_audit('update_fleet_plan', 'fleet_plan', null,
    jsonb_build_object('key', v.key, 'price_ron', v.price_ron, 'vehicle_limit', v.vehicle_limit, 'member_limit', v.member_limit),
    jsonb_build_object('key', v_after.key, 'price_ron', v_after.price_ron, 'vehicle_limit', v_after.vehicle_limit, 'member_limit', v_after.member_limit));
  v_result := to_jsonb(v_after);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke execute on function public.admin_list_fleet_companies() from public, anon;
revoke execute on function public.admin_set_company_plan(uuid, text, uuid) from public, anon;
revoke execute on function public.admin_extend_company_trial(uuid, int, uuid) from public, anon;
revoke execute on function public.admin_update_fleet_plan(text, numeric, int, int, uuid) from public, anon;
grant execute on function
  public.admin_list_fleet_companies(),
  public.admin_set_company_plan(uuid, text, uuid),
  public.admin_extend_company_trial(uuid, int, uuid),
  public.admin_update_fleet_plan(text, numeric, int, int, uuid)
to authenticated;

-- The Abonament page follows the company's subscription live (RLS: admin, manager, accountant).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_subscriptions'
  ) then
    alter publication supabase_realtime add table public.company_subscriptions;
  end if;
end
$$;

update public.schema_version set version = 94;
