-- The activity of one account, under that account (Eduard, 16 Nov 2026): admin_account_activity answers
-- the events of ONE client or ONE shop, newest first, a page at a time, from the rows that already
-- exist; only the admin asks; one account never shows another's events; Prezentare no longer carries
-- the platform's last 50 events.
begin;
select test.make_world();

-- ------------------------------------------------------------------ who may ask
select test.login(test.id('client_a'));
select test.fails(format($$select public.admin_account_activity('client', %L)$$, test.id('client_a')), 'not_allowed',
  'a client cannot read the activity of an account, not even their own');
select test.login(test.id('owner1'));
select test.fails(format($$select public.admin_account_activity('shop', %L)$$, test.id('shop1')), 'not_allowed',
  'nor a shop');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.admin_account_activity('client', %L)$$, test.id('client_a')), 'permission denied',
  'a visitor cannot call it');
select test.logout();

select test.login(test.id('admin'));
select test.fails(format($$select public.admin_account_activity('client', %L)$$, gen_random_uuid()), 'not_found', 'an unknown client');
select test.fails(format($$select public.admin_account_activity('client', %L)$$, test.id('owner1')), 'not_found', 'a shop owner is not a client');
select test.fails(format($$select public.admin_account_activity('shop', %L)$$, gen_random_uuid()), 'shop_not_found', 'an unknown shop');
select test.fails(format($$select public.admin_account_activity('car', %L)$$, test.id('client_a')), 'field_invalid', 'only a client or a shop');

-- ------------------------------------------------------------------ a client
select test.ok((select bool_and(i->>'kind' is not null and i->>'at' is not null and i->>'key' is not null)
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i),
  'every event has a kind, a moment and a key');
select test.ok((select array_agg(i->>'kind') @> array['account_created', 'booking_created', 'booking_done']
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i),
  'the client: the account, a booking made, a booking done');
select test.ok((select array_agg(i->>'kind') @> array['quote_sent', 'review_written']
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i),
  'the client: the quote they got, the review they wrote');
select test.ok((select count(*) = 0
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i
                where i->>'booking_id' is not null
                  and not exists (select 1 from public.bookings b where b.id = (i->>'booking_id')::uuid and b.client_id = test.id('client_a'))),
  'only the client''s own bookings appear, never another client''s');
select test.ok((select bool_and((a.at)::timestamptz >= (b.at)::timestamptz)
                from (select (i->>'at') as at, row_number() over () as n
                      from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i) a
                join (select (i->>'at') as at, row_number() over () as n
                      from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i) b
                  on b.n = a.n + 1),
  'newest first');

-- ------------------------------------------------------------------ pages: every event once, in order
create temp table pg_all as
  select (i->>'key') as key, row_number() over () as n
  from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i;
select test.ok((select count(*) from pg_all) >= 5, 'the client has several events to page through');
select test.eq((public.admin_account_activity('client', test.id('client_a'), null, null, 2)->>'more')::boolean, true,
  'a short page says there are older events');
select test.eq(jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 2)->'items'), 2, 'two events on the page');
select test.eq((public.admin_account_activity('client', test.id('client_a'), null, null, 100)->>'more')::boolean, false,
  'the whole list: nothing older');
-- The pages, one after the other, hold the same events in the same order as the whole list.
do $$
declare
  v_client uuid := test.id('client_a');
  v_page jsonb;
  v_at text := null;
  v_key text := null;
  v_n int := 0;
  v_keys text[] := '{}';
  r jsonb;
begin
  loop
    v_page := public.admin_account_activity('client', v_client, v_at::timestamptz, v_key, 2);
    for r in select * from jsonb_array_elements(v_page->'items') loop
      v_keys := v_keys || (r->>'key');
      v_at := r->>'at';
      v_key := r->>'key';
    end loop;
    v_n := v_n + 1;
    exit when not (v_page->>'more')::boolean or v_n > 50;
  end loop;
  if v_keys is distinct from (select array_agg(key order by n) from pg_all) then
    raise exception 'FAILED: the pages, one after the other, differ from the whole list: % vs %', v_keys, (select array_agg(key order by n) from pg_all);
  end if;
end
$$;
drop table pg_all;

-- ------------------------------------------------------------------ categories and search
select test.fails(format($$select public.admin_account_activity('client', %L, null, null, 30, 'nonsense')$$, test.id('client_a')), 'field_invalid',
  'an unknown category is refused');
select test.ok((select bool_and(i->>'kind' like 'booking\_%')
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100, 'bookings')->'items') i),
  'the bookings category holds only the steps of bookings');
select test.ok((select count(*) > 0
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100, 'bookings')->'items') i),
  'and the client has some');
select test.ok((select bool_and(i->>'kind' = 'review_written')
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100, 'reviews')->'items') i),
  'the reviews category holds only reviews');
select test.eq(jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100, 'payments')->'items'), 0,
  'a client has no payments');
-- The counts add up to the whole list and agree with each category.
select test.eq((select sum(value::int) from jsonb_each_text(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'counts')),
               (select count(*)::bigint from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items')),
  'the counts per category add up to every event');
select test.eq((public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'counts'->>'bookings')::int,
               jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100, 'bookings')->'items'),
  'the count of a category is the length of that category');
-- Search: by booking code, by name (without diacritics), by service; the counts follow the words.
create temp table s_ref as
  select (i->>'ref') as ref from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items') i
  where i->>'ref' is not null limit 1;
select test.ok((select count(*) > 0 and bool_and(i->>'ref' = (select ref from s_ref))
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_a'), null, null, 100, null, (select lower(ref) from s_ref))->'items') i),
  'searching a booking code finds the events of that booking only');
select test.eq(jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100, null, 'zzzz-nu-exista')->'items'), 0,
  'words that match nothing find nothing');
select test.eq(public.admin_account_activity('client', test.id('client_a'), null, null, 100, null, 'zzzz-nu-exista')->'counts', '{}'::jsonb,
  'and every count is empty');
select test.ok(jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100, null, '  ')->'items')
               = jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100)->'items'),
  'blank words are no filter');
select test.ok(jsonb_array_length(public.admin_account_activity('client', test.id('client_a'), null, null, 100, null, (select upper(ref) from s_ref))->'items') > 0,
  'search is not case sensitive');
-- Another category changes nothing about the page of the same filter: 2 at a time, the next page of the SAME filter.
select test.ok((public.admin_account_activity('client', test.id('client_a'), null, null, 1, 'bookings')->>'more')::boolean,
  'a short page of a category says there are older ones');
drop table s_ref;

-- ------------------------------------------------------------------ a shop
select test.ok((select array_agg(i->>'kind') @> array['shop_created', 'booking_created', 'booking_done', 'quote_sent']
                from jsonb_array_elements(public.admin_account_activity('shop', test.id('shop1'), null, null, 100)->'items') i),
  'the shop: created, bookings received, done, quotes sent');
select test.ok((select array_agg(i->>'kind') @> array['review_received']
                from jsonb_array_elements(public.admin_account_activity('shop', test.id('shop1'), null, null, 100)->'items') i),
  'the shop: a review received');
select test.ok((select count(*) = 0
                from jsonb_array_elements(public.admin_account_activity('shop', test.id('shop1'), null, null, 100)->'items') i
                where i->>'booking_id' is not null
                  and not exists (select 1 from public.bookings b where b.id = (i->>'booking_id')::uuid and b.shop_id = test.id('shop1'))),
  'only the shop''s own bookings appear');
-- The admin''s own actions on the account are in it.
select public.admin_set_account_suspended(test.id('client_b'), true, 'Verificare pentru test', test.rid());
select test.ok((select bool_or(i->>'kind' = 'admin_action')
                from jsonb_array_elements(public.admin_account_activity('client', test.id('client_b'), null, null, 100)->'items') i),
  'what an admin did to the account is in its activity');
select test.logout();

-- ------------------------------------------------------------------ a page is at most 100
select test.login(test.id('admin'));
select test.ok(jsonb_array_length(public.admin_account_activity('shop', test.id('shop1'), null, null, 100000)->'items') <= 100,
  'a page never holds more than 100 events');
select test.ok(jsonb_array_length(public.admin_account_activity('shop', test.id('shop1'), null, null, 0)->'items') = 1,
  'a page holds at least one');
select test.logout();

-- ------------------------------------------------------------------ Prezentare: the numbers only
select test.login(test.id('admin'));
select test.ok(not (public.admin_overview() ? 'activity'), 'Prezentare no longer carries the platform''s last 50 events');
select test.ok(public.admin_overview() ? 'subscriptions' and public.admin_overview() ? 'bookings', 'it keeps the numbers');
select test.logout();

rollback;
