-- T66 — one logical vehicle per owner, free to go to any number of shops. The same car (VIN, else
-- plate) is refused twice in one garage and twice among a company's active vehicles, on every path;
-- a booking reuses the garage car; the history follows the car through a new plate; shops and
-- companies never see each other's records; duplicates that exist are listed and merged only by
-- their owner, logged.
begin;
select test.make_world();
select set_config('test.car_a', (select id::text from public.cars where owner_id = test.id('client_a') limit 1), true);
select set_config('test.day', test.workday(1)::text, true);

-- ------------------------------------------------------------------ one garage
select test.login(test.id('client_a'));
select test.fails($$insert into public.cars (make, model, plate, vin) values ('VW', 'Golf', 'XX 99 ZZZ', 'wvwzzzauzgw123456')$$,
  'car_duplicate', 'the same VIN again in the same garage (another plate, lower case): refused');
select test.eq(test.error_params($$insert into public.cars (make, model, plate) values ('VW', 'Golf', 'bv-12 abc')$$)->>'car_id',
  current_setting('test.car_a'), 'the same plate written otherwise: refused, naming the car already there');
insert into public.cars (make, model, plate, vin) values ('Dacia', 'Logan', 'BV 12 ABC', 'UU1LSDAAG12345678');
select test.ok(true, 'the same plate on a car with another VIN (a plate moved): two cars');
select test.fails($$insert into public.cars (make, model, vin) values ('VW', 'Golf', 'WVW123')$$, 'violates check constraint',
  'an invalid VIN (too short) is refused');
insert into public.cars (make, model) values ('Fiat', 'Panda');
insert into public.cars (make, model) values ('Fiat', 'Panda');
select test.ok(true, 'without VIN or plate nothing identifies a car: two Pandas are not called copies');
select test.fails(format($$update public.cars set plate = 'BV12ABC', vin = null where make = 'Fiat' and owner_id = %L$$, test.id('client_a')),
  'car_duplicate', 'editing a car into a copy of another: refused');

-- A booking with the car typed in, saved or not: the car already in the garage, never a copy.
select set_config('test.b1', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day')::date,
  p_slot => '10:00', p_request_id => gen_random_uuid(),
  p_car => '{"make":"Volkswagen","model":"Golf","plate":"bv 12-abc","vin":"WVWZZZAUZGW123456"}', p_save_car => true)).id::text, true);
select test.eq((select car_id::text from public.bookings where id = current_setting('test.b1')::uuid), current_setting('test.car_a'),
  'the booking is on the garage car');
select test.eq((select count(*) from public.cars where owner_id = test.id('client_a') and vin = 'WVWZZZAUZGW123456'), 1::bigint, 'still one Golf');

-- ------------------------------------------------------------------ two shops, one car
select test.logout();
update public.bookings set status = 'done', cost = 300, done_at = now() - interval '2 days', odometer = 101000
where id = current_setting('test.b1')::uuid;
insert into public.bookings (shop_id, client_id, service_id, client_name, client_lang, car_id, car_snapshot, date, slot, status, cost, done_at, odometer)
values (test.id('shop2'), test.id('client_a'), 'frane', 'Ana Marin', 'ro', current_setting('test.car_a')::uuid,
        '{"make":"Volkswagen","model":"Golf 7","plate":"BV 12 ABC"}', current_date - 1, '10:00', 'done', 500, now() - interval '1 day', 101500);
select test.eq((select count(*) from public.cars where owner_id = test.id('client_a') and vin = 'WVWZZZAUZGW123456'), 1::bigint,
  'two shops later: still one car in the garage');
select test.eq((select count(distinct shop_id) from public.bookings where car_id = current_setting('test.car_a')::uuid and status = 'done'),
  2::bigint, 'separate jobs at two shops on it');
select test.login(test.id('owner2'));
select test.eq(test.count(format($$select 1 from public.bookings where car_id = %L and shop_id <> %L$$, current_setting('test.car_a'), test.id('shop2'))), 0::bigint,
  'shop 2 reads none of shop 1''s jobs on the car');
select test.fails(format($$select public.shop_vehicle_file(%L)$$, current_setting('test.b1')), 'booking_not_found', 'nor its file (as if it did not exist)');
select test.eq(test.count($$select 1 from public.cars$$), 0::bigint, 'and no garage at all');

-- The history follows the car, through a new plate too.
select test.login(test.id('client_a'));
update public.cars set plate = 'B 999 NOU' where id = current_setting('test.car_a')::uuid;
select test.logout();
select test.ok(jsonb_array_length(public.report_jobs(test.id('client_a'), 'plate:B999NOU')) >= 2,
  'the new plate: the jobs done under the old one still belong to the car');

-- ------------------------------------------------------------------ companies
select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Transport Ana SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"VW","model":"Golf","plate":"B 701 FLT","vin":"WVWZZZAUZGW123456"}', gen_random_uuid())->>'id'), true);
select test.ok(true, 'the same VIN in the personal garage and the company: allowed (the app only says so)');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"VW","model":"Golf","vin":"wvwzzzauzgw123456"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_vin_exists', 'the same VIN twice in one company: refused');
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'manager', repeat('e8', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('e8', 32), gen_random_uuid());
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"VW","model":"Golf","plate":"b-701-flt"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_plate_exists', 'another member adding it by plate: refused');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"VW","model":"Golf","vin":"WVWZZZAUZGW123456"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_vin_exists', 'or by VIN: refused');
-- Another owner's company: no check (it would tell one company about another's vehicles).
select set_config('test.co2', (public.create_company('Alta SRL', null, null, null, gen_random_uuid())->>'id'), true);
select public.fleet_save_vehicle(current_setting('test.co2')::uuid, null, '{"make":"VW","model":"Golf","vin":"WVWZZZAUZGW123456"}', gen_random_uuid());
select test.ok(true, 'the same VIN in another company: allowed, and neither sees the other');
select test.eq(test.count(format($$select 1 from public.company_vehicles where company_id = %L and vin is not null$$, current_setting('test.co2'))), 1::bigint,
  'the second company sees its own vehicle only');
-- An archived vehicle frees its VIN; bringing it back while another has it is refused.
select test.login(test.id('client_a'));
select public.fleet_archive_vehicle(current_setting('test.v1')::uuid, true, gen_random_uuid());
select set_config('test.v2', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"VW","model":"Golf","plate":"B 702 FLT","vin":"WVWZZZAUZGW123456"}', gen_random_uuid())->>'id'), true);
select test.fails(format($$select public.fleet_archive_vehicle(%L, false, gen_random_uuid())$$, current_setting('test.v1')),
  'vehicle_vin_exists', 'bringing back the archived copy: refused');

-- A driver's company booking stays on the fleet vehicle, never in the driver's garage.
select test.logout();
update public.company_members set role = 'driver' where company_id = current_setting('test.co')::uuid and user_id = test.id('client_b');
update public.company_vehicles set driver_member_id = (select id from public.company_members where company_id = current_setting('test.co')::uuid
  and user_id = test.id('client_b')) where id = current_setting('test.v2')::uuid;
select set_config('test.garage_b', (select count(*)::text from public.cars where owner_id = test.id('client_b')), true);
select test.login(test.id('client_b'));
select set_config('test.b2', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'frane', p_date => test.workday(2),
  p_slot => '11:00', p_request_id => gen_random_uuid(), p_company_vehicle_id => current_setting('test.v2')::uuid)).id::text, true);
select test.logout();
select test.eq((select company_vehicle_id::text from public.bookings where id = current_setting('test.b2')::uuid), current_setting('test.v2'),
  'the booking keeps the fleet vehicle');
select test.eq((select count(*)::text from public.cars where owner_id = test.id('client_b')), current_setting('test.garage_b'),
  'and the driver''s garage did not grow');
-- The member leaves: the fleet's vehicles are out of reach.
select test.login(test.id('client_b'));
select public.remove_company_member(public.my_member_id(current_setting('test.co')::uuid), gen_random_uuid());
select test.eq(test.count(format($$select 1 from public.company_vehicles where company_id = %L$$, current_setting('test.co'))), 0::bigint,
  'after leaving: no vehicle of the company');

-- ------------------------------------------------------------------ duplicates that exist: listed, merged by the owner
select test.logout();
alter table public.cars disable trigger cars_identity;
insert into public.cars (id, owner_id, make, model, plate, vin, itp_expiry)
values ('11111111-2222-4333-8444-555555555555', test.id('client_b'), 'Dacia', 'Logan', 'BV 44 KLM', null, '2027-03-01');
select set_config('test.dup', '11111111-2222-4333-8444-555555555555', true);
-- A copy known by its plate only, of a car that has a VIN: the same car too.
insert into public.cars (owner_id, make, model, plate) values (test.id('client_a'), 'VW', 'Golf', 'B-999-NOU');
alter table public.cars enable trigger cars_identity;
select set_config('test.orig', (select id::text from public.cars where owner_id = test.id('client_b') and plate_norm = 'BV44KLM'
  and id <> current_setting('test.dup')::uuid limit 1), true);
update public.bookings set car_id = current_setting('test.dup')::uuid
where id = (select id from public.bookings where client_id = test.id('client_b') order by created_at limit 1);
select test.login(test.id('admin'));
select test.ok(exists (select 1 from jsonb_array_elements(public.admin_vehicle_duplicates()->'personal') g, jsonb_array_elements(g->'cars') c
  where c->>'id' = current_setting('test.dup')),
  'the admin sees the copy listed');
select test.eq((select jsonb_array_length(g->'cars') from jsonb_array_elements(public.admin_vehicle_duplicates()->'personal') g
  where g->>'owner_id' = test.id('client_a')::text
    and exists (select 1 from jsonb_array_elements(g->'cars') c where c->>'id' = current_setting('test.car_a'))), 2,
  'and a plate-only copy of a car with a VIN, in one group with it');
select test.eq((select count(*) from jsonb_array_elements(public.admin_vehicle_duplicates()->'personal') g, jsonb_array_elements(g->'cars') c
  where c->>'vin' = 'UU1LSDAAG12345678'), 0::bigint, 'a plate moved to a car with another VIN is not called a copy');
select test.login(test.id('client_a'));
select test.fails(format($$select public.merge_cars(%L, %L, gen_random_uuid())$$, current_setting('test.orig'), current_setting('test.dup')),
  'car_not_found', 'nobody merges another''s cars');
select test.login(test.id('client_b'));
select test.fails(format($$select public.merge_cars(%L, %L, gen_random_uuid())$$, current_setting('test.orig'),
  (select id from public.cars where owner_id = test.id('client_b') and id not in (current_setting('test.orig')::uuid, current_setting('test.dup')::uuid) limit 1)),
  'car_', 'two different cars are never merged');
select public.merge_cars(current_setting('test.orig')::uuid, current_setting('test.dup')::uuid, gen_random_uuid());
select test.eq((select count(*) from public.cars where owner_id = test.id('client_b') and plate_norm = 'BV44KLM'), 1::bigint, 'merged: one Logan');
select test.eq((select count(*) from public.bookings where car_id = current_setting('test.dup')::uuid), 0::bigint, 'no booking left on the copy');
select test.eq((select itp_expiry from public.cars where id = current_setting('test.orig')::uuid), '2027-03-01'::date, 'the kept car took the ITP date it lacked');
select test.eq((select cardinality(moved_bookings) from public.car_merges where kept_car_id = current_setting('test.orig')::uuid), 1,
  'the log keeps the moved booking');
select test.eq((select dropped_car->>'id' from public.car_merges where kept_car_id = current_setting('test.orig')::uuid), current_setting('test.dup'),
  'and the removed car as it was');

rollback;
