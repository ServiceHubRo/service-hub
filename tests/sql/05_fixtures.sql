-- Shared test world for the RLS and protected-column tests. Creates the function only;
-- each test file calls test.make_world() inside its own transaction and rolls back.
--
--   client_a  — client with a car, a completed booking at shop1 (quote, review, thread, report)
--   client_b  — client with a car, a pending booking at shop2, a completed booking at shop1
--               whose review was removed
--   owner1 / staff1 — shop1 "Atelier Unu", Brașov: public (verified, one service, open days)
--   owner2    — shop2 "Atelier Doi", Codlea: not public (no services, phone not verified)
--   admin     — promoted with promote_to_admin()

create table test.ids (name text primary key, id uuid not null);
grant select on test.ids to public;

-- Looks up a fixture id by name (works under any role).
create function test.id(p_name text) returns uuid
language sql
stable
security definer
as $$ select id from test.ids where name = p_name $$;
grant execute on function test.id(text) to public;

create function test.make_world() returns void
language plpgsql
as $$
declare
  v_client_a uuid;
  v_client_b uuid;
  v_owner1 uuid;
  v_owner2 uuid;
  v_staff1 uuid;
  v_admin uuid;
  v_shop1 uuid;
  v_shop2 uuid;
  v_car_a uuid;
  v_car_b uuid;
  v_booking_a uuid;
  v_booking_b uuid;
  v_booking_b1 uuid;
  v_quote_a uuid;
  v_thread_a uuid;
  v_thread_b uuid;
begin
  delete from test.ids;

  v_client_a := test.sign_up('ana@test.local',
    '{"role":"client","name":"Ana Marin","phone":"0723000001","lang":"ro","terms_version":"2026-09"}');
  v_client_b := test.sign_up('bogdan@test.local',
    '{"role":"client","name":"Bogdan Pop","phone":"0723000002","lang":"en","terms_version":"2026-09"}');
  v_owner1 := test.sign_up('owner1@test.local',
    '{"role":"shop","name":"Ion Popescu","phone":"0268312445","shop_name":"Atelier Unu","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
  v_owner2 := test.sign_up('owner2@test.local',
    '{"role":"shop","name":"Maria Ionescu","phone":"0268251108","shop_name":"Atelier Doi","city":"Codlea","lang":"ro","terms_version":"2026-09"}');
  v_staff1 := test.sign_up('staff1@test.local', '{"role":"client","name":"Vlad Staff"}');
  v_admin := test.sign_up('admin@test.local', '{"role":"client","name":"Admin"}');
  perform public.promote_to_admin('admin@test.local');

  select id into v_shop1 from public.shops where owner_id = v_owner1;
  select id into v_shop2 from public.shops where owner_id = v_owner2;

  -- Staff member of shop1 (the real invite flow arrives in T05).
  update public.profiles set role = 'shop' where id = v_staff1;
  insert into public.shop_staff (shop_id, user_id, invited_email, role, invite_token_hash, accepted_at)
  values (v_shop1, v_staff1, 'staff1@test.local', 'staff', 'secret-hash', now());

  -- shop1 becomes public: phone verified, one service. shop2 stays private.
  update public.profiles set phone_verified_by_admin = true where id = v_owner1;
  insert into public.shop_services (shop_id, service_id) values (v_shop1, 'ulei'), (v_shop1, 'frane');

  update public.shop_billing
    set legal_name = 'AUTO UNU SRL', vat_id = 'RO14872301', reg_com = 'J08/1245/2009',
        iban = 'RO49AAAA1B31007593840000', legal_rep = 'Ion Popescu'
    where shop_id = v_shop1;
  update public.shop_billing set legal_name = 'AUTO DOI SRL', vat_id = '160796' where shop_id = v_shop2;

  insert into public.cars (owner_id, make, model, year, plate, vin)
  values (v_client_a, 'Volkswagen', 'Golf 7', 2016, 'BV 12 ABC', 'WVWZZZAUZGW123456')
  returning id into v_car_a;
  insert into public.cars (owner_id, make, model, year, plate)
  values (v_client_b, 'Dacia', 'Logan', 2019, 'BV-44-KLM')
  returning id into v_car_b;

  insert into public.bookings (shop_id, client_id, service_id, client_name, client_phone, car_id,
                               car_snapshot, date, slot, status, work, cost, odometer, done_at)
  values (v_shop1, v_client_a, 'ulei', 'Ana Marin', '+40723000001', v_car_a,
          '{"make":"Volkswagen","model":"Golf 7","plate":"BV 12 ABC","plate_norm":"BV12ABC"}',
          current_date - 10, '10:00', 'done', 'Schimb ulei', 340, 105400, now() - interval '10 days')
  returning id into v_booking_a;

  insert into public.bookings (shop_id, client_id, service_id, client_name, car_id, car_snapshot,
                               date, slot, status)
  values (v_shop2, v_client_b, 'ulei', 'Bogdan Pop', v_car_b,
          '{"make":"Dacia","model":"Logan","plate":"BV-44-KLM","plate_norm":"BV44KLM"}',
          current_date + 3, '09:00', 'pending')
  returning id into v_booking_b;

  insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot,
                               date, slot, status, done_at)
  values (v_shop1, v_client_b, 'frane', 'Bogdan Pop', '{}', current_date - 20, '11:00', 'done',
          now() - interval '20 days')
  returning id into v_booking_b1;

  insert into public.quotes (booking_id, version, status, inspection_fee, total_sent, total_approved, sent_by)
  values (v_booking_a, 1, 'accepted', 80, 340, 340, v_owner1)
  returning id into v_quote_a;
  insert into public.quote_items (quote_id, position, name, price, approved)
  values (v_quote_a, 1, 'Ulei 5W30', 255, true), (v_quote_a, 2, 'Manoperă', 85, true);

  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text)
  values (v_booking_a, v_shop1, v_client_a, 'Ana M.', 5, 'Prompt, deviz clar.');
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text,
                              report_reason, reported_at, report_status, removed_at)
  values (v_booking_b1, v_shop1, v_client_b, 'Bogdan P.', 1, 'Spam', 'fake', now(), 'removed', now());

  insert into public.threads (shop_id, client_id, client_name, last_message_at)
  values (v_shop1, v_client_a, 'Ana Marin', now()) returning id into v_thread_a;
  insert into public.threads (shop_id, client_id, client_name, last_message_at)
  values (v_shop2, v_client_b, 'Bogdan Pop', now()) returning id into v_thread_b;
  insert into public.messages (thread_id, kind, event, params, booking_id)
  values (v_thread_a, 'system', 'booking_confirmed', '{"date":"2026-10-14","slot":"10:00"}', v_booking_a);
  insert into public.messages (thread_id, kind, sender_id, body)
  values (v_thread_a, 'user', v_client_a, 'Mulțumesc'),
         (v_thread_b, 'user', v_client_b, 'Hello');

  insert into public.notices (audience, city, title_ro, body_ro, title_en, body_en)
  values ('shops', null, 'Pentru service-uri', 'Text', 'For shops', 'Text'),
         ('clients', null, 'Pentru clienți', 'Text', 'For clients', 'Text'),
         ('all', null, 'Pentru toți', 'Text', 'For everyone', 'Text'),
         ('city', 'Codlea', 'Codlea', 'Text', 'Codlea', 'Text');

  insert into public.push_subscriptions (endpoint, user_id, subscription)
  values ('https://push.test/a', v_client_a, '{}'), ('https://push.test/b', v_client_b, '{}');

  insert into public.history_reports (client_id, car_id, car_snapshot, job_count, total_amount, amount_paid, status)
  values (v_client_a, v_car_a, '{"make":"Volkswagen"}', 1, 340, 29, 'generated');

  insert into public.notification_events (user_id, event) values (v_owner1, 'booking_requested');
  insert into public.request_log (request_id, user_id, fn) values (gen_random_uuid(), v_client_a, 'create_booking');

  insert into test.ids (name, id) values
    ('client_a', v_client_a), ('client_b', v_client_b), ('owner1', v_owner1), ('owner2', v_owner2),
    ('staff1', v_staff1), ('admin', v_admin), ('shop1', v_shop1), ('shop2', v_shop2),
    ('car_a', v_car_a), ('car_b', v_car_b), ('booking_a', v_booking_a), ('booking_b', v_booking_b),
    ('booking_b1', v_booking_b1), ('quote_a', v_quote_a), ('thread_a', v_thread_a), ('thread_b', v_thread_b);
end
$$;
