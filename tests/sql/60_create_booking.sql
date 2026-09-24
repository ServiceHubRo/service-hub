-- create_booking (ARCHITECTURE §3, §4, §5): snapshots, thread message, outbox event, idempotency,
-- and every refusal — including a booking in the past sent straight to the database.
begin;
select test.make_world();
select set_config('test.day1', test.workday(1)::text, true);
select set_config('test.day2', test.workday(2)::text, true);
-- Abuse limits have their own test (65); keep them out of the way here.
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';

-- ------------------------------------------------------------------ success, snapshots, side effects
select set_config('test.rid1', test.rid()::text, true);
select test.login(test.id('client_a'));
select set_config('test.b1', (public.create_booking(
  p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day1')::date,
  p_slot => '10:00', p_request_id => current_setting('test.rid1')::uuid, p_car_id => test.id('car_a'),
  p_note => '  Aș vrea și lichidele.  ')).id::text, true);
select test.logout();

select test.eq(status, 'pending', 'new booking is pending'),
       test.eq(client_id, test.id('client_a'), 'booked for the caller'),
       test.eq(client_name, 'Ana Marin', 'client name snapshot'),
       test.eq(client_phone, '0723000001', 'client phone snapshot'),
       test.eq(client_lang, 'ro', 'client language snapshot'),
       test.eq(car_id, test.id('car_a'), 'car id kept'),
       test.eq(car_snapshot->>'make', 'Volkswagen', 'car make snapshot'),
       test.eq(car_snapshot->>'plate', 'BV 12 ABC', 'plate snapshot as typed'),
       test.eq(car_snapshot->>'plate_norm', 'BV12ABC', 'normalized plate snapshot'),
       test.eq(car_snapshot->>'vin', 'WVWZZZAUZGW123456', 'VIN snapshot'),
       test.eq(note, 'Aș vrea și lichidele.', 'note trimmed'),
       test.ok(ref ~ '^P-\d{6}$', 'human reference P-000123')
from public.bookings where id = current_setting('test.b1')::uuid;

select test.eq(count(*), 1::bigint, 'one automatic message in the existing thread'),
       test.eq(min(m.params->>'by'), 'client', 'message says who caused it'),
       test.eq(min(t.id::text), test.id('thread_a')::text, 'reuses the pair''s thread')
from public.messages m join public.threads t on t.id = m.thread_id
where m.booking_id = current_setting('test.b1')::uuid and m.kind = 'system' and m.event = 'booking_requested';

select test.eq(array_agg(user_id order by user_id),
               (select array_agg(u order by u) from unnest(array[test.id('owner1'), test.id('staff1')]) u),
               'booking_requested goes to every member of the shop'),
       test.eq(bool_and(channels = array['push']), true, 'push only while SMS is off'),
       test.eq(min(params->>'shop_name'), 'Atelier Unu', 'event carries what the dispatcher needs')
from (select * from public.notification_events
      where booking_id = current_setting('test.b1')::uuid and event = 'booking_requested'
      order by user_id) e;

-- Editing or deleting the car never changes the booking.
update public.cars set make = 'Skoda', plate = 'BV 99 XYZ' where id = test.id('car_a');
select test.eq(car_snapshot->>'make', 'Volkswagen', 'car edit leaves the snapshot') from public.bookings
where id = current_setting('test.b1')::uuid;
delete from public.cars where id = test.id('car_a');
select test.eq(car_id, null, 'deleted car: link cleared'),
       test.eq(car_snapshot->>'plate', 'BV 12 ABC', 'deleted car: snapshot kept')
from public.bookings where id = current_setting('test.b1')::uuid;

-- Client B cannot see A's booking; the shop can.
select test.login(test.id('client_b'));
select test.eq(test.count(format('select 1 from public.bookings where id = %L', current_setting('test.b1'))), 0::bigint,
  'another client cannot see the booking');
select test.logout();
select test.login(test.id('staff1'));
select test.eq(test.count(format('select 1 from public.bookings where id = %L', current_setting('test.b1'))), 1::bigint,
  'shop staff sees the booking');
select test.logout();

-- ------------------------------------------------------------------ idempotency (CLAUDE.md §6.7)
select test.login(test.id('client_a'));
select test.eq((public.create_booking(
  p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => current_setting('test.day1')::date,
  p_slot => '10:00', p_request_id => current_setting('test.rid1')::uuid,
  p_car => '{"make":"Dacia","model":"Logan"}')).id::text, current_setting('test.b1'),
  'same request id returns the first booking');
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1)->'days'->0->>'places_left',
  '4', 'the replay did not book a second place');
select test.fails(format($$select public.confirm_booking(%L, %L)$$, current_setting('test.b1'), current_setting('test.rid1')),
  'request_id_reused', 'a request id cannot be reused for another function');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00', p_request_id => null, p_car_id => null, p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'request_id_required', 'request id is mandatory');
select test.logout();
select test.eq(count(*), 1::bigint, 'replay wrote no second message') from public.messages
where booking_id = current_setting('test.b1')::uuid;
select test.eq(count(*), 2::bigint, 'replay wrote no second event') from public.notification_events
where booking_id = current_setting('test.b1')::uuid;

select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '11:00', p_request_id => %L, p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1'), current_setting('test.rid1')),
  'request_id_reused', 'another user cannot replay someone else''s request id');
select test.logout();

-- A failed call does not burn its request id: the retry runs normally.
select set_config('test.rid2', test.rid()::text, true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '10:00', p_request_id => %L, p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1'), current_setting('test.rid2')), 'slot_full', 'taken slot refused');
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day1')::date, p_slot => '11:00', p_request_id => current_setting('test.rid2')::uuid,
  p_car => '{"make":"Dacia","model":"Logan"}')).status, 'pending', 'retry with the same id after a refusal works');
select test.logout();

-- ------------------------------------------------------------------ cars
select test.login(test.id('client_b'));
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'frane',
  p_date => current_setting('test.day1')::date, p_slot => '12:00', p_request_id => gen_random_uuid(),
  p_car => '{"make":" Audi ","model":"A4","year":"2018","plate":"B-123-XYZ","vin":"wauzzz8k9ba012345"}',
  p_save_car => true)).car_snapshot->>'plate_norm', 'B123XYZ', 'typed car snapshot with normalized plate');
select test.eq(count(*), 1::bigint, 'save_car put the typed car in the garage')
from public.cars where owner_id = auth.uid() and make = 'Audi' and vin = 'WAUZZZ8K9BA012345';
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'frane',
  p_date => current_setting('test.day1')::date, p_slot => '13:00', p_request_id => gen_random_uuid(),
  p_car => '{"make":"Opel","model":"Astra"}')).car_id, null, 'unsaved typed car has no car id');
select test.eq(count(*), 0::bigint, 'save_car false keeps the garage unchanged')
from public.cars where owner_id = auth.uid() and make = 'Opel';
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car_id => %L)$$,
  test.id('shop1'), current_setting('test.day2'), test.id('car_a')), 'car_not_found', 'cannot book with another client''s car');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid())$$,
  test.id('shop1'), current_setting('test.day2')), 'car_required', 'a car is required');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'car_required', 'make and model are required');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan","vin":"WVWZZZAUZGW12345O"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'car_vin_invalid', 'VIN with the letter O refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan","year":"19"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'car_year_invalid', 'bad year refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}', p_note => repeat('x', 1001))$$,
  test.id('shop1'), current_setting('test.day2')), 'note_too_long', 'note up to 1000 characters');
select test.logout();

-- ------------------------------------------------------------------ never in the past (§4)
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => test.today() - 1, p_slot => '10:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1')), 'past_slot', 'a past day is refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => test.today(), p_slot => '00:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1')), 'past_slot', 'today at an hour that has passed is refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => test.today(), p_slot => (now() at time zone 'Europe/Bucharest')::time(0) - interval '1 minute', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1')), 'past_slot', 'today, one minute ago, is refused');
select test.logout();

-- Straight into the table, not through the app: the trigger refuses it for every role.
select test.fails(format($$insert into public.bookings (shop_id, client_id, service_id, date, slot) values (%L, %L, 'ulei', test.today() - 1, '10:00')$$,
  test.id('shop1'), test.id('client_b')), 'past_slot', 'direct insert in the past refused (SQL editor)');
set local role service_role;
select test.fails(format($$insert into public.bookings (shop_id, client_id, service_id, date, slot) values (%L, %L, 'ulei', test.today(), '00:00')$$,
  test.id('shop1'), test.id('client_b')), 'past_slot', 'direct insert earlier today refused (service role)');
reset role;
select test.fails(format($$update public.bookings set date = test.today() - 1 where id = %L$$, current_setting('test.b1')),
  'past_slot', 'moving a booking into the past directly is refused');
-- Old finished jobs are history, not bookings in the past: they load freely.
insert into public.bookings (shop_id, client_id, service_id, date, slot, status)
values (test.id('shop1'), test.id('client_b'), 'ulei', test.today() - 400, '10:00', 'done');

-- ------------------------------------------------------------------ shop rules (§4)
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '10:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), test.saturday()), 'shop_closed', 'closed weekday refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '10:30', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'invalid_slot', 'time off the hourly grid refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '07:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'invalid_slot', 'before opening refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '18:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'invalid_slot', 'a slot must end by closing time');
select test.eq(test.error_of(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '17:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day2'))), 'ok', 'last slot of the day (17:00–18:00) accepted');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => test.today() + 31, p_slot => '10:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1')), 'too_far', 'beyond max_advance_days refused');
select test.logout();

update public.shops set min_notice_hours = 168 where id = test.id('shop1');
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '09:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'too_soon', 'inside the minimum notice refused');
select test.eq(test.error_params(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '09:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')))->>'hours', '168', 'too_soon names the notice');
select test.logout();
update public.shops set min_notice_hours = 2 where id = test.id('shop1');

insert into public.shop_closures (shop_id, start_date, end_date, label)
values (test.id('shop1'), current_setting('test.day2')::date, current_setting('test.day2')::date + 2, 'Concediu');
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '09:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day2')), 'shop_closed', 'holiday refused');
-- Services and shops.
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'itp', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'service_unavailable', 'service the shop does not offer refused');
select test.logout();
update public.services set enabled = false where id = 'frane';
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'frane', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'service_unavailable', 'disabled service refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop2'), current_setting('test.day1')), 'shop_unavailable', 'a shop that is not public cannot be booked');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  gen_random_uuid(), current_setting('test.day1')), 'shop_not_found', 'unknown shop');
select test.logout();
update public.services set enabled = true where id = 'frane';

-- ------------------------------------------------------------------ who may book
select set_config('test.new_client', test.sign_up('nou@test.local', '{"role":"client","name":"Nou"}', false)::text, true);
select test.login(current_setting('test.new_client')::uuid);
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'email_not_verified', 'unconfirmed email cannot book');
select test.logout();
select test.login(test.id('owner2'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'not_allowed', 'a shop account cannot book');
select test.logout();
update public.profiles set suspended = true where id = test.id('client_b');
select test.login(test.id('client_b'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'account_suspended', 'a suspended client cannot book');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'permission denied', 'signed-out visitors cannot call it');
select test.logout();

rollback;
