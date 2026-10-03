-- The shop's window (T28b): photos (members add and order, up to 10, everyone who may read the
-- shop sees them), facilities (owner only, from the fixed list) and the "answers quickly" badge.
begin;
select test.make_world();

-- ------------------------------------------------------------------ photos
select set_config('test.base', 'http://x/storage/v1/object/public/shop-photos/' || test.id('shop1') || '/', true);
select test.login(test.id('owner1'));
insert into public.shop_photos (shop_id, path, url, position)
select test.id('shop1'), test.id('shop1') || '/p' || i || '.jpg', current_setting('test.base') || 'p' || i || '.jpg', i
from generate_series(1, 9) i;
select test.logout();
select test.login(test.id('staff1'));
insert into public.shop_photos (shop_id, path, url, position)
values (test.id('shop1'), test.id('shop1') || '/p10.jpg', current_setting('test.base') || 'p10.jpg', 10);
select test.fails(format($f$insert into public.shop_photos (shop_id, path, url) values (%L, %L, %L)$f$,
  test.id('shop1'), test.id('shop1') || '/p11.jpg', current_setting('test.base') || 'p11.jpg'), 'too_many_photos', 'at most 10');
select test.logout();
select test.eq((select count(*) from public.shop_photos where shop_id = test.id('shop1')), 10::bigint, 'owner and colleague add');

select test.login(test.id('owner2'));
select test.fails(format($f$insert into public.shop_photos (shop_id, path, url) values (%L, %L, %L)$f$,
  test.id('shop1'), test.id('shop1') || '/x.jpg', current_setting('test.base') || 'x.jpg'), 'row-level security', 'not another shop');
select test.fails(format($f$insert into public.shop_photos (shop_id, path, url) values (%L, %L, %L)$f$,
  test.id('shop2'), test.id('shop2') || '/x.jpg', 'https://evil.example/x.jpg'), 'row-level security', 'only a file of its own folder');
delete from public.shop_photos where shop_id = test.id('shop1');
select test.logout();
select test.eq((select count(*) from public.shop_photos where shop_id = test.id('shop1')), 10::bigint, 'another shop cannot remove them');

select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.get_shop_page(test.id('shop1'))->'photos'), 10, 'a client sees them on the page');
select test.eq(public.get_shop_page(test.id('shop1'))->'photos'->0->>'url', current_setting('test.base') || 'p1.jpg', 'in order');
update public.shop_photos set position = 0 where shop_id = test.id('shop1');
select test.logout();
select test.eq((select count(*) from public.shop_photos where shop_id = test.id('shop1') and position = 0), 0::bigint,
  'a client cannot order them');

select test.login(test.id('owner1'));
update public.shop_photos set position = 0 where path like '%/p10.jpg';
select test.eq(public.get_shop_page(test.id('shop1'))->'photos'->0->>'url', current_setting('test.base') || 'p10.jpg', 'moved first');
delete from public.shop_photos where path like '%/p10.jpg';
select test.logout();
select test.eq((select count(*) from public.shop_photos where shop_id = test.id('shop1')), 9::bigint, 'the owner removes one');

-- ------------------------------------------------------------------ facilities
select test.login(test.id('owner1'));
update public.shops set amenities = array['wifi', 'courtesy_car'] where id = test.id('shop1');
select test.fails(format($f$update public.shops set amenities = array['pool'] where id = %L$f$, test.id('shop1')), 'check', 'only from the list');
select test.logout();
select test.login(test.id('staff1'));
update public.shops set amenities = '{}' where id = test.id('shop1');
select test.logout();
select test.eq(amenities, array['wifi', 'courtesy_car'], 'a colleague cannot change them') from public.shops where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.eq(public.get_shop_page(test.id('shop1'))->'shop'->'amenities', '["wifi", "courtesy_car"]'::jsonb, 'on the page');
select test.eq((select amenities from public.search_card_extras(array[test.id('shop1')])), array['wifi', 'courtesy_car'],
  'and on the card, for the filters');
select test.logout();

-- ------------------------------------------------------------------ answers quickly
-- Fewer than 3 answers: no badge.
select test.eq(public.shop_response_badge(test.id('shop1')), null::text, 'no badge without enough answers');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, confirmed_at)
select test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', test.workday(1) + i, '09:00', 'confirmed',
       now() - interval '5 days', now() - interval '5 days' + interval '20 minutes'
from generate_series(0, 2) i;
select test.eq(public.shop_response_badge(test.id('shop1')), 'hour', 'answered within the hour');
-- Instant confirmations are no answers; slow answers move it to "within hours".
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, confirmed_at)
select test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', test.workday(1) + i, '10:00', 'confirmed',
       now() - interval '4 days', now() - interval '4 days'
from generate_series(0, 5) i;
select test.eq(public.shop_response_badge(test.id('shop1')), 'hour', 'instant confirmations do not count');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, created_at, confirmed_at)
select test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', test.workday(1) + i, '11:00', 'confirmed',
       now() - interval '3 days', now() - interval '3 days' + interval '3 hours'
from generate_series(0, 3) i;
select test.eq(public.shop_response_badge(test.id('shop1')), 'hours', 'within a few hours');
-- Too many requests left unanswered: no badge at all.
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status, closed_reason, created_at)
select test.id('shop1'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', current_date - 1, '12:00', 'expired', 'unanswered',
       now() - interval '2 days'
from generate_series(1, 3) i;
select test.eq(public.shop_response_badge(test.id('shop1')), null::text, 'not with many unanswered requests');
select test.login(test.id('client_a'));
select test.eq((select response from public.search_card_extras(array[test.id('shop1')])), null::text, 'the card agrees');
select test.fails(format('select public.shop_response_badge(%L)', test.id('shop1')), 'permission denied', 'read through the page and cards only');
select test.logout();

select test.eq((select version from public.schema_version), 52, 'schema 52');

rollback;
