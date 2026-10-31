-- T63b — Companies and their members (docs/FLEET_PLAN.md §3.1). PROPOSED, NOT APPLIED.
-- Moves to supabase/migrations/<timestamp>_companies.sql only after Eduard approves it.
--
-- A company is a space inside client accounts (Eduard, 31 Oct 2026: not a fourth role). Only client
-- accounts create or join companies. Everything here is additive: no existing table, row, policy or
-- function changes. Nothing works in production until `platform_settings.fleet_enabled` is switched on.
--
-- · companies — the company's own details and its rules (manager approval limit, budgets)
-- · company_members — one row per person or pending invitation, with the role
-- · company_audit_log — every change to the company or its members, who and what before/after
-- · Rights: company_role() and fleet_can() — the SQL copy of src/lib/fleet/permissions.ts
-- · Writes only through the functions below (no insert/update/delete grant to `authenticated`)

-- ---------------------------------------------------------------------------------------------
-- Switch and limits
-- ---------------------------------------------------------------------------------------------
alter table public.platform_settings add column fleet_enabled boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  vat_id text check (vat_id is null or public.is_valid_cui(vat_id)),
  reg_com text check (reg_com is null or public.is_valid_regcom(reg_com)),
  address text check (char_length(address) <= 300),
  -- Managers approve quotes up to this total; null = no limit set by the company.
  manager_approval_limit numeric(12,2) check (manager_approval_limit >= 0),
  -- Null = no budget set (never a default that could mislead).
  budget_monthly numeric(12,2) check (budget_monthly > 0),
  budget_yearly numeric(12,2) check (budget_yearly > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,  -- null until accepted
  invited_email text not null check (char_length(invited_email) <= 254),
  role text not null check (role in ('admin', 'manager', 'driver', 'accountant')),
  invite_token_hash text,
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((user_id is null) = (accepted_at is null)),
  unique (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id) where user_id is not null;
create unique index company_members_pending_email_idx
  on public.company_members (company_id, lower(invited_email)) where accepted_at is null;
create unique index company_members_token_idx on public.company_members (invite_token_hash) where invite_token_hash is not null;

create table public.company_audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index company_audit_log_company_idx on public.company_audit_log (company_id, created_at desc);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_audit_log enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Rights
-- ---------------------------------------------------------------------------------------------

-- The caller's role in a company (accepted members only), else null.
create function public.company_role(p_company uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.company_members m
  where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
$$;

-- The capability matrix — must equal src/lib/fleet/permissions.ts (a unit test compares them).
create function public.fleet_role_can(p_role text, p_capability text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'admin' then true
    when 'manager' then p_capability = any (array['vehicles.viewAll','vehicles.manage','bookings.create','bookings.viewAll',
      'quotes.approve','costs.view','costs.manage','reports.view','documents.view','documents.manage','issues.report','issues.manage'])
    when 'driver' then p_capability = any (array['issues.report','documents.view'])
    when 'accountant' then p_capability = any (array['vehicles.viewAll','bookings.viewAll','costs.view','costs.manage',
      'reports.view','documents.view','audit.view'])
    else false
  end
$$;

create function public.fleet_can(p_company uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.fleet_role_can(public.company_role(p_company), p_capability), false)
$$;

-- The company exists, is not archived, and the caller may do this; else not_found / not_allowed.
create function public.require_company(p_company uuid, p_capability text)
returns public.companies
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.companies%rowtype;
begin
  select * into v from public.companies c where c.id = p_company and c.archived_at is null;
  if not found or public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if not public.fleet_can(p_company, p_capability) then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;

-- Only client accounts take part in companies (shops and admins never do); fleets must be on.
create function public.require_fleet_client()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role <> 'client' then
    perform public.fail('company_clients_only');
  end if;
  if not coalesce((select ps.fleet_enabled from public.platform_settings ps where ps.id = 1), false) then
    perform public.fail('fleet_disabled');
  end if;
  return v;
end
$$;

create function public.company_audit(p_company uuid, p_action text, p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.company_audit_log (company_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_company, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after)
$$;

create function public.company_admin_count(p_company uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.company_members m
  where m.company_id = p_company and m.role = 'admin' and m.accepted_at is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Read access (RLS). The browser has select only; the invite token hash is never readable.
-- ---------------------------------------------------------------------------------------------
grant select on public.companies to authenticated;
grant select (id, company_id, user_id, invited_email, role, invited_at, accepted_at, created_at)
  on public.company_members to authenticated;
grant select on public.company_audit_log to authenticated;

create policy companies_select on public.companies for select to authenticated
  using (public.company_role(id) is not null or public.is_admin());

-- Everyone sees their own row; those who manage people or cars see the whole team.
create policy company_members_select on public.company_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.fleet_can(company_id, 'members.manage')
    or public.fleet_can(company_id, 'vehicles.manage')
    or public.is_admin()
  );

create policy company_audit_select on public.company_audit_log for select to authenticated
  using (public.fleet_can(company_id, 'audit.view') or public.is_admin());

-- ---------------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------------

create function public.company_json(c public.companies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) || jsonb_build_object('my_role', public.company_role(c.id))
$$;

-- A new company: the caller becomes its admin. At most `companies_per_user` (3) created per account.
create function public.create_company(p_name text, p_vat_id text, p_reg_com text, p_address text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_vat text := nullif(public.normalize_code(p_vat_id), '');
  v_reg text := nullif(public.normalize_code(p_reg_com), '');
  v_email text;
  v_company public.companies%rowtype;
  v_result jsonb;
begin
  v_me := public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'create_company');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_me.email_verified_at is null then
    perform public.fail('email_not_verified');
  end if;
  if char_length(v_name) not between 2 and 120 then
    perform public.fail('company_name_invalid');
  end if;
  if v_vat is not null and not public.is_valid_cui(v_vat) then
    perform public.fail('company_vat_invalid');
  end if;
  if v_reg is not null and not public.is_valid_regcom(v_reg) then
    perform public.fail('company_regcom_invalid');
  end if;
  if char_length(coalesce(p_address, '')) > 300 then
    perform public.fail('company_address_invalid');
  end if;
  -- Serialize one account's creations so two requests cannot pass the limit together.
  perform 1 from public.profiles where id = v_me.id for update;
  if (select count(*) from public.companies c where c.created_by = v_me.id and c.archived_at is null)
     >= public.app_limit('companies_per_user', 3) then
    perform public.fail('limit_companies', jsonb_build_object('limit', public.app_limit('companies_per_user', 3)));
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_me.id;
  insert into public.companies (name, vat_id, reg_com, address, created_by)
  values (v_name, v_vat, v_reg, nullif(btrim(coalesce(p_address, '')), ''), v_me.id)
  returning * into v_company;
  insert into public.company_members (company_id, user_id, invited_email, role, invited_by, accepted_at)
  values (v_company.id, v_me.id, coalesce(v_email, ''), 'admin', v_me.id, now());
  perform public.company_audit(v_company.id, 'create_company', 'company', v_company.id, null, to_jsonb(v_company));

  v_result := public.company_json(v_company);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- The company's details (admin).
create function public.update_company(p_company uuid, p_name text, p_vat_id text, p_reg_com text, p_address text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.companies%rowtype;
  v_after public.companies%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_vat text := nullif(public.normalize_code(p_vat_id), '');
  v_reg text := nullif(public.normalize_code(p_reg_com), '');
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'update_company');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'company.manage');
  select * into v_before from public.companies where id = p_company for update;
  if char_length(v_name) not between 2 and 120 then
    perform public.fail('company_name_invalid');
  end if;
  if v_vat is not null and not public.is_valid_cui(v_vat) then
    perform public.fail('company_vat_invalid');
  end if;
  if v_reg is not null and not public.is_valid_regcom(v_reg) then
    perform public.fail('company_regcom_invalid');
  end if;
  if char_length(coalesce(p_address, '')) > 300 then
    perform public.fail('company_address_invalid');
  end if;
  update public.companies
    set name = v_name, vat_id = v_vat, reg_com = v_reg, address = nullif(btrim(coalesce(p_address, '')), ''), updated_at = now()
    where id = p_company
    returning * into v_after;
  perform public.company_audit(p_company, 'update_company', 'company', p_company, to_jsonb(v_before), to_jsonb(v_after));
  v_result := public.company_json(v_after);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- The company's rules: managers' approval limit and the budgets (admin). Null clears one.
create function public.set_company_rules(p_company uuid, p_manager_approval_limit numeric, p_budget_monthly numeric,
  p_budget_yearly numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.companies%rowtype;
  v_after public.companies%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_rules');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'budget.manage');
  if p_manager_approval_limit < 0 or p_manager_approval_limit > 10000000
     or p_budget_monthly <= 0 or p_budget_monthly > 100000000
     or p_budget_yearly <= 0 or p_budget_yearly > 1000000000 then
    perform public.fail('company_rules_invalid');
  end if;
  select * into v_before from public.companies where id = p_company for update;
  update public.companies
    set manager_approval_limit = round(p_manager_approval_limit, 2), budget_monthly = round(p_budget_monthly, 2),
        budget_yearly = round(p_budget_yearly, 2), updated_at = now()
    where id = p_company
    returning * into v_after;
  perform public.company_audit(p_company, 'set_company_rules', 'company', p_company,
    jsonb_build_object('manager_approval_limit', v_before.manager_approval_limit, 'budget_monthly', v_before.budget_monthly, 'budget_yearly', v_before.budget_yearly),
    jsonb_build_object('manager_approval_limit', v_after.manager_approval_limit, 'budget_monthly', v_after.budget_monthly, 'budget_yearly', v_after.budget_yearly));
  v_result := public.company_json(v_after);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- An invitation: the browser makes a random 256-bit token, only its SHA-256 is stored (the shops'
-- pattern). Inviting the same address again replaces the token. At most `company_members_max` (50)
-- rows a company and `company_invites_per_day` (30) invitations a day.
create function public.invite_company_member(p_company uuid, p_email text, p_role text, p_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'invite_company_member');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'members.manage');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform public.fail('email_invalid');
  end if;
  if p_role is null or p_role not in ('admin', 'manager', 'driver', 'accountant') then
    perform public.fail('company_role_invalid');
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    perform public.fail('invite_invalid');
  end if;
  perform 1 from public.companies where id = p_company for update;
  if exists (
    select 1 from public.company_members m
    join auth.users u on u.id = m.user_id
    where m.company_id = p_company and lower(u.email) = v_email
  ) then
    perform public.fail('member_exists');
  end if;
  if not public.rate_take('company_invite', p_company, public.app_limit('company_invites_per_day', 30), interval '1 day') then
    perform public.fail('limit_invites', jsonb_build_object('limit', public.app_limit('company_invites_per_day', 30)));
  end if;

  select * into v_row from public.company_members m
  where m.company_id = p_company and m.accepted_at is null and lower(m.invited_email) = v_email;
  if found then
    update public.company_members
      set invite_token_hash = public.invite_token_hash(p_token), invited_at = now(), role = p_role, invited_by = auth.uid()
      where id = v_row.id
      returning * into v_row;
  else
    if (select count(*) from public.company_members m where m.company_id = p_company) >= public.app_limit('company_members_max', 50) then
      perform public.fail('limit_members', jsonb_build_object('limit', public.app_limit('company_members_max', 50)));
    end if;
    insert into public.company_members (company_id, invited_email, role, invite_token_hash, invited_by)
    values (p_company, v_email, p_role, public.invite_token_hash(p_token), auth.uid())
    returning * into v_row;
  end if;
  perform public.company_audit(p_company, 'invite_member', 'member', v_row.id, null,
    jsonb_build_object('email', v_row.invited_email, 'role', v_row.role));
  v_result := jsonb_build_object('id', v_row.id, 'email', v_row.invited_email, 'role', v_row.role, 'invited_at', v_row.invited_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- What an invitation link shows, signed out too: the company, the address and the role. 14 days.
create function public.get_company_invite(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('company_name', c.name, 'email', m.invited_email, 'role', m.role)
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where p_token ~ '^[0-9a-f]{64}$'
    and m.invite_token_hash = public.invite_token_hash(p_token)
    and m.accepted_at is null
    and m.invited_at > now() - interval '14 days'
    and c.archived_at is null
$$;

-- The invited person takes the invitation: a client account, its confirmed email equal to the
-- invited address. The token stops working once used.
create function public.accept_company_invite(p_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_email text;
  v_company public.companies%rowtype;
  v_result jsonb;
begin
  v_me := public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'accept_company_invite');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    perform public.fail('invite_invalid');
  end if;
  select m.* into v_row from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.invite_token_hash = public.invite_token_hash(p_token)
    and m.accepted_at is null and m.invited_at > now() - interval '14 days' and c.archived_at is null
  for update of m;
  if not found then
    perform public.fail('invite_invalid');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_me.id;
  if v_me.email_verified_at is null then
    perform public.fail('email_not_verified');
  end if;
  if v_email is distinct from lower(v_row.invited_email) then
    perform public.fail('invite_other_email');
  end if;
  if exists (select 1 from public.company_members m where m.company_id = v_row.company_id and m.user_id = v_me.id) then
    perform public.fail('member_exists');
  end if;
  update public.company_members
    set user_id = v_me.id, accepted_at = now(), invite_token_hash = null
    where id = v_row.id
    returning * into v_row;
  perform public.company_audit(v_row.company_id, 'accept_invite', 'member', v_row.id, null,
    jsonb_build_object('email', v_row.invited_email, 'role', v_row.role));
  select * into v_company from public.companies where id = v_row.company_id;
  v_result := public.company_json(v_company);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- A member's role (admin). The last admin can never be demoted.
create function public.set_company_member_role(p_member uuid, p_role text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_before text;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_member_role');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company(v_row.company_id, 'members.manage');
  if p_role is null or p_role not in ('admin', 'manager', 'driver', 'accountant') then
    perform public.fail('company_role_invalid');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  select * into v_row from public.company_members where id = p_member;
  v_before := v_row.role;
  if v_row.role = 'admin' and p_role <> 'admin' and v_row.accepted_at is not null
     and public.company_admin_count(v_row.company_id) <= 1 then
    perform public.fail('last_admin');
  end if;
  update public.company_members set role = p_role where id = p_member returning * into v_row;
  perform public.company_audit(v_row.company_id, 'set_member_role', 'member', v_row.id,
    jsonb_build_object('role', v_before), jsonb_build_object('role', v_row.role));
  v_result := jsonb_build_object('id', v_row.id, 'role', v_row.role);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Removes a member or a pending invitation (admin), or the caller leaves. Never the last admin.
-- Nothing of the company goes with the person: cars, history and costs belong to the company.
create function public.remove_company_member(p_member uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'remove_company_member');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('member_not_found');
  end if;
  if v_row.user_id is distinct from auth.uid() and not public.fleet_can(v_row.company_id, 'members.manage') then
    perform public.fail('not_allowed');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  if v_row.role = 'admin' and v_row.accepted_at is not null and public.company_admin_count(v_row.company_id) <= 1 then
    perform public.fail('last_admin');
  end if;
  delete from public.company_members where id = p_member;
  perform public.company_audit(v_row.company_id, case when v_row.user_id = auth.uid() then 'leave_company' else 'remove_member' end,
    'member', v_row.id, jsonb_build_object('email', v_row.invited_email, 'role', v_row.role, 'accepted', v_row.accepted_at is not null), null);
  v_result := jsonb_build_object('removed', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Hands the administration to another accepted member in one step: they become admin, the caller
-- becomes fleet manager. The company, its cars, history and (later) subscription do not move.
create function public.transfer_company_admin(p_member uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'transfer_company_admin');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company(v_row.company_id, 'members.manage');
  if v_row.accepted_at is null or v_row.user_id = auth.uid() then
    perform public.fail('transfer_invalid');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  update public.company_members set role = 'admin' where id = p_member;
  update public.company_members set role = 'manager'
    where company_id = v_row.company_id and user_id = auth.uid();
  perform public.company_audit(v_row.company_id, 'transfer_admin', 'member', v_row.id,
    jsonb_build_object('role', v_row.role), jsonb_build_object('role', 'admin', 'previous_admin', auth.uid()));
  v_result := jsonb_build_object('admin', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- The caller's companies, for the space switcher (name and role), oldest first.
create function public.my_companies()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'role', m.role) order by m.accepted_at, c.id), '[]'::jsonb)
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.accepted_at is not null and c.archived_at is null
$$;

-- The team with names (profiles stay unreadable). A driver or an accountant gets only themselves.
create function public.list_company_members(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean;
begin
  perform public.require_caller();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  v_all := public.fleet_can(p_company, 'members.manage') or public.fleet_can(p_company, 'vehicles.manage');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'role', m.role, 'name', p.name,
             'email', lower(coalesce(u.email, m.invited_email)),
             'invited_at', m.invited_at, 'accepted_at', m.accepted_at,
             'expired', m.accepted_at is null and m.invited_at <= now() - interval '14 days',
             'is_me', m.user_id = auth.uid())
           order by (m.role = 'admin') desc, m.accepted_at nulls last, m.invited_at), '[]'::jsonb)
    from public.company_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.company_id = p_company and (v_all or m.user_id = auth.uid())
  );
end
$$;

-- For delete-account (T63b part 2): companies where the user is the only admin while others remain.
create function public.company_deletion_blockers(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)), '[]'::jsonb)
  from public.companies c
  join public.company_members me on me.company_id = c.id and me.user_id = p_user and me.role = 'admin'
  where c.archived_at is null
    and public.company_admin_count(c.id) = 1
    and exists (select 1 from public.company_members o where o.company_id = c.id and o.user_id <> p_user and o.accepted_at is not null)
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants: helpers stay server-side; the RPCs are for signed-in users (the invite preview for anon too)
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.require_company(uuid, text) from public, anon, authenticated;
revoke execute on function public.require_fleet_client() from public, anon, authenticated;
revoke execute on function public.company_audit(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.company_admin_count(uuid) from public, anon, authenticated;
revoke execute on function public.company_json(public.companies) from public, anon, authenticated;
revoke execute on function public.company_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function public.company_deletion_blockers(uuid) to service_role;

revoke execute on function public.company_role(uuid) from public, anon;
revoke execute on function public.fleet_can(uuid, text) from public, anon;
revoke execute on function public.fleet_role_can(text, text) from public, anon;
grant execute on function public.company_role(uuid), public.fleet_can(uuid, text), public.fleet_role_can(text, text) to authenticated;

revoke execute on function public.create_company(text, text, text, text, uuid) from public, anon;
revoke execute on function public.update_company(uuid, text, text, text, text, uuid) from public, anon;
revoke execute on function public.set_company_rules(uuid, numeric, numeric, numeric, uuid) from public, anon;
revoke execute on function public.invite_company_member(uuid, text, text, text, uuid) from public, anon;
revoke execute on function public.accept_company_invite(text, uuid) from public, anon;
revoke execute on function public.set_company_member_role(uuid, text, uuid) from public, anon;
revoke execute on function public.remove_company_member(uuid, uuid) from public, anon;
revoke execute on function public.transfer_company_admin(uuid, uuid) from public, anon;
revoke execute on function public.my_companies() from public, anon;
revoke execute on function public.list_company_members(uuid) from public, anon;
grant execute on function
  public.create_company(text, text, text, text, uuid),
  public.update_company(uuid, text, text, text, text, uuid),
  public.set_company_rules(uuid, numeric, numeric, numeric, uuid),
  public.invite_company_member(uuid, text, text, text, uuid),
  public.accept_company_invite(text, uuid),
  public.set_company_member_role(uuid, text, uuid),
  public.remove_company_member(uuid, uuid),
  public.transfer_company_admin(uuid, uuid),
  public.my_companies(),
  public.list_company_members(uuid)
to authenticated;
revoke execute on function public.get_company_invite(text) from public;
grant execute on function public.get_company_invite(text) to anon, authenticated;

update public.schema_version set version = 91;
