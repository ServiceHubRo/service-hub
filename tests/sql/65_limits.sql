-- Abuse limits (ARCHITECTURE §6) with their default values from platform_settings, and the
-- no-show count. Review window: 66; quote versions: 63.
begin;
select test.make_world();

-- Two more public shops, so a client can spread bookings.
create function pg_temp.public_shop(p_email text, p_name text) returns uuid
language plpgsql as $$
declare
  v_owner uuid := test.sign_up(p_email, jsonb_build_object('role', 'shop', 'name', p_name, 'shop_name', p_name, 'city', 'Brașov'));
  v_shop uuid;
begin
  select id into v_shop from public.shops where owner_id = v_owner;
  update public.profiles set phone_verified_by_admin = true where id = v_owner;
  insert into public.shop_services (shop_id, service_id) values (v_shop, 'ulei');
  update public.shops set daily_capacity = 50, cars_per_slot = 10 where id = v_shop;
  insert into test.ids values (p_name, v_shop), (p_name || '_owner', v_owner);
  return v_shop;
end $$;
select pg_temp.public_shop('shop3@test.local', 'shop3');
select pg_temp.public_shop('shop4@test.local', 'shop4');
update public.profiles set phone_verified_by_admin = true where id = test.id('owner2');
insert into public.shop_services (shop_id, service_id) values (test.id('shop2'), 'ulei');
update public.shops set daily_capacity = 50, cars_per_slot = 10 where id in (test.id('shop1'), test.id('shop2'));
select test.ok(public.is_shop_public(test.id('shop2')) and public.is_shop_public(test.id('shop3')), 'four public shops');

select set_config('test.day', test.workday(1)::text, true);
create function pg_temp.try_book(p_client text, p_shop text, p_slot time default '10:00') returns text
language sql as $$
  select test.error_of(format($f$select test.book(%L, %L, %L, %L)$f$, test.id(p_client), test.id(p_shop), current_setting('test.day'), p_slot))
$$;

-- ------------------------------------------------------------------ 3 active bookings per shop
select test.eq(pg_temp.try_book('client_a', 'shop1', '09:00'), 'ok', 'first at shop1');
select test.eq(pg_temp.try_book('client_a', 'shop1', '10:00'), 'ok', 'second at shop1');
select test.eq(pg_temp.try_book('client_a', 'shop1', '11:00'), 'ok', 'third at shop1');
select test.eq(pg_temp.try_book('client_a', 'shop1', '12:00'), 'limit_active_shop', 'fourth active booking at the same shop refused');
select test.login(test.id('client_a'));
select test.eq(test.error_params(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '12:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day')))->>'limit', '3', 'the refusal names the limit');
select test.logout();
select test.eq(pg_temp.try_book('client_a', 'shop2', '09:00'), 'ok', 'another shop is still fine');

-- A finished (terminal) booking does not count as active.
update public.bookings set status = 'confirmed' where client_id = test.id('client_a') and shop_id = test.id('shop1') and slot = '09:00' and date = current_setting('test.day')::date;
select test.login(test.id('client_a'));
select public.cancel_booking(id, gen_random_uuid()) from public.bookings
where client_id = auth.uid() and shop_id = test.id('shop1') and slot = '09:00' and date = current_setting('test.day')::date;
select test.logout();
select test.eq(pg_temp.try_book('client_a', 'shop1', '13:00'), 'limit_daily', 'freed a shop place, but 5 new bookings in 24 h already');

-- ------------------------------------------------------------------ 5 new bookings per 24 hours (cancelled ones included)
select test.eq(count(*), 5::bigint, 'client_a created 5 today (one cancelled)') from public.bookings
where client_id = test.id('client_a') and created_at > now() - interval '24 hours';
select test.eq(pg_temp.try_book('client_a', 'shop3'), 'limit_daily', 'sixth new booking in 24 h refused');
-- Admin-editable: raising the value in platform_settings lifts it.
update public.platform_settings set limits = limits || '{"new_bookings_per_24h": 6}';
select test.eq(pg_temp.try_book('client_a', 'shop3'), 'ok', 'limit follows platform_settings');
update public.platform_settings set limits = limits || '{"new_bookings_per_24h": 5}';

-- ------------------------------------------------------------------ 10 active bookings in total
-- client_b already has 9 active bookings made weeks ago (3 per shop at shop1, shop3, shop4).
select test.raw_booking(test.id(s), test.id('client_b'), st, test.workday(2), make_time(8 + i, 0, 0))
from (values ('shop1'), ('shop3'), ('shop4')) sh(s)
cross join (values (0, 'pending'), (1, 'confirmed'), (2, 'in_progress')) x(i, st);
select test.eq(count(*), 10::bigint, 'client_b: 9 old active + the fixture pending one at shop2') from public.bookings
where client_id = test.id('client_b') and public.is_active_status(status);
select test.eq(pg_temp.try_book('client_b', 'shop2'), 'limit_active_total', 'eleventh active booking refused');
update public.bookings set status = 'done' where client_id = test.id('client_b') and status = 'in_progress' and shop_id = test.id('shop4');
select test.eq(pg_temp.try_book('client_b', 'shop2'), 'ok', 'finishing one frees a place in the total');

-- ------------------------------------------------------------------ messages: 30 per sender per thread per hour
select test.login(test.id('client_a'));
-- The world already holds one message from client_a in this thread, sent just now.
select public.send_message(test.id('thread_a'), 'Mesaj ' || i, gen_random_uuid()) from generate_series(1, 29) i;
select test.fails(format($$select public.send_message(%L, 'Încă unul', gen_random_uuid())$$, test.id('thread_a')),
  'limit_messages', 'the 31st message within an hour refused');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(test.error_of(format($$select public.send_message(%L, 'Răspuns', gen_random_uuid())$$, test.id('thread_a'))),
  'ok', 'the other side keeps its own quota');
select test.logout();
update public.messages set created_at = now() - interval '61 minutes' where thread_id = test.id('thread_a') and body like 'Mesaj %';
select test.login(test.id('client_a'));
select test.eq(test.error_of(format($$select public.send_message(%L, 'După o oră', gen_random_uuid())$$, test.id('thread_a'))),
  'ok', 'an hour later the client can write again');
select test.logout();

-- Only between a client and a shop that have a booking together (no unsolicited advertising).
insert into public.threads (shop_id, client_id, client_name) values (test.id('shop4'), test.id('client_a'), 'Ana Marin');
select test.login(test.id('shop4_owner'));
select test.fails(format($$select public.send_message(t.id, 'Ofertă specială', gen_random_uuid()) from public.threads t where t.shop_id = %L and t.client_id = %L$$,
  test.id('shop4'), test.id('client_a')), 'no_booking_together', 'no messages without a booking between the two');
select test.logout();

-- ------------------------------------------------------------------ no-shows: counted, never blocking
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - d, '10:00')
from unnest(array[5, 20, 80, 120]) d;
select test.login(test.id('client_b'));
select test.eq(public.client_no_show_count(test.id('client_b')), 3, 'client sees own count (last 90 days)');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(public.client_no_show_count(test.id('client_b')), 3, 'a shop with bookings from the client sees it');
select test.eq(public.client_no_show_count(test.id('client_b'), 365), 4, 'longer window');
select test.logout();
select test.login(test.id('admin'));
select test.eq(public.client_no_show_count(test.id('client_b')), 3, 'admin sees it');
select test.logout();
select test.login(test.id('shop4_owner'));
select test.eq(public.client_no_show_count(test.id('client_b')), 3, 'shop4 has a booking with client_b');
select test.logout();
select test.login(test.id('client_a'));
select test.fails(format($$select public.client_no_show_count(%L)$$, test.id('client_b')), 'not_allowed', 'another client cannot see it');
select test.logout();
select pg_temp.public_shop('shop5@test.local', 'shop5');
select test.login(test.id('shop5_owner'));
select test.fails(format($$select public.client_no_show_count(%L)$$, test.id('client_b')), 'not_allowed', 'a shop that never had the client cannot see it');
select test.logout();
-- No automatic block: client_b can still book.
update public.platform_settings set limits = limits || '{"active_bookings_total": 100}';
select test.eq(pg_temp.try_book('client_b', 'shop2', '11:00'), 'ok', '3 no-shows do not block booking');

rollback;
