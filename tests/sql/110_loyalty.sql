-- Loyal clients (T28c): levels from finished jobs, the shop's choice, the percent kept on the
-- booking, never added to a new-client offer, never changed afterwards.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

-- ------------------------------------------------------------------ the shop's choice
select test.login(test.id('owner1'));
select test.fails(format('update public.shops set loyalty_l1 = 10 where id = %L', test.id('shop1')), 'check', '3 or 5 only');
select test.fails(format('update public.shops set loyalty_l2 = 10 where id = %L', test.id('shop1')), 'check', 'level 2: 5 or 7 only');
select test.fails(format('update public.shops set loyalty_l1 = 3, loyalty_l2 = 3 where id = %L', test.id('shop1')), 'check',
  'level 2 starts at 5');
update public.shops set loyalty_l1 = 3, loyalty_l2 = 7 where id = test.id('shop1');
select test.logout();
select test.login(test.id('staff1'));
update public.shops set loyalty_l1 = null where id = test.id('shop1');
select test.logout();
select test.eq(loyalty_l1, 3::smallint, 'only the owner sets it') from public.shops where id = test.id('shop1');

-- ------------------------------------------------------------------ levels, per shop
-- Ana has 1 finished job at shop1 (fixture): no level there yet.
select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.my_loyalty()->'shops'), 1, 'one shop with jobs');
select test.eq((public.my_loyalty()->'shops'->0->>'level')::int, 0, 'one job: no level');
select test.eq((public.my_loyalty()->'shops'->0->>'jobs_to_next')::int, 2, 'two more to level 1');
select test.eq((public.get_shop_page(test.id('shop1'))->'loyalty'->>'jobs')::int, 1, 'the page counts her jobs there');
select test.logout();
-- One more at shop1, an old one (over 24 months) and three at shop2: only shop1's recent jobs count there.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, done_at)
values (test.id('shop1'), test.id('client_a'), 'frane', 'Ana Marin', '{}', current_date - 30, '10:00', 'done', now() - interval '31 days', now() - interval '30 days'),
       (test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', '{}', current_date - 800, '10:00', 'done', now() - interval '801 days', now() - interval '800 days');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, done_at)
select test.id('shop2'), test.id('client_a'), 'ulei', 'Ana Marin', '{}', current_date - 40 - i, '10:00', 'done',
       now() - make_interval(days => 41 + i), now() - make_interval(days => 40 + i)
from generate_series(1, 3) i;
select test.login(test.id('client_a'));
select test.eq((select (x->>'level')::int from jsonb_array_elements(public.my_loyalty()->'shops') x
                where x->>'shop_id' = test.id('shop1')::text), 0, 'two jobs at shop1: still no level there');
select test.eq((select loyalty from public.search_card_extras(array[test.id('shop1')])), null::smallint,
  'jobs at another shop do not count');
select test.eq((select (x->>'level')::int from jsonb_array_elements(public.my_loyalty()->'shops') x
                where x->>'shop_id' = test.id('shop2')::text), 1, 'three jobs at shop2: level 1 there');
select test.eq((select x->>'percent' from jsonb_array_elements(public.my_loyalty()->'shops') x
                where x->>'shop_id' = test.id('shop2')::text), null::text, 'shop2 gives no discount');
select test.logout();
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, done_at)
values (test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', '{}', current_date - 50, '10:00', 'done', now() - interval '51 days', now() - interval '50 days');
select test.login(test.id('client_a'));
select test.eq((select (x->>'level')::int from jsonb_array_elements(public.my_loyalty()->'shops') x
                where x->>'shop_id' = test.id('shop1')::text), 1, 'the third job at shop1: level 1');
select test.eq((select (x->>'jobs_to_next')::int from jsonb_array_elements(public.my_loyalty()->'shops') x
                where x->>'shop_id' = test.id('shop1')::text), 3, 'three more to level 2');
select test.eq((public.get_shop_page(test.id('shop1'))->'loyalty'->>'yours')::int, 3, 'the shop page shows her percent');
select test.eq((select loyalty from public.search_card_extras(array[test.id('shop1')])), 3::smallint, 'and the card');
select test.eq((select loyalty_offered from public.search_card_extras(array[test.id('shop1')])), true, 'the shop takes part');
select test.eq((public.my_loyalty()->>'offering')::int, 1, 'one shop gives loyalty discounts');
select test.logout();
select test.login(test.id('client_b'));
select test.eq((select loyalty from public.search_card_extras(array[test.id('shop1')])), null::smallint, 'not for another client');
select test.logout();

-- A booking keeps the percent promised.
select test.login(test.id('client_a'));
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.logout();
select test.eq(loyalty_percent, 3::smallint, 'promised 3%') from public.bookings where id = current_setting('test.b')::uuid;
select test.eq(loyalty_level, 1::smallint, 'at level 1') from public.bookings where id = current_setting('test.b')::uuid;
select test.login(test.id('owner1'));
select test.eq((public.list_shop_bookings()->'bookings'->0->>'loyalty_percent')::int, 3, 'the shop sees the promise');
-- The shop changes its mind: the promise made stays.
update public.shops set loyalty_l1 = null, loyalty_l2 = null where id = test.id('shop1');
select test.logout();
select test.eq(loyalty_percent, 3::smallint, 'a later change keeps the promise') from public.bookings where id = current_setting('test.b')::uuid;
select test.login(test.id('client_a'));
select test.fails(format('update public.bookings set loyalty_percent = 50 where id = %L', current_setting('test.b')), 'permission denied',
  'the browser cannot write it');
select test.logout();

-- At shop2 she is no new client (she has jobs there): no offer, the loyalty discount.
update public.shops set new_client_offer = 15, loyalty_l1 = 5 where id = test.id('shop2');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), test.id('client_a'), 'ulei', 'Ana Marin', '{"plate_norm":"BV12ABC"}', test.workday(4), '09:00', 'pending')
returning id as b4 \gset
select test.eq(offer_percent::int, null::int, 'no offer: not new there') from public.bookings where id = :'b4';
select test.eq(loyalty_percent, 5::smallint, 'the loyalty discount instead') from public.bookings where id = :'b4';
-- A client new at shop2 with no jobs there: the offer, no loyalty discount.
select set_config('test.client_c', test.sign_up('cora@test.local',
  '{"role":"client","name":"Cora Pop","phone":"0723000009","lang":"ro","terms_version":"2026-09"}')::text, true);
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), current_setting('test.client_c')::uuid, 'ulei', 'Cora Pop', '{}', test.workday(5), '09:00', 'pending')
returning id as b5 \gset
select test.eq(offer_percent::int, 15, 'new here: the offer') from public.bookings where id = :'b5';
select test.eq(loyalty_percent, null::smallint, 'and no loyalty discount') from public.bookings where id = :'b5';

select test.eq(public.loyalty_level_for(2), 0, '2 jobs: no level');
select test.eq(public.loyalty_level_for(5), 1, '5 jobs: level 1');
select test.eq(public.loyalty_level_for(6), 2, '6 jobs: level 2');
select test.eq(public.loyalty_percent_at(5::smallint, null, 2), 5::smallint, 'level 2 falls back to level 1''s percent');

select test.login_anon();
select test.fails('select public.my_loyalty()', 'permission denied', 'signed in only');
select test.logout();


rollback;
