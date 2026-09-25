-- T19d: the review request the day after a job and the service reminder before an interval ends —
-- push only, once each, only when they make sense.
begin;
select test.make_world();

-- A finished job written as it would be, with the car of the garage.
create function pg_temp.done_job(p_client uuid, p_car uuid, p_service text, p_done timestamptz) returns uuid
language plpgsql as $$
declare v uuid := test.raw_booking(test.id('shop1'), p_client, 'done', (p_done at time zone 'Europe/Bucharest')::date, '09:00');
begin
  alter table public.bookings disable trigger bookings_guard;
  update public.bookings set car_id = p_car, service_id = p_service, done_at = p_done where id = v;
  alter table public.bookings enable trigger bookings_guard;
  return v;
end $$;

delete from public.notification_events;

-- ------------------------------------------------------------------ review request
select set_config('test.yesterday', pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'frane', now() - interval '1 day')::text, true);
select set_config('test.today', pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'frane', now() - interval '1 minute')::text, true);
select test.eq(public.send_review_requests(now()), 1, 'one job finished yesterday without a review');
select test.eq(user_id, test.id('client_a'), 'to the client'),
       test.eq(booking_id, current_setting('test.yesterday')::uuid, 'about that job'),
       test.eq(channels, '{push}'::text[], 'push only'),
       test.eq(params->>'shop_name', 'Atelier Unu', 'with the shop')
from public.notification_events where event = 'review_request';
select test.eq(public.send_review_requests(now()), 0, 'never twice');
select test.eq(test.count($$select 1 from public.notification_events where event = 'review_request' and booking_id = test.id('booking_a')$$),
  0::bigint, 'a job already reviewed is not asked');
-- A review left before the morning: nothing to ask.
select set_config('test.reviewed', pg_temp.done_job(test.id('client_b'), null, 'frane', now() - interval '1 day')::text, true);
insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating)
values (current_setting('test.reviewed')::uuid, test.id('shop1'), test.id('client_b'), 'Bogdan P.', 5);
select test.eq(public.send_review_requests(now()), 0, 'not after the client reviewed it');

-- ------------------------------------------------------------------ service reminder
delete from public.notification_events;
-- Brake fluid every 24 months: the last change 24 months minus 10 days ago → due in 10 days.
select set_config('test.fluid', pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'lichid_frana',
  now() - interval '24 months' + interval '10 days')::text, true);
-- Air filter every 12 months, changed 3 months ago: not yet.
select pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'filtru_aer', now() - interval '3 months');
-- A service without an interval: never.
select pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'frane', now() - interval '5 years');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'one reminder: the brake fluid');
select test.eq(event, 'service_due', 'service_due'),
       test.eq(booking_id, current_setting('test.fluid')::uuid, 'about the last job of that service'),
       test.eq(params->>'service_id', 'lichid_frana', 'the service'),
       test.eq(params->>'shop_id', test.id('shop1')::text, 'at the same shop'),
       test.eq(params->>'car_id', test.id('car_a')::text, 'for the car'),
       test.eq((params->>'due')::date, (public.bucharest_today() + 10), 'due in 10 days')
from public.notification_events where user_id = test.id('client_a');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'never twice');

-- A newer job of the same service moves the date: the reminder is about the newest one only.
delete from public.client_reminders;
select pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'lichid_frana', now() - interval '2 months');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'a recent change: nothing due');

-- Already booked for it, or turned off in Cont, or the car left the garage: nothing.
delete from public.client_reminders;
alter table public.bookings disable trigger bookings_guard;
delete from public.bookings where client_id = test.id('client_a') and service_id = 'lichid_frana' and done_at > now() - interval '1 year';
alter table public.bookings enable trigger bookings_guard;
select set_config('test.active', test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', public.bucharest_today() + 5, '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set car_id = test.id('car_a'), service_id = 'lichid_frana' where id = current_setting('test.active')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'already booked for it');
alter table public.bookings disable trigger bookings_guard;
delete from public.bookings where id = current_setting('test.active')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.login(test.id('client_a'));
update public.profiles set service_reminders = false where id = test.id('client_a');
select test.logout();
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'turned off in Cont (by the client)');
update public.profiles set service_reminders = true where id = test.id('client_a');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'on again: sent');

-- ------------------------------------------------------------------ the hourly job, at 10:00 in Bucharest
select test.ok(public.run_hourly_jobs((public.bucharest_today() + time '10:05') at time zone 'Europe/Bucharest') ? 'service_reminders',
  'the 10:00 run sends both reminders'),
       test.ok(not (public.run_hourly_jobs((public.bucharest_today() + time '11:05') at time zone 'Europe/Bucharest') ? 'review_requests'),
  'other hours do not');

-- ------------------------------------------------------------------ who may see and change what
select test.login(test.id('client_a'));
select test.fails($$select 1 from public.client_reminders$$, 'permission denied', 'the sent reminders are server only');
select test.fails($$select public.send_review_requests(now())$$, 'permission denied', 'the jobs are not callable');
select test.fails($$select public.admin_set_service_reminder('ulei', 6, gen_random_uuid())$$, 'not_allowed', 'only the admin sets intervals');
select test.logout();
select test.login(test.id('admin'));
select test.eq(test.error_params($$select public.admin_set_service_reminder('ulei', 0, gen_random_uuid())$$)->>'field',
  'reminder_months', '0 months is refused');
select public.admin_set_service_reminder('ulei', 6, gen_random_uuid());
select public.admin_set_service_reminder('frane', null, gen_random_uuid());
select test.eq((select reminder_months from public.services where id = 'ulei'), 6, 'the admin changes an interval');
select test.eq((select count(*) from public.admin_audit_log where action = 'update_service' and entity_id = 'ulei'), 1::bigint,
  'logged; no row when nothing changed');
select test.eq((select (x->>'reminder_months')::int from jsonb_array_elements(public.admin_list_catalog()) c,
                jsonb_array_elements(c->'services') x where x->>'id' = 'ulei'), 6, 'the catalog shows it');
select test.logout();

rollback;
