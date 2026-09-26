-- The one-off reset before the launch (docs/sql/reset_before_launch.sql): every client and shop
-- account goes with what it made, the numbers start again, the admins and the settings stay.
begin;
select test.make_world();
update public.profiles set suspended = true where id = test.id('client_b');
select public.promote_to_admin((select email from auth.users where id = test.id('client_b')));
select test.ok(test.count('select 1 from public.bookings') > 0 and test.count('select 1 from public.account_fingerprints') > 0,
  'there is test data to delete');
update public.profiles set display_id = 'A-00007' where id = test.id('client_b');
update public.platform_settings set launch_price_ron = 99 where id = 1;

\ir ../../docs/sql/reset_before_launch.sql

-- ------------------------------------------------------------------ what goes, what stays
select test.eq(test.count($$select 1 from public.profiles where role <> 'admin'$$), 0::bigint, 'no client or shop account is left'),
       test.eq(test.count($$select 1 from auth.users$$), 2::bigint, 'only the two admins sign in'),
       test.eq(test.count($$select 1 from public.shops$$), 0::bigint, 'no shop'),
       test.eq(test.count($$select 1 from public.bookings$$), 0::bigint, 'no booking'),
       test.eq(test.count($$select 1 from public.threads$$), 0::bigint, 'no conversation'),
       test.eq(test.count($$select 1 from public.cars$$), 0::bigint, 'no car'),
       test.eq(test.count($$select 1 from public.history_reports$$), 0::bigint, 'no report'),
       test.eq(test.count($$select 1 from public.account_fingerprints$$), 0::bigint, 'no fingerprint'),
       test.eq(test.count($$select 1 from public.admin_audit_log$$), 0::bigint, 'an empty audit log');
select test.ok(test.count('select 1 from public.services') > 100, 'the service catalog stays'),
       test.eq(test.count('select 1 from public.platform_settings'), 1::bigint, 'and the platform settings');

-- ------------------------------------------------------------------ the numbers start again
select test.sign_up('primul-client@test.local', '{"role":"client","name":"Primul"}');
select test.eq(display_id, 'C-00001', 'the first client after the reset is C-00001')
from public.profiles where name = 'Primul';

select test.sign_up('primul-service@test.local',
  '{"role":"shop","name":"Ion","phone":"+40744111222","shop_name":"Primul Service","city":"Brașov","lang":"ro","terms_version":"2026-09-26"}');
select test.eq(p.display_id, 'S-00001', 'the first shop is S-00001'),
       test.eq(sub.status, 'trial', 'with its free period, whatever the test accounts did'),
       test.ok(sub.launch_offer, 'and the launch price (the settings stay), as the first of the 50')
from public.profiles p join public.shops s on s.owner_id = p.id join public.subscriptions sub on sub.shop_id = s.id
where s.name = 'Primul Service';

select test.eq(public.format_sequence_id('P', nextval('public.booking_ref_seq'), 6), 'P-000001', 'bookings start at P-000001');
select set_config('test.next_admin', public.format_sequence_id('A',
  (select max(regexp_replace(display_id, '\D', '', 'g')::bigint) + 1 from public.profiles where role = 'admin')), true);
select test.eq(public.promote_to_admin('primul-client@test.local'), current_setting('test.next_admin'),
  'the next admin comes after the ones kept');

-- ------------------------------------------------------------------ never on a platform in use
do $$
begin
  for i in 1..300 loop
    perform test.sign_up('mult-' || i || '@test.local', '{"role":"client","name":"Mult"}');
  end loop;
end
$$;
\set reset_script `cat docs/sql/reset_before_launch.sql`
select test.fails(:'reset_script', 'Refused: 301 client and shop accounts', 'over 300 accounts it refuses');
select test.eq(test.count($$select 1 from public.profiles where role <> 'admin'$$), 301::bigint, 'and deletes nothing');

rollback;
