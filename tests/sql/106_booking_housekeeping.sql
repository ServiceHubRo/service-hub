-- Bookings that look after themselves (Eduard, 3 oct): a request nobody answered closes at its time
-- (the client and the shop are told), a confirmed booking left open gets a question the next morning
-- and closes 7 days later (never as a no-show), and the admin gets a morning email only when
-- something waits. Only pg_cron / the service role run these.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

-- ------------------------------------------------------------------ 1. the request nobody answered
-- Bogdan's request at Atelier Doi (fixture): pending, 3 days ahead at 09:00.
select set_config('test.req', (select id::text from public.bookings where shop_id = test.id('shop2') and status = 'pending'), true);
select set_config('test.req_at', (select public.slot_starts_at(date, slot)::text from public.bookings
                                  where id = current_setting('test.req')::uuid), true);

select test.eq(public.expire_unanswered_requests(now()), 0, 'nothing before its time');
select test.eq(public.expire_unanswered_requests(current_setting('test.req_at')::timestamptz - interval '1 minute'), 0,
  'not a minute early');
select test.eq(public.expire_unanswered_requests(current_setting('test.req_at')::timestamptz + interval '1 minute'), 1,
  'closed once its time has come');
select test.eq(status, 'expired', 'expired') from public.bookings where id = current_setting('test.req')::uuid;
select test.eq(closed_reason, 'unanswered', 'marked as unanswered') from public.bookings where id = current_setting('test.req')::uuid;
select test.eq(public.expire_unanswered_requests(current_setting('test.req_at')::timestamptz + interval '2 hours'), 0,
  'only once');

select test.eq((select channels from public.notification_events
                where user_id = test.id('client_b') and event = 'request_expired'), array['push', 'email'],
  'the client is told, by push and email');
select test.eq((select channels from public.notification_events
                where user_id = test.id('owner2') and event = 'request_expired'), array['push', 'email'],
  'the shop''s owner too');
select test.eq((select params->>'category' from public.notification_events
                where user_id = test.id('client_b') and event = 'request_expired'), 'cat_rev',
  'with the kind of work, to find another shop');
select test.eq((select params->>'city' from public.notification_events
                where user_id = test.id('client_b') and event = 'request_expired'), 'Codlea', 'and the city');
select test.eq((select params->>'slot' from public.messages
                where booking_id = current_setting('test.req')::uuid and event = 'request_expired'), '09:00',
  'a line in the conversation, with the time');

-- Not a job: the shop's history leaves it out; the client's places are free again.
select test.login(test.id('owner2'));
select test.eq((select count(*) from jsonb_array_elements(public.list_shop_history()->'bookings') x
                where x->>'id' = current_setting('test.req')), 0::bigint, 'not in the shop''s history');
select test.logout();

-- A request the shop confirms in time stays confirmed (the job only takes pending ones).
select test.login(test.id('client_a'));
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.logout();
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.b')::uuid, gen_random_uuid());
select test.logout();
select set_config('test.b_at', public.slot_starts_at(current_setting('test.day')::date, '09:00')::text, true);
select test.eq(public.expire_unanswered_requests(current_setting('test.b_at')::timestamptz + interval '1 hour'), 0,
  'a confirmed booking is not a request');

-- The browser can neither write the marker nor run the jobs.
select test.login(test.id('client_a'));
select test.fails(format('update public.bookings set closed_reason = null where id = %L', current_setting('test.b')),
  'permission denied', 'closed_reason is the system''s');
select test.fails('select public.expire_unanswered_requests(now())', 'permission denied', 'no API access');
select test.fails('select public.send_booking_followups(now())', 'permission denied', 'no API access (followups)');
select test.fails('select public.close_stale_bookings(now())', 'permission denied', 'no API access (closing)');
select test.fails('select public.send_admin_digest(now())', 'permission denied', 'no API access (digest)');
select test.logout();

-- ------------------------------------------------------------------ 2. the confirmed booking left open
-- 10:00 in Bucharest on a given day after the booking's.
create temp table at_ten as
select d, ((current_setting('test.day')::date + d) + time '10:00') at time zone 'Europe/Bucharest' as t
from generate_series(0, 8) d;

select test.eq(public.send_booking_followups((select t from at_ten where d = 0)), 0, 'not on the day itself');
select test.eq(public.send_booking_followups((select t from at_ten where d = 1)), 1, 'the next morning');
select test.eq(public.send_booking_followups((select t from at_ten where d = 2)), 0, 'once');
select test.eq((select count(*) from public.notification_events
                where booking_id = current_setting('test.b')::uuid and event = 'booking_followup'), 2::bigint,
  'to every member (owner and colleague)');
select test.ok((select followup_sent_at is not null from public.bookings where id = current_setting('test.b')::uuid),
  'the question is remembered');

select test.eq(public.close_stale_bookings((select t from at_ten where d = 6)), 0, 'still open after 6 days');
select test.eq(public.close_stale_bookings((select t from at_ten where d = 7)), 1, 'closed after 7 days');
select test.eq(status, 'expired', 'expired') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(closed_reason, 'not_updated', 'as not updated') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq((select count(*) from public.bookings where client_id = test.id('client_a') and status = 'no_show'), 0::bigint,
  'never a no-show for the client');
select test.eq((select count(*) from public.notification_events
                where user_id = test.id('client_a') and event = 'booking_auto_closed'), 0::bigint,
  'the client gets no notification');
select test.eq((select count(*) from public.notification_events
                where user_id = test.id('owner1') and event = 'booking_auto_closed'), 1::bigint, 'the shop is told');
select test.eq((select count(*) from public.messages
                where booking_id = current_setting('test.b')::uuid and event = 'booking_auto_closed'), 1::bigint,
  'a kind line in the conversation');
select test.eq(public.close_stale_bookings((select t from at_ten where d = 8)), 0, 'only once');

select test.login(test.id('owner1'));
select test.eq((select x->>'closed_reason' from jsonb_array_elements(public.list_shop_history()->'bookings') x
                where x->>'id' = current_setting('test.b')), 'not_updated', 'in the history, with the reason');
select test.logout();

-- The morning jobs run them at 10:xx.
select test.ok(public.run_hourly_jobs((select t from at_ten where d = 1)) ?& array['booking_followups', 'bookings_closed'],
  'run at 10:00');
select test.ok(public.run_quote_jobs(now()) ? 'requests_expired', 'requests every 15 minutes');

-- ------------------------------------------------------------------ 3. the admin's morning email
-- Nothing waits: no email.
update public.reviews set signals_cleared_at = now();
update public.bookings set closed_reason = null where closed_reason = 'unanswered';
select test.eq(public.send_admin_digest(now()), false, 'nothing waits, no email');
select test.eq((select count(*) from public.notification_events where event = 'admin_digest'), 0::bigint, 'none queued');

-- A reported review waits.
update public.reviews set report_reason = 'fake', reported_at = now(), report_status = 'pending', removed_at = null
where client_id = test.id('client_b');
select test.eq(public.send_admin_digest(now()), true, 'something waits: the email');
select test.eq((select user_id from public.notification_events where event = 'admin_digest'), null::uuid,
  'to the platform address');
select test.eq((select channels from public.notification_events where event = 'admin_digest'), array['email'], 'by email');
select test.eq((select (params->>'reports')::int from public.notification_events where event = 'admin_digest'), 1,
  'with the count');
select test.eq(public.send_admin_digest(now() + interval '2 hours'), false, 'once a day');
select test.ok(public.run_hourly_jobs(((current_date + 1) + time '08:00') at time zone 'Europe/Bucharest') ? 'admin_digest',
  'run at 08:00');


rollback;
