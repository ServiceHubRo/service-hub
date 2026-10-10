-- Fișa mașinii (T27): the shop sees its own jobs on a car; other shops' jobs only with the client's
-- agreement on an active booking for that car, and then without price or shop. Only the client
-- changes the agreement; only the shop's members read the file.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

-- Ana's Golf (BV 12 ABC) at Atelier Doi, earlier: a finished job with an accepted quote.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot,
                             status, work, cost, odometer, done_at)
values (test.id('shop2'), test.id('client_a'), 'frane', 'Ana Marin',
        '{"make":"Volkswagen","model":"Golf 7","plate":"BV-12-ABC","plate_norm":"BV12ABC"}',
        current_date - 40, '09:00', 'done', 'Plăcuțe față', 520, 101000, now() - interval '40 days');
insert into public.quotes (booking_id, version, status, inspection_fee, total_sent, total_approved, sent_by)
select b.id, 1, 'partially_accepted', 0, 700, 520, test.id('owner2')
from public.bookings b where b.shop_id = test.id('shop2') and b.client_id = test.id('client_a');
insert into public.quote_items (quote_id, position, name, price, approved)
select q.id, x.pos, x.name, x.price, x.ok
from public.quotes q join public.bookings b on b.id = q.booking_id
cross join (values (1, 'Plăcuțe frână față', 520, true), (2, 'Discuri frână', 180, false)) as x(pos, name, price, ok)
where b.shop_id = test.id('shop2') and b.client_id = test.id('client_a');
-- The same plate under Bogdan's account at Atelier Doi: never part of Ana's car.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot,
                             status, work, cost, odometer, done_at)
values (test.id('shop2'), test.id('client_b'), 'ulei', 'Bogdan Pop',
        '{"make":"Volkswagen","model":"Golf 7","plate":"BV 12 ABC","plate_norm":"BV12ABC"}',
        current_date - 60, '09:00', 'done', 'Alt proprietar', 300, 90000, now() - interval '60 days');

-- ------------------------------------------------------------------ booking with the switch off
-- Ana turned "Istoricul mașinii pentru service-uri" off in Cont (on by default since 10 Oct,
-- tests/sql/122_history_by_default.sql).
update public.profiles set share_history = false where id = test.id('client_a');
select test.login(test.id('client_a'));
select set_config('test.b1', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'frane',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.fails(format('update public.bookings set share_history = true where id = %L', current_setting('test.b1')),
  'permission denied', 'the browser cannot write the agreement');
select test.fails(format('select public.shop_vehicle_file(%L)', current_setting('test.b1')),
  'booking_not_found', 'a client does not read a shop''s file');
select test.logout();
select test.eq(share_history, false, 'off unless ticked') from public.bookings where id = current_setting('test.b1')::uuid;
select test.eq(share_history_at, null::timestamptz, 'no consent time') from public.bookings where id = current_setting('test.b1')::uuid;

select test.login(test.id('owner1'));
select set_config('test.file', public.shop_vehicle_file(current_setting('test.b1')::uuid)::text, true);
select test.logout();
select test.eq(current_setting('test.file')::jsonb->>'share', 'not_shared', 'the shop sees that it is not shared');
select test.eq(jsonb_array_length(current_setting('test.file')::jsonb->'others'), 0, 'and nothing from other shops');
select test.eq(jsonb_array_length(current_setting('test.file')::jsonb->'own'), 1, 'its own job on the car');
select test.eq((current_setting('test.file')::jsonb->'own'->0->>'cost')::numeric, 340::numeric, 'with its amount');
select test.eq(current_setting('test.file')::jsonb->'own'->0->'items', '["Ulei 5W30", "Manoperă"]'::jsonb, 'and the accepted lines');
select test.eq((current_setting('test.file')::jsonb->'own'->0->>'odometer')::int, 105400, 'and the odometer');

-- ------------------------------------------------------------------ the client agrees later
select test.login(test.id('client_b'));
select test.fails(format('select public.set_booking_history_share(%L, true, gen_random_uuid())', current_setting('test.b1')),
  'booking_not_found', 'another client cannot share it');
select test.logout();
select test.login(test.id('owner1'));
select test.fails(format('select public.set_booking_history_share(%L, true, gen_random_uuid())', current_setting('test.b1')),
  'booking_not_found', 'nor can the shop');
select test.logout();

select set_config('test.rid', gen_random_uuid()::text, true);
select test.login(test.id('client_a'));
select test.eq((public.set_booking_history_share(current_setting('test.b1')::uuid, true, current_setting('test.rid')::uuid)).share_history,
  true, 'the client turns it on');
select test.eq((public.set_booking_history_share(current_setting('test.b1')::uuid, true, current_setting('test.rid')::uuid)).share_history,
  true, 'the same request twice answers the first result');
select test.fails(format('select public.set_booking_history_share(%L, null, gen_random_uuid())', current_setting('test.b1')),
  'field_invalid', 'yes or no');
select test.logout();
select test.ok(share_history_at is not null, 'the consent time is kept') from public.bookings where id = current_setting('test.b1')::uuid;

select test.login(test.id('staff1'));
select set_config('test.file', public.shop_vehicle_file(current_setting('test.b1')::uuid)::text, true);
select test.eq((public.list_shop_bookings()->'bookings'->0->>'share_history')::boolean, true, 'the booking card knows it');
select test.logout();
select test.eq(current_setting('test.file')::jsonb->>'share', 'shared', 'a colleague sees it shared');
select test.eq(jsonb_array_length(current_setting('test.file')::jsonb->'others'), 1, 'only Ana''s job at the other shop');
select test.eq(current_setting('test.file')::jsonb->'others'->0->>'work', 'Plăcuțe față', 'what was done');
select test.eq((current_setting('test.file')::jsonb->'others'->0->>'odometer')::int, 101000, 'at how many km');
select test.eq(current_setting('test.file')::jsonb->'others'->0->'items', '["Plăcuțe frână față"]'::jsonb,
  'only the accepted lines');
select test.ok(not (current_setting('test.file')::jsonb->'others'->0 ?| array['cost', 'shop_id', 'shop_name', 'shop_city', 'ref', 'client_name']),
  'no price, no shop, no booking code');
select test.ok(position('520' in current_setting('test.file')::jsonb->>'others') = 0, 'the price appears nowhere');
select test.ok(position('Atelier Doi' in current_setting('test.file')::jsonb->>'others') = 0, 'nor the other shop''s name');

select test.login(test.id('owner2'));
select test.fails(format('select public.shop_vehicle_file(%L)', current_setting('test.b1')),
  'booking_not_found', 'another shop cannot read this file');
select test.logout();
select test.login_anon();
select test.fails(format('select public.shop_vehicle_file(%L)', current_setting('test.b1')),
  'permission denied', 'signed in only');
select test.logout();

-- The file opened from the old finished job shows the same while the new booking is open.
select test.login(test.id('owner1'));
select test.eq(public.shop_vehicle_file((select id from public.bookings where shop_id = test.id('shop1')
  and client_id = test.id('client_a') and status = 'done'))->>'share', 'shared', 'from Istoric too, while a booking is open');
select test.logout();

-- ------------------------------------------------------------------ turned off, or the booking ends
select test.login(test.id('client_a'));
select test.eq((public.set_booking_history_share(current_setting('test.b1')::uuid, false, gen_random_uuid())).share_history,
  false, 'the client turns it off');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(jsonb_array_length(public.shop_vehicle_file(current_setting('test.b1')::uuid)->'others'), 0, 'off: hidden again');
select test.logout();

select test.login(test.id('client_a'));
select public.set_booking_history_share(current_setting('test.b1')::uuid, true, gen_random_uuid());
select public.cancel_booking(current_setting('test.b1')::uuid, gen_random_uuid());
select test.fails(format('select public.set_booking_history_share(%L, false, gen_random_uuid())', current_setting('test.b1')),
  'wrong_status', 'a finished booking has nothing to change');
select test.logout();
select test.login(test.id('owner1'));
select set_config('test.file', public.shop_vehicle_file(current_setting('test.b1')::uuid)::text, true);
select test.logout();
select test.eq(current_setting('test.file')::jsonb->>'share', 'no_active', 'no open booking with this client');
select test.eq(jsonb_array_length(current_setting('test.file')::jsonb->'others'), 0, 'so other shops'' jobs are hidden');
select test.eq(jsonb_array_length(current_setting('test.file')::jsonb->'own'), 1, 'its own jobs stay');

-- ------------------------------------------------------------------ the switch on again: a new booking follows it
update public.profiles set share_history = true where id = test.id('client_a');
select test.login(test.id('client_a'));
select set_config('test.b2', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '10:00', p_request_id => gen_random_uuid(),
  p_car => '{"make":"Volkswagen","model":"Golf 7","plate":"bv12abc"}', p_share_history => true)).id::text, true);
select test.logout();
select test.eq(share_history, true, 'ticked when booking') from public.bookings where id = current_setting('test.b2')::uuid;
select test.ok(share_history_at is not null, 'with its time') from public.bookings where id = current_setting('test.b2')::uuid;
select test.login(test.id('owner1'));
select test.eq(jsonb_array_length(public.shop_vehicle_file(current_setting('test.b2')::uuid)->'others'), 1,
  'the plate typed differently is the same car');
select test.logout();

-- A car without a plate: a shop's own jobs come only from the same client (make + model + year is
-- not a car's identity across owners).
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, done_at)
values (test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{"make":"Dacia","model":"Logan","year":2015}',
        current_date - 5, '09:00', 'done', now() - interval '5 days'),
       (test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', '{"make":"Dacia","model":"Logan","year":2015}',
        current_date - 3, '09:00', 'done', now() - interval '3 days');
select test.login(test.id('owner1'));
select test.eq(jsonb_array_length(public.shop_vehicle_file((select id from public.bookings where shop_id = test.id('shop1')
  and client_id = test.id('client_a') and car_snapshot->>'make' = 'Dacia'))->'own'), 1, 'no plate: only the same client''s jobs');
select test.logout();


rollback;
