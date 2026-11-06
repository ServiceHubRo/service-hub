-- Rollback of M4 (supabase/migrations/20261106171623_fleet_maintenance.sql), schema 105 → 104.
-- Run only in reverse order. Lost: the maintenance plans. The readings written by „Marchează efectuat”
-- are kept as removed (soft), so the odometer log is as before M4.
update public.fleet_odometer_readings set deleted_at = now() where source = 'maintenance' and deleted_at is null;

-- The M2 fleet_overview, verbatim (20261106165521_fleet_odometer.sql).
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
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end
$$;

drop function public.fleet_mark_maintenance_done(uuid, jsonb, uuid);
drop function public.fleet_delete_maintenance(uuid, uuid);
drop function public.fleet_save_maintenance(uuid, uuid, jsonb, uuid);
drop function public.fleet_maintenance_json(public.fleet_maintenance);
drop function public.fleet_maintenance_status(public.fleet_maintenance, date);
drop table public.fleet_maintenance;

update public.schema_version set version = 104;
