-- One active booking per car at a shop (30 Oct 2026, Eduard: "Una la același service"): a second
-- booking for the same car at the same shop is refused while one is active; at another shop the
-- client cannot take the same day. A client is checked against their own bookings only; a shop
-- adding a booking is checked at its own shop only. Rows written by the server are not checked.
begin;
select test.make_world();
select set_config('test.d1', test.workday(2)::text, true);
select set_config('test.d2', test.workday(3)::text, true);

-- shop2 public too, so the client can book there.
update public.profiles set phone_verified_by_admin = true where id = test.id('owner2');
insert into public.shop_services (shop_id, service_id) values (test.id('shop2'), 'ulei'), (test.id('shop2'), 'frane');
select test.ok(public.is_shop_public(test.id('shop2')), 'shop2 is public');

-- Ana books with her saved car (BV 12 ABC) or with a car typed in.
create function pg_temp.book(p_shop text, p_day text, p_slot text, p_service text default 'ulei', p_plate text default null)
returns uuid language plpgsql as $$
begin
  perform test.login(test.id('client_a'));
  return (public.create_booking(p_shop_id => test.id(p_shop), p_service_id => p_service,
    p_date => current_setting(p_day)::date, p_slot => p_slot::time, p_request_id => gen_random_uuid(),
    p_car_id => case when p_plate is null then test.id('car_a') end,
    p_car => case when p_plate is not null then jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', p_plate) end)).id;
end $$;
grant execute on function pg_temp.book(text, text, text, text, text) to public;

-- ------------------------------------------------------------------ one at a shop
select set_config('test.b1', pg_temp.book('shop1', 'test.d1', '10:00')::text, true);
select test.logout();
select test.ok(current_setting('test.b1') <> '', 'the first booking for the car: made (an old finished one does not count)');

select test.fails($$select pg_temp.book('shop1', 'test.d2', '10:00', 'frane')$$, 'car_already_booked',
  'a second one at the same shop, another day and service: refused');
select test.logout();
select test.fails($$select pg_temp.book('shop1', 'test.d2', '11:00', 'frane', 'bv-12 abc')$$, 'car_already_booked',
  'the same plate typed in another way: refused too');
select test.logout();

-- The refusal names the booking that exists.
do $$
begin
  perform pg_temp.book('shop1', 'test.d2', '12:00', 'frane');
exception when others then
  declare v_detail text;
  begin
    get stacked diagnostics v_detail = pg_exception_detail;
    perform test.eq((v_detail::jsonb)->>'ref', (select ref from public.bookings where id = current_setting('test.b1')::uuid), 'the refusal names the booking');
    perform test.eq((v_detail::jsonb)->>'date', current_setting('test.d1'), 'and its day');
    perform test.eq((v_detail::jsonb)->>'slot', '10:00', 'and its time');
  end;
end $$;
select test.logout();

select test.ok(pg_temp.book('shop1', 'test.d2', '10:00', 'ulei', 'B 999 XYZ') is not null, 'another car at the same shop: made');
select test.logout();

-- ------------------------------------------------------------------ another shop
select test.fails($$select pg_temp.book('shop2', 'test.d1', '15:00')$$, 'car_booked_that_day',
  'the same car at another shop on the same day: refused');
select test.logout();
select set_config('test.b2', pg_temp.book('shop2', 'test.d2', '15:00')::text, true);
select test.logout();
select test.ok(current_setting('test.b2') <> '', 'the same car at another shop on another day: made');

-- ------------------------------------------------------------------ another person's account
-- Bogdan types Ana's plate: he is checked against his own bookings only, never told about hers.
create function pg_temp.book_b(p_shop text, p_day text, p_slot text) returns uuid language plpgsql as $$
begin
  perform test.login(test.id('client_b'));
  return (public.create_booking(p_shop_id => test.id(p_shop), p_service_id => 'frane',
    p_date => current_setting(p_day)::date, p_slot => p_slot::time, p_request_id => gen_random_uuid(),
    p_car => jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', 'BV 12 ABC'))).id;
end $$;
grant execute on function pg_temp.book_b(text, text, text) to public;
select set_config('test.bb', pg_temp.book_b('shop1', 'test.d2', '13:00')::text, true);
select test.logout();
select test.ok(current_setting('test.bb') <> '', 'another account with the same plate at the same shop: not blocked, nothing told');
select test.ok(pg_temp.book_b('shop2', 'test.d1', '13:00') is not null, 'nor at another shop on the same day');
select test.logout();
update public.bookings set status = 'cancelled', cancelled_by = 'client', cancelled_at = now()
where client_id = test.id('client_b') and car_snapshot->>'plate_norm' = 'BV12ABC';

-- ------------------------------------------------------------------ a shop adding a booking
create function pg_temp.add(p_day text, p_slot text, p_plate text) returns uuid language plpgsql as $$
begin
  return (public.shop_create_booking(p_service_id => 'ulei', p_date => current_setting(p_day)::date, p_slot => p_slot::time,
    p_client_name => 'Ana Marin', p_client_phone => '0723000001',
    p_car => jsonb_build_object('make', 'Volkswagen', 'model', 'Golf 7', 'plate', p_plate),
    p_request_id => gen_random_uuid(), p_send_invite => false)).id;
end $$;
grant execute on function pg_temp.add(text, text, text) to public;

select test.login(test.id('owner1'));
select test.fails($$select pg_temp.add('test.d2', '14:00', 'BV 12 ABC')$$, 'car_already_booked',
  'the shop cannot add a second booking for a car it already has');
select test.logout();
select test.login(test.id('owner2'));
select test.fails($$select pg_temp.add('test.d1', '16:00', 'BV 12 ABC')$$, 'car_already_booked',
  'nor can shop2, which has the car on another day');
select test.ok(pg_temp.add('test.d1', '16:00', 'B 999 XYZ') is not null,
  'a car booked at another shop on that day: the shop is not told, the booking is made');
select test.logout();

-- ------------------------------------------------------------------ when the first one ends
update public.bookings set status = 'cancelled', cancelled_by = 'client', cancelled_at = now()
where id = current_setting('test.b1')::uuid;
select test.ok(pg_temp.book('shop1', 'test.d1', '11:00', 'frane') is not null, 'canceled: the car can be booked again');
select test.logout();

-- ------------------------------------------------------------------ the server is not checked
insert into public.bookings (shop_id, client_id, service_id, client_name, car_id, car_snapshot, date, slot, status)
values (test.id('shop1'), test.id('client_a'), 'ulei', 'Ana Marin', test.id('car_a'),
        '{"plate":"BV 12 ABC","plate_norm":"BV12ABC"}', current_setting('test.d2')::date, '09:00', 'confirmed');
select test.ok(true, 'a row written by the server (seed, import) is left as it is');

-- The rule is not callable from the API.
select test.ok(not has_function_privilege('authenticated', 'public.bookings_car_rule()', 'execute'), 'the rule is not callable');

rollback;
