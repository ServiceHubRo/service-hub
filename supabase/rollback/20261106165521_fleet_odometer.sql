-- Rollback of M2 (supabase/migrations/20261106165521_fleet_odometer.sql), schema 103 → 102.
-- Run only in reverse order (after the rollbacks of every later fleet migration). Lost: the manual
-- readings, the corrections, the ignored jobs, the import exceptions. Kept: every receipt (its odometer
-- field never left the receipt), every booking.
drop function public.fleet_fuel_stats(uuid, uuid, date, date);
drop function public.fleet_ignore_job_odometer(uuid, text, uuid);
drop function public.fleet_correct_reading(uuid, int, text, uuid);
drop function public.fleet_add_reading(uuid, uuid, date, int, uuid);

-- The M1 functions, verbatim (20261106063248_fleet_expenses.sql), and the M3 fleet_overview, verbatim.
create or replace function public.fleet_save_expense(p_company uuid, p_expense uuid, p_fields jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_manage boolean;
  v_before public.fleet_expenses%rowtype;
  v_row public.fleet_expenses%rowtype;
  v_vehicle uuid := public.try_uuid(f->>'vehicle_id');
  v_category text := f->>'category';
  v_day date;
  v_amount numeric;
  v_currency text := upper(coalesce(nullif(btrim(f->>'currency'), ''), 'RON'));
  v_odometer int;
  v_liters numeric;
  v_booking uuid := public.try_uuid(nullif(f->>'booking_id', ''));
  v_receipt text := nullif(btrim(coalesce(f->>'receipt_path', '')), '');
  v_supplier text := nullif(btrim(coalesce(f->>'supplier', '')), '');
  v_other uuid;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_save_expense');
  if v_seen is not null then
    return v_seen;
  end if;
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if public.company_read_only(p_company) then
    perform public.fail('fleet_read_only');
  end if;
  v_manage := public.fleet_can(p_company, 'costs.manage');

  -- The fields, checked here whatever the browser checked.
  if v_category is null or v_category not in ('fuel', 'parts', 'repairs', 'labor', 'tolls', 'consumables', 'insurance', 'other') then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'category'));
  end if;
  begin
    v_day := (f->>'day')::date;
    v_amount := round((f->>'amount')::numeric, 2);
    v_odometer := nullif(f->>'odometer', '')::int;
    v_liters := nullif(f->>'liters', '')::numeric;
  exception when others then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'number'));
  end;
  if v_day is null or v_day > public.bucharest_today() or v_day < date '2000-01-01' then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'day'));
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'amount'));
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'currency'));
  end if;
  if v_odometer is not null and v_odometer not between 0 and 2000000 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'odometer'));
  end if;
  if v_category = 'fuel' then
    if v_liters is not null and (v_liters <= 0 or v_liters > 2000) then
      perform public.fail('expense_invalid', jsonb_build_object('field', 'liters'));
    end if;
    if nullif(f->>'fuel_type', '') is not null and f->>'fuel_type' not in ('diesel', 'petrol', 'lpg', 'electric', 'other') then
      perform public.fail('expense_invalid', jsonb_build_object('field', 'fuel_type'));
    end if;
  end if;
  if char_length(v_supplier) > 120 or char_length(f->>'description') > 500 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'text'));
  end if;
  if v_receipt is not null and v_receipt !~ ('^' || p_company::text || '/' || coalesce(v_vehicle::text, '-') || '/[A-Za-z0-9._-]{1,120}$') then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'receipt'));
  end if;

  -- One request at a time per vehicle: two identical expenses cannot both pass the duplicate check.
  perform 1 from public.company_vehicles cv where cv.id = v_vehicle and cv.company_id = p_company for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;

  -- Who may write it: costs.manage; a driver only fuel, only for the vehicle assigned to them, only new.
  if not v_manage then
    if public.company_role(p_company) <> 'driver' or p_expense is not null or v_category <> 'fuel'
       or not exists (select 1 from public.company_vehicles cv where cv.id = v_vehicle and cv.archived_at is null
                        and cv.driver_member_id = public.my_member_id(p_company)) then
      perform public.fail('not_allowed');
    end if;
  end if;

  if v_booking is not null and not exists (
    select 1 from public.bookings b where b.id = v_booking and b.company_id = p_company and b.company_vehicle_id = v_vehicle) then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'booking'));
  end if;

  if p_expense is not null then
    select * into v_before from public.fleet_expenses e where e.id = p_expense and e.company_id = p_company and e.deleted_at is null for update;
    if not found then
      perform public.fail('expense_not_found');
    end if;
  end if;

  if not coalesce((f->>'confirm_duplicate')::boolean, false) then
    select e.id into v_other from public.fleet_expenses e
    where e.company_id = p_company and e.vehicle_id = v_vehicle and e.day = v_day and e.amount = v_amount
      and e.deleted_at is null and e.id is distinct from p_expense
      and lower(coalesce(e.supplier, '')) = lower(coalesce(v_supplier, ''))
    limit 1;
    if v_other is not null then
      perform public.fail('expense_possible_duplicate', jsonb_build_object('expense_id', v_other));
    end if;
  end if;

  if p_expense is null then
    insert into public.fleet_expenses (company_id, vehicle_id, category, day, amount, currency, supplier, description, odometer,
      liters, fuel_type, full_tank, booking_id, receipt_path, status, created_by)
    values (p_company, v_vehicle, v_category, v_day, v_amount, v_currency, v_supplier, nullif(btrim(coalesce(f->>'description', '')), ''),
      v_odometer,
      case when v_category = 'fuel' then v_liters end,
      case when v_category = 'fuel' then nullif(f->>'fuel_type', '') end,
      case when v_category = 'fuel' then (f->>'full_tank')::boolean end,
      v_booking, v_receipt, case when v_manage then 'ok' else 'to_check' end, auth.uid())
    returning * into v_row;
    perform public.company_audit(p_company, 'expense_created', 'expense', v_row.id, null, public.fleet_expense_json(v_row));
  else
    update public.fleet_expenses set
      vehicle_id = v_vehicle, category = v_category, day = v_day, amount = v_amount, currency = v_currency, supplier = v_supplier,
      description = nullif(btrim(coalesce(f->>'description', '')), ''), odometer = v_odometer,
      liters = case when v_category = 'fuel' then v_liters end,
      fuel_type = case when v_category = 'fuel' then nullif(f->>'fuel_type', '') end,
      full_tank = case when v_category = 'fuel' then (f->>'full_tank')::boolean end,
      booking_id = v_booking, receipt_path = v_receipt, updated_at = now()
    where id = p_expense
    returning * into v_row;
    perform public.company_audit(p_company, 'expense_updated', 'expense', v_row.id, public.fleet_expense_json(v_before), public.fleet_expense_json(v_row));
  end if;

  v_result := public.fleet_expense_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create or replace function public.fleet_delete_expense(p_expense uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.fleet_expenses%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_delete_expense');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.fleet_expenses e where e.id = p_expense and e.deleted_at is null for update;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('expense_not_found');
  end if;
  if not public.fleet_can(v_row.company_id, 'costs.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_row.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  update public.fleet_expenses set deleted_at = now() where id = p_expense;
  perform public.company_audit(v_row.company_id, 'expense_deleted', 'expense', v_row.id, public.fleet_expense_json(v_row), null);
  v_result := jsonb_build_object('id', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

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
    ), '[]'::jsonb)
  );
end
$$;

drop function public.fleet_import_expense_readings();
drop function public.fleet_reading_json(public.fleet_odometer_readings);
drop function public.fleet_sync_expense_reading(public.fleet_expenses);
drop function public.fleet_odometer_check(uuid, date, int, uuid);
drop function public.fleet_odometer_points(uuid);
drop table public.fleet_odometer_import_exceptions;
drop table public.fleet_odometer_ignored_jobs;
drop table public.fleet_odometer_readings;

update public.schema_version set version = 102;
