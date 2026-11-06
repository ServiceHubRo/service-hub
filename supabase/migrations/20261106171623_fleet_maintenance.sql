-- M4 / T75 — maintenance (Eduard, 6 Nov 2026: approved in docs/FLEET_EXTENSION_PLAN.md §M4).
--
-- A maintenance plan per company vehicle: oil, filters, brakes, tires, battery, fluids, service or a
-- custom item, every N km and/or every N months, with the last time it was done. The status is computed,
-- never stored, and never a false „ok”:
--   km:     needs the last km and the latest odometer value (readings and finished jobs), at most 60 days
--           old, dated on or after the last service, not below its km. Left = last km + interval − km:
--           overdue below 0, soon 0–1,000, else ok.
--   months: needs the last date. Due = last date + interval: overdue after it, soon in the last 30 days,
--           else ok.
--   both:   overdue if either is; else soon if either is; ok only if both are ok; else not enough data,
--           with what is known.
-- Reasons when data is missing: no_last_done_km, no_last_done_on, no_reading, reading_old,
-- reading_before_service. „Marchează efectuat” takes a date and a km (writing a reading under the M2 rule)
-- or a finished Service-Hub job of that vehicle (offered, never automatic).
--
-- Rights: vehicles.manage writes; whoever sees the vehicle reads. Rollback:
-- supabase/rollback/20261106171623_fleet_maintenance.sql.

create table public.fleet_maintenance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.company_vehicles (id),
  kind text not null check (kind in ('oil', 'filters', 'brakes', 'tires', 'battery', 'fluids', 'service', 'custom')),
  label text check (char_length(btrim(label)) between 1 and 80),
  interval_km int check (interval_km between 2000 and 500000),
  interval_months int check (interval_months between 2 and 120),
  last_done_on date,
  last_done_km int check (last_done_km between 0 and 2000000),
  last_booking_id uuid references public.bookings (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  check (interval_km is not null or interval_months is not null),
  check (kind <> 'custom' or label is not null)
);
create index fleet_maintenance_vehicle_idx on public.fleet_maintenance (vehicle_id) where deleted_at is null;
create index fleet_maintenance_company_idx on public.fleet_maintenance (company_id) where deleted_at is null;
alter table public.fleet_maintenance enable row level security;
revoke all on public.fleet_maintenance from anon, authenticated;

-- ------------------------------------------------------------------ the status
create function public.fleet_maintenance_status(m public.fleet_maintenance, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, public.bucharest_today());
  v_day date;
  v_km int;
  v_reasons text[] := '{}';
  v_km_status text;
  v_month_status text;
  v_left int;
  v_due date;
  v_status text;
begin
  -- The km side.
  if m.interval_km is not null then
    select p.day, p.km into v_day, v_km from public.fleet_odometer_points(m.vehicle_id) p order by p.day desc, p.km desc limit 1;
    if m.last_done_km is null then
      v_reasons := array_append(v_reasons, 'no_last_done_km');
    elsif v_km is null then
      v_reasons := array_append(v_reasons, 'no_reading');
    elsif v_day < v_today - 60 then
      v_reasons := array_append(v_reasons, 'reading_old');
    elsif (m.last_done_on is not null and v_day < m.last_done_on) or v_km < m.last_done_km then
      v_reasons := array_append(v_reasons, 'reading_before_service');
    else
      v_left := m.last_done_km + m.interval_km - v_km;
      v_km_status := case when v_left < 0 then 'overdue' when v_left <= 1000 then 'soon' else 'ok' end;
    end if;
  end if;
  -- The months side.
  if m.interval_months is not null then
    if m.last_done_on is null then
      v_reasons := array_append(v_reasons, 'no_last_done_on');
    else
      v_due := (m.last_done_on + make_interval(months => m.interval_months))::date;
      v_month_status := case when v_today > v_due then 'overdue' when v_due - v_today <= 30 then 'soon' else 'ok' end;
    end if;
  end if;

  v_status := case
    when 'overdue' in (v_km_status, v_month_status) then 'overdue'
    when 'soon' in (v_km_status, v_month_status) then 'soon'
    when (m.interval_km is null or v_km_status = 'ok') and (m.interval_months is null or v_month_status = 'ok') then 'ok'
    else 'insufficient_data'
  end;
  return jsonb_build_object(
    'status', v_status, 'reasons', to_jsonb(v_reasons),
    'km_status', v_km_status, 'km_left', v_left, 'due_km', case when m.last_done_km is not null and m.interval_km is not null then m.last_done_km + m.interval_km end,
    'reading_km', v_km, 'reading_day', v_day,
    'month_status', v_month_status, 'due_on', v_due, 'days_left', case when v_due is not null then v_due - v_today end);
end
$$;
revoke execute on function public.fleet_maintenance_status(public.fleet_maintenance, date) from public, anon, authenticated;

create function public.fleet_maintenance_json(m public.fleet_maintenance)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'vehicle_id', m.vehicle_id, 'kind', m.kind, 'label', m.label, 'interval_km', m.interval_km,
    'interval_months', m.interval_months, 'last_done_on', m.last_done_on, 'last_done_km', m.last_done_km,
    'last_booking_id', m.last_booking_id, 'created_at', m.created_at, 'updated_at', m.updated_at,
    'state', public.fleet_maintenance_status(m))
$$;
revoke execute on function public.fleet_maintenance_json(public.fleet_maintenance) from public, anon, authenticated;

-- ------------------------------------------------------------------ add or change an item (vehicles.manage)
create function public.fleet_save_maintenance(p_company uuid, p_item uuid, p_fields jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_vehicle uuid := public.try_uuid(f->>'vehicle_id');
  v_kind text := f->>'kind';
  v_label text := nullif(btrim(coalesce(f->>'label', '')), '');
  v_km int;
  v_months int;
  v_on date;
  v_last_km int;
  v_before public.fleet_maintenance%rowtype;
  v_row public.fleet_maintenance%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_save_maintenance');
  if v_seen is not null then
    return v_seen;
  end if;
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if not public.fleet_can(p_company, 'vehicles.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(p_company) then
    perform public.fail('fleet_read_only');
  end if;
  begin
    v_km := nullif(f->>'interval_km', '')::int;
    v_months := nullif(f->>'interval_months', '')::int;
    v_on := nullif(f->>'last_done_on', '')::date;
    v_last_km := nullif(f->>'last_done_km', '')::int;
  exception when others then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'number'));
  end;
  if v_kind is null or v_kind not in ('oil', 'filters', 'brakes', 'tires', 'battery', 'fluids', 'service', 'custom') then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'kind'));
  end if;
  if v_kind = 'custom' and v_label is null or char_length(v_label) > 80 then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'label'));
  end if;
  if v_km is null and v_months is null then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'interval'));
  end if;
  if v_km is not null and v_km not between 2000 and 500000 then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'interval_km'));
  end if;
  if v_months is not null and v_months not between 2 and 120 then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'interval_months'));
  end if;
  if v_on is not null and (v_on > public.bucharest_today() or v_on < date '2000-01-01') then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'last_done_on'));
  end if;
  if v_last_km is not null and v_last_km not between 0 and 2000000 then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'last_done_km'));
  end if;
  perform 1 from public.company_vehicles cv where cv.id = v_vehicle and cv.company_id = p_company for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;

  if p_item is null then
    insert into public.fleet_maintenance (company_id, vehicle_id, kind, label, interval_km, interval_months, last_done_on, last_done_km, created_by)
    values (p_company, v_vehicle, v_kind, v_label, v_km, v_months, v_on, v_last_km, auth.uid())
    returning * into v_row;
    perform public.company_audit(p_company, 'maintenance_created', 'maintenance', v_row.id, null, to_jsonb(v_row));
  else
    select * into v_before from public.fleet_maintenance m where m.id = p_item and m.company_id = p_company and m.deleted_at is null for update;
    if not found then
      perform public.fail('maintenance_not_found');
    end if;
    update public.fleet_maintenance set vehicle_id = v_vehicle, kind = v_kind, label = v_label, interval_km = v_km,
      interval_months = v_months, last_done_on = v_on, last_done_km = v_last_km, updated_at = now()
    where id = p_item returning * into v_row;
    perform public.company_audit(p_company, 'maintenance_updated', 'maintenance', v_row.id, to_jsonb(v_before), to_jsonb(v_row));
  end if;
  v_result := public.fleet_maintenance_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create function public.fleet_delete_maintenance(p_item uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.fleet_maintenance%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_delete_maintenance');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.fleet_maintenance m where m.id = p_item and m.deleted_at is null for update;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('maintenance_not_found');
  end if;
  if not public.fleet_can(v_row.company_id, 'vehicles.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_row.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  update public.fleet_maintenance set deleted_at = now() where id = p_item;
  perform public.company_audit(v_row.company_id, 'maintenance_deleted', 'maintenance', v_row.id, to_jsonb(v_row), null);
  v_result := jsonb_build_object('id', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ------------------------------------------------------------------ „Marchează efectuat”
-- With a finished Service-Hub job of that vehicle: its day and km (already evidence, no reading written).
-- With a day and a km: a reading (source maintenance) under the M2 rule. A day alone for a months-only item.
create function public.fleet_mark_maintenance_done(p_item uuid, p_fields jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_before public.fleet_maintenance%rowtype;
  v_row public.fleet_maintenance%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id uuid := public.try_uuid(nullif(f->>'booking_id', ''));
  v_day date;
  v_km int;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_mark_maintenance_done');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_before from public.fleet_maintenance m where m.id = p_item and m.deleted_at is null;
  if not found or public.company_role(v_before.company_id) is null then
    perform public.fail('maintenance_not_found');
  end if;
  if not public.fleet_can(v_before.company_id, 'vehicles.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_before.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  -- The vehicle first (as every odometer write), then the item.
  perform 1 from public.company_vehicles cv where cv.id = v_before.vehicle_id for update;
  select * into v_before from public.fleet_maintenance m where m.id = p_item and m.deleted_at is null for update;

  if v_booking_id is not null then
    select * into v_booking from public.bookings b
    where b.id = v_booking_id and b.company_id = v_before.company_id and b.company_vehicle_id = v_before.vehicle_id and b.status = 'done';
    if not found then
      perform public.fail('maintenance_invalid', jsonb_build_object('field', 'booking'));
    end if;
    v_day := coalesce((v_booking.done_at at time zone 'Europe/Bucharest')::date, v_booking.date);
    v_km := v_booking.odometer;
    if v_km is null and v_before.interval_km is not null then
      begin
        v_km := nullif(f->>'km', '')::int;
      exception when others then
        perform public.fail('maintenance_invalid', jsonb_build_object('field', 'km'));
      end;
    end if;
  else
    begin
      v_day := (f->>'day')::date;
      v_km := nullif(f->>'km', '')::int;
    exception when others then
      perform public.fail('maintenance_invalid', jsonb_build_object('field', 'number'));
    end;
  end if;
  if v_day is null or v_day > public.bucharest_today() or v_day < date '2000-01-01' then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'day'));
  end if;
  if v_before.interval_km is not null and v_km is null then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'km'));
  end if;
  if v_km is not null and v_km not between 0 and 2000000 then
    perform public.fail('maintenance_invalid', jsonb_build_object('field', 'km'));
  end if;
  if v_km is not null and (v_booking_id is null or v_booking.odometer is null) then
    perform public.fleet_odometer_check(v_before.vehicle_id, v_day, v_km);
    insert into public.fleet_odometer_readings (company_id, vehicle_id, day, km, source, created_by)
    values (v_before.company_id, v_before.vehicle_id, v_day, v_km, 'maintenance', auth.uid());
  end if;

  update public.fleet_maintenance set last_done_on = v_day, last_done_km = coalesce(v_km, last_done_km),
    last_booking_id = v_booking_id, updated_at = now()
  where id = p_item returning * into v_row;
  perform public.company_audit(v_row.company_id, 'maintenance_done', 'maintenance', v_row.id, to_jsonb(v_before), to_jsonb(v_row));
  v_result := public.fleet_maintenance_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke execute on function public.fleet_save_maintenance(uuid, uuid, jsonb, uuid), public.fleet_delete_maintenance(uuid, uuid),
  public.fleet_mark_maintenance_done(uuid, jsonb, uuid) from public, anon;
grant execute on function public.fleet_save_maintenance(uuid, uuid, jsonb, uuid), public.fleet_delete_maintenance(uuid, uuid),
  public.fleet_mark_maintenance_done(uuid, jsonb, uuid) to authenticated;

-- ------------------------------------------------------------------ the space's one read: the maintenance plans added
create or replace function public.fleet_overview(p_company uuid)
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
  v_money boolean;
  v_bookings boolean;
  v_issues boolean;
  v_manage boolean;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  v_role := public.company_role(p_company);
  if v_company.id is null or v_role is null then
    perform public.fail('company_not_found');
  end if;
  v_me := public.my_member_id(p_company);
  v_all := public.fleet_can(p_company, 'vehicles.viewAll');
  v_team := public.fleet_can(p_company, 'members.manage') or public.fleet_can(p_company, 'vehicles.manage');
  v_money := public.fleet_can(p_company, 'costs.view');
  v_bookings := public.fleet_can(p_company, 'bookings.viewAll');
  v_issues := v_all or public.fleet_can(p_company, 'issues.manage');
  v_manage := public.fleet_can(p_company, 'vehicles.manage');
  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'vat_id', v_company.vat_id, 'plan_key', 'none',
      -- Money rules only for those who see money.
      'manager_approval_limit', case when v_money then v_company.manager_approval_limit end,
      'budget', jsonb_build_object(
        'monthly', case when v_money then v_company.budget_monthly end,
        'yearly', case when v_money then v_company.budget_yearly end)),
    'me', jsonb_build_object('member_id', v_me, 'role', v_role,
      -- The rights that apply: none on a plan without them (kept, they apply again after an upgrade).
      'extra_caps', to_jsonb(case when public.fleet_has_feature(p_company, 'member_rights')
                                  then (select m.extra_caps from public.company_members m where m.id = v_me) else '{}'::text[] end),
      'approval_limit', case when v_money then public.my_approval_limit(p_company) end),
    'vehicles', coalesce((
      select jsonb_agg(public.vehicle_json(cv) order by cv.created_at, cv.id)
      from public.company_vehicles cv
      where cv.company_id = p_company
        and (v_all or (cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'user_id', m.user_id, 'name', coalesce(p.name, ''),
               'email', lower(coalesce(u.email, m.invited_email)), 'role', m.role, 'accepted_at', m.accepted_at,
               'extra_caps', to_jsonb(m.extra_caps), 'approval_limit', case when v_money then m.approval_limit end)
             order by m.accepted_at nulls last, m.invited_at)
      from public.company_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.company_id = p_company and (v_team or m.user_id = auth.uid())
    ), '[]'::jsonb),
    -- The company's bookings (T63d): all for those who see all; a driver those of the vehicles
    -- assigned to them and their own, without amounts.
    'jobs', coalesce((
      select jsonb_agg(public.fleet_job_json(b, v_money) order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      where b.company_id = p_company
        and (v_bookings
             or b.client_id = auth.uid()
             or b.company_vehicle_id in (
               select cv.id from public.company_vehicles cv
               where cv.company_id = p_company and cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    -- M1: the company's own expenses; a member without costs.view (a driver) sees only the ones they added.
    'expenses', coalesce((
      select jsonb_agg(public.fleet_expense_json(e) order by e.day desc, e.created_at desc)
      from public.fleet_expenses e
      where e.company_id = p_company and e.deleted_at is null and (v_money or e.created_by = auth.uid())), '[]'::jsonb),
    -- M3: issues and incidents; all for vehicles.viewAll / issues.manage, otherwise the member's own reports
    -- and those of the vehicles assigned to them.
    'issues', coalesce((
      select jsonb_agg(public.fleet_issue_json(i) order by i.created_at desc, i.id)
      from public.fleet_issues i
      where i.company_id = p_company
        and (v_issues or i.reported_by = auth.uid()
             or i.vehicle_id in (select cv.id from public.company_vehicles cv where cv.company_id = p_company and cv.driver_member_id = v_me))
    ), '[]'::jsonb),
    -- M2: the odometer log of the vehicles the member sees; the jobs whose km the company left out; the
    -- receipts the import could not take (vehicles.manage, who fixes them).
    'readings', coalesce((
      select jsonb_agg(public.fleet_reading_json(r) order by r.day desc, r.km desc, r.created_at desc)
      from public.fleet_odometer_readings r
      where r.company_id = p_company and r.deleted_at is null
        and (v_all or r.vehicle_id in (select cv.id from public.company_vehicles cv where cv.company_id = p_company and cv.driver_member_id = v_me))
    ), '[]'::jsonb),
    'ignored_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', g.booking_id, 'reason', g.reason, 'at', g.at) order by g.at)
      from public.fleet_odometer_ignored_jobs g where g.company_id = p_company and (v_all or v_bookings)
    ), '[]'::jsonb),
    'odometer_exceptions', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('expense_id', x.expense_id, 'vehicle_id', x.vehicle_id, 'day', x.day, 'km', x.km,
                                          'reasons', to_jsonb(x.reasons)) order by x.day desc)
      from public.fleet_odometer_import_exceptions x
      join public.fleet_expenses e on e.id = x.expense_id and e.deleted_at is null
      where e.company_id = p_company
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- M4: the maintenance plans of the vehicles the member sees, each with its computed status.
    'maintenance', coalesce((
      select jsonb_agg(public.fleet_maintenance_json(m) order by m.vehicle_id, m.created_at, m.id)
      from public.fleet_maintenance m
      where m.company_id = p_company and m.deleted_at is null
        and (v_all or m.vehicle_id in (select cv.id from public.company_vehicles cv where cv.company_id = p_company and cv.driver_member_id = v_me))
    ), '[]'::jsonb)
  );
end
$$;

update public.schema_version set version = 105;
