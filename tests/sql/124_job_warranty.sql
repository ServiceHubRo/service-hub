-- The warranty on a job (T37a): given at Finalizare (1–60 months, from today in Bucharest), kept on
-- the booking where only complete_job writes it, in the history report and the shop's Istoric. No
-- reminder before it ends (Eduard).
begin;
select test.make_world();

create function pg_temp.job(p_plate text, p_slot time default '10:00') returns uuid
language sql as $$
  select test.raw_booking(test.id('shop1'), test.id('client_a'), 'in_progress', test.workday(1), p_slot, p_plate)
$$;

-- ------------------------------------------------------------------ given at Finalizare
select set_config('test.j1', pg_temp.job('BV 01 GAR')::text, true);
select test.login(test.id('owner1'));
select test.fails(format($$select public.complete_job(%L, 50000, gen_random_uuid(), p_warranty_months => 0)$$,
  current_setting('test.j1')), 'warranty_invalid', 'no warranty of 0 months');
select test.fails(format($$select public.complete_job(%L, 50000, gen_random_uuid(), p_warranty_months => 61)$$,
  current_setting('test.j1')), 'warranty_invalid', 'nor more than 60');
select test.eq((public.complete_job(current_setting('test.j1')::uuid, 50000, gen_random_uuid(), p_warranty_months => 12)).warranty_months::int,
  12, 'twelve months');
select test.logout();
select test.eq(warranty_until, (public.bucharest_today() + interval '12 months')::date, 'until the same day next year')
from public.bookings where id = current_setting('test.j1')::uuid;

select set_config('test.j2', pg_temp.job('BV 02 GAR', '11:00')::text, true);
select test.login(test.id('owner1'));
select public.complete_job(current_setting('test.j2')::uuid, 60000, gen_random_uuid());
select test.logout();
select test.eq(count(*), 1::bigint, 'without a warranty: none')
from public.bookings where id = current_setting('test.j2')::uuid and warranty_months is null and warranty_until is null;

-- Nobody writes it from the browser.
select test.login(test.id('owner1'));
select test.fails(format($$update public.bookings set warranty_months = 60 where id = %L$$, current_setting('test.j2')),
  'permission denied', 'the shop cannot add a warranty afterwards');
select test.login(test.id('client_a'));
select test.fails(format($$update public.bookings set warranty_until = '2099-01-01' where id = %L$$, current_setting('test.j1')),
  'permission denied', 'nor the client lengthen it');

-- ------------------------------------------------------------------ where it shows
select test.fails($$select public.list_shop_history()$$, 'not_allowed', 'a client does not read the shop''s Istoric');
select test.logout();
select test.login(test.id('owner1'));
select test.ok((public.list_shop_history()->'bookings') @> jsonb_build_array(jsonb_build_object(
  'id', current_setting('test.j1'), 'warranty_months', 12)), 'the shop''s Istoric shows it');
select test.logout();
select test.ok(public.report_jobs(test.id('client_a'), public.vehicle_key(
  (select car_snapshot from public.bookings where id = current_setting('test.j1')::uuid)))
  @> jsonb_build_array(jsonb_build_object('id', current_setting('test.j1'), 'warranty_months', 12)),
  'the history report carries it');

select test.eq(to_regprocedure('public.send_warranty_reminders(date)'), null::regprocedure, 'no warranty reminder (Eduard)');
select test.ok(not public.is_quiet_event('warranty_ending'), 'nor its event');

rollback;
