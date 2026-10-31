-- T63c — company vehicles and fleet test accounts. A company's vehicles are read and written only by
-- its members with the right role; a driver reads only the vehicles assigned to them; another
-- company sees nothing; writes go through the functions only; with fleets off, only a test account
-- (profiles.fleet_beta) can use them.
begin;
select test.make_world();
-- Fleets are on since migration fleet_on; turned off here to check the test accounts.
update public.platform_settings set fleet_enabled = false where id = 1;

-- ------------------------------------------------------------------ fleets off: only a test account
select test.login(test.id('client_a'));
select test.ok(not public.my_fleet_access(), 'fleets off: no access');
select test.fails($$select public.create_company('Firma Ana', null, null, null, gen_random_uuid())$$, 'fleet_disabled',
  'fleets off: a normal account cannot create a company');
select test.logout();
update public.profiles set fleet_beta = true where id in (test.id('client_a'), test.id('client_b'));
select test.login(test.id('client_a'));
select test.ok(public.my_fleet_access(), 'a test account has access while fleets are off');
select test.fails($$update public.profiles set fleet_beta = false where id = auth.uid()$$, 'permission denied',
  'the browser cannot change the test flag');
select test.login(test.id('owner1'));
select test.ok(not public.my_fleet_access(), 'a shop account never has fleet access');

select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', null, null, null, gen_random_uuid())->>'id'), true);

-- ------------------------------------------------------------------ adding vehicles
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"","model":"Logan"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_invalid', 'a vehicle without make: refused');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Dacia","model":"Logan","vin":"123"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_invalid', 'an invalid VIN: refused');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Dacia","model":"Logan","year":"1850"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_invalid', 'an impossible year: refused');

select set_config('test.req', gen_random_uuid()::text, true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Dacia","model":"Logan","year":"2021","plate":"b 101 flt","vehicle_type":"car","department":"Vânzări","itp_expiry":"2027-01-10"}',
  current_setting('test.req')::uuid)->>'id'), true);
select test.eq((public.fleet_save_vehicle(current_setting('test.co')::uuid, null, '{"make":"Dacia","model":"Logan"}',
  current_setting('test.req')::uuid)->>'id'), current_setting('test.v1'), 'the same request twice returns the first vehicle');
select test.eq(test.count($$select 1 from public.company_vehicles$$), 1::bigint, 'and adds only one');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Ford","model":"Transit","plate":"B-101-FLT"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_plate_exists', 'the same plate written another way: refused');
select set_config('test.v2', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Ford","model":"Transit","plate":"B 202 FLT","vehicle_type":"van"}', gen_random_uuid())->>'id'), true);

select test.fails($$insert into public.company_vehicles (company_id, make, model) values (current_setting('test.co')::uuid, 'X', 'Y')$$,
  'permission denied', 'no direct insert');
select test.fails($$update public.company_vehicles set make = 'Furat'$$, 'permission denied', 'no direct update');
select test.fails($$delete from public.company_vehicles$$, 'permission denied', 'no direct delete');

-- ------------------------------------------------------------------ another company sees nothing
select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.company_vehicles$$), 0::bigint, 'another account reads no vehicle of A');
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.co')), 'company_not_found', 'nor its overview');
select test.fails(format($$select public.fleet_save_vehicle(%L, %L, '{"make":"X","model":"Y"}', gen_random_uuid())$$,
  current_setting('test.co'), current_setting('test.v1')), 'company_not_found', 'nor changes its vehicles');
select test.fails(format($$select public.fleet_archive_vehicle(%L, true, gen_random_uuid())$$, current_setting('test.v1')),
  'company_not_found', 'nor archives them');

-- B joins as driver; A assigns B to the Logan only.
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('c1', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('c1', 32), gen_random_uuid());
select set_config('test.m_b', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.eq(test.count($$select 1 from public.company_vehicles$$), 0::bigint, 'a driver with no vehicle assigned reads none');

select test.login(test.id('client_a'));
select test.fails(format($$select public.fleet_assign_driver(%L, %L, gen_random_uuid())$$, current_setting('test.v1'), gen_random_uuid()),
  'member_not_found', 'only a member of the company can be assigned');
select public.fleet_assign_driver(current_setting('test.v1')::uuid, current_setting('test.m_b')::uuid, gen_random_uuid());

select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.company_vehicles$$), 1::bigint, 'the driver reads the assigned vehicle only');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 1, 'and the overview holds only it');
select test.ok(public.fleet_overview(current_setting('test.co')::uuid)->'company'->'budget'->>'monthly' is null, 'no budget for a driver');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'members'), 1, 'and only themselves in the team');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"X","model":"Y"}', gen_random_uuid())$$,
  current_setting('test.co')), 'not_allowed', 'a driver cannot add a vehicle');
select test.fails(format($$select public.fleet_set_unavailable(%L, true, gen_random_uuid())$$, current_setting('test.v1')),
  'not_allowed', 'nor mark one unavailable');

-- ------------------------------------------------------------------ archive and back, history kept
select test.login(test.id('client_a'));
select public.fleet_set_unavailable(current_setting('test.v2')::uuid, true, gen_random_uuid());
select test.ok((select unavailable from public.company_vehicles where id = current_setting('test.v2')::uuid), 'marked unavailable');
select public.fleet_archive_vehicle(current_setting('test.v1')::uuid, true, gen_random_uuid());
select test.ok((select archived_at is not null and driver_member_id is null from public.company_vehicles where id = current_setting('test.v1')::uuid),
  'archived: kept, without a driver');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'vehicles'), 2, 'the admin still sees the archived one');
-- Its plate is free again while archived; a new vehicle takes it, so the old one cannot come back.
select public.fleet_save_vehicle(current_setting('test.co')::uuid, null, '{"make":"Dacia","model":"Sandero","plate":"B101FLT"}', gen_random_uuid());
select test.fails(format($$select public.fleet_archive_vehicle(%L, false, gen_random_uuid())$$, current_setting('test.v1')),
  'vehicle_plate_exists', 'an archived vehicle whose plate is taken stays archived');

select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.company_vehicles$$), 0::bigint, 'the driver no longer reads the archived vehicle');

-- ------------------------------------------------------------------ the vehicle outlives the member who added it
select test.logout();
select test.eq((select count(*) from public.company_audit_log where entity_type = 'vehicle'), 6::bigint,
  'every vehicle change is in the company log');
delete from auth.users where id = test.id('client_b');
select test.ok(exists (select 1 from public.company_vehicles where id = current_setting('test.v1')::uuid),
  'a member deleting their account leaves the vehicles in place');

-- ------------------------------------------------------------------ fleets on (the default since fleet_on)
update public.platform_settings set fleet_enabled = true where id = 1;
select test.login(test.id('staff1'));
select test.ok(not public.my_fleet_access(), 'fleets on: a shop account still has no access');
select test.login(test.id('admin'));
select test.ok(not public.my_fleet_access(), 'nor the platform admin');
select test.logout();
update public.profiles set fleet_beta = false where id = test.id('client_a');
select test.login(test.id('client_a'));
select test.ok(public.my_fleet_access(), 'fleets on: every client account has access');

rollback;
