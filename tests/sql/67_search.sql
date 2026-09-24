-- search_shops (ARCHITECTURE §5, §8; Prompt 16): public shops only, ordered by the weighted rating
-- only; name / city / service matching without diacritics; category and city filters narrow and
-- never reorder; "Oferă: …" names the matched service; distance is a separate sort.
begin;
select test.make_world();

create function pg_temp.public_shop(p_email text, p_name text, p_city text, p_services text[]) returns uuid
language plpgsql as $$
declare
  v_owner uuid := test.sign_up(p_email, jsonb_build_object('role', 'shop', 'name', p_name, 'shop_name', p_name, 'city', p_city));
  v_shop uuid;
begin
  select id into v_shop from public.shops where owner_id = v_owner;
  update public.profiles set phone_verified_by_admin = true where id = v_owner;
  insert into public.shop_services (shop_id, service_id) select v_shop, unnest(p_services);
  return v_shop;
end $$;

-- n five-star reviews for a shop, each on its own done booking.
create function pg_temp.reviews(p_shop uuid, p_n int) returns void
language plpgsql as $$
declare
  b uuid;
begin
  for i in 1..p_n loop
    b := test.raw_booking(p_shop, test.id('client_b'), 'done', test.today() - 10 - i, '10:00');
    insert into public.reviews (booking_id, shop_id, client_id, client_display_name, rating)
    values (b, p_shop, test.id('client_b'), 'Bogdan P.', 5);
  end loop;
end $$;

-- shop1  Atelier Unu, Brașov: ulei, frane — one 5★ review          → 4.475
-- shop2  Atelier Doi, Codlea: diag, discuri — made public, none      → 4.300
-- shop3  Vulcanizare Roți Expres, Brașov: anvelope, vulcanizare, 10★ → 4.838
-- shop4  Rapid Service, Brașov: ulei — one 5★ review                  → 4.475 (ties with shop1: name decides)
-- shop5  Ascuns, Brașov — suspended, never listed
update public.profiles set phone_verified_by_admin = true where id = test.id('owner2');
insert into public.shop_services (shop_id, service_id) values (test.id('shop2'), 'diag'), (test.id('shop2'), 'discuri');
update public.shops set latitude = 45.6969, longitude = 25.4439 where id = test.id('shop2');
update public.shops set latitude = 45.6440, longitude = 25.5870 where id = test.id('shop1');
insert into test.ids values
  ('shop3', pg_temp.public_shop('s3@test.local', 'Vulcanizare Roți Expres', 'Brașov', array['vulcanizare', 'anvelope'])),
  ('shop4', pg_temp.public_shop('s4@test.local', 'Rapid Service', 'Braşov', array['ulei'])), -- cedilla ş, as some keyboards type it
  ('shop5', pg_temp.public_shop('s5@test.local', 'Ascuns', 'Brașov', array['ulei']));
update public.shops set suspended = true where id = test.id('shop5');
select pg_temp.reviews(test.id('shop3'), 10);
select pg_temp.reviews(test.id('shop4'), 1);

create function pg_temp.names(p_q text default null, p_category text default null, p_city text default null,
                              p_lat double precision default null, p_lng double precision default null,
                              p_sort text default 'rating') returns text
language plpgsql as $$
declare r text;
begin
  perform test.login(test.id('client_a'));
  select string_agg(s.name || coalesce(' [' || s.matched_service_id || ']', ''), ' | ')
    into r from public.search_shops(p_q, p_category, p_city, p_lat, p_lng, p_sort) s;
  perform test.logout();
  return r;
end $$;

-- ------------------------------------------------------------------ ranking
select test.eq(pg_temp.names(),
  'Vulcanizare Roți Expres | Atelier Unu | Rapid Service | Atelier Doi',
  'weighted score desc, then review count, then name; suspended and private shops never listed');
select test.login(test.id('client_a'));
select test.eq(weighted_score, 4.4750::numeric, 'shop1 score (5 + 4.3×3) / (1 + 3)'),
       test.eq(review_count, 1, 'removed review not counted'),
       test.eq(service_count, 2, 'service count'),
       test.eq(is_favorite, false, 'not a favorite yet')
from public.search_shops() where shop_id = test.id('shop1');
select test.eq(weighted_score, 4.3000::numeric, 'no reviews start mid-list at 4.3') from public.search_shops() where shop_id = test.id('shop2');
select public.toggle_favorite(test.id('shop3'), gen_random_uuid());
select test.eq(is_favorite, true, 'favorite flag') from public.search_shops() where shop_id = test.id('shop3');
select test.logout();

-- ------------------------------------------------------------------ text: name, city, service, no diacritics
select test.eq(pg_temp.names('brasov'), 'Vulcanizare Roți Expres | Atelier Unu | Rapid Service',
  '"brasov" finds Brașov and Braşov, in rating order, no "Oferă" line');
select test.eq(pg_temp.names('BRAȘOV'), pg_temp.names('brasov'), 'upper case with ș finds the same');
select test.eq(pg_temp.names('unu'), 'Atelier Unu', 'shop name');
select test.eq(pg_temp.names('frane'), 'Atelier Unu [frane] | Atelier Doi [discuri]',
  '"frane" finds brake services ("Plăcuțe de frână", "Discuri de frână") and names them');
select test.eq(pg_temp.names('frână'), pg_temp.names('frane'), 'with diacritics finds the same');
select test.eq(pg_temp.names('vulcanizare'), 'Vulcanizare Roți Expres', 'name match wins: no "Oferă" line');
select test.eq(pg_temp.names('pana'), 'Vulcanizare Roți Expres [vulcanizare]', '"pana" finds "reparație pană"');
select test.eq(pg_temp.names('anvelope'), 'Vulcanizare Roți Expres [anvelope]', 'service name');
select test.eq(pg_temp.names('jante'), 'Vulcanizare Roți Expres [anvelope]', 'category name finds the category''s first offered service');
select test.eq(pg_temp.names('brake'), 'Atelier Unu [frane] | Atelier Doi [discuri]', 'English service names match too');
select test.eq(pg_temp.names('diagnoza'), 'Atelier Doi [diag]', 'diacritics-free "diagnoza"');
select test.eq(pg_temp.names('zzzz'), null, 'no match, no rows');
select test.eq(pg_temp.names('  '), pg_temp.names(), 'blank query = everything');

-- ------------------------------------------------------------------ filters narrow, never reorder
select test.eq(pg_temp.names(p_category => 'cat_anv'), 'Vulcanizare Roți Expres [anvelope]', 'category filter names a service in it');
select test.eq(pg_temp.names(p_category => 'cat_fra'), 'Atelier Unu [frane] | Atelier Doi [discuri]', 'category filter, rating order');
select test.eq(pg_temp.names(p_category => 'cat_fra', p_city => 'codlea'), 'Atelier Doi [discuri]', 'category + city combine');
select test.eq(pg_temp.names(p_city => 'Brasov'), 'Vulcanizare Roți Expres | Atelier Unu | Rapid Service', 'city filter without diacritics');
select test.eq(pg_temp.names('ulei', 'cat_fra'), 'Atelier Unu [ulei]', 'text and category both apply');
select test.eq(pg_temp.names('ulei', p_city => 'Codlea'), null, 'text and city both apply');

-- ------------------------------------------------------------------ distance: a separate sort, never in the score
select test.eq(pg_temp.names(p_lat => 45.6969, p_lng => 25.4439, p_sort => 'distance'),
  'Atelier Doi | Atelier Unu | Vulcanizare Roți Expres | Rapid Service',
  'nearest first; shops without coordinates after, in rating order');
select test.eq(pg_temp.names(p_lat => 45.6969, p_lng => 25.4439), pg_temp.names(), 'location alone does not change the ranking');
select test.login(test.id('client_a'));
select test.ok(distance_km < 0.01, 'distance to itself ~0 km') from public.search_shops(p_lat => 45.6969, p_lng => 25.4439) where shop_id = test.id('shop2');
select test.ok(distance_km between 10 and 13, 'Codlea → Brașov center ≈ 11 km')
from public.search_shops(p_lat => 45.6969, p_lng => 25.4439) where shop_id = test.id('shop1');
select test.eq(distance_km, null, 'no coordinates, no distance') from public.search_shops(p_lat => 45.6969, p_lng => 25.4439) where shop_id = test.id('shop4');
select test.eq(distance_km, null, 'no location given, no distance') from public.search_shops() where shop_id = test.id('shop1');
select test.logout();
select test.eq(pg_temp.names(p_sort => 'distance'), pg_temp.names(), 'distance sort without a location keeps the rating order');

-- A shop leaves search the moment it stops being public.
update public.subscriptions set status = 'inactive' where shop_id = test.id('shop3');
select test.eq(pg_temp.names('anvelope'), null, 'inactive subscription → hidden');

select test.login_anon();
select test.fails($$select * from public.search_shops()$$, 'permission denied', 'search needs an account');
select test.logout();

rollback;
