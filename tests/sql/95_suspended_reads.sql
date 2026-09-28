-- A suspended account can still sign in and read (admin screen: "can sign in and read, but can't
-- book, send messages or write reviews"); every write stays refused with `account_suspended`.
begin;
select test.make_world();

update public.profiles set suspended = true where id = test.id('client_a');

-- ------------------------------------------------------------------ the client reads
select test.login(test.id('client_a'));
select test.ok((select count(*) from public.search_cities()) > 0, 'a suspended client sees the cities');
select test.ok(exists (select 1 from public.search_shops() where shop_id = test.id('shop1')), 'and the search results');
select test.eq((public.get_shop_page(test.id('shop1'))->'shop'->>'id')::uuid, test.id('shop1'), 'and a shop page');
select test.ok(jsonb_array_length(public.get_availability(test.id('shop1'), current_date, 7)->'days') > 0, 'and the free days');
select test.ok((select count(*) from public.list_threads()) > 0, 'and the conversations');

-- ------------------------------------------------------------------ but cannot write
select test.fails(format($$select public.send_message(%L, 'Salut', gen_random_uuid())$$,
  (select id from public.threads where client_id = test.id('client_a') limit 1)), 'account_suspended', 'no messages');
select test.fails(format($$select public.toggle_favorite(%L, gen_random_uuid())$$, test.id('shop2')), 'account_suspended', 'no favorites');
select test.logout();

-- ------------------------------------------------------------------ a suspended shop owner reads too
update public.profiles set suspended = true where id = test.id('owner1');
select test.login(test.id('owner1'));
select test.ok(public.list_shop_bookings() is not null, 'a suspended owner sees the bookings');
select test.ok(public.get_shop_setup() is not null, 'and Panou');
select test.logout();

rollback;
