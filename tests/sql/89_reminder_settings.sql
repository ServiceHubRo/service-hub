-- T19d follow-up: the review request can be turned off in Cont too; no reminder goes to a
-- suspended account; a service switched off in the catalog is not reminded.
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
select test.ok(review_requests, 'on by default') from public.profiles where id = test.id('client_a');

-- ------------------------------------------------------------------ the client's own setting
select test.login(test.id('client_a'));
update public.profiles set review_requests = false where id = test.id('client_a');
select test.logout();
select test.ok(not review_requests, 'the client turns it off') from public.profiles where id = test.id('client_a');
select test.login(test.id('client_b'));
update public.profiles set review_requests = true;
update public.profiles set review_requests = true where id = test.id('client_a');
select test.logout();
select test.ok(not review_requests, 'nobody else can turn it back on') from public.profiles where id = test.id('client_a');

-- ------------------------------------------------------------------ review request
select set_config('test.job', pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'frane', now() - interval '1 day')::text, true);
select test.eq(public.send_review_requests(now()), 0, 'turned off: no review request');
update public.profiles set review_requests = true where id = test.id('client_a');
update public.profiles set suspended = true where id = test.id('client_a');
select test.eq(public.send_review_requests(now()), 0, 'a suspended account: no review request');
update public.profiles set suspended = false where id = test.id('client_a');
select test.eq(public.send_review_requests(now()), 1, 'on and not suspended: sent');
select test.eq(booking_id, current_setting('test.job')::uuid, 'about that job')
from public.notification_events where event = 'review_request';

-- ------------------------------------------------------------------ service reminder
delete from public.notification_events;
-- Brake fluid every 24 months: due in 10 days.
select pg_temp.done_job(test.id('client_a'), test.id('car_a'), 'lichid_frana', now() - interval '24 months' + interval '10 days');
update public.profiles set suspended = true where id = test.id('client_a');
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'a suspended account: no service reminder');
update public.profiles set suspended = false where id = test.id('client_a');
update public.services set enabled = false where id = 'lichid_frana';
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'a service switched off: no reminder');
update public.services set enabled = true where id = 'lichid_frana';
-- The review request setting does not touch the service reminders.
update public.profiles set review_requests = false where id = test.id('client_a');
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'otherwise sent');

rollback;
