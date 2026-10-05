-- T31b: a client with the same phone, once confirmed, gets the imported cars in the Garage and sees
-- the imported jobs; never with an unconfirmed phone; never another client's; the shop's link page.
begin;
select test.make_world();

-- client_b's phone (0723000002) is imported by shop1 with two cars and three jobs; another
-- client's number with one car.
select test.login(test.id('owner1'));
select set_config('test.imp', (public.shop_import_begin('clienti.csv', gen_random_uuid())).id::text, true);
select public.shop_import_add(current_setting('test.imp')::uuid, $$[
  {"row": 2, "name": "Bogdan Pop", "phone": "+40723000002", "make": "Dacia", "model": "Logan", "plate": "BV 02 BOG",
   "day": "2023-05-10", "work": "Schimb ulei", "odometer": 90000, "cost": 300},
  {"row": 3, "name": "Bogdan Pop", "phone": "+40723000002", "make": "Dacia", "model": "Logan", "plate": "BV-02-BOG",
   "day": "2024-06-01", "work": "Frâne", "cost": 500},
  {"row": 4, "name": "Bogdan Pop", "phone": "+40723000002", "make": "Ford", "model": "Focus", "plate": "BV 44 KLM",
   "day": "2022-01-15", "work": "Distribuție", "cost": 1500},
  {"row": 5, "name": "Altcineva", "phone": "+40744999888", "make": "Opel", "plate": "B 999 ALT", "day": "2024-01-01", "work": "x"}
]$$::jsonb, gen_random_uuid());
select test.logout();

-- Not confirmed yet: nothing.
select test.eq((select count(*) from public.shop_clients where client_id is not null), 0::bigint, 'an unconfirmed phone ties nothing');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.my_imported_jobs()), 0, 'and shows nothing');
select test.logout();

-- The phone is confirmed: the cars come to the Garage, the jobs show.
select test.eq((select count(*) from public.cars where owner_id = test.id('client_b')), 1::bigint, 'one car before (BV-44-KLM)');
update public.profiles set phone_verified_at = now() where id = test.id('client_b');
select test.eq((select client_id from public.shop_clients where phone = '+40723000002'), test.id('client_b'), 'tied to the account');
select test.eq((select count(*) from public.cars where owner_id = test.id('client_b')), 2::bigint,
  'the Logan came; the Focus plate was already in the Garage (BV-44-KLM)');
select test.eq((select model from public.cars where owner_id = test.id('client_b') and plate = 'BV 02 BOG'), 'Logan', 'as imported');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.my_imported_jobs()), 3, 'the three jobs');
select test.eq(public.my_imported_jobs()->0->>'shop_name', 'Atelier Unu', 'with the shop');
select test.eq(public.my_imported_jobs()->0->>'day', '2024-06-01', 'newest first');
select test.eq((select count(*) from public.imported_jobs), 0::bigint, 'the table itself shows a client nothing');
select test.eq((select count(*) from public.shop_clients), 0::bigint, 'nor the shop''s client list');
select test.logout();

-- Another client sees none of it.
select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.my_imported_jobs()), 0, 'another client sees nothing');
select test.logout();

-- A car the client deleted does not come back with a later import of the same plate.
delete from public.cars where owner_id = test.id('client_b') and plate = 'BV 02 BOG';
select test.login(test.id('owner1'));
select set_config('test.imp2', (public.shop_import_begin('din-nou.csv', gen_random_uuid())).id::text, true);
select public.shop_import_add(current_setting('test.imp2')::uuid, $$[
  {"row": 2, "name": "Bogdan Pop", "phone": "+40723000002", "make": "Dacia", "model": "Logan", "plate": "BV 02 BOG"},
  {"row": 3, "name": "Bogdan Pop", "phone": "+40723000002", "make": "Skoda", "model": "Octavia", "plate": "BV 03 NEW"}
]$$::jsonb, gen_random_uuid());
select test.logout();
select test.eq((select count(*) from public.cars where owner_id = test.id('client_b') and plate = 'BV 02 BOG'), 0::bigint,
  'a deleted car stays deleted');
select test.eq((select count(*) from public.cars where owner_id = test.id('client_b') and plate = 'BV 03 NEW'), 1::bigint,
  'a new car of an import after the account came at once');

-- A changed number lets go of the old one's history.
update public.profiles set phone = '0723000099' where id = test.id('client_b');
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.my_imported_jobs()), 0, 'another phone: the history goes');
select test.logout();

-- An admin-confirmed phone counts too; a shop account with the same phone ties nothing.
update public.profiles set phone = '0744999888' where id = test.id('client_a');
select test.eq((select client_id from public.shop_clients where phone = '+40744999888'), null::uuid, 'a new number, not confirmed: nothing');
update public.profiles set phone_verified_by_admin = true where id = test.id('client_a');
select test.eq((select client_id from public.shop_clients where phone = '+40744999888'), test.id('client_a'), 'confirmed by the admin');


-- ------------------------------------------------------------------ the shop's link page
select test.logout();
set local role anon;
select test.eq(public.shop_link_preview(test.id('shop1'))->>'name', 'Atelier Unu', 'anyone sees a public shop''s card');
select test.eq(public.shop_link_preview(test.id('shop2')), null::jsonb, 'not a shop that is not public');
select test.eq(public.shop_link_preview(gen_random_uuid()), null::jsonb, 'nor one that does not exist');
reset role;
select test.login(test.id('client_a'));
select test.fails($$select public.link_imported(null, null)$$, 'permission denied', 'linking is not callable');
select test.logout();

rollback;
