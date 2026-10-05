-- T31a: a shop imports its clients, cars and past jobs; they show in Istoric and Fișa mașinii,
-- never as bookings; an import can be undone; only the owner imports; other shops see nothing.
begin;
select test.make_world();

-- ------------------------------------------------------------------ who may import
select test.login(test.id('client_a'));
select test.fails($$select public.shop_import_begin('x.csv', gen_random_uuid())$$, 'not_allowed', 'not a client');
select test.logout();
select test.login(test.id('staff1'));
select test.fails($$select public.shop_import_begin('x.csv', gen_random_uuid())$$, 'not_allowed', 'not a colleague');
select test.logout();

select test.login(test.id('owner1'));
select set_config('test.imp', (public.shop_import_begin('clienti.csv', '00000000-0000-4000-8000-000000000001')).id::text, true);
select test.eq((public.shop_import_begin('clienti.csv', '00000000-0000-4000-8000-000000000001')).id::text,
  current_setting('test.imp'), 'the same request twice: the same import');

-- ------------------------------------------------------------------ rows
select set_config('test.r', (public.shop_import_add(current_setting('test.imp')::uuid, $$[
  {"row": 2, "name": "Ion Pop", "phone": "+40722111222", "email": "ion@example.ro", "make": "Dacia", "model": "Logan",
   "year": 2015, "plate": "BV 01 ION", "day": "2024-03-10", "work": "Schimb ulei", "odometer": 120500, "cost": 350.5},
  {"row": 3, "name": "Ion Pop", "phone": "+40722111222", "make": "Dacia", "model": "Logan", "plate": "BV-01-ION",
   "day": "2025-02-01", "work": "Plăcuțe frână", "cost": 420},
  {"row": 4, "name": "Maria Ene", "phone": "+40733444555", "make": "Skoda", "model": "Fabia", "plate": "B 123 MEN"},
  {"row": 5, "name": "Vasile Fără Telefon"},
  {"row": 6, "make": "Ford", "model": "Focus", "plate": "CJ 22 FOC", "day": "2023-11-05", "odometer": 98000}
]$$::jsonb, '00000000-0000-4000-8000-000000000002')).id::text, true);
select test.eq(clients, 3, 'three clients (the same phone once)'),
       test.eq(cars, 3, 'three cars (the same plate once)'),
       test.eq(jobs, 3, 'three jobs'),
       test.eq(row_count, 5, 'five rows')
from public.shop_imports where id = current_setting('test.imp')::uuid;
select test.eq((select email from public.shop_clients where phone = '+40722111222'), 'ion@example.ro', 'the email kept');
select test.eq((select count(*) from public.shop_client_cars c join public.shop_clients s on s.id = c.client_id
                where s.phone = '+40722111222'), 1::bigint, 'the car belongs to the client');
select test.eq((select count(*) from public.bookings where shop_id = test.id('shop1') and car_snapshot->>'plate_norm' = 'BV01ION'),
  0::bigint, 'never bookings');

-- The same file again (a new chunk with the same jobs): nothing doubles.
select public.shop_import_add(current_setting('test.imp')::uuid, $$[
  {"row": 2, "name": "Ion Pop", "phone": "+40722111222", "make": "Dacia", "model": "Logan", "plate": "BV 01 ION",
   "day": "2024-03-10", "work": "Schimb ulei", "odometer": 120500, "cost": 350.5}
]$$::jsonb, gen_random_uuid());
select test.eq(jobs, 3, 'the same job again is kept once'), test.eq(clients, 3, 'no new client')
from public.shop_imports where id = current_setting('test.imp')::uuid;

-- Wrong rows refuse the chunk, naming the row and the field.
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 9, "name": "X", "phone": "0722"}]'::jsonb, gen_random_uuid())$$), '{"row": 9, "field": "phone"}'::jsonb, 'a wrong phone');
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 10, "name": "X", "day": "2099-01-01", "work": "a"}]'::jsonb, gen_random_uuid())$$)->>'field', 'day', 'a day in the future');
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 11, "name": "X", "day": "2024-01-01"}]'::jsonb, gen_random_uuid())$$)->>'field', 'work', 'a job with nothing in it');
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 12, "name": "X", "cost": 100}]'::jsonb, gen_random_uuid())$$)->>'field', 'day', 'an amount without a day');
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 13, "email": "a@b.ro"}]'::jsonb, gen_random_uuid())$$)->>'field', 'name', 'nothing to keep');
select test.eq(test.error_params($$select public.shop_import_add(current_setting('test.imp')::uuid,
  '[{"row": 14, "name": "X", "day": "2024-01-01", "cost": "12,5"}]'::jsonb, gen_random_uuid())$$)->>'field', 'cost', 'an amount as text');
select test.fails($$select public.shop_import_add(current_setting('test.imp')::uuid, '[]'::jsonb, gen_random_uuid())$$,
  'import_empty', 'an empty chunk');
select test.fails($$select public.shop_import_add(current_setting('test.imp')::uuid,
  (select jsonb_agg(jsonb_build_object('row', g, 'name', 'N' || g)) from generate_series(1, 1001) g), gen_random_uuid())$$,
  'import_too_large', 'at most 1 000 rows a chunk');

-- ------------------------------------------------------------------ Istoric and Fișa mașinii
select test.eq(jsonb_array_length(public.list_shop_history()->'imported'), 3, 'Istoric has the three imported jobs');
select test.eq(public.list_shop_history()->'imported'->0->>'day', '2025-02-01', 'newest first');
select test.ok(not exists (select 1 from jsonb_array_elements(public.list_shop_history()->'bookings') b
                           where b->'car_snapshot'->>'plate_norm' = 'BV01ION'), 'not among the bookings');
-- A long history comes in pages; the search runs in the database (T31a at scale).
select test.eq((public.list_shop_history()->>'imported_total')::int, 3, 'how many there are');
select test.eq(jsonb_array_length(public.list_imported_jobs('plăcuțe', null, null, 10)->'jobs'), 1, 'search without diacritics or case');
select test.eq(jsonb_array_length(public.list_imported_jobs('bv01ion', null, null, 10)->'jobs'), 2, 'the plate without spaces');
select test.eq(jsonb_array_length(public.list_imported_jobs('BV 01 ION ulei', null, null, 10)->'jobs'), 1, 'every word');
select test.eq(jsonb_array_length(public.list_imported_jobs('0722 111 222', null, null, 10)->'jobs'), 2, 'the phone as typed locally');
select test.eq(jsonb_array_length(public.list_imported_jobs('+4072211', null, null, 10)->'jobs'), 2, 'the phone');
select test.eq(jsonb_array_length(public.list_imported_jobs(null, null, null, 1)->'jobs'), 2, 'one page and one more (there is a next page)');
select test.eq(public.list_imported_jobs(null, '2025-02-01', (select id from public.imported_jobs where day = '2025-02-01'), 10)->'jobs'->0->>'day',
  '2024-03-10', 'the next page starts after the last one');
select test.logout();

-- A booking of the same plate at this shop shows them in Fișa mașinii.
select set_config('test.bk', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', current_date + 1, '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set car_snapshot = '{"make":"Dacia","model":"Logan","plate":"BV 01 ION","plate_norm":"BV01ION"}'
where id = current_setting('test.bk')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.login(test.id('staff1'));
select test.eq(jsonb_array_length(public.shop_vehicle_file(current_setting('test.bk')::uuid)->'imported'), 2,
  'a colleague sees the two imported jobs of the car');
select test.eq((select count(*) from public.shop_clients), 3::bigint, 'and the shop''s clients');
select test.fails($$select public.shop_import_undo(current_setting('test.imp')::uuid, gen_random_uuid())$$, 'not_allowed',
  'a colleague cannot undo');
select test.logout();

-- ------------------------------------------------------------------ another shop, a client
select test.login(test.id('owner2'));
select test.eq((select count(*) from public.shop_clients), 0::bigint, 'another shop sees no clients');
select test.eq((select count(*) from public.imported_jobs), 0::bigint, 'nor jobs');
select test.eq((select count(*) from public.shop_imports), 0::bigint, 'nor imports');
select test.eq(jsonb_array_length(public.list_shop_history()->'imported'), 0, 'nor in its Istoric');
select test.eq(jsonb_array_length(public.list_imported_jobs(null, null, null, 10)->'jobs'), 0, 'nor in its pages');
select test.fails($$select public.shop_import_add(current_setting('test.imp')::uuid, '[{"row":1,"name":"X"}]'::jsonb, gen_random_uuid())$$,
  'import_not_found', 'nor adds to it');
select test.fails($$select public.shop_import_undo(current_setting('test.imp')::uuid, gen_random_uuid())$$,
  'import_not_found', 'nor undoes it');
select test.logout();
select test.login(test.id('client_a'));
select test.eq((select count(*) from public.shop_client_cars), 0::bigint, 'a client sees nothing');
select test.fails($$insert into public.shop_clients (shop_id, name) values (test.id('shop1'), 'X')$$, 'permission denied',
  'nobody writes the tables directly');
select test.logout();
select test.login(test.id('owner1'));
select test.fails($$update public.imported_jobs set cost = 1$$, 'permission denied', 'not even the owner');

-- ------------------------------------------------------------------ undo
select test.ok((public.shop_import_undo(current_setting('test.imp')::uuid, gen_random_uuid())).undone_at is not null, 'undone');
select test.eq((select count(*) from public.shop_clients), 0::bigint, 'the clients went');
select test.eq((select count(*) from public.shop_client_cars), 0::bigint, 'the cars went');
select test.eq(jsonb_array_length(public.list_shop_history()->'imported'), 0, 'the jobs went');
select test.fails($$select public.shop_import_add(current_setting('test.imp')::uuid, '[{"row":1,"name":"X"}]'::jsonb, gen_random_uuid())$$,
  'import_not_found', 'an undone import takes no more rows');

-- At most 10 imports a day per shop.
select public.shop_import_begin('f' || g || '.csv', gen_random_uuid()) from generate_series(1, 9) g;
select test.fails($$select public.shop_import_begin('f.csv', gen_random_uuid())$$, 'limit_imports', 'the eleventh in a day');
select test.logout();

rollback;
