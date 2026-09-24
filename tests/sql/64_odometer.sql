-- Odometer rules for complete_job (ARCHITECTURE §7), in their documented order, and
-- last_odometer_for_booking visibility. The world's done booking at shop1: plate BV 12 ABC, 105 400 km.
begin;
select test.make_world();

create function pg_temp.job(p_plate text, p_slot time default '10:00') returns uuid
language sql as $$
  select test.raw_booking(test.id('shop1'), test.id('client_a'), 'in_progress', test.workday(1), p_slot, p_plate)
$$;
create function pg_temp.complete(p_booking uuid, p_km int, p_confirm boolean default false) returns text
language plpgsql as $$
declare r text;
begin
  perform test.login(test.id('owner1'));
  r := test.error_of(format('select public.complete_job(%L, %s, gen_random_uuid(), p_confirm_jump => %L)',
                            p_booking, coalesce(p_km::text, 'null'), p_confirm));
  perform test.logout();
  return r;
end $$;

-- ------------------------------------------------------------------ last known reading
select set_config('test.j1', pg_temp.job('BV-12-ABC')::text, true);
select test.login(test.id('owner1'));
select test.eq(public.last_odometer_for_booking(current_setting('test.j1')::uuid), 105400, 'last reading for the plate (typed differently)');
select test.logout();
select test.login(test.id('staff1'));
select test.eq(public.last_odometer_for_booking(current_setting('test.j1')::uuid), 105400, 'staff read it too');
select test.logout();
select test.login(test.id('owner2'));
select test.fails(format($$select public.last_odometer_for_booking(%L)$$, current_setting('test.j1')), 'not_allowed', 'another shop cannot read it');
select test.logout();
select test.login(test.id('client_a'));
select test.fails(format($$select public.last_odometer_for_booking(%L)$$, current_setting('test.j1')), 'not_allowed', 'the client uses history, not this');
select test.logout();

-- ------------------------------------------------------------------ the rules, in order
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, null), 'odometer_required', '1. missing → required');
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, 99), 'odometer_invalid', '2. below 100 → invalid');
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, 2000001), 'odometer_invalid', '2. above 2 000 000 → invalid');
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, 105000), 'odometer_lower', '3. lower than the last reading → refused');
select test.login(test.id('owner1'));
select test.eq(test.error_params(format('select public.complete_job(%L, 105000, gen_random_uuid())', current_setting('test.j1')))->>'previous',
  '105400', '3. the refusal names the previous value');
select test.eq(test.error_params(format('select public.complete_job(%L, 155401, gen_random_uuid())', current_setting('test.j1'))),
  '{"diff": 50001, "previous": 105400}'::jsonb, '4. a jump names the previous value and the difference');
select test.logout();
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, 155401), 'odometer_jump', '4. more than 50 000 km above → needs confirmation');
select test.eq(test.status_of(current_setting('test.j1')::uuid), 'in_progress', 'refusals leave the job open');
select test.eq(pg_temp.complete(current_setting('test.j1')::uuid, 155401, true), 'ok', '4. confirmed jump accepted');
select test.eq(odometer, 155401, 'reading stored'), test.eq(status, 'done', 'job done')
from public.bookings where id = current_setting('test.j1')::uuid;

-- The new reading is now the last one.
select set_config('test.j2', pg_temp.job('bv12abc', '11:00')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j2')::uuid, 155000), 'odometer_lower', 'compares with the newest done job');
select test.eq(pg_temp.complete(current_setting('test.j2')::uuid, 155401), 'ok', 'the same reading as last time is accepted');
select set_config('test.j3', pg_temp.job('BV 12 ABC', '12:00')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j3')::uuid, 205401), 'ok', 'exactly 50 000 km more needs no confirmation');

-- Readings from other shops count too.
select test.raw_booking(test.id('shop2'), test.id('client_b'), 'done', test.today() - 30, '10:00', 'CJ 01 XYZ', 200000);
select set_config('test.j4', pg_temp.job('CJ 01 XYZ', '13:00')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j4')::uuid, 150000), 'odometer_lower', 'a reading at another shop counts');
-- Only done jobs count: a cancelled booking with a (bogus) reading is ignored.
select test.raw_booking(test.id('shop2'), test.id('client_b'), 'cancelled', test.today() - 20, '10:00', 'CJ 01 XYZ', 900000);
select test.eq(pg_temp.complete(current_setting('test.j4')::uuid, 210000), 'ok', 'only done jobs set the last reading');

-- 5. First reading for a plate: anything in range.
select set_config('test.j5', pg_temp.job('B 999 NEW', '14:00')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j5')::uuid, 100), 'ok', '5. first reading: 100 accepted');
select set_config('test.j6', pg_temp.job('B 998 NEW', '15:00')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j6')::uuid, 2000000), 'ok', '5. first reading: 2 000 000 accepted');
-- A car without a plate cannot be compared: range check only.
select set_config('test.j7', test.raw_booking(test.id('shop1'), test.id('client_a'), 'in_progress', test.workday(1), '16:00', '')::text, true);
select test.eq(pg_temp.complete(current_setting('test.j7')::uuid, 5000), 'ok', 'no plate: range check only');

-- Cost and work checks.
select set_config('test.j8', pg_temp.job('B 997 NEW', '17:00')::text, true);
select test.login(test.id('owner1'));
select test.fails(format('select public.complete_job(%L, 1000, gen_random_uuid(), p_cost => -1)', current_setting('test.j8')), 'cost_invalid', 'negative cost refused');
select test.fails(format('select public.complete_job(%L, 1000, gen_random_uuid(), p_cost => 10.555)', current_setting('test.j8')), 'cost_invalid', 'cost with 3 decimals refused');
select test.fails(format('select public.complete_job(%L, 1000, gen_random_uuid(), p_work => repeat(''x'', 4001))', current_setting('test.j8')), 'work_too_long', 'work up to 4000 characters');
select test.logout();

-- The browser can never write the reading directly.
select test.login(test.id('owner1'));
select test.fails(format($$update public.bookings set odometer = 1 where id = %L$$, current_setting('test.j8')), 'permission denied', 'odometer only through complete_job');
select test.logout();
-- The column itself refuses nonsense from any path.
select test.fails(format($$update public.bookings set odometer = 5 where id = %L$$, current_setting('test.j8')), 'check constraint', 'table refuses readings below 100');

rollback;
