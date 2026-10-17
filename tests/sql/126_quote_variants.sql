-- Variants on a quote line (T37c): original part or alternative part. Stored as two lines of one
-- option group; the total sent counts the originals; the client takes at most one of the two; the
-- quote is accepted when every line is taken in one of its variants; the shop's lists show them.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
update public.shops set inspection_fee = 80, daily_capacity = 20 where id = test.id('shop1');
select set_config('test.day1', test.workday(1)::text, true);

create function pg_temp.in_inspection(p_slot time) returns uuid
language plpgsql as $$
declare
  v uuid := test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, p_slot);
begin
  perform test.login(test.id('owner1'));
  perform public.confirm_booking(v, gen_random_uuid());
  perform public.start_inspection(v, gen_random_uuid());
  perform test.logout();
  return v;
end $$;

create function pg_temp.item(p_quote uuid, p_variant text) returns uuid
language sql as $$
  select id from public.quote_items where quote_id = p_quote and variant is not distinct from p_variant
  order by position limit 1
$$;

select set_config('test.b', pg_temp.in_inspection('09:00')::text, true);

-- ------------------------------------------------------------------ the shop sends a line with an alternative
select test.login(test.id('owner1'));
select test.fails(format($$select public.send_quote(%L, '[{"name":"Plăcuțe","price":420,"alt":{"price":-1}}]', gen_random_uuid())$$,
  current_setting('test.b')), 'quote_item_invalid', 'the alternative needs a valid price');
select test.fails(format($$select public.send_quote(%L, %L, gen_random_uuid())$$, current_setting('test.b'),
  jsonb_build_array(jsonb_build_object('name', 'Plăcuțe', 'price', 420, 'alt', jsonb_build_object('price', 260, 'brand', repeat('b', 81))))),
  'quote_item_invalid', 'a brand up to 80 characters');
select public.send_quote(current_setting('test.b')::uuid,
  '[{"name":"Plăcuțe frână față","price":420,"alt":{"price":260,"brand":"Bosch"}},{"name":"Manoperă","price":150}]',
  gen_random_uuid());
select test.logout();
select set_config('test.q', test.sent_quote(current_setting('test.b')::uuid)::text, true);
select test.eq(array_agg(position || ':' || name || '=' || price || ':' || coalesce(variant, '-') || ':' || coalesce(brand, '-') order by position),
  array['1:Plăcuțe frână față=420.00:original:-', '2:Plăcuțe frână față=260.00:alternative:Bosch', '3:Manoperă=150.00:-:-'],
  'two lines of one group, then the plain line')
from public.quote_items where quote_id = current_setting('test.q')::uuid;
select test.eq(total_sent, 570.00::numeric(10,2), 'the total sent counts the original, not both')
from public.quotes where id = current_setting('test.q')::uuid;

-- The shop's list shows the variants.
select test.login(test.id('owner1'));
select test.ok((select b->'quote'->'items' from jsonb_array_elements(public.list_shop_bookings()->'bookings') b
  where b->>'id' = current_setting('test.b')) @> '[{"variant":"alternative","brand":"Bosch","option_group":1}]',
  'list_shop_bookings carries the variant');
select test.logout();

-- ------------------------------------------------------------------ the client answers
select set_config('test.orig', pg_temp.item(current_setting('test.q')::uuid, 'original')::text, true),
       set_config('test.alt', pg_temp.item(current_setting('test.q')::uuid, 'alternative')::text, true),
       set_config('test.plain', pg_temp.item(current_setting('test.q')::uuid, null)::text, true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.decide_quote(%L, %L, array[%L, %L]::uuid[], gen_random_uuid())$$,
  current_setting('test.b'), current_setting('test.q'), current_setting('test.orig'), current_setting('test.alt')),
  'quote_variant_both', 'not both variants of a line');
select test.eq(count(*), 0::bigint, 'the refused answer changed nothing')
from public.quote_items where quote_id = current_setting('test.q')::uuid and approved is not null;
select public.decide_quote(current_setting('test.b')::uuid, current_setting('test.q')::uuid,
  array[current_setting('test.alt'), current_setting('test.plain')]::uuid[],
  gen_random_uuid());
select test.logout();
select test.eq(status, 'accepted', 'the alternative and the plain line: every line taken, accepted'),
       test.eq(total_approved, 410.00::numeric(10,2), 'at the alternative''s price')
from public.quotes where id = current_setting('test.q')::uuid;
select test.eq(test.status_of(current_setting('test.b')::uuid), 'approved', 'the booking is approved');
select test.ok(exists (select 1 from public.notification_events
  where event = 'quote_accepted' and booking_id = current_setting('test.b')::uuid), 'the shop is told it was accepted');

-- Only the plain line: partially accepted.
select set_config('test.b2', pg_temp.in_inspection('10:00')::text, true);
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.b2')::uuid,
  '[{"name":"Plăcuțe frână față","price":420,"alt":{"price":260}},{"name":"Manoperă","price":150}]', gen_random_uuid());
select test.logout();
select set_config('test.q2', test.sent_quote(current_setting('test.b2')::uuid)::text, true);
select test.eq(brand, null::text, 'the brand is optional')
from public.quote_items where id = pg_temp.item(current_setting('test.q2')::uuid, 'alternative');
select set_config('test.alt2', pg_temp.item(current_setting('test.q2')::uuid, 'alternative')::text, true),
       set_config('test.plain2', pg_temp.item(current_setting('test.q2')::uuid, null)::text, true);
select test.login(test.id('client_a'));
select public.decide_quote(current_setting('test.b2')::uuid, current_setting('test.q2')::uuid,
  array[current_setting('test.plain2')]::uuid[], gen_random_uuid());
select test.logout();
select test.eq(status, 'partially_accepted', 'one line left out: partially accepted'),
       test.eq(total_approved, 150.00::numeric(10,2), 'only the plain line')
from public.quotes where id = current_setting('test.q2')::uuid;

-- The finished job takes the chosen variant's price.
select test.login(test.id('owner1'));
select public.start_work(current_setting('test.b')::uuid, gen_random_uuid());
select test.eq((public.complete_job(current_setting('test.b')::uuid, 50000, gen_random_uuid())).cost, 410.00::numeric(10,2),
  'the cost is the chosen variant plus the plain line');
select test.ok((select b->'quote'->'items' from jsonb_array_elements(public.list_shop_history()->'bookings') b
  where b->>'id' = current_setting('test.b')) @> '[{"variant":"alternative","approved":true}]',
  'the shop''s Istoric shows the variant taken');
select test.logout();

-- Nobody writes the variant from the browser.
select test.login(test.id('client_a'));
select test.fails(format($$update public.quote_items set variant = 'original' where id = %L$$,
  current_setting('test.alt2')), 'permission denied', 'the client cannot change a variant');
select test.logout();

rollback;
