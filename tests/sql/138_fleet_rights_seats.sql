-- T63i/T64d — rights the admin gives, and colleagues billed per person. Only the admin gives rights,
-- changes roles, hands over the administration, invites or removes an admin and sets the approval
-- limit; a right works everywhere the role's rights do (approve with the member's own limit, manage
-- vehicles, invite); nobody gives a right on. A plan includes colleagues (the admin not counted),
-- each one after them adds the colleague's price, fixed with the subscription; pending invitations
-- are free; the frame never sees a price.
begin;
select test.make_world();

select set_config('test.mgr', test.sign_up('mara@test.local',
  '{"role":"client","name":"Mara Manager","phone":"0723000011","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.acc', test.sign_up('dan@test.local',
  '{"role":"client","name":"Dan Contabil","phone":"0723000012","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.c4', test.sign_up('ioana@test.local', '{"role":"client","name":"Ioana Patru"}')::text, true);
select set_config('test.day', test.workday(1)::text, true);

select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Dacia","model":"Logan","plate":"B 201 FLT"}', gen_random_uuid())->>'id'), true);
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('e1', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'mara@test.local', 'manager', repeat('e2', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'dan@test.local', 'accountant', repeat('e3', 32), gen_random_uuid());

-- ------------------------------------------------------------------ colleagues billed per person
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'included_members', '3', 'Fleet Business includes 3 colleagues');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'member_price_ron', '19.00', 'then 19 lei each');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'colleagues', '0', 'pending invitations are free; the admin does not count');
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('e1', 32), gen_random_uuid());
select set_config('test.m_b', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(current_setting('test.mgr')::uuid);
select public.accept_company_invite(repeat('e2', 32), gen_random_uuid());
select set_config('test.m_mgr', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(current_setting('test.acc')::uuid);
select public.accept_company_invite(repeat('e3', 32), gen_random_uuid());
select set_config('test.m_acc', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(test.id('client_a'));
select public.fleet_assign_driver(current_setting('test.v1')::uuid, current_setting('test.m_b')::uuid, gen_random_uuid());
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'extra_members', '0', 'three colleagues: all included');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'monthly_total', '59.00', 'the plan''s price alone');
select public.invite_company_member(current_setting('test.co')::uuid, 'ioana@test.local', 'driver', repeat('e4', 32), gen_random_uuid());
select test.login(current_setting('test.c4')::uuid);
select public.accept_company_invite(repeat('e4', 32), gen_random_uuid());
select test.login(test.id('client_a'));
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'extra_members', '1', 'a fourth colleague is not refused: one past the plan');
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'monthly_total', '78.00', '59 + 19 lei');
select test.ok(not (public.fleet_plan_summary(current_setting('test.co')::uuid) ? 'member_price_ron')
  and not (public.fleet_plan_summary(current_setting('test.co')::uuid) ? 'monthly_total'), 'the frame never sees a price');

-- The platform admin sets the plan: colleagues included for everyone, the price fixed until a plan change.
select test.login(test.id('admin'));
select public.admin_update_fleet_plan('fleet_business', 59, 15, 2, 25, gen_random_uuid());
select test.login(test.id('client_a'));
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'monthly_total', '97.00',
  'two included now; the running subscription keeps 19 lei: 59 + 2 × 19');
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_business', gen_random_uuid());
select test.login(test.id('client_a'));
select test.eq(public.fleet_subscription(current_setting('test.co')::uuid)->'plan'->>'monthly_total', '109.00',
  'after a plan change the new colleague''s price: 59 + 2 × 25');
select test.fails($$select public.admin_update_fleet_plan('fleet_business', 59, 15, 2, 25, gen_random_uuid())$$, 'not_allowed',
  'a company member cannot change a plan');

-- ------------------------------------------------------------------ only the admin gives rights
select test.login(current_setting('test.mgr')::uuid);
select test.fails(format($$select public.set_company_member_rights(%L, '{quotes.approve}', null, gen_random_uuid())$$,
  current_setting('test.m_acc')), 'not_allowed', 'a manager cannot give rights');
select test.fails(format($$select public.set_company_member_rights(%L, '{quotes.approve}', 99999, gen_random_uuid())$$,
  current_setting('test.m_mgr')), 'not_allowed', 'nor raise their own limit');
select test.login(test.id('client_a'));
select test.fails(format($$select public.set_company_member_rights(%L, '{company.manage}', null, gen_random_uuid())$$,
  current_setting('test.m_mgr')), 'company_rights_invalid', 'the company''s settings cannot be given');
select test.fails(format($$select public.set_company_member_rights(%L, '{subscription.manage}', null, gen_random_uuid())$$,
  current_setting('test.m_mgr')), 'company_rights_invalid', 'nor the subscription');
select test.fails(format($$select public.set_company_member_rights(%L, '{costs.view}', 300, gen_random_uuid())$$,
  current_setting('test.m_acc')), 'company_rights_invalid', 'a limit only with the right to approve');
select test.fails(format($$select public.set_company_member_rights(%L, '{}', null, gen_random_uuid())$$,
  public.my_member_id(current_setting('test.co')::uuid)), 'company_rights_invalid', 'never to an admin');
select test.fails(format($$update public.company_members set extra_caps = '{members.manage}' where id = %L$$, current_setting('test.m_mgr')),
  'permission denied', 'the browser never writes rights');

-- The accountant may approve, up to 300 lei.
select public.set_company_member_rights(current_setting('test.m_acc')::uuid, '{quotes.approve}', 300, gen_random_uuid());
select test.eq((select count(*) from public.company_audit_log where company_id = current_setting('test.co')::uuid and action = 'set_member_rights'), 1::bigint,
  'a right given is in the company log');
select set_config('test.b1', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day')::date,
  p_slot => '10:00', p_request_id => gen_random_uuid(), p_company_vehicle_id => current_setting('test.v1')::uuid)).id::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.b1')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.b1')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.b1')::uuid, '[{"name":"Filtru","price":250},{"name":"Manoperă","price":150}]', gen_random_uuid());
select set_config('test.q1', test.sent_quote(current_setting('test.b1')::uuid)::text, true);
select set_config('test.items', test.quote_item_ids(current_setting('test.q1')::uuid)::text, true);
select test.login(current_setting('test.acc')::uuid);
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'), 1, 'approving brings the bookings');
select test.eq(public.fleet_overview(current_setting('test.co')::uuid)->'me'->>'approval_limit', '300.00', 'and the member''s own limit');
select test.fails(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.b1'), current_setting('test.q1'),
  current_setting('test.items')), 'fleet_over_limit', 'over their own limit: refused');
select test.eq((public.fleet_decide_quote(current_setting('test.b1')::uuid, current_setting('test.q1')::uuid,
  array[(current_setting('test.items')::uuid[])[1]], gen_random_uuid())).status, 'approved', 'within it: approved');

-- A manager's own limit, lower than the company's.
select test.login(test.id('client_a'));
select public.set_company_member_rights(current_setting('test.m_mgr')::uuid, '{}', 200, gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select test.eq(public.fleet_overview(current_setting('test.co')::uuid)->'me'->>'approval_limit', '200.00', 'a manager''s own limit');

-- A driver who may manage vehicles sees and adds them all.
select test.login(test.id('client_a'));
select public.set_company_member_rights(current_setting('test.m_b')::uuid, '{vehicles.manage}', null, gen_random_uuid());
select test.login(test.id('client_b'));
select public.fleet_save_vehicle(current_setting('test.co')::uuid, null, '{"make":"Ford","model":"Transit","plate":"B 202 FLT"}', gen_random_uuid());
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 2, 'the driver with the right sees every vehicle');
select test.ok(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'->0->'quote' = 'null'::jsonb, 'but still no money');
select test.login(test.id('client_a'));
select public.set_company_member_rights(current_setting('test.m_b')::uuid, '{}', null, gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 1, 'the right taken back: only the assigned vehicle');

-- A manager who may invite never touches the admin's part.
select test.login(test.id('client_a'));
select public.set_company_member_rights(current_setting('test.m_mgr')::uuid, '{members.manage,budget.manage}', null, gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select public.invite_company_member(current_setting('test.co')::uuid, 'nou@test.local', 'driver', repeat('e5', 32), gen_random_uuid());
select test.ok(true, 'a manager who may invite invites a driver');
select test.fails(format($$select public.invite_company_member(%L, 'sef@test.local', 'admin', repeat('e6', 32), gen_random_uuid())$$, current_setting('test.co')),
  'not_allowed', 'but never an admin');
select test.fails(format($$select public.set_company_member_role(%L, 'manager', gen_random_uuid())$$, current_setting('test.m_acc')),
  'not_allowed', 'nor changes a role');
select test.fails(format($$select public.transfer_company_admin(%L, gen_random_uuid())$$, current_setting('test.m_mgr')),
  'not_allowed', 'nor takes the administration');
select test.fails(format($$select public.remove_company_member(%L, gen_random_uuid())$$,
  (select id from public.company_members where company_id = current_setting('test.co')::uuid and role = 'admin')), 'not_allowed', 'nor removes the admin');
select public.set_company_rules(current_setting('test.co')::uuid, null, 4000, null, gen_random_uuid());
select test.ok(true, 'a manager who may manage the budget sets it');
select test.fails(format($$select public.set_company_rules(%L, 100000, 4000, null, gen_random_uuid())$$, current_setting('test.co')),
  'not_allowed', 'but never the approval limit');
select test.fails(format($$select public.set_company_member_rights(%L, '{quotes.approve}', null, gen_random_uuid())$$,
  current_setting('test.m_b')), 'not_allowed', 'and gives no right on');

rollback;
