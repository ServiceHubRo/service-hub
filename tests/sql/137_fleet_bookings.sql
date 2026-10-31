-- T63d — company bookings and quote approvals. A member books a company vehicle (a driver only the
-- vehicle assigned to them, an accountant never); the booking carries the company and the vehicle;
-- one active booking per vehicle at a shop across the company; company limits replace the personal
-- ones; the driver who booked cannot approve the quote, not even through decide_quote; a manager
-- approves up to the company's limit; every decision is logged; drivers read no amounts; another
-- company or a stranger reads nothing.
begin;
select test.make_world();

select set_config('test.mgr', test.sign_up('mara@test.local',
  '{"role":"client","name":"Mara Manager","phone":"0723000011","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.acc', test.sign_up('dan@test.local',
  '{"role":"client","name":"Dan Contabil","phone":"0723000012","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.out', test.sign_up('eva@test.local',
  '{"role":"client","name":"Eva Străină","phone":"0723000013","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.day', test.workday(1)::text, true);
select set_config('test.day2', test.workday(2)::text, true);

-- One booking as the caller's overview shows it.
create function pg_temp.job(p_booking text) returns jsonb
language sql as $$
  select j from jsonb_array_elements(public.fleet_overview(current_setting('test.co')::uuid)->'jobs') j where j->>'id' = p_booking
$$;
grant execute on function pg_temp.job(text) to public;

-- ------------------------------------------------------------------ the company and its team
select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Dacia","model":"Logan","year":"2021","plate":"B 101 FLT"}', gen_random_uuid())->>'id'), true);
select set_config('test.v2', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Ford","model":"Transit","plate":"B 102 FLT"}', gen_random_uuid())->>'id'), true);
select set_config('test.v3', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Renault","model":"Kangoo","plate":"B 103 FLT"}', gen_random_uuid())->>'id'), true);
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('d1', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'mara@test.local', 'manager', repeat('d2', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'dan@test.local', 'accountant', repeat('d3', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('d1', 32), gen_random_uuid());
select set_config('test.m_b', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(current_setting('test.mgr')::uuid);
select public.accept_company_invite(repeat('d2', 32), gen_random_uuid());
select test.login(current_setting('test.acc')::uuid);
select public.accept_company_invite(repeat('d3', 32), gen_random_uuid());
select test.login(test.id('client_a'));
select public.fleet_assign_driver(current_setting('test.v1')::uuid, current_setting('test.m_b')::uuid, gen_random_uuid());

-- ------------------------------------------------------------------ the vehicles each one may book
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_bookable_vehicles()->0->'vehicles'), 1, 'a driver may book only the vehicle assigned');
select test.eq(public.fleet_bookable_vehicles()->0->'vehicles'->0->>'id', current_setting('test.v1'), 'that one');
select test.login(current_setting('test.mgr')::uuid);
select test.eq(jsonb_array_length(public.fleet_bookable_vehicles()->0->'vehicles'), 3, 'a manager may book every vehicle');
select test.login(current_setting('test.acc')::uuid);
select test.eq(jsonb_array_length(public.fleet_bookable_vehicles()), 0, 'an accountant books nothing');
select test.login(current_setting('test.out')::uuid);
select test.eq(jsonb_array_length(public.fleet_bookable_vehicles()), 0, 'a stranger sees no company vehicle');

-- ------------------------------------------------------------------ booking
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '10:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day'), current_setting('test.v2')),
  'not_allowed', 'a driver cannot book a vehicle not assigned to them');
select set_config('test.req', gen_random_uuid()::text, true);
select set_config('test.b1', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day')::date,
  p_slot => '10:00', p_request_id => current_setting('test.req')::uuid, p_company_vehicle_id => current_setting('test.v1')::uuid)).id::text, true);
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day')::date,
  p_slot => '10:00', p_request_id => current_setting('test.req')::uuid, p_company_vehicle_id => current_setting('test.v1')::uuid)).id::text,
  current_setting('test.b1'), 'the same request twice returns the first booking');
select test.logout();
select test.eq((select company_id::text from public.bookings where id = current_setting('test.b1')::uuid), current_setting('test.co'), 'the booking carries the company');
select test.eq((select company_vehicle_id::text from public.bookings where id = current_setting('test.b1')::uuid), current_setting('test.v1'), 'and the vehicle');
select test.eq((select car_snapshot->>'plate' from public.bookings where id = current_setting('test.b1')::uuid), 'B 101 FLT', 'the vehicle''s details are the snapshot');
select test.eq((select client_id from public.bookings where id = current_setting('test.b1')::uuid), test.id('client_b'), 'the driver is the booking''s client');
select test.eq((select count(*) from public.company_audit_log where company_id = current_setting('test.co')::uuid and action = 'booking_created'), 1::bigint,
  'the booking is in the company log');

select test.login(current_setting('test.mgr')::uuid);
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'frane', p_date => %L, p_slot => '12:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day2'), current_setting('test.v1')),
  'car_already_booked', 'the same vehicle at the same shop, booked by another member: refused');
select test.login(test.id('client_a'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00',
  p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}', p_company_vehicle_id => %L)$$,
  test.id('shop1'), current_setting('test.day'), current_setting('test.v2')), 'car_invalid', 'a typed car and a company vehicle together: refused');
select test.login(current_setting('test.acc')::uuid);
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day'), current_setting('test.v2')),
  'not_allowed', 'an accountant cannot book');
select test.login(current_setting('test.out')::uuid);
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day'), current_setting('test.v2')),
  'vehicle_not_found', 'a stranger cannot book a company vehicle');
select test.login(test.id('owner1'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day'), current_setting('test.v2')),
  'not_allowed', 'a shop account cannot book a company vehicle');

-- Company limits replace the personal ones; personal limits no longer count company bookings.
select test.logout();
update public.platform_settings set limits = limits || '{"active_bookings_total": 1, "fleet_active_bookings_per_shop": 2}'::jsonb where id = 1;
select test.login(test.id('client_a'));
select set_config('test.b2', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day')::date,
  p_slot => '11:00', p_request_id => gen_random_uuid(), p_company_vehicle_id => current_setting('test.v2')::uuid)).id::text, true);
select public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day2')::date,
  p_slot => '11:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Skoda","model":"Octavia","plate":"BV 77 PRS"}');
select test.ok(true, 'a personal booking still fits: the company booking is not counted');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00',
  p_request_id => gen_random_uuid(), p_car => '{"make":"Opel","model":"Astra","plate":"BV 78 PRS"}')$$, test.id('shop1'), current_setting('test.day2')),
  'limit_active_total', 'the personal limit still holds for personal bookings');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '15:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day2'), current_setting('test.v3')),
  'fleet_limit_active_shop', 'the company''s limit at one shop');
select test.logout();
update public.platform_settings set limits = limits || '{"active_bookings_total": 10, "fleet_active_bookings_per_shop": 20}'::jsonb where id = 1;

-- Read-only (billing on, trial over): no new booking.
update public.platform_settings set fleet_billing_enabled = true where id = 1;
update public.company_subscriptions set status = 'inactive' where company_id = current_setting('test.co')::uuid;
select test.login(test.id('client_a'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '15:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day2'), current_setting('test.v3')),
  'fleet_read_only', 'a company in read-only cannot book');
select test.logout();
update public.company_subscriptions set status = 'trial' where company_id = current_setting('test.co')::uuid;
update public.platform_settings set fleet_billing_enabled = false where id = 1;

-- ------------------------------------------------------------------ who reads the bookings
select test.login(current_setting('test.mgr')::uuid);
select test.eq(test.count(format($$select 1 from public.bookings where company_id = %L$$, current_setting('test.co'))), 2::bigint,
  'a manager reads the company''s bookings');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'), 2, 'and the overview holds them');
select test.login(current_setting('test.acc')::uuid);
select test.eq(test.count(format($$select 1 from public.bookings where company_id = %L$$, current_setting('test.co'))), 2::bigint,
  'so does the accountant');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'jobs'), 1, 'a driver: the booking of the vehicle assigned');
select test.eq(test.count(format($$select 1 from public.bookings where company_id = %L$$, current_setting('test.co'))), 1::bigint,
  'and reads only their own row');
select test.login(current_setting('test.out')::uuid);
select test.eq(test.count(format($$select 1 from public.bookings where company_id = %L$$, current_setting('test.co'))), 0::bigint,
  'a stranger reads none');
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.co')), 'company_not_found', 'nor the overview');
select test.login(test.id('client_a'));
select test.fails(format($$update public.bookings set company_id = null where id = %L$$, current_setting('test.b1')), 'permission denied',
  'the browser cannot change a booking''s company');
select test.fails($$select * from public.company_quote_decisions$$, 'permission denied', 'nor read the decision log directly');

-- ------------------------------------------------------------------ the quote
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.b1')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.b1')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.b1')::uuid, '[{"name":"Plăcuțe","price":420},{"name":"Manoperă","price":180}]', gen_random_uuid());
select set_config('test.q1', test.sent_quote(current_setting('test.b1')::uuid)::text, true);
select set_config('test.items', test.quote_item_ids(current_setting('test.q1')::uuid)::text, true);

select test.login(test.id('client_b'));
select test.ok(pg_temp.job(current_setting('test.b1'))->'quote' = 'null'::jsonb, 'a driver reads no quote');
select test.ok(pg_temp.job(current_setting('test.b1'))->'cost' = 'null'::jsonb, 'nor any cost');
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')),
  'fleet_use_company_approval', 'the driver who booked cannot approve through decide_quote');
select test.fails(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')),
  'not_allowed', 'nor through the company''s approval');
select test.login(current_setting('test.acc')::uuid);
select test.fails(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')),
  'not_allowed', 'an accountant cannot approve');
select test.login(current_setting('test.out')::uuid);
select test.fails(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')),
  'booking_not_found', 'a stranger cannot approve');

-- The manager's limit: only the admin sets it.
select test.login(current_setting('test.mgr')::uuid);
select test.fails(format($$select public.set_company_rules(%L, 100000, null, null, gen_random_uuid())$$, current_setting('test.co')),
  'not_allowed', 'a manager cannot raise their own limit');
select test.login(test.id('client_a'));
select public.set_company_rules(current_setting('test.co')::uuid, 500, null, null, gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select test.eq(pg_temp.job(current_setting('test.b1'))->'quote'->>'total_sent', '600.00', 'the manager reads the quote');
select test.fails(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')),
  'fleet_over_limit', 'over the manager''s limit: refused');
select test.eq(test.error_params(format($$select public.fleet_decide_quote(%L, %L, %L, gen_random_uuid())$$,
  current_setting('test.b1'), current_setting('test.q1'), current_setting('test.items')))->>'limit', '500.00', 'the refusal names the limit');
select set_config('test.req', gen_random_uuid()::text, true);
select test.eq((public.fleet_decide_quote(current_setting('test.b1')::uuid, current_setting('test.q1')::uuid,
  array[(current_setting('test.items')::uuid[])[1]], current_setting('test.req')::uuid)).status, 'approved', 'within the limit: approved');
select test.eq((public.fleet_decide_quote(current_setting('test.b1')::uuid, current_setting('test.q1')::uuid,
  array[(current_setting('test.items')::uuid[])[1]], current_setting('test.req')::uuid)).status, 'approved', 'the same request twice: the first answer');
select test.logout();
select test.eq((select status from public.quotes where id = current_setting('test.q1')::uuid), 'partially_accepted', 'one line of two: partially accepted');
select test.eq((select total_approved from public.quotes where id = current_setting('test.q1')::uuid), 420.00::numeric(10,2), 'for 420 lei');
select test.eq((select decided_by_user::text from public.quotes where id = current_setting('test.q1')::uuid), current_setting('test.mgr'), 'decided by the manager');
select test.eq((select count(*) from public.company_quote_decisions where booking_id = current_setting('test.b1')::uuid), 1::bigint, 'one decision logged');
select test.eq((select role || ' ' || decision || ' ' || amount from public.company_quote_decisions where booking_id = current_setting('test.b1')::uuid),
  'manager partially_approved 420.00', 'who, what and how much');
select test.eq((select count(*) from public.company_audit_log where company_id = current_setting('test.co')::uuid and action = 'quote_decided'), 1::bigint,
  'and in the company log');
select test.login(test.id('client_a'));
select test.eq(pg_temp.job(current_setting('test.b1'))->'quote'->>'decided_by_name', 'Mara Manager', 'the overview names who decided');

-- A refusal (the manager may always refuse): the inspection fee becomes the cost.
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.b2')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.b2')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.b2')::uuid, '[{"name":"Ambreiaj","price":2400}]', gen_random_uuid());
select test.login(current_setting('test.mgr')::uuid);
select test.eq((public.fleet_decide_quote(current_setting('test.b2')::uuid, test.sent_quote(current_setting('test.b2')::uuid), '{}', gen_random_uuid())).status,
  'quote_refused', 'a manager refuses a quote over their limit');

-- An admin approves any amount.
select test.login(test.id('client_a'));
select set_config('test.b3', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day2')::date,
  p_slot => '15:00', p_request_id => gen_random_uuid(), p_company_vehicle_id => current_setting('test.v3')::uuid)).id::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.b3')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.b3')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.b3')::uuid, '[{"name":"Distribuție","price":1900}]', gen_random_uuid());
select test.login(test.id('client_a'));
select test.eq((public.fleet_decide_quote(current_setting('test.b3')::uuid, test.sent_quote(current_setting('test.b3')::uuid),
  test.quote_item_ids(test.sent_quote(current_setting('test.b3')::uuid)), gen_random_uuid())).status, 'approved', 'the admin approves above the managers'' limit');

-- ------------------------------------------------------------------ fleets off
select test.logout();
update public.platform_settings set fleet_enabled = false where id = 1;
select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.fleet_bookable_vehicles()), 0, 'fleets off: no company vehicle offered');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '16:00',
  p_request_id => gen_random_uuid(), p_company_vehicle_id => %L)$$, test.id('shop1'), current_setting('test.day2'), current_setting('test.v3')),
  'fleet_disabled', 'fleets off: no company booking');

rollback;
