-- T63c — A company's vehicles, and fleet access for test accounts on the real project.
-- docs/FLEET_PLAN.md §3.2. Only additions, plus `require_fleet_client` replaced to accept test
-- accounts. No existing row changes.
--
-- · profiles.fleet_beta — a test account for fleets (Eduard, 31 Oct 2026: test on the real
--   database while clients see nothing). Set only by SQL; the browser has no grant on it.
--   Fleets work for an account when `platform_settings.fleet_enabled` is on, or for it alone when
--   its `fleet_beta` is on.
-- · company_vehicles — the company's own vehicles. Deliberately NOT rows of `cars`: a car belongs
--   to a person (`cars.owner_id` cascades on delete, the personal reminders and the garage follow
--   it), while a company vehicle must outlive any member — the one who added it can leave or delete
--   their account and the vehicle, its history and costs stay with the company.
-- · Writes only through functions (vehicles.manage: admin, manager), each logged in
--   company_audit_log. A driver reads only the vehicles assigned to them.
-- · fleet_overview(company) — the one read of the fleet screens, already narrowed to the role.

-- ---------------------------------------------------------------------------------------------
-- Fleet access: the switch, or a test account
-- ---------------------------------------------------------------------------------------------
alter table public.profiles add column fleet_beta boolean not null default false;

create or replace function public.require_fleet_client()
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
  if not (v.fleet_beta or coalesce((select ps.fleet_enabled from public.platform_settings ps where ps.id = 1), false)) then
    perform public.fail('fleet_disabled');
  end if;
  return v;
end
$$;
revoke execute on function public.require_fleet_client() from public, anon, authenticated;

-- Whether the caller may use fleets (the app shows "Firmele mele" only then).
create function public.my_fleet_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.role = 'client'
       and (p.fleet_beta or coalesce((select ps.fleet_enabled from public.platform_settings ps where ps.id = 1), false))
    from public.profiles p where p.id = auth.uid()
  ), false)
$$;
revoke execute on function public.my_fleet_access() from public, anon;
grant execute on function public.my_fleet_access() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- company_vehicles
-- ---------------------------------------------------------------------------------------------
create table public.company_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
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
  department text check (char_length(department) <= 60),
  vehicle_type text check (vehicle_type in ('car', 'van', 'truck', 'motorcycle', 'other')),
  driver_member_id uuid references public.company_members(id) on delete set null,
  unavailable boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index company_vehicles_company_idx on public.company_vehicles (company_id);
create index company_vehicles_driver_idx on public.company_vehicles (driver_member_id) where driver_member_id is not null;
-- One vehicle per plate in a company's active fleet (an archived one may come back as a new row).
create unique index company_vehicles_plate_idx on public.company_vehicles (company_id, plate_norm)
  where plate_norm is not null and archived_at is null;
alter table public.company_vehicles enable row level security;

create trigger company_vehicles_normalize before insert or update on public.company_vehicles
  for each row execute function public.cars_normalize();
create trigger company_vehicles_updated_at before update on public.company_vehicles
  for each row execute function public.set_updated_at();

-- The caller's member row in a company (accepted), else null.
create function public.my_member_id(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id from public.company_members m
  where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
$$;
revoke execute on function public.my_member_id(uuid) from public, anon;
grant execute on function public.my_member_id(uuid) to authenticated;

grant select on public.company_vehicles to authenticated;
create policy company_vehicles_select on public.company_vehicles for select to authenticated
  using (
    public.fleet_can(company_id, 'vehicles.viewAll')
    or (driver_member_id is not null and driver_member_id = public.my_member_id(company_id) and archived_at is null)
    or public.is_admin()
  );

-- ---------------------------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------------------------

-- Checks one vehicle's fields (the same rules as the garage, src/lib/validators.ts); raises
-- vehicle_invalid {field}.
create function public.check_vehicle_fields(p jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_year int;
begin
  if char_length(btrim(coalesce(p->>'make', ''))) not between 1 and 60 then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'make'));
  end if;
  if char_length(btrim(coalesce(p->>'model', ''))) not between 1 and 60 then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'model'));
  end if;
  if nullif(p->>'year', '') is not null then
    if (p->>'year') !~ '^\d{4}$' then
      perform public.fail('vehicle_invalid', jsonb_build_object('field', 'year'));
    end if;
    v_year := (p->>'year')::int;
    if v_year < 1900 or v_year > extract(year from public.bucharest_today())::int + 1 then
      perform public.fail('vehicle_invalid', jsonb_build_object('field', 'year'));
    end if;
  end if;
  if char_length(coalesce(p->>'plate', '')) > 20 then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'plate'));
  end if;
  if nullif(btrim(coalesce(p->>'vin', '')), '') is not null and not public.is_valid_vin(public.normalize_code(p->>'vin')) then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'vin'));
  end if;
  if char_length(coalesce(p->>'department', '')) > 60 then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'department'));
  end if;
  if nullif(p->>'vehicle_type', '') is not null and p->>'vehicle_type' not in ('car', 'van', 'truck', 'motorcycle', 'other') then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'vehicle_type'));
  end if;
  begin
    perform nullif(p->>'itp_expiry', '')::date, nullif(p->>'rca_expiry', '')::date, nullif(p->>'vignette_expiry', '')::date;
  exception when others then
    perform public.fail('vehicle_invalid', jsonb_build_object('field', 'expiry'));
  end;
end
$$;
revoke execute on function public.check_vehicle_fields(jsonb) from public, anon, authenticated;

create function public.vehicle_json(v public.company_vehicles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(v) - 'driver_member_id' - 'plate_norm' - 'created_by' - 'updated_at'
         || jsonb_build_object('driver_id', v.driver_member_id)
$$;
revoke execute on function public.vehicle_json(public.company_vehicles) from public, anon, authenticated;

-- Adds a vehicle (p_vehicle null) or changes one (admin, manager). At most `company_vehicles_max`
-- (500) active vehicles; the plan's own limit comes with T64.
create function public.fleet_save_vehicle(p_company uuid, p_vehicle uuid, p_fields jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.company_vehicles%rowtype;
  v_row public.company_vehicles%rowtype;
  v_result jsonb;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_save_vehicle');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'vehicles.manage');
  perform public.check_vehicle_fields(f);
  -- One fleet edits at a time: the limit and the plate check cannot be passed by two requests.
  perform 1 from public.companies where id = p_company for update;

  if p_vehicle is null then
    if (select count(*) from public.company_vehicles cv where cv.company_id = p_company and cv.archived_at is null)
       >= public.app_limit('company_vehicles_max', 500) then
      perform public.fail('limit_vehicles', jsonb_build_object('limit', public.app_limit('company_vehicles_max', 500)));
    end if;
  else
    select * into v_before from public.company_vehicles where id = p_vehicle and company_id = p_company;
    if not found then
      perform public.fail('vehicle_not_found');
    end if;
  end if;

  if nullif(upper(regexp_replace(coalesce(f->>'plate', ''), '[\s-]', '', 'g')), '') is not null and exists (
    select 1 from public.company_vehicles cv
    where cv.company_id = p_company and cv.archived_at is null and cv.id is distinct from p_vehicle
      and cv.plate_norm = upper(regexp_replace(f->>'plate', '[\s-]', '', 'g'))
  ) then
    perform public.fail('vehicle_plate_exists');
  end if;

  if p_vehicle is null then
    insert into public.company_vehicles (company_id, make, model, year, plate, vin, itp_expiry, rca_expiry, vignette_expiry,
      department, vehicle_type, created_by)
    values (p_company, f->>'make', f->>'model', nullif(f->>'year', '')::int, nullif(f->>'plate', ''), nullif(f->>'vin', ''),
      nullif(f->>'itp_expiry', '')::date, nullif(f->>'rca_expiry', '')::date, nullif(f->>'vignette_expiry', '')::date,
      nullif(btrim(coalesce(f->>'department', '')), ''), nullif(f->>'vehicle_type', ''), auth.uid())
    returning * into v_row;
    perform public.company_audit(p_company, 'add_vehicle', 'vehicle', v_row.id, null, public.vehicle_json(v_row));
  else
    update public.company_vehicles set
      make = f->>'make', model = f->>'model', year = nullif(f->>'year', '')::int, plate = nullif(f->>'plate', ''),
      vin = nullif(f->>'vin', ''), itp_expiry = nullif(f->>'itp_expiry', '')::date, rca_expiry = nullif(f->>'rca_expiry', '')::date,
      vignette_expiry = nullif(f->>'vignette_expiry', '')::date, department = nullif(btrim(coalesce(f->>'department', '')), ''),
      vehicle_type = nullif(f->>'vehicle_type', '')
    where id = p_vehicle
    returning * into v_row;
    perform public.company_audit(p_company, 'update_vehicle', 'vehicle', v_row.id, public.vehicle_json(v_before), public.vehicle_json(v_row));
  end if;

  v_result := public.vehicle_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Archives a vehicle (retired from the fleet: history stays) or brings it back (admin, manager).
create function public.fleet_archive_vehicle(p_vehicle uuid, p_archived boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_vehicles%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_archive_vehicle');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_vehicles where id = p_vehicle;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;
  perform public.require_company(v_row.company_id, 'vehicles.manage');
  perform 1 from public.companies where id = v_row.company_id for update;
  select * into v_row from public.company_vehicles where id = p_vehicle;
  if coalesce(p_archived, false) and v_row.archived_at is null then
    update public.company_vehicles set archived_at = now(), driver_member_id = null where id = p_vehicle returning * into v_row;
    perform public.company_audit(v_row.company_id, 'archive_vehicle', 'vehicle', v_row.id, null, null);
  elsif not coalesce(p_archived, false) and v_row.archived_at is not null then
    if (select count(*) from public.company_vehicles cv where cv.company_id = v_row.company_id and cv.archived_at is null)
       >= public.app_limit('company_vehicles_max', 500) then
      perform public.fail('limit_vehicles', jsonb_build_object('limit', public.app_limit('company_vehicles_max', 500)));
    end if;
    if v_row.plate_norm is not null and exists (
      select 1 from public.company_vehicles cv
      where cv.company_id = v_row.company_id and cv.archived_at is null and cv.plate_norm = v_row.plate_norm
    ) then
      perform public.fail('vehicle_plate_exists');
    end if;
    update public.company_vehicles set archived_at = null where id = p_vehicle returning * into v_row;
    perform public.company_audit(v_row.company_id, 'unarchive_vehicle', 'vehicle', v_row.id, null, null);
  end if;
  v_result := public.vehicle_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Assigns a vehicle to an accepted member of the same company, or to nobody (admin, manager).
create function public.fleet_assign_driver(p_vehicle uuid, p_member uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_vehicles%rowtype;
  v_before uuid;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_assign_driver');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_vehicles where id = p_vehicle for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;
  perform public.require_company(v_row.company_id, 'vehicles.manage');
  if v_row.archived_at is not null then
    perform public.fail('vehicle_archived');
  end if;
  if p_member is not null and not exists (
    select 1 from public.company_members m
    where m.id = p_member and m.company_id = v_row.company_id and m.accepted_at is not null
  ) then
    perform public.fail('member_not_found');
  end if;
  v_before := v_row.driver_member_id;
  update public.company_vehicles set driver_member_id = p_member where id = p_vehicle returning * into v_row;
  perform public.company_audit(v_row.company_id, 'assign_driver', 'vehicle', v_row.id,
    jsonb_build_object('driver', v_before), jsonb_build_object('driver', p_member));
  v_result := public.vehicle_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Marks a vehicle unavailable (or available again) — the only way "Indisponibil" is shown.
create function public.fleet_set_unavailable(p_vehicle uuid, p_unavailable boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_vehicles%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_set_unavailable');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_vehicles where id = p_vehicle for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;
  perform public.require_company(v_row.company_id, 'vehicles.manage');
  update public.company_vehicles set unavailable = coalesce(p_unavailable, false) where id = p_vehicle returning * into v_row;
  perform public.company_audit(v_row.company_id, 'set_unavailable', 'vehicle', v_row.id, null,
    jsonb_build_object('unavailable', v_row.unavailable));
  v_result := public.vehicle_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The fleet screens' one read (the shape of src/lib/fleet/types.ts FleetOverview)
-- ---------------------------------------------------------------------------------------------
create function public.fleet_overview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_role text;
  v_me uuid;
  v_all boolean;
  v_team boolean;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  v_role := public.company_role(p_company);
  if v_company.id is null or v_role is null then
    perform public.fail('company_not_found');
  end if;
  v_me := public.my_member_id(p_company);
  v_all := public.fleet_role_can(v_role, 'vehicles.viewAll');
  v_team := public.fleet_role_can(v_role, 'members.manage') or public.fleet_role_can(v_role, 'vehicles.manage');
  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'vat_id', v_company.vat_id, 'plan_key', 'none',
      -- Money rules only for those who see money.
      'manager_approval_limit', case when public.fleet_role_can(v_role, 'costs.view') then v_company.manager_approval_limit end,
      'budget', jsonb_build_object(
        'monthly', case when public.fleet_role_can(v_role, 'costs.view') then v_company.budget_monthly end,
        'yearly', case when public.fleet_role_can(v_role, 'costs.view') then v_company.budget_yearly end)),
    'me', jsonb_build_object('member_id', v_me, 'role', v_role),
    'vehicles', coalesce((
      select jsonb_agg(public.vehicle_json(cv) order by cv.created_at, cv.id)
      from public.company_vehicles cv
      where cv.company_id = p_company
        and (v_all or (cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'user_id', m.user_id, 'name', coalesce(p.name, ''),
               'email', lower(coalesce(u.email, m.invited_email)), 'role', m.role, 'accepted_at', m.accepted_at)
             order by m.accepted_at nulls last, m.invited_at)
      from public.company_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.company_id = p_company and (v_team or m.user_id = auth.uid())
    ), '[]'::jsonb),
    -- Bookings, expenses and issues arrive with T63d / T63e.
    'jobs', '[]'::jsonb,
    'expenses', '[]'::jsonb,
    'issues', '[]'::jsonb
  );
end
$$;

revoke execute on function public.fleet_save_vehicle(uuid, uuid, jsonb, uuid) from public, anon;
revoke execute on function public.fleet_archive_vehicle(uuid, boolean, uuid) from public, anon;
revoke execute on function public.fleet_assign_driver(uuid, uuid, uuid) from public, anon;
revoke execute on function public.fleet_set_unavailable(uuid, boolean, uuid) from public, anon;
revoke execute on function public.fleet_overview(uuid) from public, anon;
grant execute on function
  public.fleet_save_vehicle(uuid, uuid, jsonb, uuid),
  public.fleet_archive_vehicle(uuid, boolean, uuid),
  public.fleet_assign_driver(uuid, uuid, uuid),
  public.fleet_set_unavailable(uuid, boolean, uuid),
  public.fleet_overview(uuid)
to authenticated;

-- Realtime: the fleet screens follow the company's vehicles and team (RLS decides who gets a row).
do $$
declare
  t text;
begin
  foreach t in array array['company_vehicles', 'company_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

update public.schema_version set version = 92;
