-- Offers (Eduard, 8 Oct): the new-client offer with a last day and chosen services, the quiet-day
-- offer, and the common rules — written on the booking by the database, never cumulated (the larger
-- one, at most 15 %), kept on a reschedule, set by the owner only.
begin;
select test.make_world();

create function pg_temp.client(p_n int) returns uuid
language sql as $$
  select test.sign_up('oferta' || p_n || '@test.local', jsonb_build_object(
    'role', 'client', 'name', 'Client ' || p_n, 'phone', '07' || lpad((55000000 + p_n)::text, 8, '0'),
    'lang', 'ro', 'terms_version', '2026-10-08'))
$$;
create function pg_temp.book(p_client uuid, p_service text, p_day date, p_slot time default '10:00') returns public.bookings
language plpgsql as $$
declare
  v public.bookings;
begin
  perform test.login(p_client);
  v := public.create_booking(p_shop_id => test.id('shop1'), p_service_id => p_service, p_date => p_day, p_slot => p_slot,
    p_request_id => gen_random_uuid(), p_car => jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', 'B ' || left(p_client::text, 6)));
  perform test.logout();
  return v;
end
$$;

update public.shops set cars_per_slot = 5, daily_capacity = 20 where id = test.id('shop1');

-- ------------------------------------------------------------------ the new-client offer, completed
update public.shops set new_client_offer = 10, new_client_offer_until = test.workday(3),
  new_client_offer_services = array['frane'] where id = test.id('shop1');
select test.eq((pg_temp.book(pg_temp.client(1), 'ulei', test.workday(1))).offer_percent, null::int,
  'a service the offer does not cover: no offer');
select test.eq((pg_temp.book(pg_temp.client(2), 'frane', test.workday(1))).offer_percent, 10,
  'one of the chosen services, before the last day: -10 %');
select test.eq((select offer_kind from public.bookings where client_id = (select id from public.profiles where name = 'Client 2')),
  'new_client', 'and which offer it was');
select test.eq((pg_temp.book(pg_temp.client(3), 'frane', test.workday(4))).offer_percent, null::int,
  'an appointment after the last day: the offer has ended');
select test.fails(format($$update public.shops set new_client_offer_until = %L where id = %L$$,
  test.today() - 1, test.id('shop1')), 'field_invalid', 'a last day in the past is refused');

-- ------------------------------------------------------------------ the quiet-day offer; never cumulated
update public.shops set new_client_offer_until = null, new_client_offer_services = null,
  quiet_day_offer = 15, quiet_days = array[extract(dow from test.workday(5))::smallint] where id = test.id('shop1');
select set_config('test.b4', (pg_temp.book(pg_temp.client(4), 'ulei', test.workday(5))).id::text, true);
select test.eq(offer_percent, 15, 'new client (10 %) on a quiet day (15 %): the larger one, not 25 %'),
       test.eq(offer_kind, 'quiet_day', 'the quiet-day offer')
from public.bookings where id = current_setting('test.b4')::uuid;
select test.eq((pg_temp.book(pg_temp.client(5), 'ulei', test.workday(6))).offer_percent, 10,
  'another day: the new-client offer');
select test.eq((pg_temp.book(test.id('client_a'), 'ulei', test.workday(5), '11:00')).offer_percent, 15,
  'a returning client also gets the quiet day');
select test.fails(format($$update public.shops set quiet_day_offer = 20 where id = %L$$, test.id('shop1')),
  'check', 'at most 15 %');
select test.fails(format($$update public.shops set quiet_days = '{}' where id = %L$$, test.id('shop1')),
  'field_invalid', 'a quiet-day offer needs its days');

-- A rescheduled booking keeps its promise.
select test.login(test.id('owner1'));
select public.reschedule_booking(current_setting('test.b4')::uuid, test.workday(6), '10:00', gen_random_uuid());
select test.logout();
select test.eq(offer_percent, 15, 'moved to an ordinary day: still -15 %')
from public.bookings where id = current_setting('test.b4')::uuid;

-- A booking the shop adds for a walk-in: no client account, no offer.
select test.login(test.id('owner1'));
select test.eq((public.shop_create_booking(p_service_id => 'ulei', p_date => test.workday(5), p_slot => '15:00',
  p_client_name => 'Ion Ghișeu', p_client_phone => '0722111333', p_car => '{"make":"Opel","model":"Astra","plate":"B 22 OFR"}',
  p_request_id => gen_random_uuid())).offer_percent, null::int, 'a walk-in booking: no offer');
select test.logout();

-- ------------------------------------------------------------------ what the client sees
select test.login(pg_temp.client(6));
select test.eq((public.shop_offers(array[test.id('shop1')])->0->'new_client'->>'percent')::int, 10, 'a new client sees the offer'),
       test.eq((public.shop_offers(array[test.id('shop1')])->0->'quiet_day'->>'percent')::int, 15, 'and the quiet days');
select test.logout();
select test.login(test.id('client_a'));
select test.ok(public.shop_offers(array[test.id('shop1')])->0->'new_client' = 'null'::jsonb, 'a returning client: no new-client offer'),
       test.eq((public.shop_offers(array[test.id('shop1')])->0->'quiet_day'->'days'->>0)::int,
               extract(dow from test.workday(5))::int, 'the quiet day still shows');
select test.logout();

-- ------------------------------------------------------------------ rights
select test.login(test.id('staff1'));
update public.shops set quiet_day_offer = 5, new_client_offer = 5 where id = test.id('shop1');
select test.logout();
select test.eq(quiet_day_offer::int, 15, 'a colleague cannot change the offers'),
       test.eq(new_client_offer, 10, 'neither of them')
from public.shops where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.fails(format($$update public.bookings set offer_percent = 15, offer_kind = 'quiet_day' where id = %L$$,
  current_setting('test.b4')), 'permission denied', 'the browser never writes the promise');
select test.logout();
select test.login(test.id('owner1'));
update public.shops set quiet_day_offer = 5 where id = test.id('shop1');
select test.logout();
select test.eq(quiet_day_offer::int, 5, 'the owner can') from public.shops where id = test.id('shop1');

rollback;
