-- New-client offers (T23): the owner picks a discount for first bookings; a booking made by a
-- client new at that shop remembers it; nobody else can set either; search order is untouched.
begin;
select test.make_world();
select set_config('test.day', test.workday(2)::text, true);
select set_config('test.client_c', test.sign_up('carmen@test.local',
  '{"role":"client","name":"Carmen Dinu","phone":"0723000003","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.client_d', test.sign_up('dan@test.local',
  '{"role":"client","name":"Dan Radu","phone":"0723000004","lang":"en","terms_version":"2026-09"}')::text, true);

-- Books at shop1 as the given client; answers the new booking's id.
create function pg_temp.book(p_client text, p_slot text, p_plate text) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  perform test.login(current_setting(p_client)::uuid);
  select (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei',
    p_date => current_setting('test.day')::date, p_slot => p_slot::time, p_request_id => gen_random_uuid(),
    p_car => jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', p_plate))).id into v_id;
  perform test.logout();
  return v_id;
end $$;

-- ------------------------------------------------------------------ who sets it
select test.login(test.id('owner1'));
update public.shops set new_client_offer = 10 where id = test.id('shop1');
select test.fails($$update public.shops set new_client_offer = 12 where id = test.id('shop1')$$,
  'new_client_offer', 'only the listed percentages');
select test.logout();
select test.eq(new_client_offer, 10, 'the owner sets the offer') from public.shops where id = test.id('shop1');

select test.login(test.id('staff1'));
update public.shops set new_client_offer = 30 where id = test.id('shop1');
select test.logout();
select test.login(current_setting('test.client_c')::uuid);
update public.shops set new_client_offer = 30 where id = test.id('shop1');
select test.fails($$update public.bookings set offer_percent = 50$$, 'permission denied', 'a client cannot write an offer on a booking');
select test.logout();
select test.eq(new_client_offer, 10, 'neither a colleague nor a client changes it') from public.shops where id = test.id('shop1');

-- ------------------------------------------------------------------ who sees it
select test.login(current_setting('test.client_c')::uuid);
select test.eq((select jsonb_agg(jsonb_build_object('shop', o.shop_id = test.id('shop1'), 'percent', o.percent))
  from public.new_client_offers(array[test.id('shop1'), test.id('shop2')]) o),
  '[{"shop": true, "percent": 10}]'::jsonb, 'a new client sees the public shop''s offer');
select test.logout();
select test.login(test.id('client_a'));
select test.eq(test.count(format('select 1 from public.new_client_offers(array[%L]::uuid[])', test.id('shop1'))), 0::bigint,
  'a client who already went there does not');
select test.logout();
select test.login_anon();
select test.fails(format('select public.new_client_offers(array[%L]::uuid[])', test.id('shop1')), 'permission denied', 'signed in only');
select test.logout();

-- ------------------------------------------------------------------ the booking remembers it
select set_config('test.b1', pg_temp.book('test.client_c', '09:00', 'BV 01 NEW')::text, true);
select test.eq(offer_percent, 10, 'the first booking carries the offer') from public.bookings where id = current_setting('test.b1')::uuid;
select set_config('test.b2', pg_temp.book('test.client_c', '10:00', 'BV 01 NEW')::text, true);
select test.eq(offer_percent, null::int, 'a second one, while the first is open, does not') from public.bookings where id = current_setting('test.b2')::uuid;
select test.login(current_setting('test.client_c')::uuid);
select test.eq(test.count(format('select 1 from public.new_client_offers(array[%L]::uuid[])', test.id('shop1'))), 0::bigint,
  'and the shop no longer shows it to them');
select test.logout();

-- A request the client canceled does not use it up.
select set_config('test.d1', pg_temp.book('test.client_d', '11:00', 'BV 02 DAN')::text, true);
select test.login(current_setting('test.client_d')::uuid);
select public.cancel_booking(current_setting('test.d1')::uuid, gen_random_uuid());
select test.logout();
select set_config('test.d2', pg_temp.book('test.client_d', '12:00', 'BV 02 DAN')::text, true);
select test.eq(offer_percent, 10, 'after a canceled request the next one still gets it') from public.bookings where id = current_setting('test.d2')::uuid;

-- The car that already went there under another account does not.
update public.bookings set status = 'cancelled' where id = current_setting('test.d2')::uuid;
select set_config('test.d3', pg_temp.book('test.client_d', '13:00', 'BV-12-ABC')::text, true);
select test.eq(offer_percent, null::int, 'the same plate counts as the same client') from public.bookings where id = current_setting('test.d3')::uuid;

-- A changed offer keeps the promise already made; a removed one is shown to nobody.
select test.login(test.id('owner1'));
update public.shops set new_client_offer = null where id = test.id('shop1');
select test.eq(d->>'offer_percent', '10', 'the shop''s list shows what the booking was promised')
from jsonb_array_elements(public.list_shop_bookings()->'bookings') d where d->>'id' = current_setting('test.b1');
select test.logout();
select test.eq(offer_percent, 10, 'kept after the offer is removed') from public.bookings where id = current_setting('test.b1')::uuid;
update public.bookings set status = 'cancelled' where client_id = current_setting('test.client_c')::uuid;
select test.login(current_setting('test.client_c')::uuid);
select test.eq(test.count(format('select 1 from public.new_client_offers(array[%L]::uuid[])', test.id('shop1'))), 0::bigint,
  'no offer, nothing shown');
select test.logout();

rollback;
