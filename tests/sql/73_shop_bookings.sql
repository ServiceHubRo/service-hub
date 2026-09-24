-- Shop Panou and Programări (T08): list_shop_bookings shows a shop only its own active bookings,
-- with the client's account id, no-show count and the current quote; get_availability with
-- p_exclude_booking frees the moved booking's own place, for members of its shop only.
begin;
select test.make_world();
update public.shops set daily_capacity = 100, cars_per_slot = 20 where id = test.id('shop1');

select set_config('test.pending', test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', test.workday(1), '10:00')::text, true);
select set_config('test.confirmed', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.workday(2), '09:00')::text, true);
select set_config('test.quoted', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_sent', test.workday(3), '11:00')::text, true);
select set_config('test.inspect', test.raw_booking(test.id('shop1'), test.id('client_b'), 'in_inspection', test.workday(3), '12:00')::text, true);
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'declined', test.workday(4), '10:00');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 5, '10:00');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 6, '10:00');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 7, '10:00');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 120, '10:00');
-- A replaced quote: version 1 superseded, version 2 waiting.
select test.raw_quote(current_setting('test.quoted')::uuid, '[{"name":"Vechi","price":100}]');
update public.quotes set status = 'superseded' where booking_id = current_setting('test.quoted')::uuid and version = 1;
select test.raw_quote(current_setting('test.quoted')::uuid);

-- ------------------------------------------------------------------ owner of shop1
select test.login(test.id('owner1'));
select set_config('test.list', public.list_shop_bookings()::text, true);
select test.logout();

select test.eq(current_setting('test.list')::jsonb->'shop'->>'id', test.id('shop1')::text, 'the caller''s shop'),
       test.eq(current_setting('test.list')::jsonb->'shop'->>'daily_capacity', '100', 'capacity for the Panou line'),
       test.eq(current_setting('test.list')::jsonb->>'quote_expiry_days', '3', 'quote expiry days for the note');
select test.eq(jsonb_array_length(current_setting('test.list')::jsonb->'bookings'), 4,
  'only the four active bookings (done, declined and no-show stay out)');
select test.eq(
  (select string_agg(b->>'status', ',') from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b),
  'pending,confirmed,quote_sent,in_inspection', 'ordered by day and time');

select test.eq(b->>'slot', '10:00', 'slot as HH:MM'),
       test.eq(b->>'service_ro', 'Schimb ulei + filtru ulei', 'service name in Romanian'),
       test.ok(b->>'service_en' is not null and b->>'service_icon' is not null, 'service name in English and icon'),
       test.eq(b->>'client_account', (select display_id from public.profiles where id = test.id('client_a')), 'client account id'),
       test.eq(b->>'client_no_shows', '0', 'client A has no no-shows'),
       test.eq(b->'quote', 'null'::jsonb, 'no quote before quote_sent'),
       test.eq(b->'car_snapshot'->>'plate', 'BV 01 TST', 'car snapshot')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.pending');

select test.eq(b->>'client_no_shows', '3', 'client B: three no-shows in the last 90 days (the older one not counted)')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.inspect');

select test.eq(b->'quote'->>'version', '2', 'the waiting version, not the superseded one'),
       test.eq(b->'quote'->>'status', 'sent', 'quote waiting'),
       test.eq(b->'quote'->>'total_sent', '400.00', 'total of the waiting version'),
       test.eq(jsonb_array_length(b->'quote'->'items'), 2, 'its two lines'),
       test.eq(b->'quote'->'items'->0->>'name', 'Plăcuțe', 'lines in position order'),
       test.eq(b->'quote'->'items'->0->'approved', 'null'::jsonb, 'not decided yet')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.quoted');

-- Staff sees the same list; nothing of the client's profile beyond the account id.
select test.login(test.id('staff1'));
select test.eq(jsonb_array_length(public.list_shop_bookings()->'bookings'), 4, 'staff sees the shop''s bookings');
select test.eq(test.count($$select 1 from public.profiles where id = test.id('client_a')$$), 0::bigint,
  'staff still cannot read client profiles');
select test.logout();

-- Another shop sees only its own; a client and a signed-out caller get nothing.
select test.login(test.id('owner2'));
select test.eq(jsonb_array_length(public.list_shop_bookings()->'bookings'), 1, 'shop2 sees only its own pending booking');
select test.eq(public.list_shop_bookings()->'bookings'->0->>'id', test.id('booking_b')::text, 'shop2''s booking');
select test.logout();
select test.login(test.id('client_a'));
select test.eq(test.error_of('select public.list_shop_bookings()'), 'not_allowed', 'a client has no shop list');
select test.logout();
select test.login_anon();
select test.fails('select public.list_shop_bookings()', 'permission denied', 'anon cannot call it');
select test.logout();

-- ------------------------------------------------------------------ availability without the moved booking
update public.shops set daily_capacity = 1, cars_per_slot = 1 where id = test.id('shop1');
select set_config('test.day', test.workday(2)::text, true); -- holds only test.confirmed (09:00)

select test.login(test.id('owner1'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1)->'days'->0->>'reason',
  'full', 'without exclusion the day is full');
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1, null,
                 current_setting('test.confirmed')::uuid)->'days'->0->>'bookable',
  'true', 'the moved booking''s own place is free for the shop');
select test.eq(s->>'available', 'true', 'its own time is offered too')
from jsonb_array_elements(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1,
       current_setting('test.day')::date, current_setting('test.confirmed')::uuid)->'slots') s
where s->>'time' = '09:00';
-- Moving it to another time the same (full) day works, as the grid promised.
select test.eq(test.error_of(format('select public.reschedule_booking(%L, %L, ''14:00'', gen_random_uuid())',
  current_setting('test.confirmed'), current_setting('test.day'))), 'ok', 'reschedule within its own full day');
select test.logout();

-- Somebody else's exclusion is ignored.
select test.login(test.id('client_a'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1, null,
                 current_setting('test.confirmed')::uuid)->'days'->0->>'reason',
  'full', 'a client cannot free a place by naming a booking');
select test.logout();
select test.login(test.id('owner2'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1, null,
                 current_setting('test.confirmed')::uuid)->'days'->0->>'reason',
  'full', 'another shop cannot free a place either');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day')::date, 1, null,
                 test.id('booking_b'))->'days'->0->>'reason',
  'full', 'a booking of another shop frees nothing');
select test.logout();

rollback;
