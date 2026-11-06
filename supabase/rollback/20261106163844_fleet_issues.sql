-- Rollback of M3 (supabase/migrations/20261106163844_fleet_issues.sql), schema 102 → 101.
-- Run only in reverse order (after the rollbacks of every later fleet migration). Applied as a new
-- migration if Eduard decides to undo M3. Lost: the issues and their history. Kept: every photo in
-- storage (the cleanup job stops with it), every other row.
do $$
begin
  if to_regnamespace('cron') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'sh_fleet_files_cleanup'$q$;
  end if;
end
$$;

drop policy fleet_files_insert on storage.objects;
drop policy fleet_files_select on storage.objects;
drop policy fleet_files_delete on storage.objects;
-- The M1 policies, verbatim (20261106063248_fleet_expenses.sql).
create policy fleet_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-files'
    and public.fleet_file_can_write(public.try_uuid((storage.foldername(name))[1]), public.try_uuid((storage.foldername(name))[2])));
create policy fleet_files_select on storage.objects for select to authenticated
  using (bucket_id = 'fleet-files'
    and (public.fleet_can(public.try_uuid((storage.foldername(name))[1]), 'costs.view') or owner = auth.uid()));
create policy fleet_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fleet-files'
    and (public.fleet_can(public.try_uuid((storage.foldername(name))[1]), 'costs.manage') or owner = auth.uid()));

drop function public.kick_fleet_files_cleanup();
drop function public.fleet_issue_photo_orphan(text);
drop function public.fleet_issue_photo_orphans(int);
drop function public.fleet_issue_detail(uuid);
drop function public.fleet_update_issue(uuid, jsonb, uuid);
drop function public.fleet_report_issue(uuid, uuid, jsonb, uuid);
drop function public.fleet_issue_json(public.fleet_issues);
drop function public.fleet_issue_check_photos(uuid, uuid, uuid, jsonb);
drop function public.fleet_issue_photo_can_delete(text, uuid);
drop function public.fleet_issue_photo_can_read(text, uuid);
drop function public.fleet_issue_photo_can_upload(text);
drop function public.fleet_issue_path(text);
drop function public.fleet_issue_can_read(public.fleet_issues);
drop function public.fleet_issue_can_report(uuid, uuid);
drop table public.fleet_issue_events;
drop table public.fleet_issues;

-- The M1 fleet_overview, verbatim.
-- The space's one read: the expenses now filled in.
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
    'issues', '[]'::jsonb
  );
end
$$;

update public.schema_version set version = 101;
