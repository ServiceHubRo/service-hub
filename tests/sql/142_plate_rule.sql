-- M7 — one rule for license plates: the same canonical value in the garage, the fleet, bookings, the
-- history and the duplicate checks; a typed plate is checked; existing rows are never rejected. The
-- same vectors as tests/unit/plate.test.ts.
begin;
select test.make_world();

-- ------------------------------------------------------------------ the rule
select test.eq((select count(distinct public.plate_norm(x)) from unnest(array['BV98LGY', 'BV-98-LGY', 'bv98lgy', 'bv-98-lgy',
  'BV 98 LGY', 'B V 98 L G Y', 'BV.98.LGY', ' bv_98/lgy ']) x), 1::bigint, 'every way of writing BV 98 LGY is one plate');
select test.eq(public.plate_norm('B V 98 L G Y'), 'BV98LGY', 'and it is BV98LGY');
select test.eq(public.plate_norm('tü-ab 123'), 'TÜAB123', 'letters with diacritics stay (a foreign plate keeps its identity)');
select test.eq(public.plate_norm('M·AB 1234'), 'MAB1234', 'the middle dot is a separator');
select test.eq(public.vehicle_key('{"plate":"bv.98.lgy"}'), 'plate:BV98LGY', 'the history key uses the same rule');
select test.ok((select bool_and(public.plate_valid(x)) from unnest(array['B 123 ABC', 'B 12 ABC', 'BV 98 LGY', 'B 012345',
  'CD 123 456', 'MAI 12345', 'M-AB 1234', 'TÜ-AB 123', 'AB 123 CD', '1234 ABC']) x), 'Romanian and foreign plates are valid');
select test.ok((select bool_and(not coalesce(public.plate_valid(x), false)) from unnest(array['', 'X', 'ABCDEF', 'BV98LGY12345',
  '€123', '1']) x), 'a word, one character, a long code or symbols are not plates');

-- ------------------------------------------------------------------ the garage
select set_config('test.car_a', (select id::text from public.cars where owner_id = test.id('client_a') limit 1), true);
select set_config('test.plate_a', (select plate from public.cars where id = current_setting('test.car_a')::uuid), true);
select test.login(test.id('client_a'));
select test.fails(format($$insert into public.cars (make, model, plate) values ('VW', 'Golf', %L)$$,
  replace(lower(current_setting('test.plate_a')), ' ', '.')), 'car_duplicate', 'the same plate with dots: the same car');
select test.fails($$insert into public.cars (make, model, plate) values ('VW', 'Golf', 'ABCDEF')$$, 'car_plate_invalid',
  'a word is not a plate');
insert into public.cars (make, model, plate) values ('Skoda', 'Fabia', 'tü-ab 123');
select test.eq((select plate_norm from public.cars where owner_id = test.id('client_a') and plate = 'tü-ab 123'), 'TÜAB123',
  'a foreign plate is kept, typed as it was, with its canonical value');
-- A plate saved before the rule is never rejected for the rest of the row.
select test.logout();
alter table public.cars disable trigger cars_plate_check;
update public.cars set plate = 'VECHI' where id = current_setting('test.car_a')::uuid;
alter table public.cars enable trigger cars_plate_check;
select test.login(test.id('client_a'));
update public.cars set oil_change_months = 6 where id = current_setting('test.car_a')::uuid;
select test.eq((select oil_change_months from public.cars where id = current_setting('test.car_a')::uuid), 6, 'an old plate: the car still saves');
update public.cars set plate = current_setting('test.plate_a') where id = current_setting('test.car_a')::uuid;

-- ------------------------------------------------------------------ bookings
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L::date,
  p_slot => '10:00', p_request_id => gen_random_uuid(), p_car => '{"make":"VW","model":"Golf","plate":"NUMAR"}')$$,
  test.id('shop1'), test.workday(1)), 'car_plate_invalid', 'a booking with a typed plate that is not one: refused');
select set_config('test.b', (public.create_booking(p_shop_id => test.id('shop1'), p_service_id => 'ulei', p_date => test.workday(1),
  p_slot => '10:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan","plate":"b.v-77/xyz"}')).id::text, true);
select test.logout();
select test.eq((select car_snapshot->>'plate_norm' from public.bookings where id = current_setting('test.b')::uuid), 'BV77XYZ',
  'the booking''s snapshot has the canonical plate');
select test.eq((select car_snapshot->>'plate' from public.bookings where id = current_setting('test.b')::uuid), 'b.v-77/xyz',
  'and the plate as it was typed');

-- ------------------------------------------------------------------ company vehicles
select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Plăcuțe SRL', null, null, null, gen_random_uuid())->>'id'), true);
select public.fleet_save_vehicle(current_setting('test.co')::uuid, null, '{"make":"Ford","model":"Transit","plate":"B 701 FLT"}', gen_random_uuid());
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Ford","model":"Transit","plate":"b.701.flt"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_plate_exists', 'the same plate with dots in the same company: named, refused');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"Ford","model":"Transit","plate":"FLOTA"}', gen_random_uuid())$$,
  current_setting('test.co')), 'vehicle_invalid', 'a word is not a plate in the fleet either');

rollback;
