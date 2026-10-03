-- A request the shop has not answered is not forgotten until its time (Eduard, 3 oct): a reminder
-- every morning, and a last call 3 hours before its time (or the evening before, for a morning time).
begin;
select test.make_world();

-- Bogdan's request at Atelier Doi (fixture): pending, 3 days ahead at 09:00, made two days ago.
select set_config('test.req', (select id::text from public.bookings where shop_id = test.id('shop2') and status = 'pending'), true);
update public.bookings set created_at = now() - interval '2 days' where id = current_setting('test.req')::uuid;
select set_config('test.day', (select date::text from public.bookings where id = current_setting('test.req')::uuid), true);

-- A local time in Bucharest, `d` days before the request's day.
create temp table bucharest(d int, h time, t timestamptz);
insert into bucharest
select d, h, ((current_setting('test.day')::date - d) + h) at time zone 'Europe/Bucharest'
from generate_series(0, 2) d, unnest(array[time '09:05', time '17:30', time '18:10']) h;

-- ------------------------------------------------------------------ every morning
select test.eq(public.send_request_daily_reminders((select t from bucharest where d = 2 and h = '09:05')), 1,
  'the morning two days before');
select test.eq(public.send_request_daily_reminders((select t from bucharest where d = 2 and h = '17:30')), 0,
  'once a day');
select test.eq(public.send_request_daily_reminders((select t from bucharest where d = 1 and h = '09:05')), 1,
  'and again the next morning');
select test.eq(public.send_request_daily_reminders((select t from bucharest where d = 0 and h = '09:05')), 0,
  'not once its time has passed');
select test.eq((select count(*) from public.notification_events
                where user_id = test.id('owner2') and event = 'booking_request_waiting'
                  and booking_id = current_setting('test.req')::uuid), 2::bigint, 'two mornings, two reminders');

-- A request made in the night is covered by its first reminder: no morning one before 12 hours.
update public.bookings set created_at = (select t from bucharest where d = 1 and h = '09:05') - interval '3 hours'
where id = current_setting('test.req')::uuid;
delete from public.engagement_log where kind = 'request_daily';
select test.eq(public.send_request_daily_reminders((select t from bucharest where d = 1 and h = '09:05')), 0,
  'not for a request younger than 12 hours');
update public.bookings set created_at = now() - interval '2 days' where id = current_setting('test.req')::uuid;

-- ------------------------------------------------------------------ the last call
-- 09:00 is a morning time: the last call comes at 18:xx the evening before, never in the night.
select test.eq(public.send_request_last_calls((select t from bucharest where d = 2 and h = '18:10')), 0,
  'not two evenings before');
select test.eq(public.send_request_last_calls((select t from bucharest where d = 1 and h = '17:30')), 0,
  'not before 18:00');
select test.eq(public.send_request_last_calls((select t from bucharest where d = 1 and h = '18:10')), 1,
  'the evening before');
select test.eq(public.send_request_last_calls((select t from bucharest where d = 0 and h = '09:05') - interval '2 hours'), 0,
  'only once');
select test.eq((select channels from public.notification_events
                where user_id = test.id('owner2') and event = 'booking_request_last_call'), array['push', 'email'],
  'to the owner by push and email');

-- An afternoon time: 3 hours before.
select test.login(test.id('client_a'));
select set_config('test.pm', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => test.workday(2), p_slot => '15:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.logout();
select set_config('test.pm_at', public.slot_starts_at(test.workday(2), '15:00')::text, true);
select test.eq(public.send_request_last_calls(current_setting('test.pm_at')::timestamptz - interval '3 hours 30 minutes'), 0,
  'not 3 and a half hours before');
select test.eq(public.send_request_last_calls(current_setting('test.pm_at')::timestamptz - interval '2 hours 50 minutes'), 1,
  '3 hours before');
select test.eq((select count(*) from public.notification_events
                where booking_id = current_setting('test.pm')::uuid and event = 'booking_request_last_call'), 2::bigint,
  'to every member (owner and colleague)');

-- An answered request gets nothing more.
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.pm')::uuid, gen_random_uuid());
select test.logout();
delete from public.engagement_log where kind in ('request_daily', 'request_last_call');
select public.send_request_daily_reminders(current_setting('test.pm_at')::timestamptz - interval '5 hours');
select test.eq((select count(*) from public.notification_events
                where booking_id = current_setting('test.pm')::uuid and event = 'booking_request_waiting'), 0::bigint,
  'a confirmed booking gets no morning reminder');
select test.eq(public.send_request_last_calls(current_setting('test.pm_at')::timestamptz - interval '2 hours'), 0,
  'a confirmed booking gets no last call');

-- The jobs run them; the browser cannot.
select test.ok(public.run_quote_jobs(now()) ? 'requests_last_call', 'every 15 minutes');
select test.ok(public.run_hourly_jobs((select t from bucharest where d = 1 and h = '09:05')) ? 'requests_daily', 'at 09:00');
select test.ok(not (public.run_hourly_jobs((select t from bucharest where d = 1 and h = '17:30')) ? 'requests_daily'),
  'only at 09:00');
select test.login(test.id('owner1'));
select test.fails('select public.send_request_daily_reminders(now())', 'permission denied', 'no API access');
select test.fails('select public.send_request_last_calls(now())', 'permission denied', 'no API access (last call)');
select test.logout();


rollback;
