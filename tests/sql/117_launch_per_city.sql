-- Launch price per city (Eduard, 8 Oct): the first launch_slots_per_city shops of each city get the
-- launch price and are founding partners; the next one in that city pays the standard price, another
-- city still gets it; "Brasov" and "Brașov" are the same city; nobody changes the flag from the
-- browser; the landing page learns only whether a place is open, never a count.
begin;
update public.platform_settings set subscription_price_ron = 149, launch_price_ron = 99, launch_slots_per_city = 10 where id = 1;

create function pg_temp.shop(p_n int, p_city text) returns uuid
language sql as $$
  select test.sign_up('lansare' || p_n || '@test.local', jsonb_build_object(
    'role', 'shop', 'name', 'Owner ' || p_n, 'phone', '07' || lpad((44000000 + p_n)::text, 8, '0'),
    'shop_name', 'Lansare ' || p_n, 'city', p_city, 'lang', 'ro', 'terms_version', '2026-10-08'))
$$;
create function pg_temp.sub(p_n int) returns public.subscriptions
language sql as $$
  select sub.* from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Lansare ' || p_n
$$;

-- Ten in Brașov, however it is spelled.
select pg_temp.shop(n, (array['Brașov', 'Brasov', ' brașov ', 'BRAȘOV', 'brasov'])[1 + n % 5]) from generate_series(1, 10) n;
select test.eq(test.count($$select 1 from public.subscriptions sub join public.shops s on s.id = sub.shop_id
                            where s.name like 'Lansare %' and sub.price_ron = 99 and sub.launch_offer and s.founder$$), 10::bigint,
  'the first ten in Brașov: 99 lei, founding partners');

select test.login_anon();
select test.ok(public.public_pricing('Brasov')->'launch_price_ron' = 'null'::jsonb, 'Brașov is full, also spelled Brasov');
select test.eq(public.public_pricing('Cluj-Napoca')->>'launch_price_ron', '99.00', 'Cluj still has places');
select test.eq(public.public_pricing()->>'launch_price_ron', '99.00', 'without a city: the offer is open');
select test.ok(not (public.public_pricing('Brașov') ? 'launch_left') and not (public.public_pricing('Brașov') ? 'launch_shops'),
  'never a count');
select test.fails($$select public.launch_slots_left('Brașov')$$, 'permission denied', 'the count is not callable');
select test.logout();

-- The eleventh in Brașov pays the standard price; another city still gets 99.
select pg_temp.shop(11, 'Brasov');
select test.eq((pg_temp.sub(11)).price_ron, 149.00::numeric(10,2), 'the 11th in Brașov: 149 lei'),
       test.ok(not (pg_temp.sub(11)).launch_offer, 'not a founding partner'),
       test.ok(not (select founder from public.shops where name = 'Lansare 11'), 'no badge');
select pg_temp.shop(12, 'Cluj-Napoca');
select test.eq((pg_temp.sub(12)).price_ron, 99.00::numeric(10,2), 'the first in Cluj: 99 lei'),
       test.ok((select founder from public.shops where name = 'Lansare 12'), 'a founding partner');

-- Fewer places later: those signed up keep their price, never a higher one.
update public.platform_settings set launch_slots_per_city = 1 where id = 1;
select pg_temp.shop(13, 'Cluj Napoca');
select test.eq((pg_temp.sub(13)).price_ron, 149.00::numeric(10,2), 'Cluj Napoca = Cluj-Napoca: its one place is taken'),
       test.eq(test.count($$select 1 from public.subscriptions sub join public.shops s on s.id = sub.shop_id
                            where s.name like 'Lansare %' and sub.price_ron = 99$$), 11::bigint, 'the earlier ones keep 99 lei');

-- The flag and the price are not the browser's.
select test.login((select owner_id from public.shops where name = 'Lansare 11'));
select test.fails($$update public.shops set founder = true where name = 'Lansare 11'$$, 'permission denied',
  'the owner cannot make the shop a founding partner');
select test.fails($$update public.subscriptions set launch_offer = true, price_ron = 99$$, 'permission denied',
  'nor take the launch price');
select test.logout();

-- An admin changing the subscription keeps the badge in step.
update public.subscriptions set launch_offer = false where shop_id = (select id from public.shops where name = 'Lansare 12');
select test.ok(not (select founder from public.shops where name = 'Lansare 12'), 'the badge follows the subscription');

rollback;
