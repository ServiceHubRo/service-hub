-- The warranty on a job (T37a): given at Finalizare (1–60 months, from today in Bucharest), kept on
-- the booking where only complete_job writes it, in the history report and the shop's Istoric, and
-- remembered to the client once, 30 days before it ends.
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

-- ------------------------------------------------------------------ the reminder
delete from public.notification_events;
-- j1's warranty ends in 20 days, j2 got one that ended yesterday.
update public.bookings set warranty_until = test.today() + 20 where id = current_setting('test.j1')::uuid;
update public.bookings set warranty_months = 1, warranty_until = test.today() - 1 where id = current_setting('test.j2')::uuid;
select test.eq(public.send_warranty_reminders(test.today()), 1, 'one warranty ends within 30 days');
select test.eq(public.send_warranty_reminders(test.today()), 0, 'told once');
select test.eq(count(*), 1::bigint, 'to the client, with the shop and the day')
from public.notification_events
where user_id = test.id('client_a') and event = 'warranty_ending' and booking_id = current_setting('test.j1')::uuid
  and params->>'until' = (test.today() + 20)::text and params->>'shop_name' is not null;

-- More than 30 days left: not yet. Service reminders off in Cont: never.
select set_config('test.j3', pg_temp.job('BV 03 GAR', '12:00')::text, true);
select test.login(test.id('owner1'));
select public.complete_job(current_setting('test.j3')::uuid, 70000, gen_random_uuid(), p_warranty_months => 6);
select test.logout();
select test.eq(public.send_warranty_reminders(test.today()), 0, 'six months left: nothing yet');
update public.bookings set warranty_until = test.today() + 10 where id = current_setting('test.j3')::uuid;
update public.profiles set service_reminders = false where id = test.id('client_a');
select test.eq(public.send_warranty_reminders(test.today()), 0, 'reminders off: nothing');
update public.profiles set service_reminders = true where id = test.id('client_a');
select test.eq(public.send_warranty_reminders(test.today()), 1, 'back on: told');
select test.ok(public.is_quiet_event('warranty_ending'), 'it waits for the morning (quiet hours)');

rollback;
