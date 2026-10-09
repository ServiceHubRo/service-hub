-- Security guards (after T35, Eduard 9 Oct): what a browser may touch stays exactly what was
-- decided, the private files stay private, and the two repeatable actions are counted.
begin;
select test.make_world();

-- ------------------------------------------------------------------ what the browser may touch
select test.eq(string_agg(distinct table_name::text, ', ' order by table_name::text), 'service_categories, services',
  'without an account only the service catalog is readable')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';

select test.eq(string_agg(table_name::text, ', ' order by table_name::text),
  'cars, push_subscriptions, shop_closures, shop_photos, shop_services, shop_staff',
  'the only tables a signed-in user may delete rows from (each behind its own row rule)')
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'DELETE';

select test.eq(test.count($$select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                             and has_function_privilege('anon', p.oid, 'execute')
                             and p.provolatile = 'v' and p.proname not in ('try_uuid')$$), 0::bigint,
  'nothing callable without an account changes data');

-- ------------------------------------------------------------------ files
select test.ok(not (select public from storage.buckets where id = 'reports'), 'the history reports are private');
select test.eq((select count(*) from pg_policies where schemaname = 'storage' and qual::text like '%reports%'), 0::bigint,
  'and no browser rule reaches them (only the server)');
select test.ok(not exists (select 1 from storage.buckets b, unnest(b.allowed_mime_types) m
                           where m not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  'uploads are pictures (no SVG or HTML that could carry a script) or PDFs');
select test.ok(not exists (select 1 from storage.buckets b where b.file_size_limit is null or b.file_size_limit > 10485760),
  'every bucket has a size limit');

-- ------------------------------------------------------------------ rate_take
select test.fails($$select public.rate_take('x', gen_random_uuid(), 1, interval '1 hour')$$, 'permission denied',
  'not callable from the browser') from (select test.login(test.id('client_a'))) x;
select test.logout();
select test.eq((select count(*) filter (where ok) from (
    select public.rate_take('geocode', test.id('shop1'), 10, interval '1 hour') as ok from generate_series(1, 12)) t),
  10::bigint, 'ten lookups an hour per shop, the 11th and 12th refused');
select test.ok(public.rate_take('geocode', test.id('shop2'), 10, interval '1 hour'), 'another shop counts on its own');
update public.rate_events set at = now() - interval '2 hours' where kind = 'geocode' and subject = test.id('shop1');
select test.ok(public.rate_take('geocode', test.id('shop1'), 10, interval '1 hour'), 'an hour later: again');

-- ------------------------------------------------------------------ staff invitations: 20 a day
select test.login(test.id('owner1'));
select public.invite_staff('coleg' || n || '@test.local', md5(n::text) || md5('x' || n), test.rid())
from generate_series(1, 5) n;
-- The same address again and again also sends an email each time: it counts.
select public.invite_staff('coleg1@test.local', md5('r' || n) || md5('y' || n), test.rid()) from generate_series(1, 15) n;
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'coleg2@test.local', md5('z') || md5('w'), test.rid())),
  'limit_invites', 'the 21st invitation of the day is refused');
select test.eq(test.error_params(format('select public.invite_staff(%L, %L, %L)', 'coleg2@test.local', md5('z') || md5('w'), test.rid())),
  '{"limit": 20}'::jsonb, 'with the limit for the message');
select test.logout();
update public.rate_events set at = now() - interval '25 hours' where kind = 'staff_invite';
select test.login(test.id('owner1'));
select test.eq(public.invite_staff('coleg2@test.local', md5('z') || md5('w'), test.rid())->>'email', 'coleg2@test.local',
  'the next day: invitations again');
-- A repeated tap (same request id) is answered again and counts nothing.
select set_config('test.req', test.rid()::text, true);
select public.invite_staff('coleg3@test.local', md5('q') || md5('p'), current_setting('test.req')::uuid);
select public.invite_staff('coleg3@test.local', md5('q') || md5('p'), current_setting('test.req')::uuid);
select test.logout();
select test.eq((select count(*) from public.rate_events where kind = 'staff_invite' and at > now() - interval '1 hour'), 2::bigint,
  'two invitations counted, the repeated tap not');
select test.ok(not has_function_privilege('authenticated', 'public.invite_staff_base(text, text, uuid)', 'execute'),
  'the counted path is the only one');

rollback;
