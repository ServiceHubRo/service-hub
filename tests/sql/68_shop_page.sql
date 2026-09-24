-- T06: search_cities (city chips from the data), get_shop_page (public columns only, who may open
-- it, what it contains) and reviews readable only together with their shop.
begin;
select test.make_world();

-- ------------------------------------------------------------------ search_shops, word by word
-- shop1 "Atelier Unu", Brașov, offers ulei + frane (the only public shop of the world).
create function pg_temp.hits(p_q text) returns text
language plpgsql as $$
declare r text;
begin
  perform test.login(test.id('client_a'));
  select string_agg(s.name || coalesce(' [' || s.matched_service_id || ']', ''), ' | ')
    into r from public.search_shops(p_q) s;
  perform test.logout();
  return r;
end $$;

select test.eq(pg_temp.hits('brakes'), 'Atelier Unu [frane]', 'English plural: "brakes" finds brake pads');
select test.eq(pg_temp.hits('schimb ulei'), 'Atelier Unu [ulei]', 'two words in one service name');
select test.eq(pg_temp.hits('oil change'), 'Atelier Unu [ulei]', 'two words, English, not next to each other');
select test.eq(pg_temp.hits('frane brasov'), 'Atelier Unu [frane]', 'a service word and a city word');
select test.eq(pg_temp.hits('Unu Brașov'), 'Atelier Unu', 'name and city words: no service named');
select test.eq(pg_temp.hits('frane codlea'), null, 'every word must match');
select test.eq(pg_temp.hits('frane ulei'), null, 'the service words must meet in one service');
select test.eq(public.search_words('  Frânele, BRAKES / oil-change  '), array['franel', 'brak', 'oil', 'chang'],
  'words: folded, split on anything not a letter or digit, plural s and last vowel optional');
select test.eq(cardinality(public.search_words('a b c d e f g h i j')), 8, 'at most 8 words');
select test.eq(public.search_words(null), '{}'::text[], 'no query, no words');

-- ------------------------------------------------------------------ search_cities
select test.login(test.id('client_a'));
select test.eq((select string_agg(city || ':' || shop_count, ', ') from public.search_cities()), 'Brașov:1',
  'only cities with public shops (Codlea''s shop is private)');
select test.logout();

-- Two more public shops: "Brasov" without diacritics and Codlea made public.
do $$
declare
  v_owner uuid := test.sign_up('s3@test.local', '{"role":"shop","name":"Radu","shop_name":"Rapid","city":"Brasov "}');
begin
  update public.profiles set phone_verified_by_admin = true where id in (v_owner, test.id('owner2'));
  insert into public.shop_services (shop_id, service_id)
  select id, 'ulei' from public.shops where owner_id = v_owner
  union all select test.id('shop2'), 'diag';
end $$;
select test.login(test.id('client_a'));
select test.eq((select string_agg(city || ':' || shop_count, ', ') from public.search_cities()), 'Brașov:2, Codlea:1',
  'one chip per city whatever the spelling, shown with diacritics, most shops first');
select test.logout();
-- Back to private for the rest of the file.
update public.profiles set phone_verified_by_admin = false where id = test.id('owner2');
delete from public.shop_services where shop_id = test.id('shop2');

select test.login_anon();
select test.fails($$select * from public.search_cities()$$, 'permission denied', 'cities need an account');
select test.logout();

-- ------------------------------------------------------------------ get_shop_page: content
insert into public.shop_closures (shop_id, start_date, end_date, label) values
  (test.id('shop1'), test.today() - 10, test.today() - 5, 'Trecut'),
  (test.id('shop1'), test.today() - 1, test.today() + 1, 'Acum'),
  (test.id('shop1'), test.today() + 20, test.today() + 22, 'Concediu');
update public.shops set inspection_fee = 80, street = 'Str. Lungă 42', phone = '0268 312 445' where id = test.id('shop1');
update public.reviews set reply = 'Mulțumim', reply_at = now() where client_id = test.id('client_a');

select test.login(test.id('client_a'));
create temp table page as select public.get_shop_page(test.id('shop1')) as p;
select test.eq(p->'shop'->>'name', 'Atelier Unu', 'shop name'),
       test.eq(p->'shop'->>'street', 'Str. Lungă 42', 'address'),
       test.eq((p->'shop'->>'inspection_fee')::numeric, 80::numeric, 'inspection fee'),
       test.eq((p->>'bookable')::boolean, true, 'public shop is bookable'),
       test.eq((p->>'is_favorite')::boolean, false, 'not a favorite'),
       test.eq((p->'rating'->>'review_count')::int, 1, 'removed review not counted'),
       test.eq(jsonb_array_length(p->'hours'), 7, 'seven weekdays'),
       test.eq(p->'hours'->1->>'open_time', '08:00', 'Monday opens 08:00 (HH:MM)'),
       test.eq((p->'hours'->0->>'is_closed')::boolean, true, 'Sunday closed'),
       test.eq((select string_agg(c->>'label', ',') from jsonb_array_elements(p->'closures') c), 'Acum,Concediu',
               'closures from today on, in date order'),
       test.eq((select string_agg(s->>'id', ',') from jsonb_array_elements(p->'services') s), 'ulei,frane',
               'offered services in catalog order'),
       test.ok(p->'services'->0 ? 'category_ro' and p->'services'->0 ? 'icon', 'services carry category and icon'),
       test.eq(jsonb_array_length(p->'reviews'), 1, 'removed review not listed'),
       test.eq(p->'reviews'->0->>'display_name', 'Ana M.', 'reviewer display name'),
       test.eq(p->'reviews'->0->>'reply', 'Mulțumim', 'shop reply included'),
       test.ok(not (p->'reviews'->0 ? 'client_id') and not (p->'reviews'->0 ? 'report_reason'),
               'no reviewer id or report data in reviews')
from page;

-- Public columns only: nothing fiscal, no preferences, no internal stamps.
select test.eq(
  (select string_agg(k, ',' order by k) from jsonb_object_keys((select p->'shop' from page)) k),
  'cancel_deadline_hours,cars_per_slot,city,county,daily_capacity,description,facebook,id,inspection_fee,latitude,'
  || 'logo_url,longitude,max_advance_days,min_notice_hours,name,phone,phone2,street,website,year_established',
  'exact list of shop fields on the page');
select test.ok(position('RO14872301' in (select p::text from page)) = 0
               and position('RO49AAAA' in (select p::text from page)) = 0
               and position('AUTO UNU' in (select p::text from page)) = 0, 'no CUI, IBAN or legal name anywhere');

select public.toggle_favorite(test.id('shop1'), gen_random_uuid());
select test.eq((public.get_shop_page(test.id('shop1'))->>'is_favorite')::boolean, true, 'favorite flag');

-- ------------------------------------------------------------------ get_shop_page: who may open it
select test.fails(format('select public.get_shop_page(%L)', test.id('shop2')), 'shop_not_found',
  'a private shop the client never booked is not found');
select test.fails(format('select public.get_shop_page(%L)', gen_random_uuid()), 'shop_not_found', 'unknown id');
select test.logout();

select test.login(test.id('client_b'));
select test.eq((public.get_shop_page(test.id('shop2'))->>'bookable')::boolean, false,
  'a client with a booking there still sees a private shop, marked not bookable');
select test.logout();

select test.login(test.id('owner2'));
select test.eq(public.get_shop_page(test.id('shop2'))->'shop'->>'name', 'Atelier Doi', 'members see their own page');
select test.eq((public.get_shop_page(test.id('shop1'))->>'is_favorite')::boolean, false,
  'another shop reads a public page like anyone (never someone else''s favorites)');
select test.logout();

select test.login_anon();
select test.fails(format('select public.get_shop_page(%L)', test.id('shop1')), 'permission denied', 'page needs an account');
select test.logout();

-- ------------------------------------------------------------------ reviews follow their shop
-- A review at private shop2, by client_b (who has a booking there).
do $$
declare
  b uuid := test.raw_booking(test.id('shop2'), test.id('client_b'), 'done', test.today() - 3, '10:00');
begin
  insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating, text)
  values (b, test.id('shop2'), test.id('client_b'), 'Bogdan P.', 4, 'Ok');
end $$;

select test.login(test.id('client_a'));
select test.eq(test.count(format('select 1 from public.reviews where shop_id = %L', test.id('shop2'))), 0::bigint,
  'another client cannot read reviews of a shop they cannot read');
select test.eq(test.count(format('select 1 from public.reviews where shop_id = %L', test.id('shop1'))), 1::bigint,
  'visible reviews of a public shop stay readable');
select test.logout();

select test.login(test.id('client_b'));
select test.eq(test.count(format('select 1 from public.reviews where shop_id = %L', test.id('shop2'))), 1::bigint,
  'the author reads their own review');
select test.logout();

select test.login(test.id('owner2'));
select test.eq(test.count(format('select 1 from public.reviews where shop_id = %L', test.id('shop2'))), 1::bigint,
  'the shop reads its reviews');
select test.logout();

rollback;
