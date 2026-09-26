-- T19c launch check (docs/LAUNCH_CHECK.md): the points of the "Final check" list that no other
-- SQL test named directly.
begin;
select test.make_world();

-- ------------------------------------------------------------------ Saturday with short hours
-- „Sâmbăta cu program scurt afișează doar orele corecte”: open 09:00–13:00, hourly slots.
update public.shop_hours set is_closed = false, open_time = '09:00', close_time = '13:00'
where shop_id = test.id('shop1') and weekday = 6;
select test.login(test.id('client_a'));
select test.eq(d->>'bookable', 'true', 'the short Saturday is bookable')
from jsonb_array_elements(public.get_availability(test.id('shop1'), test.saturday(), 1)->'days') d;
select test.eq(
  (select jsonb_agg(s->>'time') from jsonb_array_elements(
    public.get_availability(test.id('shop1'), test.saturday(), 1, test.saturday())->'slots') s),
  '["09:00", "10:00", "11:00", "12:00"]'::jsonb,
  'Saturday 09:00–13:00: 09:00 to 12:00, the last one ending at closing');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L,
  p_slot => '13:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), test.saturday()), 'invalid_slot', 'a booking at closing time is refused');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L,
  p_slot => '08:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), test.saturday()), 'invalid_slot', 'a booking before opening is refused');
select test.eq((public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => test.saturday(),
  p_slot => '12:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')).status,
  'pending', 'the last Saturday slot is accepted');
select test.logout();

-- ------------------------------------------------------------------ no published prices
-- „Nicăieri în aplicație nu apar prețuri publicate pe servicii”: the catalog and a shop's services
-- have nowhere to keep a price (only the inspection fee and the quote have amounts).
select test.eq(count(*), 0::bigint, 'no price column on the catalog or on a shop''s services')
from information_schema.columns
where table_schema = 'public' and table_name in ('services', 'shop_services')
  and (column_name ilike '%price%' or column_name ilike '%cost%' or column_name ilike '%amount%');

rollback;
