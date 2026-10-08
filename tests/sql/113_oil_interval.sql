-- T30: the client's own oil-change interval and last change in the Garage; the other service
-- reminders as a heads-up.
begin;
select test.make_world();

create function pg_temp.done_job(p_client uuid, p_car uuid, p_service text, p_done timestamptz) returns uuid
language plpgsql as $$
declare v uuid := test.raw_booking(test.id('shop1'), p_client, 'done', (p_done at time zone 'Europe/Bucharest')::date, '09:00');
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set car_id = p_car, service_id = p_service, extra_service_ids = '{}', done_at = p_done where id = v;
  alter table public.bookings enable trigger bookings_guard;
  return v;
end $$;

-- Only the jobs this test writes.
alter table public.bookings disable trigger bookings_guard;
delete from public.bookings where car_id in (test.id('car_a'), test.id('car_b'));
alter table public.bookings enable trigger bookings_guard;
delete from public.notification_events;
delete from public.client_reminders;

-- ------------------------------------------------------------------ the client's own fields
select test.login(test.id('client_b'));
update public.cars set oil_change_months = 6, last_oil_change = current_date - 30 where id = test.id('car_b');
select test.eq((select oil_change_months from public.cars where id = test.id('car_b')), 6, 'the client sets the interval');
select test.fails($$update public.cars set last_oil_change = current_date + 2 where id = test.id('car_b')$$,
  'car_oil_date_invalid', 'a date in the future is refused');
select test.fails($$update public.cars set oil_change_months = 25 where id = test.id('car_b')$$,
  'cars_oil_change_months_check', 'at most 24 months');
select test.fails($$update public.cars set oil_change_months = 0 where id = test.id('car_b')$$,
  'cars_oil_change_months_check', 'at least one month');
-- Another client's car: nothing changes.
update public.cars set oil_change_months = 3 where id = test.id('car_a');
select test.logout();
select test.eq((select oil_change_months from public.cars where id = test.id('car_a')), null::int, 'not on another client''s car');
select test.eq((select reminded from public.cars where id = test.id('car_b')) ? 'oil', false, 'the client cannot write what was sent');

-- ------------------------------------------------------------------ the date written in the Garage
-- Six months, the last change 6 months minus 10 days ago: due in 10 days, no shop.
update public.cars set last_oil_change = (public.bucharest_today() - interval '6 months' + interval '10 days')::date
where id = test.id('car_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'one reminder: the oil');
select test.eq(params->>'kind', 'oil', 'the oil reminder'),
       test.eq((params->>'months')::int, 6, 'with the client''s interval'),
       test.eq(params->>'service_id', 'ulei', 'for the oil change'),
       test.eq(params->>'shop_id', null::text, 'no shop: the date came from the Garage'),
       test.eq(booking_id, null::uuid, 'no booking'),
       test.eq((params->>'due')::date, public.bucharest_today() + 10, 'due in 10 days'),
       test.eq(params->>'make', 'Dacia', 'the car from the Garage'),
       test.eq(channels, '{push}'::text[], 'push only')
from public.notification_events where user_id = test.id('client_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'never twice for the same date');
-- A new date starts over; a date with the due day far away sends nothing.
update public.cars set last_oil_change = public.bucharest_today() - 20 where id = test.id('car_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'changed recently: nothing due');
-- A longer interval moves the due day: 12 months from 6 months ago is far.
update public.cars set oil_change_months = 12, last_oil_change = (public.bucharest_today() - interval '6 months' + interval '5 days')::date
where id = test.id('car_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'the client''s longer interval: not yet');

-- ------------------------------------------------------------------ a job through Service-Hub
delete from public.notification_events;
update public.cars set oil_change_months = 4, last_oil_change = (public.bucharest_today() - interval '1 year')::date
where id = test.id('car_b');
-- An oil change 4 months minus 5 days ago is newer than the date written: it counts.
select set_config('test.oil', pg_temp.done_job(test.id('client_b'), test.id('car_b'), 'ulei',
  now() - interval '4 months' + interval '5 days')::text, true);
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'one reminder, from the job');
select test.eq(booking_id, current_setting('test.oil')::uuid, 'about that job'),
       test.eq(params->>'shop_id', test.id('shop1')::text, 'at the same shop'),
       test.eq(params->>'kind', 'oil', 'the oil reminder'),
       test.eq((params->>'months')::int, 4, 'every 4 months')
from public.notification_events where user_id = test.id('client_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'never twice for the same job');
-- A date written after the job is newer: it counts instead.
update public.cars set last_oil_change = public.bucharest_today() - 7 where id = test.id('car_b');
delete from public.client_reminders;
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'the newer date in the Garage wins');

-- Already booked for an oil change or a full service: nothing.
update public.cars set last_oil_change = null where id = test.id('car_b');
select set_config('test.active', test.raw_booking(test.id('shop1'), test.id('client_b'), 'pending', public.bucharest_today() + 3, '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set car_id = test.id('car_b'), service_id = 'frane', extra_service_ids = '{revizie}'
where id = current_setting('test.active')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'a full service already booked');
alter table public.bookings disable trigger bookings_guard;
delete from public.bookings where id = current_setting('test.active')::uuid;
alter table public.bookings enable trigger bookings_guard;
-- Turned off in Cont: nothing.
update public.profiles set service_reminders = false where id = test.id('client_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'reminders off in Cont');
update public.profiles set service_reminders = true where id = test.id('client_b');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'on again: sent');

-- ------------------------------------------------------------------ the standard interval and a full service
-- No interval of the client's: the catalog's for "Schimb ulei" (12). A full service 12 months minus
-- 5 days ago: its own heads-up says it, the oil reminder would repeat it on the same day.
delete from public.notification_events;
delete from public.client_reminders;
alter table public.bookings disable trigger bookings_guard;
delete from public.bookings where car_id = test.id('car_b');
alter table public.bookings enable trigger bookings_guard;
update public.cars set oil_change_months = null, last_oil_change = null where id = test.id('car_b');
select pg_temp.done_job(test.id('client_b'), test.id('car_b'), 'revizie', now() - interval '12 months' + interval '5 days');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'one reminder for the full service');
select test.eq(params->>'service_id', 'revizie', 'the full service'),
       test.eq(params->>'kind', 'headsup', 'as a heads-up')
from public.notification_events where user_id = test.id('client_b');
-- With 6 months of the client's, the oil comes first, on its own.
delete from public.notification_events;
delete from public.client_reminders;
update public.cars set oil_change_months = 6 where id = test.id('car_b');
alter table public.bookings disable trigger bookings_guard;
update public.bookings set done_at = now() - interval '6 months' + interval '5 days' where car_id = test.id('car_b');
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'the oil, at 6 months after the full service');
select test.eq(params->>'kind', 'oil', 'the oil reminder'),
       test.eq(params->>'service_id', 'ulei', 'for the oil change')
from public.notification_events where user_id = test.id('client_b');

-- ------------------------------------------------------------------ the other services: a heads-up
delete from public.notification_events;
select pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'lichid_frana', now() - interval '24 months' + interval '10 days');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'the brake fluid');
select test.eq(params->>'kind', 'headsup', 'a heads-up'),
       test.eq(params ? 'months', false, 'the catalog''s interval, not told')
from public.notification_events where user_id = test.id('client_a');

-- The oil change in the catalog switched off: no oil reminder, whatever the client set.
delete from public.notification_events;
update public.cars set oil_change_months = 6, last_oil_change = (public.bucharest_today() - interval '6 months' + interval '3 days')::date
where id = test.id('car_a');
update public.services set enabled = false where id = 'ulei';
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'the oil change switched off');
update public.services set enabled = true where id = 'ulei';
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'switched on: sent');

select test.login(test.id('client_a'));
select test.fails($$select public.send_service_reminders(public.bucharest_today())$$, 'permission denied', 'the job is not callable');
select test.logout();

rollback;
