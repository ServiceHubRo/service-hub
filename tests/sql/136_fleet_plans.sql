-- T64a — fleet plans and a company's subscription. A new company gets a 30-day Fleet Business trial
-- once per creating account and per CUI; the plan's limits refuse a vehicle or a member over it on
-- every path (nothing is deleted); read-only applies only once billing is on; subscriptions are
-- readable by the company's admin, manager and accountant only, never written by the browser; the
-- platform admin changes plans and trials, logged.
begin;
select test.make_world();

select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', 'RO 18547290', null, null, gen_random_uuid())->>'id'), true);
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'plan_key', 'fleet_business', 'a new company: Fleet Business');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'status', 'trial', 'on trial');
select test.ok((public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'trial_ends_at')::timestamptz
  between now() + interval '29 days' and now() + interval '31 days', 'for 30 days');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'price_ron', '59.00', 'its price fixed at 59 lei');
select test.eq(jsonb_array_length(public.fleet_subscription(current_setting('test.co')::uuid)->'plans'), 4, 'four plans to compare');

-- A second company of the same account: no second trial.
select set_config('test.co2', (public.create_company('A doua firmă', null, null, null, gen_random_uuid())->>'id'), true);
select test.eq(public.fleet_subscription(current_setting('test.co2')::uuid)->'plan'->>'status', 'inactive', 'a second company of the same account: no trial');
-- Another account with the same CUI: no trial either.
select test.login(test.id('client_b'));
select set_config('test.co3', (public.create_company('Aceeași firmă', 'RO18547290', null, null, gen_random_uuid())->>'id'), true);
select test.eq(public.fleet_subscription(current_setting('test.co3')::uuid)->'plan'->>'ended_reason', 'trial_used', 'the same CUI from another account: no trial');
-- With billing off, none of them is blocked.
select test.ok(not (public.fleet_plan_summary(current_setting('test.co3')::uuid)->>'read_only')::boolean, 'billing off: never read-only');

-- ------------------------------------------------------------------ the browser never writes plans
select test.fails($$update public.company_subscriptions set plan_key = 'fleet_pro'$$, 'permission denied', 'no direct change of plan');
select test.fails($$insert into public.company_subscriptions (company_id, plan_key, status) values (gen_random_uuid(), 'fleet_pro', 'active')$$,
  'permission denied', 'no direct subscription');
select test.fails($$update public.fleet_plans set vehicle_limit = 999$$, 'permission denied', 'no direct change of a plan''s limit');
select test.eq(test.count(format($$select 1 from public.company_subscriptions where company_id = %L$$, current_setting('test.co'))), 0::bigint,
  'another company''s subscription is not readable');
select test.fails(format($$select public.fleet_subscription(%L)$$, current_setting('test.co')), 'company_not_found', 'nor through the page');

-- ------------------------------------------------------------------ vehicle limit (Fleet Start: 5)
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_start', gen_random_uuid());
select test.login(test.id('client_a'));
select test.eq(public.fleet_plan_summary(current_setting('test.co')::uuid)->>'vehicle_limit', '5', 'Fleet Start: 5 vehicles');
do $$
begin
  for i in 1..5 loop
    perform public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
      jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', 'B ' || (100 + i) || ' TST'), gen_random_uuid());
  end loop;
end $$;
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Ford","model":"Transit"}', gen_random_uuid())$$,
  current_setting('test.co')), 'fleet_vehicle_limit', 'a sixth vehicle on Fleet Start: refused');
select set_config('test.v1', (select id::text from public.company_vehicles where company_id = current_setting('test.co')::uuid order by created_at limit 1), true);
select public.fleet_save_vehicle(current_setting('test.co')::uuid, current_setting('test.v1')::uuid, '{"make":"Dacia","model":"Sandero","plate":"B 101 TST"}', gen_random_uuid());
select test.ok(true, 'editing a vehicle at the limit still works');
select public.fleet_archive_vehicle(current_setting('test.v1')::uuid, true, gen_random_uuid());
select public.fleet_save_vehicle(current_setting('test.co')::uuid, null, '{"make":"Ford","model":"Transit"}', gen_random_uuid());
select test.ok(true, 'after archiving one, a new one fits');
select test.fails(format($$select public.fleet_archive_vehicle(%L, false, gen_random_uuid())$$, current_setting('test.v1')),
  'fleet_vehicle_limit', 'bringing the archived one back over the limit: refused');

-- Member limit (Fleet Start: the admin only).
select test.fails(format($$select public.invite_company_member(%L, 'x@test.local', 'driver', repeat('a1', 32), gen_random_uuid())$$,
  current_setting('test.co')), 'fleet_member_limit', 'Fleet Start: no second member');

-- Budgets need Fleet Business.
select test.fails(format($$select public.set_company_rules(%L, null, 4000, null, gen_random_uuid())$$, current_setting('test.co')),
  'plan_feature_missing', 'Fleet Start: no budget');

-- A downgrade over the limit deletes nothing.
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_business', gen_random_uuid());
select test.login(test.id('client_a'));
select public.fleet_archive_vehicle(current_setting('test.v1')::uuid, false, gen_random_uuid());
select test.eq((select count(*) from public.company_vehicles where company_id = current_setting('test.co')::uuid and archived_at is null), 6::bigint,
  'on Fleet Business the sixth vehicle comes back');
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_start', gen_random_uuid());
select test.eq((select count(*) from public.company_vehicles where company_id = current_setting('test.co')::uuid and archived_at is null), 6::bigint,
  'back on Fleet Start: all six stay, nothing deleted');

-- ------------------------------------------------------------------ roles
select test.login(test.id('client_a'));
select public.set_company_rules(current_setting('test.co')::uuid, null, null, null, gen_random_uuid());
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_business', gen_random_uuid());
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('b2', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('b2', 32), gen_random_uuid());
select test.fails(format($$select public.fleet_subscription(%L)$$, current_setting('test.co')), 'not_allowed', 'a driver cannot open the subscription');
select test.eq(test.count(format($$select 1 from public.company_subscriptions where company_id = %L$$, current_setting('test.co'))), 0::bigint,
  'nor read its row');
select test.ok(public.fleet_plan_summary(current_setting('test.co')::uuid)->>'price_ron' is null, 'the summary a driver sees has no price');

-- ------------------------------------------------------------------ read-only once billing is on
select test.logout();
update public.platform_settings set fleet_billing_enabled = true where id = 1;
update public.company_subscriptions set trial_ends_at = now() - interval '1 day' where company_id = current_setting('test.co')::uuid;
select test.login(test.id('client_a'));
select test.ok((public.fleet_plan_summary(current_setting('test.co')::uuid)->>'read_only')::boolean, 'billing on, trial over: read-only');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Opel","model":"Astra"}', gen_random_uuid())$$,
  current_setting('test.co')), 'fleet_read_only', 'read-only: no new vehicle');
select test.ok(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles') = 6, 'read-only: every vehicle still readable');
select public.fleet_save_vehicle(current_setting('test.co')::uuid, current_setting('test.v1')::uuid, '{"make":"Dacia","model":"Sandero","plate":"B 101 TST"}', gen_random_uuid());
select test.ok(true, 'read-only: an existing vehicle can still be corrected');

-- ------------------------------------------------------------------ the platform admin
select test.login(test.id('admin'));
select public.admin_extend_company_trial(current_setting('test.co')::uuid, 14, gen_random_uuid());
select test.login(test.id('client_a'));
select test.ok(not (public.fleet_plan_summary(current_setting('test.co')::uuid)->>'read_only')::boolean, 'a trial extended by the admin: working again');
select test.fails(format($$select public.admin_set_company_plan(%L, 'fleet_pro', gen_random_uuid())$$, current_setting('test.co')),
  'not_allowed', 'a member cannot change the plan through the admin function');
select test.login(test.id('admin'));
select public.admin_update_fleet_plan('fleet_start', 35, 6, 1, gen_random_uuid());
select test.eq((select price_ron from public.fleet_plans where key = 'fleet_start'), 35.00::numeric(10,2), 'the admin sets a plan''s price');
select test.ok((select count(*) from public.admin_audit_log where action in ('set_company_plan', 'extend_company_trial', 'update_fleet_plan')) >= 6,
  'every admin change is logged');
select test.ok(jsonb_array_length(public.admin_list_fleet_companies()) >= 3, 'the admin lists the companies');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_list_fleet_companies()$$, 'mfa_required', 'not without the second sign-in step');

rollback;
