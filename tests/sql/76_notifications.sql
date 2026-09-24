-- Push notifications and scheduled jobs (T12, ARCHITECTURE §9, §10): devices, the outbox the
-- dispatcher claims and finishes, the quote / appointment / document reminders, the daily summary.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
update public.shops set daily_capacity = 20 where id = test.id('shop1');
select set_config('test.day1', test.workday(1)::text, true);
select set_config('test.day2', test.workday(2)::text, true);

-- Events of one kind for one person (as the test runner).
create function pg_temp.events(p_event text, p_user uuid) returns bigint
language sql as $$ select count(*) from public.notification_events where event = p_event and user_id = p_user $$;

-- A local wall-clock time in Bucharest as an instant.
create function pg_temp.at_local(p_date date, p_time time) returns timestamptz
language sql as $$ select (p_date + p_time) at time zone 'Europe/Bucharest' $$;

-- A browser subscription as PushManager gives it.
create function pg_temp.sub(p_endpoint text) returns jsonb
language sql as $$
  select jsonb_build_object('endpoint', p_endpoint, 'expirationTime', null, 'keys', jsonb_build_object(
    'p256dh', 'B' || repeat('A', 86), 'auth', repeat('x', 22)))
$$;
grant execute on function pg_temp.sub(text) to public;

-- ------------------------------------------------------------------ devices
select test.login(test.id('client_a'));
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.sub('https://fcm.googleapis.com/fcm/send/dev-1'), 'Chrome');
-- Saving the same device again is harmless (same row, fresh keys).
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.sub('https://fcm.googleapis.com/fcm/send/dev-1'), 'Chrome 2');
select test.eq(test.count($$select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1'$$),
  1::bigint, 'one row per device');
select test.eq(user_agent, 'Chrome 2', 'the device row is updated') from public.push_subscriptions
where endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1';
select public.save_push_subscription('https://updates.push.services.mozilla.com/wpush/v2/x', pg_temp.sub('https://updates.push.services.mozilla.com/wpush/v2/x'));
select public.save_push_subscription('https://web.push.apple.com/QGx', pg_temp.sub('https://web.push.apple.com/QGx'));
select public.save_push_subscription('https://wns2-par02p.notify.windows.com/w/?token=x', pg_temp.sub('https://wns2-par02p.notify.windows.com/w/?token=x'));

select test.fails($$select public.save_push_subscription('https://evil.example.com/push', pg_temp.sub('https://evil.example.com/push'))$$,
  'push_endpoint_invalid', 'only real push services');
select test.fails($$select public.save_push_subscription('http://fcm.googleapis.com/fcm/send/x', pg_temp.sub('http://fcm.googleapis.com/fcm/send/x'))$$,
  'push_endpoint_invalid', 'https only');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com.evil.com/x', pg_temp.sub('https://fcm.googleapis.com.evil.com/x'))$$,
  'push_endpoint_invalid', 'a look-alike host is refused');
select test.fails($$select public.save_push_subscription('https://127.0.0.1:9999/x', pg_temp.sub('https://127.0.0.1:9999/x'))$$,
  'push_endpoint_invalid', 'no local addresses');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/y', pg_temp.sub('https://fcm.googleapis.com/fcm/send/z'))$$,
  'push_subscription_invalid', 'the subscription must be for that endpoint');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/y', '{"endpoint":"https://fcm.googleapis.com/fcm/send/y"}')$$,
  'push_subscription_invalid', 'keys are required');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/y',
    jsonb_set(pg_temp.sub('https://fcm.googleapis.com/fcm/send/y'), '{keys,auth}', '"<script>"'))$$,
  'push_subscription_invalid', 'keys must be base64url');
select test.fails($$insert into public.push_subscriptions (endpoint, subscription) values ('https://fcm.googleapis.com/fcm/send/q', '{}')$$,
  'permission denied', 'no direct insert');
select test.fails($$update public.push_subscriptions set subscription = '{}'$$, 'permission denied', 'no direct update');
select test.fails($$select * from public.push_config$$, 'permission denied', 'push_config is private');
select test.fails($$select public.claim_notifications(10)$$, 'permission denied', 'the browser cannot claim notifications');
select test.fails($$select public.finish_notifications('[]')$$, 'permission denied', 'the browser cannot finish notifications');
select test.fails($$select public.run_hourly_jobs()$$, 'permission denied', 'the browser cannot run jobs');
select test.fails($$select public.run_quote_jobs()$$, 'permission denied', 'the browser cannot run quote jobs');
select test.fails($$select public.send_doc_expiry_reminders()$$, 'permission denied', 'nor send reminders');
select test.fails($$select public.kick_dispatcher()$$, 'permission denied', 'nor wake the dispatcher');
-- Turning notifications off on this device: a plain delete of the own row.
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/QGx';
select test.logout();
select test.eq((select count(*) from public.push_subscriptions where user_id = test.id('client_a')), 4::bigint,
  'client A has the fixture device and three of the new ones');

-- The same browser, now signed in as client B: the device moves to B.
select test.login(test.id('client_b'));
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/dev-1', pg_temp.sub('https://fcm.googleapis.com/fcm/send/dev-1'));
select test.logout();
select test.eq(user_id, test.id('client_b'), 'a device belongs to whoever signed in on it last')
from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/dev-1';

-- At most 10 devices per person; the least recently used drop out.
select test.login(test.id('owner1'));
select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/o-' || i, pg_temp.sub('https://fcm.googleapis.com/fcm/send/o-' || i))
from generate_series(1, 12) i;
select test.eq(test.count('select 1 from public.push_subscriptions'), 10::bigint, 'ten devices kept');
select test.logout();

select test.login(test.id('admin'));
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/adm', pg_temp.sub('https://fcm.googleapis.com/fcm/send/adm'))$$,
  'not_allowed', 'admin accounts get no push');
select test.logout();
select test.login_anon();
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/anon', pg_temp.sub('https://fcm.googleapis.com/fcm/send/anon'))$$,
  'permission denied', 'signed-out visitors cannot save devices');
select test.logout();

-- Local test origins are accepted only when listed in push_config.
update public.push_config set extra_push_origins = '{http://127.0.0.1:9999}';
select test.login(test.id('client_a'));
select public.save_push_subscription('http://127.0.0.1:9999/push/1', pg_temp.sub('http://127.0.0.1:9999/push/1'));
select test.fails($$select public.save_push_subscription('http://127.0.0.1:99999/x', pg_temp.sub('http://127.0.0.1:99999/x'))$$,
  'push_endpoint_invalid', 'the origin must match exactly');
select test.logout();
update public.push_config set extra_push_origins = '{}';

-- Before the dispatcher stored its address (or without pg_net) nothing is called and nothing fails.
update public.push_config set dispatch_url = null;
select test.eq(public.kick_dispatcher(), false, 'no address yet: the dispatcher is not called');
select test.eq(public.dispatch_sweep(), false, 'no address yet: the sweep does nothing');

-- ------------------------------------------------------------------ the outbox
delete from public.notification_events;
insert into public.notification_events (id, user_id, event, params, channels) values
  ('00000000-0000-0000-0000-0000000000e1', test.id('client_a'), 'booking_confirmed', '{"service_id":"ulei"}', '{push}'),
  ('00000000-0000-0000-0000-0000000000e4', test.id('owner1'), 'booking_requested', '{}', '{push,sms}');
insert into public.notification_events (id, user_id, event, created_at)
values ('00000000-0000-0000-0000-0000000000e2', test.id('client_a'), 'job_done', now() - interval '13 hours');
insert into public.notification_events (id, user_id, event, attempts, last_error)
values ('00000000-0000-0000-0000-0000000000e3', test.id('client_a'), 'job_done', 5, 'push 503');

select set_config('test.claim', public.claim_notifications(10)::text, true);
select test.eq(jsonb_array_length(current_setting('test.claim')::jsonb->'events'), 2, 'two events claimed');
select test.eq(e->>'id', '00000000-0000-0000-0000-0000000000e1', 'oldest first'),
       test.eq(e->>'lang', 'ro', 'with the recipient''s language'),
       test.eq(e->>'role', 'client', 'and role'),
       test.eq(e->'service'->>'en', 'Oil & oil filter change', 'with the service names'),
       test.eq(jsonb_array_length(e->'devices'), 4, 'with every device of the recipient'),
       test.ok(jsonb_path_exists(e->'devices', '$[*].keys.p256dh'), 'devices carry their keys'),
       test.eq((e->>'attempts')::int, 1, 'first attempt')
from (select current_setting('test.claim')::jsonb->'events'->0 as e) x;
select test.ok(current_setting('test.claim')::jsonb ? 'texts', 'the admin text overrides come along');
select test.eq(last_error, 'stale', 'an event older than 12 hours is closed unsent')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000e2' and processed_at is not null;
select test.eq(last_error, 'push 503', 'an event tried 5 times is closed')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000e3' and processed_at is not null;
select test.eq(jsonb_array_length(public.claim_notifications(10)->'events'), 0, 'claimed events are held');

-- A failed send waits before the retry.
select test.eq(public.finish_notifications('[{"id":"00000000-0000-0000-0000-0000000000e1","done":false,"error":"push 503"}]'), 1, 'one finished');
select test.ok(processed_at is null and locked_until > now() + interval '1 minute' and last_error = 'push 503', 'retry later')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000e1';
select test.eq(jsonb_array_length(public.claim_notifications(10)->'events'), 0, 'not before its time');
update public.notification_events set locked_until = now() - interval '1 second'
where id = '00000000-0000-0000-0000-0000000000e1';
select test.eq((public.claim_notifications(10)->'events'->0->>'attempts')::int, 2, 'second attempt');

-- Done: log, dead devices removed (only the recipient's), working devices stamped.
select public.finish_notifications(jsonb_build_array(jsonb_build_object(
  'id', '00000000-0000-0000-0000-0000000000e1', 'done', true,
  'log', jsonb_build_array(jsonb_build_object('channel', 'push', 'status', 'sent'),
                           jsonb_build_object('channel', 'fax', 'status', 'sent')),
  'gone', jsonb_build_array('https://updates.push.services.mozilla.com/wpush/v2/x', 'https://push.test/b'),
  'delivered', jsonb_build_array('https://push.test/a'))));
select test.ok(processed_at is not null and locked_until is null and last_error is null, 'event done')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000e1';
select test.eq((select count(*) from public.notifications_log where event_id = '00000000-0000-0000-0000-0000000000e1'), 1::bigint,
  'one log row (unknown channels ignored)');
select test.eq((select count(*) from public.push_subscriptions where endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/x'), 0::bigint,
  'a device the push service no longer knows is deleted');
select test.eq((select count(*) from public.push_subscriptions where endpoint = 'https://push.test/b'), 1::bigint,
  'another person''s device is never touched');
select test.ok(last_success_at is not null, 'a working device is stamped')
from public.push_subscriptions where endpoint = 'https://push.test/a';
select test.eq(public.finish_notifications('[{"id":"00000000-0000-0000-0000-0000000000e1","done":true,"log":[{"channel":"push","status":"sent"}]}]'), 0,
  'finishing twice does nothing');
select test.eq((select count(*) from public.notifications_log where event_id = '00000000-0000-0000-0000-0000000000e1'), 1::bigint,
  'no second log row');

-- ------------------------------------------------------------------ quote expires in 24 h
delete from public.notification_events;
select set_config('test.qb', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, '09:00')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.qb')::uuid, gen_random_uuid());
select public.start_inspection(current_setting('test.qb')::uuid, gen_random_uuid());
select public.send_quote(current_setting('test.qb')::uuid, '[{"name":"Plăcuțe","price":280}]', gen_random_uuid());
select test.logout();
select set_config('test.expires', (select expires_at::text from public.quotes where booking_id = current_setting('test.qb')::uuid), true);

select test.eq(public.remind_expiring_quotes(now()), 0, 'no reminder right after sending');
select test.eq(public.remind_expiring_quotes(current_setting('test.expires')::timestamptz - interval '25 hours'), 0, 'not 25 h before');
select test.eq(public.remind_expiring_quotes(current_setting('test.expires')::timestamptz - interval '20 hours'), 1, 'reminded inside the last 24 h');
select test.eq(pg_temp.events('quote_expiring', test.id('client_a')), 1::bigint, 'the client is reminded');
select test.eq(pg_temp.events('quote_expiring', test.id('owner1')), 1::bigint, 'the owner is reminded');
select test.eq(pg_temp.events('quote_expiring', test.id('staff1')), 1::bigint, 'the staff member is reminded');
select test.ok(params ? 'expires_at' and params->>'total' = '280.00' and params->>'shop_name' = 'Atelier Unu', 'the reminder says when and how much')
from public.notification_events where event = 'quote_expiring' and user_id = test.id('client_a');
select test.eq(public.remind_expiring_quotes(current_setting('test.expires')::timestamptz - interval '10 hours'), 0, 'only once');
-- A new version of the quote gets its own reminder.
select test.login(test.id('owner1'));
select public.replace_quote(current_setting('test.qb')::uuid, '[{"name":"Plăcuțe","price":250}]', gen_random_uuid());
select test.logout();
select set_config('test.expires2', (select expires_at::text from public.quotes where booking_id = current_setting('test.qb')::uuid and status = 'sent'), true);
select test.eq(public.remind_expiring_quotes(current_setting('test.expires2')::timestamptz - interval '20 hours'), 1, 'the new version is reminded');
select test.eq(public.remind_expiring_quotes(current_setting('test.expires2')::timestamptz + interval '1 minute'), 0, 'not after it expired');
-- A quote the client answered is not reminded.
update public.quotes set expiry_reminded_at = null where booking_id = current_setting('test.qb')::uuid;
select test.login(test.id('client_a'));
select public.decide_quote(current_setting('test.qb')::uuid, test.sent_quote(current_setting('test.qb')::uuid),
  test.quote_item_ids(test.sent_quote(current_setting('test.qb')::uuid)), gen_random_uuid());
select test.logout();
select test.eq(public.remind_expiring_quotes(current_setting('test.expires2')::timestamptz - interval '20 hours'), 0, 'an answered quote is not reminded');

-- ------------------------------------------------------------------ appointment 24 h before
delete from public.notification_events;
select set_config('test.ab', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, '10:00')::text, true);
select set_config('test.start', public.slot_starts_at(current_setting('test.day1')::date, '10:00')::text, true);
select test.eq(public.send_appointment_reminders(current_setting('test.start')::timestamptz - interval '23 hours'), 0,
  'a request not yet confirmed gets no reminder');
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.ab')::uuid, gen_random_uuid());
select test.logout();
select test.eq(public.send_appointment_reminders(current_setting('test.start')::timestamptz - interval '25 hours'), 0, 'not 25 h before');
select test.eq(public.send_appointment_reminders(current_setting('test.start')::timestamptz - interval '23 hours'), 1, 'reminded 23 h before');
select test.eq(params->>'day', 'tomorrow', 'tomorrow'),
       test.eq(params->>'slot', '10:00', 'with the time'),
       test.eq(params->>'shop_name', 'Atelier Unu', 'and the shop'),
       test.eq(booking_id, current_setting('test.ab')::uuid, 'for that booking')
from public.notification_events where event = 'appointment_reminder' and user_id = test.id('client_a');
select test.eq(public.send_appointment_reminders(current_setting('test.start')::timestamptz - interval '22 hours 30 minutes'), 0, 'only once');
select test.ok(reminder_sent_at is not null, 'reminder_sent_at stamped') from public.bookings where id = current_setting('test.ab')::uuid;
-- Moving the booking arms the reminder again.
select test.login(test.id('owner1'));
select public.reschedule_booking(current_setting('test.ab')::uuid, current_setting('test.day2')::date, '11:00', gen_random_uuid());
select test.logout();
select test.eq(public.send_appointment_reminders(public.slot_starts_at(current_setting('test.day2')::date, '11:00') - interval '23 hours'), 1,
  'a moved booking is reminded for its new time');
-- A late slot reminded after midnight is "today".
select set_config('test.late', test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed', test.workday(3), '23:00')::text, true);
select test.eq(public.send_appointment_reminders(public.slot_starts_at(test.workday(3), '23:00') - interval '22 hours 30 minutes'), 1, 'late slot reminded');
select test.eq(params->>'day', 'today', 'at 00:30 a 23:00 slot is today')
from public.notification_events where event = 'appointment_reminder' and booking_id = current_setting('test.late')::uuid;

-- ------------------------------------------------------------------ documents at 30 / 7 / 0 days
delete from public.notification_events;
update public.cars
  set itp_expiry = test.today() + 12, rca_expiry = test.today() + 5, vignette_expiry = test.today() - 40, reminded = '{}'
where id = test.id('car_a');
select test.eq(public.send_doc_expiry_reminders(test.today()), 2, 'ITP in 12 days and RCA in 5 days');
select test.eq((select count(*) from public.notification_events where event = 'doc_expiry' and user_id = test.id('client_a')), 2::bigint,
  'both to the owner');
select test.ok(params->>'days' = '12' and params->>'make' = 'Volkswagen' and params->>'model' = 'Golf 7' and params->>'car_id' = test.id('car_a')::text,
  'the ITP reminder names the car and the days left')
from public.notification_events where event = 'doc_expiry' and params->>'doc' = 'itp';
select test.eq(reminded, jsonb_build_object(
    'itp', jsonb_build_object((test.today() + 12)::text, '[30]'::jsonb),
    'rca', jsonb_build_object((test.today() + 5)::text, '[30, 7]'::jsonb)),
  'thresholds recorded (RCA skipped straight to 7 days)')
from public.cars where id = test.id('car_a');
select test.eq(public.send_doc_expiry_reminders(test.today()), 0, 'not twice the same day');
select test.eq(public.send_doc_expiry_reminders(test.today() + 1), 0, 'nor the next day');
select test.eq(public.send_doc_expiry_reminders(test.today() + 5), 2, 'ITP at 7 days and RCA on the day');
select test.eq((select params->>'days' from public.notification_events where event = 'doc_expiry' and params->>'doc' = 'rca' order by created_at desc, (params->>'days')::int limit 1),
  '0', 'RCA expires today');
select test.eq(public.send_doc_expiry_reminders(test.today() + 9), 0, 'an expired document is reminded once');
-- A renewed document starts over with its new date.
update public.cars set rca_expiry = test.today() + 25 where id = test.id('car_a');
select test.eq(public.send_doc_expiry_reminders(test.today()), 1, 'the new RCA date is reminded');
select test.eq(reminded->'rca', jsonb_build_object((test.today() + 25)::text, '[30]'::jsonb), 'the old date is forgotten')
from public.cars where id = test.id('car_a');

-- ------------------------------------------------------------------ daily summary at opening
delete from public.notification_events;
select set_config('test.d1', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, '14:00')::text, true);
select set_config('test.d2', test.book(test.id('client_b'), test.id('shop1'), current_setting('test.day1')::date, '11:00')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.d1')::uuid, gen_random_uuid());
select public.confirm_booking(current_setting('test.d2')::uuid, gen_random_uuid());
select test.logout();
-- (day 1 now has: 09:00 approved, 11:00 and 14:00 confirmed; day 2: 11:00 confirmed)
select test.book(test.id('client_b'), test.id('shop1'), current_setting('test.day2')::date, '15:00'); -- a request
delete from public.notification_events;

select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day1')::date, '08:30')), 0, 'off unless the shop wants it');
update public.shops set daily_digest = true where id = test.id('shop1');
select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day1')::date, '07:30')), 0, 'not before opening');
select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day1')::date, '08:30')), 1, 'sent after opening');
select test.eq(params->>'today', '3', 'three bookings today'),
       test.eq(params->>'pending', '1', 'one request waiting'),
       test.eq(params->>'first_slot', '09:00', 'the first at 09:00'),
       test.eq(params->>'date', current_setting('test.day1'), 'for that day')
from public.notification_events where event = 'daily_digest' and user_id = test.id('owner1');
select test.eq(pg_temp.events('daily_digest', test.id('staff1')), 1::bigint, 'every member gets it');
select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day1')::date, '09:30')), 0, 'once a day');
select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day2')::date, '10:30')), 0, 'not late in the day');
select test.eq(public.send_daily_digests(pg_temp.at_local(test.saturday(), '09:00')), 0, 'not on a closed day');
insert into public.shop_closures (shop_id, start_date, end_date, label)
values (test.id('shop1'), current_setting('test.day2')::date, current_setting('test.day2')::date, 'Inventar');
select test.eq(public.send_daily_digests(pg_temp.at_local(current_setting('test.day2')::date, '08:10')), 0, 'not on a day off');

-- ------------------------------------------------------------------ the hourly and quarter-hour jobs
insert into public.request_log (request_id, user_id, fn, created_at)
values (gen_random_uuid(), test.id('client_a'), 'create_booking', now() - interval '8 days');
select test.ok(not (public.run_hourly_jobs(pg_temp.at_local(test.today() + 1, '12:05')) ? 'doc_reminders'), 'documents only at 07:00');
select test.ok(r ? 'doc_reminders' and (r->>'request_log_purged')::int >= 1, 'at 07:00 documents and the purge run')
from (select public.run_hourly_jobs(pg_temp.at_local(test.today() + 1, '07:05')) as r) x;
select test.eq((select count(*) from public.request_log where created_at < now() - interval '7 days'), 0::bigint, 'old request ids purged');
select test.ok(r ? 'expired' and r ? 'reminded', 'the quarter-hour job expires and reminds')
from (select public.run_quote_jobs() as r) x;

-- Scheduling needs pg_cron (Supabase); without it the function says so and changes nothing.
select test.eq(public.schedule_notification_jobs(),
  case when to_regnamespace('cron') is null then 'pg_cron missing' else 'scheduled' end, 'jobs scheduled where pg_cron exists');
select test.login(test.id('owner1'));
select test.fails($$select public.schedule_notification_jobs()$$, 'permission denied', 'the browser cannot schedule jobs');
select test.logout();

rollback;
