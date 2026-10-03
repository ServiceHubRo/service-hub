-- Loyal clients (T28c): levels from finished jobs, the shop's choice, the percent kept on the
-- booking, never added to a new-client offer, never changed afterwards.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

-- ------------------------------------------------------------------ the shop's choice
select test.login(test.id('owner1'));
select test.fails(format('update public.shops set loyalty_l1 = 7 where id = %L', test.id('shop1')), 'check', '5 or 10 only');
select test.fails(format('update public.shops set loyalty_l1 = 10, loyalty_l2 = 5 where id = %L', test.id('shop1')), 'shops_loyalty_order',
  'level 2 never gets less than level 1');
update public.shops set loyalty_l1 = 5, loyalty_l2 = 10 where id = test.id('shop1');
select test.logout();
select test.login(test.id('staff1'));
update public.shops set loyalty_l1 = null where id = test.id('shop1');
select test.logout();
select test.eq(loyalty_l1, 5::smallint, 'only the owner sets it') from public.shops where id = test.id('shop1');

-- ------------------------------------------------------------------ levels
-- Ana has 1 finished job (fixture): no level yet.
select test.login(test.id('client_a'));
select test.eq((public.my_loyalty()->>'level')::int, 0, 'one job: no level');
select test.eq((public.my_loyalty()->>'jobs_to_next')::int, 1, 'one more to level 1');
select test.logout();
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, done_at)
values (test.id('shop1'), test.id('client_a'), 'frane', 'Ana Marin', '{}', current_date - 30, '10:00', 'done', now() - interval '30 days');
-- An old job (over 24 months) does not count.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, done_at)
values (test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', '{}', current_date - 800, '10:00', 'done', now() - interval '800 days');
select test.login(test.id('client_a'));
select test.eq((public.my_loyalty()->>'level')::int, 1, 'two jobs in 24 months: level 1');
select test.eq((public.my_loyalty()->>'jobs_to_next')::int, 3, 'three more to level 2');
select test.eq((public.get_shop_page(test.id('shop1'))->'loyalty'->>'yours')::int, 5, 'the shop page shows her percent');
select test.eq((select loyalty from public.search_card_extras(array[test.id('shop1')])), 5::smallint, 'and the card');
select test.eq((select loyalty_offered from public.search_card_extras(array[test.id('shop1')])), true, 'the shop takes part');

-- A booking keeps the percent promised.
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.logout();
select test.eq(loyalty_percent, 5::smallint, 'promised 5%') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(loyalty_level, 1::smallint, 'at level 1') from public.bookings where id = current_setting('test.b')::uuid;
select test.login(test.id('owner1'));
select test.eq((public.list_shop_bookings()->'bookings'->0->>'loyalty_percent')::int, 5, 'the shop sees the promise');
-- The shop changes its mind: the promise made stays.
update public.shops set loyalty_l1 = null, loyalty_l2 = null where id = test.id('shop1');
select test.logout();
select test.eq(loyalty_percent, 5::smallint, 'a later change keeps the promise') from public.bookings where id = current_setting('test.b')::uuid;
select test.login(test.id('client_a'));
select test.fails(format('update public.bookings set loyalty_percent = 50 where id = %L', current_setting('test.b')), 'permission denied',
  'the browser cannot write it');
select test.logout();

-- A new client at a shop with both: the new-client offer wins, they never add up.
update public.shops set new_client_offer = 20, loyalty_l1 = 10 where id = test.id('shop2');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), test.id('client_a'), 'ulei', 'Ana Marin', '{"plate_norm":"BV12ABC"}', test.workday(3), '09:00', 'pending')
returning id as b3 \gset
select test.eq(offer_percent::int, 20, 'new here: the offer') from public.bookings where id = :'b3';
select test.eq(loyalty_percent, null::smallint, 'and not the loyalty discount on top') from public.bookings where id = :'b3';
-- Once she is no longer new there, the loyalty discount applies.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), test.id('client_a'), 'ulei', 'Ana Marin', '{"plate_norm":"BV12ABC"}', test.workday(4), '09:00', 'pending')
returning id as b4 \gset
select test.eq(offer_percent::int, null::int, 'no longer new') from public.bookings where id = :'b4';
select test.eq(loyalty_percent, 10::smallint, 'so the loyalty discount') from public.bookings where id = :'b4';

select test.eq(public.loyalty_level_for(4), 1, '4 jobs: level 1');
select test.eq(public.loyalty_level_for(5), 2, '5 jobs: level 2');
select test.eq(public.loyalty_percent_at(5::smallint, null, 2), 5::smallint, 'level 2 falls back to level 1''s percent');

select test.login_anon();
select test.fails('select public.my_loyalty()', 'permission denied', 'signed in only');
select test.logout();

select test.eq((select version from public.schema_version), 53, 'schema 53');

rollback;
