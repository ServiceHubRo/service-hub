-- T24: quiet hours, tips and offers to clients (tires, welcome, a favorite's offer), the request
-- still waiting and the monthly report to the shop.
begin;
select test.make_world();
delete from public.notification_events;

create function pg_temp.at_local(p_day date, p_time text) returns timestamptz
language sql as $$ select (p_day + p_time::time) at time zone 'Europe/Bucharest' $$;

create function pg_temp.device(p_user uuid) returns void
language sql as $$
  insert into public.push_subscriptions (endpoint, user_id, subscription)
  values ('https://push.test/' || p_user, p_user, '{"keys":{"p256dh":"x","auth":"y"}}')
  on conflict do nothing
$$;

create function pg_temp.events(p_event text, p_user uuid) returns bigint
language sql as $$ select count(*) from public.notification_events where event = p_event and user_id = p_user $$;

-- ------------------------------------------------------------------ quiet hours
update public.platform_settings set limits = limits || '{"quiet_hours_start": 21, "quiet_hours_end": 9}' where id = 1;
select test.eq(public.quiet_until(pg_temp.at_local('2026-10-01', '22:30')), pg_temp.at_local('2026-10-02', '09:00'),
  'late evening → the next morning at 9');
select test.eq(public.quiet_until(pg_temp.at_local('2026-10-02', '03:00')), pg_temp.at_local('2026-10-02', '09:00'),
  'at night → the same morning at 9');
select test.eq(public.quiet_until(pg_temp.at_local('2026-10-02', '08:59')), pg_temp.at_local('2026-10-02', '09:00'),
  '08:59 still waits');
select test.ok(public.quiet_until(pg_temp.at_local('2026-10-02', '09:00')) is null, '09:00 is not quiet');
select test.ok(public.quiet_until(pg_temp.at_local('2026-10-02', '20:59')) is null, '20:59 is not quiet');
-- Across the switch to winter time (25 Oct 2026): 9:00 is still 9:00 on the clock.
select test.eq(public.quiet_until(pg_temp.at_local('2026-10-24', '23:00')), pg_temp.at_local('2026-10-25', '09:00'),
  'the night the clocks change');
update public.platform_settings set limits = limits || '{"quiet_hours_start": 1, "quiet_hours_end": 6}' where id = 1;
select test.eq(public.quiet_until(pg_temp.at_local('2026-10-02', '02:00')), pg_temp.at_local('2026-10-02', '06:00'),
  'quiet hours inside one day');
select test.ok(public.quiet_until(pg_temp.at_local('2026-10-02', '07:00')) is null, 'outside them');
update public.platform_settings set limits = limits || '{"quiet_hours_start": 0, "quiet_hours_end": 0}' where id = 1;
select test.ok(public.quiet_until(pg_temp.at_local('2026-10-02', '03:00')) is null, 'start = end: no quiet hours');

-- The hour that is now, made quiet: a reminder waits, what a person did goes at once.
select set_config('test.h', extract(hour from now() at time zone 'Europe/Bucharest')::int::text, true);
update public.platform_settings
  set limits = limits || jsonb_build_object('quiet_hours_start', current_setting('test.h')::int,
                                            'quiet_hours_end', (current_setting('test.h')::int + 1) % 24)
where id = 1;
select public.notify_user(test.id('client_a'), 'review_request', '{}', test.id('booking_a'));
select public.notify_user(test.id('client_a'), 'booking_confirmed', '{}', test.id('booking_a'));
select test.ok((select not_before > now() from public.notification_events where event = 'review_request'),
  'a reminder waits for the end of the quiet hours');
select test.ok((select not_before is null from public.notification_events where event = 'booking_confirmed'),
  'a confirmation goes at once');
select public.notify_shop_owner(test.id('shop1'), 'invoice_paid', '{}');
select test.ok((select not_before is null from public.notification_events where event = 'invoice_paid'),
  'the payment receipt goes at once (an email the payer waits for)');
select test.eq((select count(*) from jsonb_array_elements(public.claim_notifications(50)->'events') e
                where e->>'event' = 'review_request'), 0::bigint, 'the waiting one is not claimed');
-- Due: claimed. Waited from 21:00 to 9:00 (12 hours) and still sent, not closed as old.
update public.notification_events
  set not_before = now() - interval '1 minute', created_at = now() - interval '13 hours'
where event = 'review_request';
select test.eq((select count(*) from jsonb_array_elements(public.claim_notifications(50)->'events') e
                where e->>'event' = 'review_request'), 1::bigint, 'due in the morning: sent, not stale');
update public.platform_settings set limits = limits || '{"quiet_hours_start": 0, "quiet_hours_end": 0}' where id = 1;
delete from public.notification_events;

-- ------------------------------------------------------------------ tips: device, weekly limit, once
delete from public.push_subscriptions;
select test.ok(not public.send_tip(test.id('client_a'), 'welcome', 'x1', 'welcome', '{}'), 'no device: nothing');
select pg_temp.device(test.id('client_a'));
select test.ok(public.send_tip(test.id('client_a'), 'welcome', 'x1', 'welcome', '{}'), 'with a device: sent');
select test.ok(not public.send_tip(test.id('client_a'), 'welcome', 'x1', 'welcome', '{}'), 'the same one never twice');
select test.ok(public.send_tip(test.id('client_a'), 'welcome', 'x2', 'welcome', '{}'), 'a second one this week');
select test.ok(not public.send_tip(test.id('client_a'), 'welcome', 'x3', 'welcome', '{}'), 'not a third (2 a week)');
select test.eq(pg_temp.events('welcome', test.id('client_a')), 2::bigint, 'two pushes in all');
select test.eq((select channels from public.notification_events where event = 'welcome' limit 1), '{push}'::text[], 'push only');
select pg_temp.device(test.id('owner1'));
select test.ok(not public.send_tip(test.id('owner1'), 'welcome', 'x4', 'welcome', '{}'), 'never to a shop');
delete from public.engagement_log;
delete from public.notification_events;

-- ------------------------------------------------------------------ tires
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-09-20', '10:05')), 0, 'not in September');
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-20', '10:05')), 1,
  'winter tires: the client with a car and a device');
select test.eq(params->>'season', 'winter', 'winter'),
       test.eq(params->>'make', (select make from public.cars where id = test.id('car_a')), 'one car: named')
from public.notification_events where event = 'tire_season' and user_id = test.id('client_a');
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-21', '10:05')), 0, 'once a season');
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2027-03-30', '10:05')), 1, 'and again for summer');
delete from public.engagement_log;
delete from public.notification_events;
-- A tire job already booked: nothing.
select set_config('test.tires', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.today() + 3, '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set service_id = 'anvelope' where id = current_setting('test.tires')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-20', '10:05')), 0, 'already booked for tires');
alter table public.bookings disable trigger bookings_guard;
update public.bookings set status = 'done', done_at = now() - interval '5 days' where id = current_setting('test.tires')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-20', '10:05')), 0, 'tires changed lately');
alter table public.bookings disable trigger bookings_guard;
update public.bookings set done_at = now() - interval '200 days' where id = current_setting('test.tires')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-20', '10:05')), 1, 'changed long ago: reminded');
select test.eq((params->>'shop_id')::uuid, test.id('shop1'), 'with the shop that did them last time')
from public.notification_events where event = 'tire_season';
delete from public.engagement_log;
update public.profiles set season_reminders = false where id = test.id('client_a');
select test.eq(public.send_tire_season_reminders(pg_temp.at_local('2026-10-20', '10:05')), 0, 'turned off in Cont');
update public.profiles set season_reminders = true where id = test.id('client_a');
delete from public.engagement_log;
delete from public.notification_events;

-- ------------------------------------------------------------------ welcome tips
select set_config('test.new', test.sign_up('nou@test.local',
  '{"role":"client","name":"Nou Client","phone":"0723000009","lang":"ro","terms_version":"2026-09"}')::text, true);
select pg_temp.device(current_setting('test.new')::uuid);
update public.profiles set created_at = now() - interval '3 days' where id = current_setting('test.new')::uuid;
select test.eq(public.send_welcome_tips(now()), 1, '3 days after sign-up, never booked');
select test.eq((params->>'day')::int, 3, 'the first one'),
       test.eq((params->>'has_car')::boolean, false, 'knows the garage is empty')
from public.notification_events where event = 'welcome';
select test.eq(public.send_welcome_tips(now() + interval '1 day'), 0, 'once');
update public.profiles set created_at = now() - interval '14 days' where id = current_setting('test.new')::uuid;
update public.profiles set app_tips = false where id = current_setting('test.new')::uuid;
select test.eq(public.send_welcome_tips(now()), 0, 'tips turned off in Cont');
update public.profiles set app_tips = true where id = current_setting('test.new')::uuid;
select test.eq(public.send_welcome_tips(now()), 1, 'and at 14 days');
update public.profiles set created_at = now() - interval '30 days' where id = current_setting('test.new')::uuid;
delete from public.engagement_log;
select test.eq(public.send_welcome_tips(now()), 0, 'not after that');
-- client_a has bookings: never.
update public.profiles set created_at = now() - interval '3 days' where id = test.id('client_a');
select test.eq(pg_temp.events('welcome', test.id('client_a')) + public.send_welcome_tips(now()), 0::bigint, 'not to someone who booked');
delete from public.engagement_log;
delete from public.notification_events;

-- ------------------------------------------------------------------ a favorite's offer
insert into public.favorites (client_id, shop_id) values (current_setting('test.new')::uuid, test.id('shop1')),
                                                         (test.id('client_a'), test.id('shop1'));
-- Offers are off until the client turns them on (consent).
select test.login(test.id('owner1'));
update public.shops set new_client_offer = 5 where id = test.id('shop1');
select test.logout();
select test.eq(pg_temp.events('favorite_offer', current_setting('test.new')::uuid), 0::bigint, 'offers are off by default');
update public.shops set new_client_offer = null where id = test.id('shop1');
delete from public.engagement_log where kind = 'favorite_offer';
update public.profiles set promo_notifications = true where id in (current_setting('test.new')::uuid, test.id('client_a'));
select test.login(test.id('owner1'));
update public.shops set new_client_offer = 10 where id = test.id('shop1');
select test.logout();
select test.eq(pg_temp.events('favorite_offer', current_setting('test.new')::uuid), 1::bigint,
  'the offer reaches the client who keeps the shop in favorites');
select test.eq((params->>'percent')::int, 10, 'with the percentage')
from public.notification_events where event = 'favorite_offer';
select test.eq(pg_temp.events('favorite_offer', test.id('client_a')), 0::bigint, 'not to a client already known there');
select test.login(test.id('owner1'));
update public.shops set new_client_offer = 20 where id = test.id('shop1');
update public.shops set new_client_offer = null where id = test.id('shop1');
update public.shops set new_client_offer = 30 where id = test.id('shop1');
select test.logout();
select test.eq(pg_temp.events('favorite_offer', current_setting('test.new')::uuid), 1::bigint, 'once a month per shop');
delete from public.notification_events;

-- ------------------------------------------------------------------ a request still waiting
-- The world's own pending request (shop2) is left out: this part is about one new request.
insert into public.engagement_log (kind, key) select 'request_waiting', id::text from public.bookings where status = 'pending';
select set_config('test.req', test.raw_booking(test.id('shop1'), test.id('client_b'), 'pending', test.today() + 4, '11:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set created_at = now() - interval '1 hour' where id = current_setting('test.req')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_request_waiting_reminders(now()), 0, 'one hour: not yet');
select test.eq(public.send_request_waiting_reminders(now() + interval '90 minutes'), 1, 'after two hours: reminded');
select test.eq(pg_temp.events('booking_request_waiting', test.id('owner1')), 1::bigint, 'to the owner'),
       test.eq(pg_temp.events('booking_request_waiting', test.id('staff1')), 1::bigint, 'and the colleague');
select test.eq(public.send_request_waiting_reminders(now() + interval '3 hours'), 0, 'once');
select test.ok(public.run_quote_jobs() ? 'requests_waiting', 'the quarter-hour job does it');
delete from public.notification_events;

-- ------------------------------------------------------------------ the monthly report
-- February 2025, a month the world has nothing in: one job of 450 lei by a returning client.
delete from public.engagement_log;
select set_config('test.job', test.raw_booking(test.id('shop1'), test.id('client_b'), 'done', '2025-02-10', '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set cost = 450, created_at = pg_temp.at_local('2025-02-08', '12:00')
where id = current_setting('test.job')::uuid;
update public.bookings set done_at = pg_temp.at_local('2024-11-10', '12:00')
where id = (select id from public.bookings where client_id = test.id('client_b') and shop_id = test.id('shop1')
              and status = 'done' and id <> current_setting('test.job')::uuid limit 1);
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_monthly_reports(pg_temp.at_local('2025-03-05', '10:05')), 0, 'only on the first days of the month');
select test.eq(public.send_monthly_reports(pg_temp.at_local('2025-03-01', '10:05')), 1, 'on the 1st: one shop had work last month');
select test.eq(user_id, test.id('owner1'), 'to the owner only'),
       test.eq(channels, '{push,email}'::text[], 'push and email'),
       test.eq((params->>'done')::int, 1, 'one job'),
       test.eq((params->>'revenue')::numeric, 450::numeric, 'its cost'),
       test.eq((params->>'requests')::int, 1, 'one request'),
       test.eq((params->>'new_clients')::int, 0, 'client_b was there before')
from public.notification_events where event = 'monthly_report';
select test.eq(public.send_monthly_reports(pg_temp.at_local('2025-03-02', '10:05')), 0, 'once a month');
delete from public.engagement_log;
select test.login(test.id('staff1'));
update public.shops set monthly_report = false where id = test.id('shop1');
select test.logout();
select test.ok((select monthly_report from public.shops where id = test.id('shop1')), 'a colleague cannot turn it off');
select test.login(test.id('owner1'));
update public.shops set monthly_report = false where id = test.id('shop1');
select test.logout();
select test.eq(public.send_monthly_reports(pg_temp.at_local('2025-03-01', '10:05')), 0, 'the owner turned it off');

-- ------------------------------------------------------------------ the hourly job and who may see what
select test.ok(r ? 'tire_season' and r ? 'welcome_tips' and r ? 'monthly_reports' and r ? 'doc_reminders',
  'at 10:00 the tips, the reports and the documents')
from (select public.run_hourly_jobs(pg_temp.at_local(test.today(), '10:05')) as r) x;

select test.login(test.id('client_a'));
select test.fails($$select 1 from public.engagement_log$$, 'permission denied', 'the log is server only');
select test.fails($$select public.send_tip(auth.uid(), 'welcome', 'k', 'welcome', '{}')$$, 'permission denied', 'tips are not callable');
update public.profiles set season_reminders = false, app_tips = false, promo_notifications = false where id = test.id('client_a');
select test.ok((select not season_reminders and not app_tips and not promo_notifications from public.profiles where id = test.id('client_a')),
  'the client turns each off');
select test.logout();

select test.login(test.id('admin'));
select test.eq(test.error_params($$select public.admin_update_settings('{"limits":{"quiet_hours_start":24}}', gen_random_uuid())$$)->>'field',
  'quiet_hours_start', 'an hour is 0–23');
select public.admin_update_settings('{"limits":{"quiet_hours_start":22,"promo_per_week":1}}', gen_random_uuid());
select test.eq((select (limits->>'quiet_hours_start')::int from public.platform_settings), 22, 'the admin moves the quiet hours');
select test.logout();

rollback;
