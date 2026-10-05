-- No SMS to shops for a new request (Eduard, 4 Oct): the owner cannot turn it on, not even through
-- the API, and a new request asks for a push only.
begin;
select test.make_world();

select test.login(test.id('owner1'));
select test.fails(format('update public.shops set sms_on_new_booking = true where id = %L', test.id('shop1')),
  'permission denied', 'the owner cannot turn SMS on');
select test.logout();

select test.fails(format('update public.shops set sms_on_new_booking = true where id = %L', test.id('shop1')),
  'shops_no_new_booking_sms', 'not even the server');

select test.login(test.id('client_a'));
select set_config('test.b', (public.create_booking(
  p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => test.workday(3), p_slot => '10:00',
  p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan","plate":"B 01 SMS"}'))
  .id::text, true);
select test.logout();
select test.eq(count(*), 1::bigint, 'a new request: one message to the shop'),
       test.eq(bool_and(channels = array['push']), true, 'a push, no SMS')
from public.notification_events
where booking_id = current_setting('test.b')::uuid and user_id = test.id('owner1');

rollback;
