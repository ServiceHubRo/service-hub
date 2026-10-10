-- The car's history is shown to the booked shop by default (Eduard, 10 Oct); one switch in Cont
-- (profiles.share_history) turns it off for every open booking at once.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);

select test.eq((select share_history from public.profiles where id = test.id('client_a')), true, 'on for every client by default');

-- A new booking follows the switch, whatever the form sends.
select test.login(test.id('client_a'));
select set_config('test.b1', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'frane',
  p_date => current_setting('test.day')::date, p_slot => '09:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')), p_share_history => false)).id::text, true);
select test.logout();
select test.eq(share_history, true, 'a new booking is shared') from public.bookings where id = current_setting('test.b1')::uuid;
select test.ok(share_history_at is not null, 'with its time') from public.bookings where id = current_setting('test.b1')::uuid;

-- A finished booking of hers, for the check below.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, done_at)
values (test.id('shop2'), test.id('client_a'), 'ulei', 'Ana Marin', '{"make":"Dacia","model":"Logan"}',
        current_date - 10, '09:00', 'done', now() - interval '10 days');
update public.bookings set share_history = false
where client_id = test.id('client_a') and status = 'done' and shop_id = test.id('shop2');

-- Off in Cont: every open booking stops sharing; a finished one is left as it was.
select test.login(test.id('client_a'));
update public.profiles set share_history = false where id = test.id('client_a');
select test.logout();
select test.eq(share_history, false, 'off: the open booking stops sharing') from public.bookings where id = current_setting('test.b1')::uuid;
select test.eq(count(*), 0::bigint, 'a finished booking is not touched')
from public.bookings where client_id = test.id('client_a') and status = 'done' and shop_id = test.id('shop2') and share_history;
select test.login(test.id('owner1'));
select test.eq(public.shop_vehicle_file(current_setting('test.b1')::uuid)->>'share', 'not_shared', 'the shop sees it hidden');
select test.logout();

-- A booking made while off stays off; on again shares both.
select test.login(test.id('client_a'));
select set_config('test.b2', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
  p_date => current_setting('test.day')::date, p_slot => '10:00', p_request_id => gen_random_uuid(),
  p_car_id => (select id from public.cars where owner_id = test.id('client_a')), p_share_history => true)).id::text, true);
select test.logout();
select test.eq(share_history, false, 'off: a new booking is not shared') from public.bookings where id = current_setting('test.b2')::uuid;
select test.login(test.id('client_a'));
update public.profiles set share_history = true where id = test.id('client_a');
select test.logout();
select test.eq(count(*), 2::bigint, 'on again: both open bookings share')
from public.bookings where id in (current_setting('test.b1')::uuid, current_setting('test.b2')::uuid) and share_history;

-- Only she changes her switch.
select test.login(test.id('client_b'));
update public.profiles set share_history = false where id = test.id('client_a');
select test.logout();
select test.eq((select share_history from public.profiles where id = test.id('client_a')), true, 'another client cannot change it');

rollback;
