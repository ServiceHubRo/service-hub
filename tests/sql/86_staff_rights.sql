-- Colleagues' rights (after T19b): a colleague works with bookings, quotes, jobs, messages and the
-- history; the shop's settings, the replies to reviews and the takings are the owner's. Checked in
-- the database, so no screen or direct API call can get around it.
begin;
select test.make_world();

-- ------------------------------------------------------------------ settings: the colleague cannot
select test.login(test.id('staff1'));
update public.shops set inspection_fee = 1, name = 'Schimbat de coleg', sms_on_new_booking = true, daily_capacity = 99
where id = test.id('shop1');
update public.shop_hours set is_closed = true where shop_id = test.id('shop1');
select test.fails(format($$insert into public.shop_closures (shop_id, start_date, end_date, label) values (%L, current_date, current_date, 'x')$$,
  test.id('shop1')), 'row-level security', 'a colleague cannot add days off');
select test.fails(format($$insert into public.shop_services (shop_id, service_id) values (%L, 'frane')$$, test.id('shop1')),
  'row-level security', 'nor offer a service');
delete from public.shop_services where shop_id = test.id('shop1');
select test.fails($$select public.set_shop_services(array['ulei'], gen_random_uuid())$$, 'not_allowed', 'nor save the services');
select test.fails($$select public.save_shop_hours('[]'::jsonb, gen_random_uuid())$$, 'not_allowed', 'nor save the week');
-- ... but still reads the shop and works with its bookings and history.
select test.eq(test.count(format('select 1 from public.shops where id = %L', test.id('shop1'))), 1::bigint, 'reads the shop');
select test.ok(jsonb_typeof(public.list_shop_history()) is not null, 'reads the repair history');
select test.ok(jsonb_typeof(public.list_shop_bookings()) is not null, 'reads the bookings');
select test.logout();

select test.ok(s.name <> 'Schimbat de coleg' and s.inspection_fee <> 1 and not s.sms_on_new_booking and s.daily_capacity <> 99,
  'the public profile, the fee, the preferences and the capacity are unchanged')
from public.shops s where s.id = test.id('shop1');
select test.eq(count(*) filter (where is_closed), 2::bigint, 'the week is unchanged (Saturday and Sunday closed)')
from public.shop_hours where shop_id = test.id('shop1');
select test.ok(exists (select 1 from public.shop_services where shop_id = test.id('shop1')), 'the services are unchanged');

-- ------------------------------------------------------------------ the owner can
select test.login(test.id('owner1'));
update public.shops set inspection_fee = 75 where id = test.id('shop1');
insert into public.shop_closures (shop_id, start_date, end_date, label) values (test.id('shop1'), current_date + 30, current_date + 31, 'Concediu');
select test.logout();
select test.eq(inspection_fee, 75.00::numeric(10,2), 'the owner changes the fee') from public.shops where id = test.id('shop1');
select test.eq(count(*), 1::bigint, 'and adds days off') from public.shop_closures where shop_id = test.id('shop1') and label = 'Concediu';

rollback;
