-- M2 — odometer and fuel: the chronological rule against readings, receipts and finished jobs (same
-- day not compared); corrections (vehicles.manage, with a reason, logged); ignoring a job's km; the
-- import of existing receipts (coherent, duplicate, contradictory, jump; receipts never modified);
-- fuel statistics with missing data; rights and isolation; the same request twice.
begin;
select test.make_fleet();

create function pg_temp.readings(p_vehicle text) returns bigint
language sql security definer as $$ select count(*) from public.fleet_odometer_readings where vehicle_id = test.id(p_vehicle) and deleted_at is null $$;
create function pg_temp.reading_of(p_expense uuid) returns public.fleet_odometer_readings
language sql security definer as $$ select * from public.fleet_odometer_readings where ref_id = p_expense and deleted_at is null $$;
create function pg_temp.exc(p_expense uuid) returns text[]
language sql security definer as $$ select reasons from public.fleet_odometer_import_exceptions where expense_id = p_expense $$;
create function pg_temp.audits(p_action text) returns bigint
language sql security definer as $$ select count(*) from public.company_audit_log where action = p_action $$;
create function pg_temp.expense(p_vehicle text, p_day date, p_km int, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select public.fleet_save_expense(test.id('co'), null,
    jsonb_build_object('vehicle_id', test.id(p_vehicle), 'category', 'parts', 'day', p_day, 'amount', 100 + p_km % 1000,
                       'supplier', 'Furnizor ' || p_km, 'odometer', p_km) || p_extra, gen_random_uuid())
$$;
-- A receipt written as before M2 (no reading), for the import.
create function pg_temp.old_receipt(p_vehicle text, p_day date, p_km int) returns uuid
language sql security definer as $$
  insert into public.fleet_expenses (company_id, vehicle_id, category, day, amount, odometer, created_by)
  values (test.id('co'), test.id(p_vehicle), 'parts', p_day, 50, p_km, test.id('client_a')) returning id
$$;
create function pg_temp.receipts_json() returns jsonb
language sql security definer as $$ select jsonb_agg(to_jsonb(e) order by e.id) from public.fleet_expenses e where e.company_id = test.id('co') $$;
grant execute on all functions in schema pg_temp to public;

-- A finished job of v1 at 100,000 km ten days ago.
select set_config('test.job', test.fleet_booking('v1', test.id('client_b'), 'done', test.today() - 10, '10:00', 400, 100000)::text, true);

-- ------------------------------------------------------------------ the rule
select test.login(test.id('client_a'));
select test.fails(format($$select pg_temp.expense('v1', %L, 99000)$$, test.today() - 5), 'odometer_lower', 'lower than the job before it: refused');
select test.eq(test.error_params(format($$select pg_temp.expense('v1', %L, 99000)$$, test.today() - 5))->>'previous', '100000', 'the error names the value before');
select test.fails(format($$select pg_temp.expense('v1', %L, 100100)$$, test.today() - 12), 'odometer_higher_than_later', 'back-dated above the job after it: refused');
select test.ok(pg_temp.expense('v1', test.today() - 10, 99500) ? 'id', 'the same day as the job: not compared');
select set_config('test.e1', (pg_temp.expense('v1', test.today() - 5, 100800))->>'id', true);
select test.eq((pg_temp.reading_of(current_setting('test.e1')::uuid)).km, 100800, 'an expense with km writes a reading');
-- Editing the km moves the reading; against the rule it is refused.
select public.fleet_save_expense(test.id('co'), current_setting('test.e1')::uuid,
  jsonb_build_object('vehicle_id', test.id('v1'), 'category', 'parts', 'day', test.today() - 5, 'amount', 900, 'supplier', 'Furnizor 100800', 'odometer', 100900), gen_random_uuid());
select test.eq((pg_temp.reading_of(current_setting('test.e1')::uuid)).km, 100900, 'editing the expense moves its reading');
select test.fails(format($$select public.fleet_save_expense(%L, %L, jsonb_build_object('vehicle_id', %L, 'category', 'parts', 'day', %L, 'amount', 900, 'odometer', 90000), gen_random_uuid())$$,
  test.id('co'), current_setting('test.e1'), test.id('v1'), test.today() - 5), 'odometer_lower', 'and an edit against the rule is refused');
-- A manual reading later than the expense must be higher.
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 100850, gen_random_uuid())$$, test.id('co'), test.id('v1'), test.today() - 3),
  'odometer_lower', 'a manual reading below an earlier one: refused');
select set_config('test.r1', (public.fleet_add_reading(test.id('co'), test.id('v1'), test.today() - 3, 101500, gen_random_uuid()))->>'id', true);
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 1, gen_random_uuid())$$, test.id('co'), test.id('v1'), test.today() + 1),
  'reading_invalid', 'a day in the future');
-- Deleting the expense removes its reading.
select public.fleet_delete_expense(current_setting('test.e1')::uuid, gen_random_uuid());
select test.ok((pg_temp.reading_of(current_setting('test.e1')::uuid)).id is null, 'deleting the expense removes its reading');

-- ------------------------------------------------------------------ rights
select test.login(test.id('client_b'));
select test.ok(public.fleet_add_reading(test.id('co'), test.id('v1'), test.today() - 1, 101800, gen_random_uuid()) ? 'id', 'the driver adds a reading for their vehicle');
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 1000, gen_random_uuid())$$, test.id('co'), test.id('v2'), test.today()),
  'not_allowed', 'not for another vehicle');
select test.fails(format($$select public.fleet_correct_reading(%L, 101600, 'Cifră greșită', gen_random_uuid())$$, current_setting('test.r1')),
  'not_allowed', 'a driver does not correct');
select test.fails(format($$select public.fleet_ignore_job_odometer(%L, 'Greșit la service', gen_random_uuid())$$, current_setting('test.job')),
  'not_allowed', 'nor ignores a job''s km');
select test.login(test.id('acc'));
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 101900, gen_random_uuid())$$, test.id('co'), test.id('v1'), test.today()),
  'not_allowed', 'the accountant does not add readings (no vehicles.manage)');
select test.login(test.id('out'));
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 1000, gen_random_uuid())$$, test.id('co2'), test.id('v1'), test.today()),
  'vehicle_not_found', 'another company''s vehicle');
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co2'))->'readings'), 0, 'another company sees no readings');

-- ------------------------------------------------------------------ corrections
select test.login(test.id('mgr'));
select test.fails(format($$select public.fleet_correct_reading(%L, 101600, 'ab', gen_random_uuid())$$, current_setting('test.r1')),
  'reading_invalid', 'a correction needs a reason');
select test.fails(format($$select public.fleet_correct_reading(%L, 102000, 'Cifră greșită', gen_random_uuid())$$, current_setting('test.r1')),
  'odometer_higher_than_later', 'a correction follows the same rule');
select set_config('test.rid', gen_random_uuid()::text, true);
select test.eq((public.fleet_correct_reading(current_setting('test.r1')::uuid, 101600, 'Cifră greșită', current_setting('test.rid')::uuid))->>'corrected_from',
  '101500', 'corrected: the value before is kept');
select public.fleet_correct_reading(current_setting('test.r1')::uuid, 101600, 'Cifră greșită', current_setting('test.rid')::uuid);
select test.eq(pg_temp.audits('odometer_corrected'), 1::bigint, 'the same request twice: one correction in the log');

-- ------------------------------------------------------------------ a job's km ignored
-- A wrong km typed at the shop (120,000) blocks a true reading of 101,000 after it.
select set_config('test.job2', test.fleet_booking('v2', test.id('drv2'), 'done', test.today() - 8, '11:00', 300, 120000)::text, true);
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 101000, gen_random_uuid())$$, test.id('co'), test.id('v2'), test.today() - 2),
  'odometer_lower', 'the job''s wrong km blocks the reading');
select test.ok(public.fleet_ignore_job_odometer(current_setting('test.job2')::uuid, 'Kilometraj greșit la service', gen_random_uuid()) ? 'booking_id',
  'the manager ignores that job''s km');
select test.ok(public.fleet_add_reading(test.id('co'), test.id('v2'), test.today() - 2, 101000, gen_random_uuid()) ? 'id', 'then the reading is accepted');
select test.eq((select odometer from public.bookings where id = current_setting('test.job2')::uuid), 120000, 'the booking is untouched');

-- ------------------------------------------------------------------ fuel statistics
select set_config('test.ids', '', true);
create function pg_temp.fuel(p_day date, p_km int, p_liters numeric, p_full boolean, p_amount numeric default 300) returns void
language sql as $$
  select public.fleet_save_expense(test.id('co'), null,
    jsonb_build_object('vehicle_id', test.id('v2'), 'category', 'fuel', 'day', p_day, 'amount', p_amount, 'supplier', 'Petrom ' || p_km,
                       'odometer', p_km, 'liters', p_liters, 'fuel_type', 'diesel', 'full_tank', p_full), gen_random_uuid())
$$;
grant execute on function pg_temp.fuel(date, int, numeric, boolean, numeric) to public;
select test.eq(public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->>'status', 'insufficient_data', 'no fills: no consumption');
select pg_temp.fuel(test.today() - 1, 101100, 40, true);
select pg_temp.fuel(test.today(), 101600, 30, true);
select test.eq((public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->>'consumption')::numeric, 6.00,
  'two full tanks: 30 l over 500 km = 6 l/100 km');
select test.eq((public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->>'cost_per_km')::numeric is not null, true,
  'cost per km with two readings (costs.view)');
select test.login(test.id('drv2'));
select test.ok(public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->'cost_per_km' = 'null'::jsonb
  and public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->'fuel_cost' = 'null'::jsonb, 'a driver sees consumption without money');
select test.fails(format($$select public.fleet_fuel_stats(%L, %L, null, %L)$$, test.id('co'), test.id('v1'), test.today()), 'vehicle_not_found',
  'nor another vehicle''s stats');
select test.login(test.id('mgr'));
-- A partial fill without liters between two full tanks: that stretch is unknown, never estimated.
select pg_temp.fuel(test.today(), 101700, null, false);
select pg_temp.fuel(test.today(), 102000, 25, true);
select test.ok(public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->'reasons' ? 'missing_liters', 'missing liters named');
select test.eq((public.fleet_fuel_stats(test.id('co'), test.id('v2'), null, test.today())->>'consumption')::numeric, 6.00,
  'the unknown stretch is left out, not estimated');

-- ------------------------------------------------------------------ the import of receipts written before M2
select test.logout();
-- v1: job 100,000 (−10). A 100,500 (−8) and B 99,000 (−6) contradict each other; C 150,000 (−4) is a jump.
select set_config('test.a', pg_temp.old_receipt('v1', test.today() - 8, 100500)::text, true);
select set_config('test.b', pg_temp.old_receipt('v1', test.today() - 6, 99000)::text, true);
-- v3 (archived): F 50,000 (−9), G and H 50,400 the same day (−5, a duplicate receipt): coherent.
select set_config('test.f', pg_temp.old_receipt('v3', test.today() - 9, 50000)::text, true);
select set_config('test.g', pg_temp.old_receipt('v3', test.today() - 5, 50400)::text, true);
select set_config('test.h', pg_temp.old_receipt('v3', test.today() - 5, 50400)::text, true);
select set_config('test.c', pg_temp.old_receipt('v3', test.today() - 4, 75000)::text, true);
select set_config('test.before', pg_temp.receipts_json()::text, true);
select public.fleet_import_expense_readings();
select test.eq(pg_temp.receipts_json()::text, current_setting('test.before'), 'the receipts are never modified by the import');
select test.ok('above_later' = any (pg_temp.exc(current_setting('test.a')::uuid)), 'A: contradicted by a later receipt: listed');
select test.ok('below_earlier' = any (pg_temp.exc(current_setting('test.b')::uuid)), 'B: below earlier values: listed (both sides)');
select test.ok((pg_temp.reading_of(current_setting('test.a')::uuid)).id is null and (pg_temp.reading_of(current_setting('test.b')::uuid)).id is null, 'neither becomes a reading');
select test.ok((pg_temp.reading_of(current_setting('test.f')::uuid)).id is not null, 'F: coherent: a reading');
select test.ok((pg_temp.reading_of(current_setting('test.g')::uuid)).id is not null and (pg_temp.reading_of(current_setting('test.h')::uuid)).id is not null,
  'G and H, the same day: both readings (same day not compared)');
select test.eq(pg_temp.exc(current_setting('test.c')::uuid), array['jump'], 'C: 24,600 km in a day: listed as a jump');
select test.eq(public.fleet_import_expense_readings()->>'imported', '0', 'run again: nothing twice');
-- Fixed by editing the receipt: the exception goes, the reading comes.
select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'odometer_exceptions'), 3, 'vehicles.manage sees the exceptions');
select public.fleet_save_expense(test.id('co'), current_setting('test.b')::uuid,
  jsonb_build_object('vehicle_id', test.id('v1'), 'category', 'parts', 'day', test.today() - 6, 'amount', 50, 'odometer', null), gen_random_uuid());
select test.ok(pg_temp.exc(current_setting('test.b')::uuid) is null, 'B without km: no longer an exception');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'odometer_exceptions'), 0, 'a driver does not see them');

-- The browser cannot read the tables.
select test.fails('select 1 from public.fleet_odometer_readings', 'permission denied', 'the readings table is closed to the browser');
select test.fails('select public.fleet_import_expense_readings()', 'permission denied', 'nor run the import');

rollback;
