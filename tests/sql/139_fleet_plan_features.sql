-- T65 — three real plans. Start: no reports, exports, budgets, approval limits or extra rights;
-- Business adds them; Pro adds the advanced reports, filters, forecast, Excel and members' own
-- limits. The plan never widens a role (a driver on Pro still sees no money, an accountant still
-- cannot approve); a downgrade makes nothing more permissive and deletes nothing. The report's
-- figures follow the ledger of src/lib/fleet/costs.ts (tests/unit/fleet.test.ts has the same case).
begin;
select test.make_world();

select set_config('test.acc', test.sign_up('dan@test.local',
  '{"role":"client","name":"Dan Contabil","phone":"0723000012","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.mgr', test.sign_up('mara@test.local',
  '{"role":"client","name":"Mara Manager","phone":"0723000011","lang":"ro","terms_version":"2026-09"}')::text, true);

select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Dacia","model":"Logan","plate":"B 301 FLT","department":"Vânzări"}', gen_random_uuid())->>'id'), true);
select set_config('test.v2', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Ford","model":"Transit","plate":"B 302 FLT","department":"Livrări"}', gen_random_uuid())->>'id'), true);
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('f1', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'dan@test.local', 'accountant', repeat('f2', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'mara@test.local', 'manager', repeat('f3', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('f1', 32), gen_random_uuid());
select set_config('test.m_b', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(current_setting('test.acc')::uuid);
select public.accept_company_invite(repeat('f2', 32), gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select public.accept_company_invite(repeat('f3', 32), gen_random_uuid());
select set_config('test.m_mgr', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(test.id('client_a'));
select public.fleet_assign_driver(current_setting('test.v1')::uuid, current_setting('test.m_b')::uuid, gen_random_uuid());

-- The company's finished jobs (written as the server would, no app path needed):
--   v1: oil change 400 lei at 100 000 km (40 days ago), brakes 600 lei at 101 000 km (10 days ago)
--   v2: oil change 200 lei at 50 000 km (20 days ago), a refused quote's inspection fee of 80 lei (5 days ago)
select test.logout();
create function pg_temp.job(p_vehicle text, p_service text, p_status text, p_days int, p_cost numeric, p_km int) returns void
language sql as $$
  insert into public.bookings (shop_id, client_id, service_id, client_name, client_lang, car_snapshot, date, slot, status,
                               cost, odometer, done_at, company_id, company_vehicle_id)
  values (test.id('shop1'), test.id('client_a'), p_service, 'Ana Marin', 'ro', '{"make":"Dacia","model":"Logan"}',
          test.today() - p_days, '10:00', p_status, p_cost, p_km,
          case when p_status = 'done' then ((test.today() - p_days) + time '16:00') at time zone 'Europe/Bucharest' end,
          current_setting('test.co')::uuid, p_vehicle::uuid)
$$;
select pg_temp.job(current_setting('test.v1'), 'ulei', 'done', 40, 400, 100000);
select pg_temp.job(current_setting('test.v1'), 'frane', 'done', 10, 600, 101000);
select pg_temp.job(current_setting('test.v2'), 'ulei', 'done', 20, 200, 50000);
select pg_temp.job(current_setting('test.v2'), 'frane', 'quote_refused', 5, 80, null);

create function pg_temp.report(p_filters jsonb default '{}') returns jsonb
language sql as $$
  select public.fleet_report(current_setting('test.co')::uuid, test.today() - 60, test.today(),
                             test.today() - 121, test.today() - 61, p_filters)
$$;
grant execute on function pg_temp.job(text, text, text, int, numeric, int), pg_temp.report(jsonb) to public;

create function pg_temp.set_plan(p_plan text) returns void
language plpgsql as $$
begin
  perform test.login(test.id('admin'));
  perform public.admin_set_company_plan(current_setting('test.co')::uuid, p_plan, gen_random_uuid());
  perform test.login(test.id('client_a'));
end
$$;
grant execute on function pg_temp.set_plan(text) to public;

-- ------------------------------------------------------------------ Fleet Start
select pg_temp.set_plan('fleet_start');
select test.fails($$select pg_temp.report()$$, 'plan_feature_missing', 'Start: no reports, not even through the API');
select test.fails(format($$select public.fleet_log_export(%L, 'costs_csv', 4)$$, current_setting('test.co')), 'plan_feature_missing', 'Start: no export');
select test.fails(format($$select public.set_company_rules(%L, null, 4000, null, gen_random_uuid())$$, current_setting('test.co')),
  'plan_feature_missing', 'Start: no budget');
select test.fails(format($$select public.set_company_rules(%L, 500, null, null, gen_random_uuid())$$, current_setting('test.co')),
  'plan_feature_missing', 'Start: no approval limit for managers');
select test.fails(format($$select public.set_company_member_rights(%L, '{vehicles.manage}', null, gen_random_uuid())$$, current_setting('test.m_b')),
  'plan_feature_missing', 'Start: no rights beyond the role');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'), 4, 'Start: the jobs and their costs are listed (Costuri)');

-- ------------------------------------------------------------------ Fleet Business
select pg_temp.set_plan('fleet_business');
select test.eq((pg_temp.report()->>'total')::numeric, 1280.00, 'the period''s total: 400 + 600 + 200 + 80');
select test.eq((pg_temp.report()->>'count')::int, 4, 'four entries');
select test.eq((pg_temp.report()->'previous'->>'total')::numeric, 0.00, 'nothing in the period before');
select test.eq((pg_temp.report()->>'avg_per_vehicle')::numeric, 640.00, 'per vehicle: 1280 / 2');
select test.eq(pg_temp.report()->'by_vehicle'->0->>'key', current_setting('test.v1'), 'the Logan costs most');
select test.eq((pg_temp.report()->'by_vehicle'->0->>'total')::numeric, 1000.00, '1000 lei');
select test.eq(pg_temp.report()->'by_vehicle'->0->>'top_category', 'repairs', 'mostly repairs');
select test.eq(pg_temp.report()->'by_vehicle'->1->>'top_category', 'maintenance', 'the Transit mostly maintenance (200 against an 80 lei fee)');
select test.eq(pg_temp.report()->'by_category'->0->>'key', 'repairs', 'repairs first');
select test.eq((pg_temp.report()->'by_category'->0->>'total')::numeric, 680.00, 'repairs: 600 + the 80 lei fee');
select test.eq((pg_temp.report()->'repairs'->0->>'count')::int, 2, 'two finished jobs on the Logan (a refused quote is not a repair)');
select test.eq(pg_temp.report()->'per_km'->'per_vehicle'->0->>'status', 'ok', 'the Logan has a cost per km');
select test.eq((pg_temp.report()->'per_km'->'per_vehicle'->0->>'km')::int, 1000, 'over 1000 km');
select test.eq((pg_temp.report()->'per_km'->'per_vehicle'->0->>'per_km')::numeric, 0.60, '600 lei after the first reading: 0.60 lei/km');
select test.eq(pg_temp.report()->'per_km'->'per_vehicle'->1->>'status', 'one_reading', 'one reading: no figure for the Transit');
select test.eq((pg_temp.report()->'per_km'->'total'->>'per_km')::numeric, 0.60, 'the fleet: only cars with a figure');
select test.ok(pg_temp.report() ? 'budget', 'Business: budgets');
select test.ok(not (pg_temp.report() ? 'advanced'), 'Business: no advanced part');
select test.ok(not (pg_temp.report()->'budget' ? 'forecast') and not (pg_temp.report() ? 'forecast'), 'Business: no forecast');
select test.fails($$select pg_temp.report('{"categories":["repairs"]}')$$, 'plan_feature_missing', 'Business: no filters');
select public.fleet_log_export(current_setting('test.co')::uuid, 'costs_csv', 4);
select test.eq((select count(*) from public.company_audit_log where company_id = current_setting('test.co')::uuid and action = 'export'), 1::bigint,
  'an export is logged');
select test.fails(format($$select public.fleet_log_export(%L, 'report_xlsx', 4)$$, current_setting('test.co')), 'plan_feature_missing', 'Business: no Excel');
select public.set_company_rules(current_setting('test.co')::uuid, 500, 4000, null, gen_random_uuid());
select test.ok(true, 'Business: the managers'' limit and a budget');
select test.fails(format($$select public.set_company_member_rights(%L, '{}', 300, gen_random_uuid())$$, current_setting('test.m_mgr')),
  'plan_feature_missing', 'Business: no own limit for a member');
select public.set_company_member_rights(current_setting('test.m_b')::uuid, '{vehicles.manage}', null, gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 2, 'Business: the right applies');

-- Roles stay roles on any plan.
select test.fails($$select pg_temp.report()$$, 'not_allowed', 'a driver never gets the reports');
select test.login(current_setting('test.acc')::uuid);
select test.eq((pg_temp.report()->>'total')::numeric, 1280.00, 'the accountant reads them');

-- ------------------------------------------------------------------ Fleet Pro
select pg_temp.set_plan('fleet_pro');
select test.ok(pg_temp.report() ? 'advanced', 'Pro: the advanced part');
select test.eq(pg_temp.report()->'advanced'->'high_cost'->>0, current_setting('test.v1'), 'the Logan costs over 1.5 × the average (1000 > 960)');
select test.eq(jsonb_array_length(pg_temp.report()->'advanced'->'vehicle_monthly'), 2, 'each vehicle''s last 12 months');
select test.ok(pg_temp.report()->'budget' is not null and pg_temp.report() ? 'forecast', 'Pro: the forecast');
select test.eq((pg_temp.report('{"categories":["repairs"]}')->>'total')::numeric, 680.00, 'Pro: a category filter');
select test.eq((pg_temp.report(jsonb_build_object('departments', jsonb_build_array('Livrări')))->>'total')::numeric, 280.00, 'a department filter');
select public.fleet_log_export(current_setting('test.co')::uuid, 'report_xlsx', 4);
select test.ok(true, 'Pro: Excel');
select public.set_company_member_rights(current_setting('test.m_mgr')::uuid, '{}', 200, gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select test.eq(public.fleet_overview(current_setting('test.co')::uuid)->'me'->>'approval_limit', '200.00', 'Pro: the manager''s own limit');

-- A driver on Pro still sees no money; an accountant on Pro still cannot approve.
select test.login(test.id('client_b'));
select test.ok(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'->0->'cost' = 'null'::jsonb, 'Pro: a driver sees no cost');
select test.login(current_setting('test.acc')::uuid);
select test.ok(not public.fleet_can(current_setting('test.co')::uuid, 'quotes.approve'), 'Pro: an accountant does not approve');

-- ------------------------------------------------------------------ down to Start: nothing more permissive, nothing deleted
select test.login(test.id('client_a'));
select public.set_company_member_rights(current_setting('test.m_mgr')::uuid, '{}', 800, gen_random_uuid());
select pg_temp.set_plan('fleet_business');
select test.login(current_setting('test.mgr')::uuid);
select test.eq(public.fleet_overview(current_setting('test.co')::uuid)->'me'->>'approval_limit', '500.00',
  'Business: the lower of the own limit (800) and the company''s (500)');
select pg_temp.set_plan('fleet_start');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 1, 'Start: the right no longer applies');
select test.logout();
select test.eq((select extra_caps from public.company_members where id = current_setting('test.m_b')::uuid), '{vehicles.manage}'::text[],
  'but it is kept for an upgrade');
select test.eq((select budget_monthly from public.companies where id = current_setting('test.co')::uuid), 4000.00::numeric(12,2),
  'the budget is kept too');
select test.eq((select count(*) from public.bookings where company_id = current_setting('test.co')::uuid), 4::bigint, 'and every job');

rollback;
