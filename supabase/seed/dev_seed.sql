-- Demo data for LOCAL tests only (CLAUDE.md §9). Never run on the real project unless Eduard asks.
-- Loaded by `npx supabase db reset` (config.toml → db.seed) and checked by `npm run test:sql`.
--
-- The four shops of docs/reference-demo.html (Brașov, Codlea), one client with two cars and a
-- booking in every status, four more clients who left the demo reviews, and an admin. Atelier Demo
-- also has a year of finished work, for Rapoarte (T17).
-- Every account's password: Parola-Test-1
--
--   atelier@service-hub.test      shop  Atelier Demo (Brașov)        — fiscal data filled in
--   rapid@service-hub.test        shop  Rapid Service (Brașov)
--   vulcanizare@service-hub.test  shop  Vulcanizare Roți Expres (Brașov)
--   precis@service-hub.test       shop  Auto Precis (Codlea)
--   client@service-hub.test       client Andrei Marin — Golf 7 + Duster, bookings in every status
--   admin@service-hub.test        admin

-- Creates a confirmed email/password account; the sign-up trigger builds profile and shop.
create function pg_temp.seed_user(p_id uuid, p_email text, p_meta jsonb) returns uuid
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
    email_change, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Parola-Test-1', extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}', p_meta, now() - interval '120 days', now()
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at,
                               created_at, updated_at)
  values (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
          'email', now(), now(), now());
  return p_id;
end
$$;

-- Books a slot for a seeded client, with the snapshots create_booking() would take.
create function pg_temp.seed_booking(
  p_shop uuid, p_client uuid, p_car uuid, p_service text, p_day int, p_slot time, p_status text,
  p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_profile public.profiles%rowtype;
  v_car public.cars%rowtype;
begin
  select * into v_profile from public.profiles where id = p_client;
  select * into v_car from public.cars where id = p_car;
  insert into public.bookings (
    shop_id, client_id, service_id, client_name, client_phone, client_lang, car_id, car_snapshot,
    date, slot, note, status, created_at
  ) values (
    p_shop, p_client, p_service, v_profile.name, v_profile.phone, v_profile.lang, p_car,
    case when v_car.id is null then '{}'::jsonb else jsonb_build_object(
      'make', v_car.make, 'model', v_car.model, 'year', v_car.year, 'plate', v_car.plate,
      'plate_norm', v_car.plate_norm, 'vin', v_car.vin) end,
    public.bucharest_today() + p_day, p_slot, p_note, p_status,
    least(now(), (public.bucharest_today() + p_day)::timestamptz - interval '3 days')
  )
  returning id into v_id;
  return v_id;
end
$$;

-- A quote with its items; `approved` per item follows the decision.
create function pg_temp.seed_quote(
  p_booking uuid, p_status text, p_fee numeric, p_items jsonb, p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_total numeric := (select sum((i->>'price')::numeric) from jsonb_array_elements(p_items) i);
  v_approved numeric := (select sum((i->>'price')::numeric) from jsonb_array_elements(p_items) i
                         where (i->>'ok')::boolean);
begin
  insert into public.quotes (booking_id, version, status, note, inspection_fee, total_sent,
                             total_approved, sent_at, expires_at, decided_at, sent_by)
  select p_booking, 1, p_status, p_note, p_fee, v_total,
         case when p_status in ('accepted', 'partially_accepted') then v_approved end,
         now() - interval '1 day', now() + interval '2 days',
         case when p_status in ('accepted', 'partially_accepted', 'refused') then now() - interval '12 hours' end,
         s.owner_id
  from public.bookings b join public.shops s on s.id = b.shop_id
  where b.id = p_booking
  returning id into v_id;

  insert into public.quote_items (quote_id, position, name, price, approved)
  select v_id, ord, i->>'name', (i->>'price')::numeric,
         case when p_status in ('accepted', 'partially_accepted', 'refused') then (i->>'ok')::boolean end
  from jsonb_array_elements(p_items) with ordinality as t(i, ord);
  return v_id;
end
$$;

do $$
declare
  -- people
  u_atelier uuid := pg_temp.seed_user('10000000-0000-4000-8000-000000000001', 'atelier@service-hub.test',
    '{"role":"shop","name":"Ion Popescu","phone":"0268 312 445","shop_name":"Atelier Demo","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
  u_rapid uuid := pg_temp.seed_user('10000000-0000-4000-8000-000000000002', 'rapid@service-hub.test',
    '{"role":"shop","name":"Radu Stoica","phone":"0268 447 210","shop_name":"Rapid Service","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
  u_vulc uuid := pg_temp.seed_user('10000000-0000-4000-8000-000000000003', 'vulcanizare@service-hub.test',
    '{"role":"shop","name":"Marius Dinu","phone":"0268 901 332","shop_name":"Vulcanizare Roți Expres","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
  u_precis uuid := pg_temp.seed_user('10000000-0000-4000-8000-000000000004', 'precis@service-hub.test',
    '{"role":"shop","name":"Elena Vasile","phone":"0268 251 108","shop_name":"Auto Precis","city":"Codlea","lang":"ro","terms_version":"2026-09"}');
  u_client uuid := pg_temp.seed_user('20000000-0000-4000-8000-000000000001', 'client@service-hub.test',
    '{"role":"client","name":"Andrei Marin","phone":"0723 375 248","lang":"ro","terms_version":"2026-09"}');
  u_cristina uuid := pg_temp.seed_user('20000000-0000-4000-8000-000000000002', 'cristina@service-hub.test',
    '{"role":"client","name":"Cristina Dobre","phone":"0724 100 200","lang":"ro","terms_version":"2026-09"}');
  u_mihai uuid := pg_temp.seed_user('20000000-0000-4000-8000-000000000003', 'mihai@service-hub.test',
    '{"role":"client","name":"Mihai Petrescu","phone":"0725 100 200","lang":"ro","terms_version":"2026-09"}');
  u_ioana uuid := pg_temp.seed_user('20000000-0000-4000-8000-000000000004', 'ioana@service-hub.test',
    '{"role":"client","name":"Ioana Radu","phone":"0726 100 200","lang":"en","terms_version":"2026-09"}');
  u_george uuid := pg_temp.seed_user('20000000-0000-4000-8000-000000000005', 'george@service-hub.test',
    '{"role":"client","name":"George Toma","phone":"0727 100 200","lang":"ro","terms_version":"2026-09"}');
  u_admin uuid := pg_temp.seed_user('30000000-0000-4000-8000-000000000001', 'admin@service-hub.test',
    '{"role":"client","name":"Eduard Admin","lang":"ro","terms_version":"2026-09"}');
  -- shops
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  -- cars
  c_golf uuid; c_duster uuid;
  -- bookings
  b uuid;
  t uuid;
  i int;
  v_at timestamptz;
begin
  perform public.promote_to_admin('admin@service-hub.test');

  select id into s1 from public.shops where owner_id = u_atelier;
  select id into s2 from public.shops where owner_id = u_rapid;
  select id into s3 from public.shops where owner_id = u_vulc;
  select id into s4 from public.shops where owner_id = u_precis;

  -- Phones verified by admin, so all four shops are public.
  update public.profiles set phone_verified_by_admin = true
  where id in (u_atelier, u_rapid, u_vulc, u_precis);

  update public.shops set street = 'Str. Lungă 42', county = 'Brașov', postal_code = '500059',
    description = 'Service auto multimarcă, 12 ani experiență.', daily_capacity = 6, inspection_fee = 80,
    latitude = 45.6440, longitude = 25.5870, year_established = 2013, setup_completed_at = now()
  where id = s1;
  update public.shops set street = 'Calea București 18', county = 'Brașov', postal_code = '500365',
    description = 'Specializat pe suspensie și frânare.', daily_capacity = 4, inspection_fee = 50,
    latitude = 45.6505, longitude = 25.6200, setup_completed_at = now()
  where id = s2;
  update public.shops set street = 'Str. Zizinului 7', county = 'Brașov', postal_code = '500407',
    description = 'Vulcanizare rapidă, fără programare lungă.', daily_capacity = 14, cars_per_slot = 2,
    inspection_fee = 0, latitude = 45.6440, longitude = 25.6230, setup_completed_at = now()
  where id = s3;
  update public.shops set street = 'Str. Lungă 3', county = 'Brașov', postal_code = '505100',
    description = 'Diagnoză și reparații motor.', daily_capacity = 5, inspection_fee = 100,
    latitude = 45.6969, longitude = 25.4439, setup_completed_at = now()
  where id = s4;
  -- The first-run checklist (T05) is done for the demo shops.
  update public.shops set hours_reviewed_at = now(), capacity_reviewed_at = now() where id in (s1, s2, s3, s4);

  -- Hours: Atelier Demo 08–18, Rapid 08–17, Vulcanizare 08–20 (+ Saturday 09–14), Precis 09–17.
  update public.shop_hours set open_time = '08:00', close_time = '17:00' where shop_id = s2 and not is_closed;
  update public.shop_hours set open_time = '08:00', close_time = '20:00' where shop_id = s3 and not is_closed;
  update public.shop_hours set is_closed = false, open_time = '09:00', close_time = '14:00' where shop_id = s3 and weekday = 6;
  update public.shop_hours set open_time = '09:00', close_time = '17:00' where shop_id = s4 and not is_closed;

  insert into public.shop_closures (shop_id, start_date, end_date, label)
  values (s1, public.bucharest_today() + 20, public.bucharest_today() + 22, 'Concediu');

  insert into public.shop_services (shop_id, service_id)
  select s1, unnest(array['ulei', 'frane', 'itp', 'diag', 'clima', 'distributie'])
  union all select s2, unnest(array['ulei', 'frane', 'vulcanizare', 'geometrie', 'suspensie'])
  union all select s3, unnest(array['vulcanizare', 'geometrie'])
  union all select s4, unnest(array['ulei', 'diag', 'ambreiaj', 'distributie', 'frane']);

  update public.shop_billing set legal_name = 'AUTO DEMO SERV S.R.L.', vat_id = 'RO14872301',
    reg_com = 'J08/1245/2009', legal_address = 'Str. Lungă 42, Brașov', vat_payer = true,
    bank_name = 'Banca Transilvania', iban = 'RO49AAAA1B31007593840000',
    billing_email = 'facturi@atelierdemo.ro', legal_rep = 'Ion Popescu'
  where shop_id = s1;

  -- The client's garage.
  insert into public.cars (owner_id, make, model, year, plate, vin, itp_expiry, rca_expiry, vignette_expiry)
  values (u_client, 'Volkswagen', 'Golf 7', 2016, 'BV 12 ABC', 'WVWZZZAUZGW123456',
          public.bucharest_today() + 48, public.bucharest_today() + 12, public.bucharest_today() - 3)
  returning id into c_golf;
  insert into public.cars (owner_id, make, model, year, plate, itp_expiry, rca_expiry, vignette_expiry)
  values (u_client, 'Dacia', 'Duster', 2020, 'BV 07 DAC', public.bucharest_today() + 200, public.bucharest_today() + 150, public.bucharest_today() + 90)
  returning id into c_duster;

  insert into public.favorites (client_id, shop_id) values (u_client, s1);

  -- One booking in every status.
  perform pg_temp.seed_booking(s1, u_client, c_golf, 'ulei', 3, '10:00', 'pending', 'Aș vrea și verificarea lichidelor.');

  b := pg_temp.seed_booking(s2, u_client, c_duster, 'frane', 2, '09:00', 'confirmed');
  update public.bookings set confirmed_at = now() - interval '1 day' where id = b;

  b := pg_temp.seed_booking(s1, u_client, c_duster, 'diag', 1, '11:00', 'in_inspection', 'Martorul de motor aprins.');
  update public.bookings set confirmed_at = now() - interval '2 days', inspection_started_at = now() where id = b;

  b := pg_temp.seed_booking(s1, u_client, c_golf, 'frane', 1, '09:00', 'quote_sent', 'Scârțâie la frânare dimineața.');
  update public.bookings set confirmed_at = now() - interval '2 days', inspection_started_at = now() - interval '1 day' where id = b;
  perform pg_temp.seed_quote(b, 'sent', 80,
    '[{"name":"Plăcuțe frână față","price":280,"ok":true},{"name":"Discuri frână față","price":420,"ok":true},{"name":"Manoperă","price":150,"ok":true}]',
    'Discurile sunt sub limită, recomand schimbarea împreună.');

  b := pg_temp.seed_booking(s4, u_client, c_duster, 'distributie', 1, '14:00', 'approved');
  update public.bookings set confirmed_at = now() - interval '3 days', inspection_started_at = now() - interval '2 days' where id = b;
  perform pg_temp.seed_quote(b, 'partially_accepted', 100,
    '[{"name":"Kit distribuție","price":950,"ok":true},{"name":"Pompă apă","price":320,"ok":false},{"name":"Manoperă","price":400,"ok":true}]');

  b := pg_temp.seed_booking(s4, u_client, c_golf, 'ulei', 2, '15:00', 'in_progress');
  update public.bookings set confirmed_at = now() - interval '3 days', inspection_started_at = now() - interval '2 days',
    started_at = now() - interval '1 hour' where id = b;
  perform pg_temp.seed_quote(b, 'accepted', 100,
    '[{"name":"Ulei 5W30 5L","price":210,"ok":true},{"name":"Filtru ulei","price":45,"ok":true}]');

  b := pg_temp.seed_booking(s2, u_client, c_golf, 'ulei', -40, '10:00', 'done');
  update public.bookings set work = 'Schimb ulei 5W30 + filtru ulei și aer', cost = 340, odometer = 105400,
    done_at = (public.bucharest_today() - 40) + time '13:00' where id = b;
  perform pg_temp.seed_quote(b, 'accepted', 50,
    '[{"name":"Ulei 5W30 5L","price":210,"ok":true},{"name":"Filtru ulei","price":45,"ok":true},{"name":"Manoperă","price":85,"ok":true}]');

  b := pg_temp.seed_booking(s1, u_client, c_golf, 'itp', -95, '14:00', 'done');
  update public.bookings set work = 'ITP efectuat, admis', cost = 150, odometer = 98200,
    done_at = (public.bucharest_today() - 95) + time '15:00' where id = b;
  perform pg_temp.seed_quote(b, 'accepted', 80, '[{"name":"ITP","price":150,"ok":true}]');
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text, reply, reply_at, created_at)
  values (b, s1, u_client, 'Andrei M.', 5, 'Prompt, deviz clar, fără surprize la plată.',
          'Mulțumim, vă așteptăm cu drag.', now() - interval '11 days', now() - interval '12 days');

  b := pg_temp.seed_booking(s3, u_client, c_duster, 'vulcanizare', -5, '12:00', 'declined');
  update public.bookings set decline_reason = 'Nu avem anvelope pe stoc pentru dimensiunea ta.' where id = b;

  b := pg_temp.seed_booking(s2, u_client, c_duster, 'geometrie', -12, '16:00', 'cancelled');
  update public.bookings set cancelled_by = 'client', cancelled_at = now() - interval '13 days' where id = b;

  b := pg_temp.seed_booking(s1, u_client, c_duster, 'clima', -30, '11:00', 'quote_refused');
  update public.bookings set cost = 80 where id = b;
  perform pg_temp.seed_quote(b, 'refused', 80, '[{"name":"Compresor clima","price":1600,"ok":false}]');

  b := pg_temp.seed_booking(s4, u_client, c_golf, 'diag', -8, '10:00', 'expired');
  perform pg_temp.seed_quote(b, 'expired', 100, '[{"name":"Senzor ABS","price":380,"ok":false}]');

  perform pg_temp.seed_booking(s3, u_client, c_golf, 'geometrie', -20, '09:00', 'no_show');

  -- Atelier Demo's working week (T08), with other clients: a confirmed booking whose time has
  -- passed (no-show possible), one tomorrow, a partly accepted quote, a job in progress today, and
  -- George's three no-shows elsewhere (the shop sees "Client cu 3 neprezentări"). Past active
  -- bookings are refused by the bookings trigger, so it is paused for these rows only.
  alter table public.bookings disable trigger bookings_guard;
  b := pg_temp.seed_booking(s1, u_george, null, 'ulei', -1, '16:00', 'confirmed', 'Vin după program, dacă se poate.');
  update public.bookings set confirmed_at = now() - interval '3 days',
    car_snapshot = '{"make":"Renault","model":"Clio","year":2015,"plate":"BV 21 GTO","plate_norm":"BV21GTO"}' where id = b;
  perform pg_temp.seed_booking(s2, u_george, null, 'ulei', -15, '09:00', 'no_show');
  perform pg_temp.seed_booking(s3, u_george, null, 'vulcanizare', -25, '10:00', 'no_show');
  perform pg_temp.seed_booking(s4, u_george, null, 'diag', -40, '11:00', 'no_show');

  b := pg_temp.seed_booking(s1, u_cristina, null, 'geometrie', 1, '10:00', 'confirmed');
  update public.bookings set confirmed_at = now() - interval '1 day',
    car_snapshot = '{"make":"Toyota","model":"Corolla","year":2019,"plate":"BV 55 CRD","plate_norm":"BV55CRD"}' where id = b;

  b := pg_temp.seed_booking(s1, u_mihai, null, 'suspensie', 1, '13:00', 'approved');
  update public.bookings set confirmed_at = now() - interval '2 days', inspection_started_at = now() - interval '1 day',
    car_snapshot = '{"make":"Skoda","model":"Octavia","year":2017,"plate":"BV 90 MHP","plate_norm":"BV90MHP"}' where id = b;
  perform pg_temp.seed_quote(b, 'partially_accepted', 80,
    '[{"name":"Bieletă antiruliu","price":180,"ok":true},{"name":"Amortizoare spate","price":640,"ok":false},{"name":"Manoperă","price":150,"ok":true}]');

  b := pg_temp.seed_booking(s1, u_ioana, null, 'ulei', 0, '08:00', 'in_progress');
  update public.bookings set confirmed_at = now() - interval '2 days', inspection_started_at = now() - interval '1 day',
    started_at = now() - interval '40 minutes',
    car_snapshot = '{"make":"Ford","model":"Focus","year":2018,"plate":"B 123 IRD","plate_norm":"B123IRD"}' where id = b;
  perform pg_temp.seed_quote(b, 'accepted', 80,
    '[{"name":"Ulei 5W30 5L","price":210,"ok":true},{"name":"Filtru ulei","price":45,"ok":true}]');
  alter table public.bookings enable trigger bookings_guard;

  -- The other demo reviews, each on its own completed booking.
  b := pg_temp.seed_booking(s1, u_cristina, null, 'frane', -35, '10:00', 'done');
  update public.bookings set cost = 760, odometer = 142000, done_at = now() - interval '34 days' where id = b;
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text, created_at)
  values (b, s1, u_cristina, 'Cristina D.', 4, 'Treabă bună, dar am așteptat puțin peste ora programată.', now() - interval '31 days');

  b := pg_temp.seed_booking(s2, u_mihai, null, 'suspensie', -10, '09:00', 'done');
  update public.bookings set cost = 690, odometer = 88000, done_at = now() - interval '9 days' where id = b;
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text, created_at)
  values (b, s2, u_mihai, 'Mihai P.', 5, 'Rapizi și corecți.', now() - interval '8 days');

  b := pg_temp.seed_booking(s2, u_ioana, null, 'ulei', -46, '11:00', 'done');
  update public.bookings set cost = 310, odometer = 61000, done_at = now() - interval '45 days' where id = b;
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text, created_at)
  values (b, s2, u_ioana, 'Ioana R.', 4, 'Preț ok pentru ce au făcut.', now() - interval '44 days');

  b := pg_temp.seed_booking(s4, u_george, null, 'diag', -21, '13:00', 'done');
  update public.bookings set cost = 200, odometer = 173500, done_at = now() - interval '20 days' where id = b;
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text, created_at)
  values (b, s4, u_george, 'George T.', 5, 'Au găsit o problemă pe care alții au ratat-o.', now() - interval '19 days');

  -- A year of finished work at Atelier Demo (T17), so Rapoarte has months, services, customers who
  -- came back and quotes to show: a job every ten days, every sixth quote refused (the inspection
  -- fee charged). The shop joined 400 days ago. Past bookings are refused by the bookings trigger,
  -- so it is paused for these rows only.
  update public.shops set created_at = now() - interval '400 days' where id = s1;
  alter table public.bookings disable trigger bookings_guard;
  for i in 0..35 loop
    b := pg_temp.seed_booking(s1, (array[u_cristina, u_mihai, u_ioana, u_george, u_cristina])[i % 5 + 1], null,
      (array['ulei', 'frane', 'itp', 'diag', 'ulei', 'clima', 'distributie', 'frane', 'ulei'])[i % 9 + 1],
      -(38 + i * 10), (array['08:00', '10:00', '13:00', '15:00'])[i % 4 + 1]::time,
      case when i % 6 = 5 then 'quote_refused' else 'done' end);
    v_at := ((public.bucharest_today() - (38 + i * 10)) + (array['08:00', '10:00', '13:00', '15:00'])[i % 4 + 1]::time) at time zone 'Europe/Bucharest';
    update public.bookings set
      car_snapshot = (array[
        '{"make":"Toyota","model":"Corolla","year":2019,"plate":"BV 55 CRD","plate_norm":"BV55CRD"}',
        '{"make":"Skoda","model":"Octavia","year":2017,"plate":"BV 90 MHP","plate_norm":"BV90MHP"}',
        '{"make":"Ford","model":"Focus","year":2018,"plate":"B 123 IRD","plate_norm":"B123IRD"}',
        '{"make":"Renault","model":"Clio","year":2015,"plate":"BV 21 GTO","plate_norm":"BV21GTO"}'
      ])[i % 4 + 1]::jsonb,
      confirmed_at = v_at - interval '2 days', inspection_started_at = v_at, status_changed_at = v_at + interval '1 day',
      started_at = case when i % 6 = 5 then null else v_at + interval '5 hours' end,
      done_at = case when i % 6 = 5 then null else v_at + interval '1 day' end,
      odometer = case when i % 6 = 5 then null else 60000 + i * 2300 end,
      work = case when i % 6 = 5 then null else 'Lucrare efectuată conform devizului' end,
      cost = case when i % 6 = 5 then 80 else (array[310, 820, 150, 180, 340, 260, 1380, 760, 295])[i % 9 + 1] end
    where id = b;
    insert into public.quotes (booking_id, version, status, inspection_fee, total_sent, total_approved,
                               sent_at, expires_at, decided_at, sent_by)
    values (b, 1, case when i % 6 = 5 then 'refused' else 'accepted' end, 80,
            case when i % 6 = 5 then 1450 else (array[310, 820, 150, 180, 340, 260, 1380, 760, 295])[i % 9 + 1] end,
            case when i % 6 = 5 then 0 else (array[310, 820, 150, 180, 340, 260, 1380, 760, 295])[i % 9 + 1] end,
            v_at + interval '1 hour', v_at + interval '3 days', v_at + interval '1 hour' + (i % 7 + 1) * interval '50 minutes',
            u_atelier)
    returning id into t;
    insert into public.quote_items (quote_id, position, name, price, approved)
    values (t, 1, 'Piese și manoperă', case when i % 6 = 5 then 1450 else (array[310, 820, 150, 180, 340, 260, 1380, 760, 295])[i % 9 + 1] end,
            i % 6 <> 5);
  end loop;
  alter table public.bookings enable trigger bookings_guard;

  -- Conversations: automatic messages as event + parameters, and a plain chat.
  insert into public.threads (shop_id, client_id, client_name, last_message_at)
  values (s1, u_client, 'Andrei Marin', now() - interval '12 minutes') returning id into t;
  insert into public.messages (thread_id, kind, event, params, created_at) values
    (t, 'system', 'booking_confirmed', jsonb_build_object('date', public.bucharest_today() + 1, 'slot', '09:00'), now() - interval '120 minutes'),
    (t, 'system', 'inspection_started', '{}', now() - interval '45 minutes'),
    (t, 'system', 'quote_sent', '{"total":850}', now() - interval '12 minutes');

  insert into public.threads (shop_id, client_id, client_name, last_message_at, client_last_read_at)
  values (s2, u_client, 'Andrei Marin', now() - interval '2790 minutes', now() - interval '2790 minutes') returning id into t;
  insert into public.messages (thread_id, kind, sender_id, body, created_at) values
    (t, 'user', u_rapid, 'Bună ziua, lucrarea e gata, puteți veni oricând până la 17.', now() - interval '2800 minutes'),
    (t, 'user', u_client, 'Mulțumesc, vin în 20 de minute.', now() - interval '2790 minutes');

  insert into public.notices (audience, title_ro, body_ro, title_en, body_en, created_by)
  values ('all', 'Bine ai venit pe Service-Hub', 'Aceasta este o versiune de test.',
          'Welcome to Service-Hub', 'This is a test version.', u_admin);
end
$$;
