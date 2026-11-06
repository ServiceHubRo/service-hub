-- M4 — maintenance: every status and reason, the 1,000 km / 30-day edges, the 60-day reading, a reading
-- before the service, „Marchează efectuat” (a day and km under the M2 rule, or a finished job), rights,
-- isolation, the same request twice.
begin;
select test.make_fleet();

-- An item as the server keeps it, and its status on a given day.
create function pg_temp.item(p_km int, p_months int, p_on date, p_last_km int) returns public.fleet_maintenance
language sql as $$
  select (gen_random_uuid(), test.id('co'), test.id('v1'), 'oil', null, p_km, p_months, p_on, p_last_km, null, null, now(), null, null)::public.fleet_maintenance
$$;
create function pg_temp.st(p_km int, p_months int, p_on date, p_last_km int) returns jsonb
language sql security definer as $$ select public.fleet_maintenance_status(pg_temp.item(p_km, p_months, p_on, p_last_km), test.today()) $$;
create function pg_temp.reading(p_day date, p_km int) returns void
language sql security definer as $$
  insert into public.fleet_odometer_readings (company_id, vehicle_id, day, km, source) values (test.id('co'), test.id('v1'), p_day, p_km, 'manual')
$$;
create function pg_temp.clear() returns void
language sql security definer as $$ delete from public.fleet_odometer_readings where vehicle_id = test.id('v1') $$;
grant execute on all functions in schema pg_temp to public;

-- ------------------------------------------------------------------ km only
select test.eq(pg_temp.st(10000, null, null, null)->>'status', 'insufficient_data', 'km: no last km: not enough data');
select test.ok(pg_temp.st(10000, null, null, null)->'reasons' ? 'no_last_done_km', 'reason no_last_done_km');
select test.ok(pg_temp.st(10000, null, null, 50000)->'reasons' ? 'no_reading', 'no reading: reason no_reading');
select pg_temp.reading(test.today() - 61, 55000);
select test.ok(pg_temp.st(10000, null, null, 50000)->'reasons' ? 'reading_old', 'a reading 61 days old: reading_old, never ok');
select pg_temp.clear();
select pg_temp.reading(test.today() - 60, 55000);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'ok', 'a reading 60 days old is used: 5,000 km left: ok');
select pg_temp.clear();
select pg_temp.reading(test.today() - 10, 59000);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'soon', '1,000 km left: soon (edge)');
select pg_temp.clear();
select pg_temp.reading(test.today() - 10, 58999);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'ok', '1,001 km left: ok (edge)');
select pg_temp.clear();
select pg_temp.reading(test.today() - 10, 60000);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'soon', '0 km left: soon');
select pg_temp.clear();
select pg_temp.reading(test.today() - 10, 60001);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'overdue', '1 km past: overdue');
select test.eq((pg_temp.st(10000, null, null, 50000)->>'km_left')::int, -1, 'km_left is told');
-- The latest reading is before the service (date or km).
select test.ok(pg_temp.st(10000, null, test.today() - 5, 50000)->'reasons' ? 'reading_before_service', 'a reading dated before the service: not used');
select test.ok(pg_temp.st(10000, null, null, 70000)->'reasons' ? 'reading_before_service', 'a reading below the service km: not used');
-- A finished job counts as a reading.
select pg_temp.clear();
select test.fleet_booking('v1', test.id('client_b'), 'done', test.today() - 3, '10:00', 400, 59500);
select test.eq(pg_temp.st(10000, null, null, 50000)->>'status', 'soon', 'a finished job''s km is the latest value');

-- ------------------------------------------------------------------ months only
select test.ok(pg_temp.st(null, 12, null, null)->'reasons' ? 'no_last_done_on', 'months: no last date: no_last_done_on');
select test.eq(pg_temp.st(null, 12, null, null)->>'status', 'insufficient_data', 'and not enough data');
select test.eq(pg_temp.st(null, 12, (test.today() - interval '12 months')::date, null)->>'status', 'soon', 'due today: soon, not overdue');
select test.eq(pg_temp.st(null, 12, (test.today() - interval '12 months')::date - 1, null)->>'status', 'overdue', 'one day past: overdue');
select test.eq(pg_temp.st(null, 12, (test.today() - interval '12 months')::date + 30, null)->>'status', 'soon', '30 days left: soon (edge)');
select test.eq(pg_temp.st(null, 12, (test.today() - interval '12 months')::date + 31, null)->>'status', 'ok', '31 days left: ok (edge)');

-- ------------------------------------------------------------------ both
-- 59,500 km from the job (3 days ago): with last km 50,000 and 10,000 km: soon.
select test.eq(pg_temp.st(10000, 12, test.today() - 30, 50000)->>'status', 'soon', 'both: km soon, months ok: soon');
select test.eq(pg_temp.st(20000, 12, (test.today() - interval '12 months')::date - 1, 50000)->>'status', 'overdue', 'both: km ok, months overdue: overdue');
select test.eq(pg_temp.st(20000, 12, test.today() - 30, 50000)->>'status', 'ok', 'both ok: ok');
select test.eq(pg_temp.st(20000, 12, null, 50000)->>'status', 'insufficient_data', 'km ok, months unknown: never ok');
select test.ok((pg_temp.st(20000, 12, null, 50000)->>'km_left') is not null, 'with what is known (km left)');
select test.eq(pg_temp.st(20000, 12, (test.today() - interval '12 months')::date - 1, null)->>'status', 'overdue', 'km unknown, months overdue: overdue');

-- ------------------------------------------------------------------ writes and rights
select test.login(test.id('client_b'));
select test.fails(format($$select public.fleet_save_maintenance(%L, null, jsonb_build_object('vehicle_id', %L, 'kind', 'oil', 'interval_km', 10000), gen_random_uuid())$$,
  test.id('co'), test.id('v1')), 'not_allowed', 'a driver does not plan maintenance');
select test.login(test.id('acc'));
select test.fails(format($$select public.fleet_save_maintenance(%L, null, jsonb_build_object('vehicle_id', %L, 'kind', 'oil', 'interval_km', 10000), gen_random_uuid())$$,
  test.id('co'), test.id('v1')), 'not_allowed', 'nor the accountant');
select test.login(test.id('mgr'));
select test.fails(format($$select public.fleet_save_maintenance(%L, null, jsonb_build_object('vehicle_id', %L, 'kind', 'oil'), gen_random_uuid())$$,
  test.id('co'), test.id('v1')), 'maintenance_invalid', 'an interval is required');
select test.fails(format($$select public.fleet_save_maintenance(%L, null, jsonb_build_object('vehicle_id', %L, 'kind', 'custom', 'interval_months', 12), gen_random_uuid())$$,
  test.id('co'), test.id('v1')), 'maintenance_invalid', 'a custom item needs a name');
select test.fails(format($$select public.fleet_save_maintenance(%L, null, jsonb_build_object('vehicle_id', %L, 'kind', 'oil', 'interval_km', 1000), gen_random_uuid())$$,
  test.id('co'), test.id('v1')), 'maintenance_invalid', 'an interval under 2,000 km');
select set_config('test.rid', gen_random_uuid()::text, true);
select set_config('test.m', (public.fleet_save_maintenance(test.id('co'), null,
  jsonb_build_object('vehicle_id', test.id('v1'), 'kind', 'oil', 'interval_km', 10000, 'interval_months', 12, 'last_done_on', test.today() - 30, 'last_done_km', 50000),
  current_setting('test.rid')::uuid))->>'id', true);
select public.fleet_save_maintenance(test.id('co'), null,
  jsonb_build_object('vehicle_id', test.id('v1'), 'kind', 'oil', 'interval_km', 10000), current_setting('test.rid')::uuid);
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'maintenance'), 1, 'the same request twice: one item');
select test.eq((public.fleet_overview(test.id('co'))->'maintenance'->0->'state'->>'status'), 'soon', 'the overview carries the computed status');

-- „Marchează efectuat” with a day and km: a reading under the M2 rule.
select test.fails(format($$select public.fleet_mark_maintenance_done(%L, jsonb_build_object('day', %L, 'km', 59000), gen_random_uuid())$$,
  current_setting('test.m'), test.today()), 'odometer_lower', 'a km below the job before it is refused');
select test.fails(format($$select public.fleet_mark_maintenance_done(%L, jsonb_build_object('day', %L), gen_random_uuid())$$,
  current_setting('test.m'), test.today()), 'maintenance_invalid', 'a km item needs the km');
select test.eq((public.fleet_mark_maintenance_done(current_setting('test.m')::uuid, jsonb_build_object('day', test.today(), 'km', 59800), gen_random_uuid()))->'state'->>'status',
  'ok', 'done today at 59,800 km: ok again');
select test.eq((select count(*) from jsonb_array_elements(public.fleet_overview(test.id('co'))->'readings') r where r->>'source' = 'maintenance'), 1::bigint,
  'a maintenance reading was written');
-- With a finished job: its day and km, no reading written.
select set_config('test.job', (select id::text from public.bookings where company_vehicle_id = test.id('v1') and status = 'done' limit 1), true);
select test.eq((public.fleet_mark_maintenance_done(current_setting('test.m')::uuid, jsonb_build_object('booking_id', current_setting('test.job')), gen_random_uuid()))->>'last_done_km',
  '59500', 'from a finished job: its km');
select test.fails(format($$select public.fleet_mark_maintenance_done(%L, jsonb_build_object('booking_id', %L), gen_random_uuid())$$,
  current_setting('test.m'), test.fleet_booking('v2', test.id('drv2'), 'done', test.today() - 1, '09:00', 100, 1000)), 'maintenance_invalid',
  'a job of another vehicle is refused');

-- The driver reads the plan of their vehicle; another company nothing.
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'maintenance'), 1, 'the driver reads the plan of their vehicle');
select test.fails(format($$select public.fleet_mark_maintenance_done(%L, jsonb_build_object('day', %L, 'km', 60000), gen_random_uuid())$$,
  current_setting('test.m'), test.today()), 'not_allowed', 'but does not mark it done');
select test.login(test.id('drv2'));
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'maintenance'), 0, 'another driver does not see it');
select test.login(test.id('out'));
select test.fails(format($$select public.fleet_delete_maintenance(%L, gen_random_uuid())$$, current_setting('test.m')), 'maintenance_not_found',
  'another company: not found');
select test.login(test.id('mgr'));
select public.fleet_delete_maintenance(current_setting('test.m')::uuid, gen_random_uuid());
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'maintenance'), 0, 'deleted: gone from the list');
select test.fails('select 1 from public.fleet_maintenance', 'permission denied', 'the table is closed to the browser');

rollback;
