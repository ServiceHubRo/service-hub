-- The loyalty programme was withdrawn (migration remove_loyalty): the owner can no longer set it, new
-- bookings get no loyalty discount, the shop page and the cards no longer mention it, and a discount
-- already promised on a booking stays visible to the shop.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

select test.login(test.id('owner1'));
select test.fails(format('update public.shops set loyalty_l1 = 5 where id = %L', test.id('shop1')), 'permission denied',
  'the owner cannot turn it on');
select test.logout();

-- Even with an old value left on the shop and enough jobs, a new booking gets nothing.
update public.shops set loyalty_l1 = 5, loyalty_l2 = 7 where id = test.id('shop1');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, done_at)
select test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', '{}', current_date - 30 - i, '10:00', 'done',
       now() - make_interval(days => 31 + i), now() - make_interval(days => 30 + i)
from generate_series(1, 6) i;
select test.login(test.id('client_a'));
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')))).id::text, true);
select test.eq(public.get_shop_page(test.id('shop1')) ? 'loyalty', false, 'the shop page no longer has it');
select test.fails('select public.my_loyalty()', 'does not exist', 'no loyalty screen data');
select test.logout();
select test.eq(loyalty_percent, null::smallint, 'no loyalty discount on a new booking')
from public.bookings where id = current_setting('test.b')::uuid;

-- A discount promised before the withdrawal stays on the booking, and the shop sees it.
update public.bookings set loyalty_percent = 5, loyalty_level = 1 where id = current_setting('test.b')::uuid;
select test.login(test.id('owner1'));
select test.eq((select (x->>'loyalty_percent')::int from jsonb_array_elements(public.list_shop_bookings()->'bookings') x
                where x->>'id' = current_setting('test.b')), 5, 'a promise already made is still shown');
select test.logout();

rollback;
