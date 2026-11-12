-- The one-off reset before the launch (docs/sql/reset_before_launch.sql): every client and shop
-- account goes with what it made, the numbers start again, the admins and the settings stay.
begin;
-- A8: the world with a company (vehicles with drivers, a company booking) and a support request with a
-- message, a note and a file, as the real project holds after the fleet and support tests.
select test.make_fleet();
select test.fleet_booking('v1', test.id('client_b'), 'done', test.today() - 3);
do $$
declare
  v uuid;
  v_msg uuid;
begin
  insert into public.suggestions (author_id, author_role, title, body, category, status)
  values (test.id('client_a'), 'client', 'Solicitare de test', 'Textul solicitării', 'technical', 'new') returning id into v;
  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body)
  values (v, test.id('client_a'), false, 'Mesaj') returning id into v_msg;
  insert into public.suggestion_notes (suggestion_id, author_id, author_display_id, body) values (v, test.id('admin'), 'A-00001', 'Notă');
  insert into public.suggestion_files (suggestion_id, message_id, uploaded_by, from_staff, path, mime, size, name, sha256, attached_at)
  values (v, v_msg, test.id('client_a'), false, test.id('client_a') || '/' || gen_random_uuid(), 'image/png', 10, 'p.png', repeat('a', 64), now());
end
$$;
update public.profiles set suspended = true where id = test.id('client_b');
select public.promote_to_admin((select email from auth.users where id = test.id('client_b')));
select test.ok(test.count('select 1 from public.bookings') > 0 and test.count('select 1 from public.account_fingerprints') > 0
  and test.count('select 1 from public.company_vehicles where driver_member_id is not null') > 0
  and test.count('select 1 from public.suggestions') > 0,
  'there is test data to delete, companies with drivers and support requests included');

-- An active legal hold stops it before anything is deleted (A3c2a: held data survives every deletion).
\set reset_script `cat docs/sql/reset_before_launch.sql`
insert into public.legal_holds (suggestion_id, subject_id, subject_display_id, basis, reason, reference, responsible_id, created_by, review_due_at)
select s.id, s.author_id, 'C-00001', 'litigation', 'Litigiu de test pentru resetarea dinaintea lansării', 'Dosar 1/2026',
       test.id('admin'), test.id('admin'), now() + interval '90 days'
from public.suggestions s;
select set_config('test.accounts_before', test.count($$select 1 from public.profiles where role <> 'admin'$$)::text, true);
select test.fails(:'reset_script', 'Refused: an active legal hold', 'an active legal hold: it refuses');
select test.eq(test.count($$select 1 from public.profiles where role <> 'admin'$$), current_setting('test.accounts_before')::bigint,
  'and deletes no account'),
       test.eq(test.count($$select 1 from public.companies$$), 2::bigint, 'and no company');
update public.legal_holds set released_at = now(), released_by = test.id('admin'),
  release_reason = 'Eliberată pentru testul resetării';
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
       test.eq(test.count($$select 1 from public.admin_audit_log$$), 0::bigint, 'an empty audit log'),
       test.eq(test.count($$select 1 from public.companies$$), 0::bigint, 'no company'),
       test.eq(test.count($$select 1 from public.company_members$$), 0::bigint, 'no company member'),
       test.eq(test.count($$select 1 from public.company_vehicles$$), 0::bigint, 'no company vehicle'),
       test.eq(test.count($$select 1 from public.suggestions$$), 0::bigint, 'no support request'),
       test.eq(test.count($$select 1 from public.suggestion_files$$), 0::bigint, 'no support file row');
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
