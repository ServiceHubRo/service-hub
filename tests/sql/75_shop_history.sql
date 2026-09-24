-- Repair history (T10): list_shop_history shows a shop only its own finished bookings — done,
-- quote refused, expired, cancelled, no-show; never declined or active ones — newest first, with
-- the quote that belongs to how each one ended.
begin;
select test.make_world();

-- shop1 already has two done jobs from the fixtures (booking_a 10 days ago, booking_b1 20 days ago).
select set_config('test.refused', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_refused', test.today() - 2, '09:00')::text, true);
select set_config('test.expired', test.raw_booking(test.id('shop1'), test.id('client_b'), 'expired', test.today() - 3, '09:00')::text, true);
select set_config('test.cancelled', test.raw_booking(test.id('shop1'), test.id('client_a'), 'cancelled', test.today() - 4, '09:00')::text, true);
select set_config('test.noshow', test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 5, '09:00')::text, true);
select set_config('test.partial', test.raw_booking(test.id('shop1'), test.id('client_b'), 'done', test.today() - 1, '09:00', 'BV 12 ABC', 110000)::text, true);
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'declined', test.today() - 6, '09:00');
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', test.workday(1), '09:00');
select test.raw_booking(test.id('shop2'), test.id('client_b'), 'done', test.today() - 1, '10:00');

-- When each one ended, as the functions stamp it.
update public.bookings set status_changed_at = now() - interval '2 days' where id = current_setting('test.refused')::uuid;
update public.bookings set status_changed_at = now() - interval '3 days' where id = current_setting('test.expired')::uuid;
update public.bookings set status_changed_at = now() - interval '6 days', cancelled_at = now() - interval '4 days',
                           cancelled_by = 'client' where id = current_setting('test.cancelled')::uuid;
update public.bookings set status_changed_at = now() - interval '5 days' where id = current_setting('test.noshow')::uuid;
update public.bookings set work = 'Plăcuțe față', cost = 280, note = 'Scârțâie la frânare'
where id = current_setting('test.partial')::uuid;

-- Quotes: refused; expired; a finished job whose version 1 was replaced and version 2 partly accepted.
select test.raw_quote(current_setting('test.refused')::uuid);
update public.quotes set status = 'refused' where booking_id = current_setting('test.refused')::uuid;
select test.raw_quote(current_setting('test.expired')::uuid);
update public.quotes set status = 'expired' where booking_id = current_setting('test.expired')::uuid;
select test.raw_quote(current_setting('test.partial')::uuid, '[{"name":"Vechi","price":100}]');
update public.quotes set status = 'superseded' where booking_id = current_setting('test.partial')::uuid;
select test.raw_quote(current_setting('test.partial')::uuid);
update public.quotes set status = 'partially_accepted', total_approved = 280
where booking_id = current_setting('test.partial')::uuid and version = 2;
update public.quote_items set approved = (name = 'Plăcuțe')
where quote_id = (select id from public.quotes where booking_id = current_setting('test.partial')::uuid and version = 2);

-- ------------------------------------------------------------------ owner of shop1
select test.login(test.id('owner1'));
select set_config('test.list', public.list_shop_history()::text, true);
select test.logout();

select test.eq(current_setting('test.list')::jsonb->'shop'->>'id', test.id('shop1')::text, 'the caller''s shop');
select test.eq(jsonb_array_length(current_setting('test.list')::jsonb->'bookings'), 7,
  'the seven finished bookings (declined, pending and shop2''s stay out)');
select test.eq(
  (select string_agg(b->>'status', ',' order by ord) from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') with ordinality x(b, ord)),
  'done,quote_refused,expired,cancelled,no_show,done,done', 'newest first, by when each one ended');

select test.eq(b->>'slot', '09:00', 'slot as HH:MM'),
       test.eq(b->>'service_ro', 'Schimb ulei + filtru ulei', 'service name in Romanian'),
       test.ok(b->>'service_en' is not null and b->>'service_icon' is not null, 'service name in English and icon'),
       test.eq(b->>'odometer', '110000', 'odometer'),
       test.eq(b->>'work', 'Plăcuțe față', 'work performed'),
       test.eq(b->>'cost', '280.00', 'amount collected'),
       test.eq(b->>'note', 'Scârțâie la frânare', 'the client''s note'),
       test.eq(b->>'has_client', 'true', 'the client still has an account'),
       test.eq(b->'car_snapshot'->>'plate', 'BV 12 ABC', 'car snapshot'),
       test.eq(b->'quote'->>'version', '2', 'the accepted version, not the replaced one'),
       test.eq(b->'quote'->>'status', 'partially_accepted', 'partly accepted'),
       test.eq(b->'quote'->>'total_approved', '280.00', 'approved total'),
       test.eq(b->'quote'->'items'->1->'approved', 'false'::jsonb, 'the refused line says so'),
       test.eq(b->'quote'->'items'->0->>'name', 'Plăcuțe', 'lines in position order')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.partial');

select test.eq(b->'quote'->>'status', 'refused', 'a refused quote comes with its booking')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.refused');
select test.eq(b->'quote'->>'status', 'expired', 'an expired quote comes with its booking')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.expired');
select test.eq(b->'quote', 'null'::jsonb, 'a cancelled booking has no quote'),
       test.eq(b->>'cancelled_by', 'client', 'who cancelled'),
       test.ok((b->>'ended_at')::timestamptz < now() - interval '3 days' and (b->>'ended_at')::timestamptz > now() - interval '5 days',
         'a cancelled booking ended when it was cancelled')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = current_setting('test.cancelled');
select test.eq(b->'quote'->'items'->0->>'name', 'Ulei 5W30', 'the fixture''s accepted quote')
from jsonb_array_elements(current_setting('test.list')::jsonb->'bookings') b
where b->>'id' = test.id('booking_a')::text;

-- A client who deleted the account: the job stays, without a conversation to open.
update public.bookings set client_id = null where id = current_setting('test.noshow')::uuid;
select test.login(test.id('staff1'));
select test.eq(b->>'has_client', 'false', 'a deleted client account')
from jsonb_array_elements(public.list_shop_history()->'bookings') b
where b->>'id' = current_setting('test.noshow');
select test.eq(jsonb_array_length(public.list_shop_history()->'bookings'), 7, 'staff sees the shop''s history');
select test.logout();

-- Another shop sees only its own; a client, an admin and a signed-out caller get nothing.
select test.login(test.id('owner2'));
select test.eq(jsonb_array_length(public.list_shop_history()->'bookings'), 1, 'shop2 sees only its own finished job');
select test.logout();
select test.login(test.id('client_a'));
select test.eq(test.error_of('select public.list_shop_history()'), 'not_allowed', 'a client has no shop history');
select test.logout();
select test.login(test.id('admin'));
select test.eq(test.error_of('select public.list_shop_history()'), 'not_allowed', 'an admin has no shop of their own');
select test.logout();
select test.login_anon();
select test.fails('select public.list_shop_history()', 'permission denied', 'anon cannot call it');
select test.logout();

rollback;
