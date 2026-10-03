-- Instant confirmation and free places (T28a): a shop may confirm free places at once (never for a
-- client with a recent no-show), and the search cards read whether it does and its first free place.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

-- ------------------------------------------------------------------ who may switch it on
select test.login(test.id('client_a'));
update public.shops set auto_confirm = true where id = test.id('shop1');
select test.logout();
select test.eq(auto_confirm, false, 'a client cannot switch it on') from public.shops where id = test.id('shop1');
select test.login(test.id('staff1'));
update public.shops set auto_confirm = true where id = test.id('shop1');
select test.logout();
select test.eq(auto_confirm, false, 'nor a colleague') from public.shops where id = test.id('shop1');

-- Off (the default): a request waits for the shop, as before.
select test.login(test.id('client_a'));
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).status, 'pending', 'off: a request');
select test.logout();

select test.login(test.id('owner1'));
update public.shops set auto_confirm = true where id = test.id('shop1');
select test.logout();
select test.eq(auto_confirm, true, 'the owner switches it on') from public.shops where id = test.id('shop1');

-- ------------------------------------------------------------------ on: confirmed at once
select set_config('test.rid', gen_random_uuid()::text, true);
select test.login(test.id('client_a'));
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '10:00', p_request_id => current_setting('test.rid')::uuid,
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '10:00', p_request_id => current_setting('test.rid')::uuid,
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).status, 'confirmed',
  'the same request twice answers the confirmed booking');
select test.logout();
select test.eq(status, 'confirmed', 'confirmed at once') from public.bookings where id = current_setting('test.b')::uuid;
select test.ok(confirmed_at is not null, 'with its time') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq((select count(*) from public.bookings where client_id = test.id('client_a') and slot = '10:00' and date = current_setting('test.day')::date), 1::bigint,
  'one booking');
select test.eq((select array_agg(event order by created_at, event) from public.messages
                where booking_id = current_setting('test.b')::uuid), array['booking_auto_confirmed', 'booking_requested'],
  'the conversation says it was asked and confirmed');
select test.eq((select (params->>'auto')::boolean from public.notification_events
                where user_id = test.id('client_a') and event = 'booking_confirmed'
                  and booking_id = current_setting('test.b')::uuid), true, 'the client is told it is confirmed');
select test.eq((select count(*) from public.notification_events
                where booking_id = current_setting('test.b')::uuid and event = 'booking_auto_confirmed'), 2::bigint,
  'every member is told it came in confirmed');
select test.eq((select count(*) from public.notification_events
                where booking_id = current_setting('test.b')::uuid and event = 'booking_requested'), 0::bigint,
  'not as a request to answer');

-- A client with a no-show in the last 90 days: the request waits for the shop.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', current_date - 5, '09:00', 'no_show');
select test.login(test.id('client_b'));
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '11:00', p_request_id => gen_random_uuid(),
  p_car => '{"make":"Dacia","model":"Logan"}')).status, 'pending', 'a recent no-show: a request, as before');
select test.logout();

-- The places stay counted: a full day refuses as before.
update public.shops set daily_capacity = 3 where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.fails(format($f$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L,
  p_slot => '12:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Ford","model":"Focus"}')$f$,
  test.id('shop1'), current_setting('test.day')), 'day_full', 'a full day stays full');
select test.logout();

-- ------------------------------------------------------------------ the search cards
select test.login(test.id('client_a'));
select test.eq((select auto_confirm from public.search_card_extras(array[test.id('shop1')])), true, 'confirms at once');
select test.ok((select free_date from public.search_card_extras(array[test.id('shop1')])) is not null, 'a first free place');
select test.eq((select free_date from public.search_card_extras(array[test.id('shop1')], current_setting('test.day')::date)),
  null::date, 'none on a full day');
select test.eq((select free_date from public.search_card_extras(array[test.id('shop1')], test.saturday())), null::date,
  'none on a closed day');
select test.eq((select free_date from public.search_card_extras(array[test.id('shop1')], test.workday(3))), test.workday(3),
  'that day');
select test.eq((select free_slot from public.search_card_extras(array[test.id('shop1')], test.workday(3))), '08:00',
  'its first time');
select test.eq((select count(*) from public.search_card_extras(array[test.id('shop2')])), 0::bigint,
  'a shop that is not public is not answered');
select test.eq((public.get_shop_page(test.id('shop1'))->'shop'->>'auto_confirm')::boolean, true, 'the shop page knows');
select test.logout();

-- A slot already taken is skipped; a booking at 08:00 moves the first free place to 08:30 or later.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', test.workday(3), '08:00', 'confirmed');
select test.login(test.id('client_a'));
select test.ok((select free_slot from public.search_card_extras(array[test.id('shop1')], test.workday(3))) > '08:00',
  'a taken time is skipped');
select test.logout();

select test.login_anon();
select test.fails('select * from public.search_card_extras(array[gen_random_uuid()])', 'permission denied', 'signed in only');
select test.logout();


rollback;
