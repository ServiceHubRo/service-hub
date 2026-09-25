-- Reminders for clients (T19d): the review request the day after a job, the service reminder
-- before the next oil change (service intervals set by the admin), both turned off in Cont.
begin;
select test.make_world();

-- A local wall-clock time in Bucharest as an instant.
create function pg_temp.at_local(p_date date, p_time time) returns timestamptz
language sql as $$ select (p_date + p_time) at time zone 'Europe/Bucharest' $$;

-- Events of one kind for one booking.
create function pg_temp.events(p_event text, p_booking uuid) returns bigint
language sql as $$ select count(*) from public.notification_events where event = p_event and booking_id = p_booking $$;

-- A finished job on a car of the client's garage, `p_days` days ago (Bucharest calendar).
create function pg_temp.job(p_client uuid, p_car uuid, p_service text, p_days int, p_time time default '15:00') returns uuid
language plpgsql as $$
declare
  v_id uuid := test.raw_booking(test.id('shop1'), p_client, 'done', test.today() - p_days, p_time);
begin
  update public.bookings set car_id = p_car, service_id = p_service where id = v_id;
  return v_id;
end
$$;

-- ------------------------------------------------------------------ the catalog intervals
select test.eq(interval_months, 12, 'oil: 12 months') from public.services where id = 'ulei';
select test.eq(interval_months, 24, 'brake fluid: 24 months') from public.services where id = 'lichid_frana';
select test.ok(interval_months is null, 'brake pads: none') from public.services where id = 'frane';

select test.login(test.id('client_a'));
select test.fails($$select public.admin_set_service_interval('frane', test.rid(), 6)$$, 'not_allowed', 'a client cannot set an interval');
select test.fails($$update public.services set interval_months = 1 where id = 'ulei'$$, 'permission denied', 'nor write the catalog');
select test.fails($$select public.send_review_requests()$$, 'permission denied', 'nor send review requests');
select test.fails($$select public.send_service_reminders()$$, 'permission denied', 'nor service reminders');
select test.logout();
select test.login(test.id('owner1'));
select test.fails($$select public.admin_set_service_interval('frane', test.rid(), 6)$$, 'not_allowed', 'nor a shop');
select test.logout();

select test.login(test.id('admin'));
select set_config('test.rid', test.rid()::text, true);
select test.eq((public.admin_set_service_interval('frane', current_setting('test.rid')::uuid, 18))->>'interval_months', '18', 'the admin sets one');
select test.eq((public.admin_set_service_interval('frane', current_setting('test.rid')::uuid, 30))->>'interval_months', '18',
  'the same request twice does nothing else');
select test.fails($$select public.admin_set_service_interval('frane', test.rid(), 0)$$, 'field_invalid', 'at least 1 month');
select test.fails($$select public.admin_set_service_interval('frane', test.rid(), 121)$$, 'field_invalid', 'at most 120 months');
select test.fails($$select public.admin_set_service_interval('nu_exista', test.rid(), 6)$$, 'service_not_found', 'an existing service');
select test.ok(public.admin_set_service_interval('antigel', test.rid()) ->> 'interval_months' is null, 'left out = no reminder');
select test.eq((select count(*) from jsonb_array_elements(public.admin_list_catalog()) c, jsonb_array_elements(c->'services') s
                where s->>'id' = 'frane' and s->>'interval_months' = '18'), 1::bigint, 'the catalog tool shows it');
select test.logout();
select test.eq(count(*), 1::bigint, 'the change is in the audit log')
from public.admin_audit_log where action = 'update_service' and entity_id = 'frane'
  and before->'interval_months' = 'null'::jsonb and after->>'interval_months' = '18';
select test.eq(interval_months, 18, 'stored') from public.services where id = 'frane';

-- ------------------------------------------------------------------ Cont: turning them off
select test.login(test.id('client_a'));
update public.profiles set review_requests = false, service_reminders = false where id = test.id('client_a');
select test.ok(not review_requests and not service_reminders, 'the client turns both off') from public.profiles where id = test.id('client_a');
select test.logout();
select test.login(test.id('client_b'));
update public.profiles set review_requests = true, service_reminders = true;
update public.profiles set review_requests = false where id = test.id('client_a');
select test.logout();
select test.ok(not review_requests and not service_reminders, 'another client cannot touch them')
from public.profiles where id = test.id('client_a');
select test.ok(review_requests and service_reminders, 'client B keeps the defaults') from public.profiles where id = test.id('client_b');
update public.profiles set review_requests = true, service_reminders = true where id = test.id('client_a');

-- ------------------------------------------------------------------ review requests
delete from public.notification_events;
select set_config('test.yesterday', pg_temp.job(test.id('client_a'), test.id('car_a'), 'ulei', 1)::text, true);
select set_config('test.today_job', pg_temp.job(test.id('client_a'), test.id('car_a'), 'frane', 0, '00:30')::text, true);
select set_config('test.old', pg_temp.job(test.id('client_b'), test.id('car_b'), 'ulei', 4)::text, true);
select set_config('test.reviewed', pg_temp.job(test.id('client_b'), test.id('car_b'), 'frane', 2)::text, true);
insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating)
values (current_setting('test.reviewed')::uuid, test.id('shop1'), test.id('client_b'), 'Bogdan P.', 4);

-- Only at 10:xx Bucharest.
select test.ok(not (public.run_hourly_jobs(pg_temp.at_local(test.today(), '09:05')) ? 'review_requests'), 'not at 09:00');
select test.eq(pg_temp.events('review_request', current_setting('test.yesterday')::uuid), 0::bigint, 'nothing sent at 09:00');
select test.eq((public.run_hourly_jobs(pg_temp.at_local(test.today(), '10:05'))->>'review_requests')::int, 1, 'one request at 10:00');
select test.eq(pg_temp.events('review_request', current_setting('test.yesterday')::uuid), 1::bigint, 'for the job finished yesterday');
select test.ok(user_id = test.id('client_a') and channels = array['push'] and params->>'shop_name' = 'Atelier Unu'
               and params->>'service_id' = 'ulei' and params->>'booking_id' = current_setting('test.yesterday'),
  'a push to the client, with the shop and the service')
from public.notification_events where event = 'review_request';
select test.eq(pg_temp.events('review_request', current_setting('test.today_job')::uuid), 0::bigint, 'not for a job finished today');
select test.eq(pg_temp.events('review_request', current_setting('test.old')::uuid), 0::bigint, 'not 4 days later');
select test.eq(pg_temp.events('review_request', current_setting('test.reviewed')::uuid), 0::bigint, 'not when the review is left');
select test.eq(pg_temp.events('review_request', test.id('booking_a')), 0::bigint, 'nor for the fixture job');
select test.eq(public.send_review_requests(pg_temp.at_local(test.today(), '10:30')), 0, 'never twice');
-- The job finished today is asked about tomorrow; a client who turned them off is not.
select test.eq(public.send_review_requests(pg_temp.at_local(test.today() + 1, '10:05')), 1, 'the next day, today''s job');
select test.eq(pg_temp.events('review_request', current_setting('test.today_job')::uuid), 1::bigint, 'is asked about');
select set_config('test.b_yesterday', pg_temp.job(test.id('client_b'), test.id('car_b'), 'bujii', 1)::text, true);
update public.profiles set review_requests = false where id = test.id('client_b');
select test.eq(public.send_review_requests(pg_temp.at_local(test.today(), '10:05')), 0, 'turned off in Cont: nothing');
update public.profiles set review_requests = true where id = test.id('client_b');
update public.profiles set suspended = true where id = test.id('client_b');
select test.eq(public.send_review_requests(pg_temp.at_local(test.today(), '10:05')), 0, 'a suspended client: nothing');
update public.profiles set suspended = false where id = test.id('client_b');
-- A short review window closes the request too.
update public.platform_settings set limits = limits || '{"review_window_days": 1}';
select test.eq(public.send_review_requests(pg_temp.at_local(test.today(), '23:30') + interval '1 day'), 0,
  'not once the review can no longer be left');
update public.platform_settings set limits = limits || '{"review_window_days": 60}';
select test.eq(public.send_review_requests(pg_temp.at_local(test.today(), '10:05')), 1, 'client B''s job once it is on again');

-- ------------------------------------------------------------------ service reminders
delete from public.notification_events;
-- Oil (12 months) on car A, done 12 months minus 10 days ago: due in 10 days.
select set_config('test.oil', pg_temp.job(test.id('client_a'), test.id('car_a'), 'ulei',
  test.today() - (test.today() - interval '12 months' + interval '10 days')::date)::text, true);
-- Brake fluid (24 months) on car A, done 23 months ago: due in about a month, too early.
select set_config('test.fluid', pg_temp.job(test.id('client_a'), test.id('car_a'), 'lichid_frana',
  test.today() - (test.today() - interval '23 months')::date)::text, true);
-- The fixture job (oil 10 days ago) and the review-request jobs above are newer oil jobs on car A:
-- the reminder counts from the last one, so park those on another service for this part.
update public.bookings set service_id = 'diag'
where car_id = test.id('car_a') and service_id = 'ulei' and id <> current_setting('test.oil')::uuid;

select test.ok(not (public.run_hourly_jobs(pg_temp.at_local(test.today(), '07:05')) ? 'service_reminders'), 'not at 07:00');
select test.eq((public.run_hourly_jobs(pg_temp.at_local(test.today(), '10:05'))->>'service_reminders')::int, 1, 'one reminder at 10:00');
select test.ok(user_id = test.id('client_a') and channels = array['push'] and params->>'service_id' = 'ulei'
               and params->>'car_id' = test.id('car_a')::text and params->>'make' = 'Volkswagen'
               and params->>'shop_id' = test.id('shop1')::text
               and params->>'due_date' = (test.today() + 10)::text and params->>'months' = '12'
               and (params->>'last_date')::date = (test.today() - interval '12 months' + interval '10 days')::date,
  'the car, the service, the shop, the last job and the due date')
from public.notification_events where event = 'service_due' and booking_id = current_setting('test.oil')::uuid;
select test.eq(pg_temp.events('service_due', current_setting('test.fluid')::uuid), 0::bigint, 'nothing a month early');
select test.eq(public.send_service_reminders(test.today() + 1), 0, 'once per job');
select test.eq(public.send_service_reminders(test.today() + 10), 0, 'even on the due day');

-- Brake fluid comes within 14 days a couple of weeks later.
select test.eq(public.send_service_reminders((test.today() - interval '23 months' + interval '24 months' - interval '14 days')::date), 1,
  'two weeks before the brake fluid is due');
select test.eq(pg_temp.events('service_due', current_setting('test.fluid')::uuid), 1::bigint, 'for that job');

-- Not when the car already has a booking for it, nor when turned off, nor past the due date.
delete from public.notification_events;
select set_config('test.oil_b', pg_temp.job(test.id('client_b'), test.id('car_b'), 'ulei',
  test.today() - (test.today() - interval '12 months' + interval '5 days')::date)::text, true);
update public.bookings set service_id = 'diag' where car_id = test.id('car_b') and service_id = 'ulei'
  and id <> current_setting('test.oil_b')::uuid;
select set_config('test.upcoming', test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed', test.workday(2), '10:00')::text, true);
update public.bookings set car_id = test.id('car_b') where id = current_setting('test.upcoming')::uuid;
select test.eq(public.send_service_reminders(test.today()), 0, 'already booked for that service');
update public.bookings set service_id = 'frane' where id = current_setting('test.upcoming')::uuid;
update public.profiles set service_reminders = false where id = test.id('client_b');
select test.eq(public.send_service_reminders(test.today()), 0, 'turned off in Cont');
update public.profiles set service_reminders = true where id = test.id('client_b');
select test.eq(public.send_service_reminders(test.today() + 6), 0, 'past the due date: nothing');
update public.services set enabled = false where id = 'ulei';
select test.eq(public.send_service_reminders(test.today()), 0, 'a switched-off service: nothing');
update public.services set enabled = true where id = 'ulei';
-- A car no longer in the garage: no reminder (car_id is cleared when the car is deleted).
savepoint car_kept;
delete from public.cars where id = test.id('car_b');
select test.eq(public.send_service_reminders(test.today()), 0, 'a deleted car: nothing');
rollback to savepoint car_kept;
select test.eq(public.send_service_reminders(test.today()), 1, 'otherwise client B is reminded');
select test.eq(pg_temp.events('service_due', current_setting('test.oil_b')::uuid), 1::bigint, 'about the oil of car B');

-- A newer oil job starts over: the reminder follows the last one.
delete from public.notification_events;
select set_config('test.oil_new', pg_temp.job(test.id('client_a'), test.id('car_a'), 'ulei', 2)::text, true);
select test.eq(public.send_service_reminders((test.today() - 2 + interval '12 months' - interval '14 days')::date), 1,
  'the newer job is reminded a year later');
select test.eq(pg_temp.events('service_due', current_setting('test.oil_new')::uuid), 1::bigint, 'on the newer job');

rollback;
