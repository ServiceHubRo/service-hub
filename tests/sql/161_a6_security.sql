-- A6 — security and control of the team (migration 20261112150000_a6_security.sql):
--   H1/L1 an admin's token works only while its session lives; deleted or suspended admins refused
--   H2    what an admin opens is in the audit log, once, without personal data
--   M1    a suspended account, owner or shop cannot write through tables or Storage
--   M2    the audit log is append-only (service role and people included)
--   M3    the session of every audit entry; grouped security events
--   M4    fleet files only with a ticket from the fleet-files Edge Function; limits
--   M5    reasons for the sensitive actions; export limits; the owner told of a billing change
--   M6    admins act on other admins (never themselves); their tokens refused at once
--   L3    a team member's sessions end with its role or suspension
begin;
select test.make_fleet();

-- ================================================================================ H1, L1: sessions
select test.login(test.id('admin'));
select set_config('test.admin_sid', test.admin_session(test.id('admin'))::text, true);
select test.ok(jsonb_array_length(public.admin_list_clients()) >= 2, 'an admin with a live session works');

-- Every admin_* function refuses a token whose session is gone (signed out or ended).
select test.logout();
delete from auth.sessions where user_id = test.id('admin');
select set_config('request.jwt.claim.sub', test.id('admin')::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin'), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', current_setting('test.admin_sid'))::text, true);
set local role authenticated;
do $$
declare
  r record;
  v_args text;
  v_err text;
  v_n int := 0;
begin
  for r in
    select p.proname, p.pronargs, p.proargnames from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%'
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    select string_agg(case when a.n = 'p_request_id' then 'gen_random_uuid()' when a.n = 'p_reason' then '''Motiv''' else 'null' end,
                      ', ' order by a.o)
      into v_args
    from unnest(r.proargnames[1:r.pronargs]) with ordinality a(n, o);
    v_err := test.error_of(format('select public.%I(%s)', r.proname, coalesce(v_args, '')));
    if v_err <> 'not_signed_in' then
      raise exception 'FAILED: % answered an admin without a session with "%" instead of not_signed_in', r.proname, v_err;
    end if;
    v_n := v_n + 1;
  end loop;
  perform test.ok(v_n >= 85, 'every admin_* function refuses an admin whose session is gone (' || v_n || ' checked)');
end
$$;
select test.eq(public.is_admin(), false, 'and no access rule lets it read (is_admin)');
select test.eq(test.count('select 1 from public.admin_audit_log'), 0::bigint, 'the audit log is closed to it');
select test.fails($$select public.support_list_requests()$$, 'not_signed_in', 'nor the team functions');

-- A token without any session id (forged or from before sessions) is refused the same way.
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select test.fails($$select public.admin_list_clients()$$, 'not_signed_in', 'a token without a session id is refused');

-- A session past its end (Supabase Auth time-box: not_after) is refused.
reset role;
insert into auth.sessions (id, user_id, not_after) values (current_setting('test.admin_sid')::uuid, test.id('admin'), now() - interval '1 minute');
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin'), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', current_setting('test.admin_sid'))::text, true);
set local role authenticated;
select test.fails($$select public.admin_list_clients()$$, 'not_signed_in', 'an expired session is refused');
reset role;
update auth.sessions set not_after = now() + interval '1 hour' where id = current_setting('test.admin_sid')::uuid;
set local role authenticated;
select test.ok(jsonb_array_length(public.admin_list_clients()) >= 2, 'the same session within its time works');
-- A6 L4: a team member's sign-in lasts 8 hours, whatever Supabase's settings (they apply to everyone).
reset role;
update auth.sessions set created_at = now() - interval '8 hours 1 minute' where id = current_setting('test.admin_sid')::uuid;
set local role authenticated;
select test.fails($$select public.admin_list_clients()$$, 'not_signed_in', 'an admin signed in more than 8 hours ago signs in again');
reset role;
update auth.sessions set created_at = now() - interval '7 hours 59 minutes' where id = current_setting('test.admin_sid')::uuid;
set local role authenticated;
select test.ok(jsonb_array_length(public.admin_list_clients()) >= 2, 'within 8 hours it works');

-- The second step stays required; a session of another person does not count.
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin'), 'role', 'authenticated', 'aal', 'aal1',
  'session_id', current_setting('test.admin_sid'))::text, true);
select test.fails($$select public.admin_list_clients()$$, 'mfa_required', 'aal1 is still refused');
reset role;
insert into auth.sessions (id, user_id) values ('61000000-0000-4000-8000-000000000001', test.id('client_a'));
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin'), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', '61000000-0000-4000-8000-000000000001')::text, true);
set local role authenticated;
select test.fails($$select public.admin_list_clients()$$, 'not_signed_in', 'another person''s session is refused');

-- A deleted admin (deleted_at), a suspended admin: refused.
reset role;
update public.profiles set deleted_at = now() where id = test.id('admin');
select test.login(test.id('admin'));
select test.fails($$select public.admin_list_clients()$$, 'not_allowed', 'a deleted admin is refused');
select test.eq(public.is_admin(), false, 'and is no admin for the access rules');
reset role;
update public.profiles set deleted_at = null, suspended = true where id = test.id('admin');
select test.login(test.id('admin'));
select test.fails($$select public.admin_list_clients()$$, 'account_suspended', 'a suspended admin is refused');
select test.eq(public.is_admin(), false, 'and is no admin for the access rules');
reset role;
update public.profiles set suspended = false where id = test.id('admin');

-- Clients and shops never reach an admin function.
select test.login(test.id('client_a'));
select test.fails($$select public.admin_list_clients()$$, 'not_allowed', 'a client is refused');
select test.login(test.id('owner1'));
select test.fails($$select public.admin_get_shop(test.id('shop1'))$$, 'not_allowed', 'a shop is refused');

-- ================================================================================ H2: views in the log
select test.logout();
select test.unlock_audit_log();
delete from public.admin_audit_log;
delete from public.audit_log_unlocks where txid = txid_current();
select test.login(test.id('admin'));
-- The session of this sign-in (the one ended above was replaced by a new one).
select set_config('test.admin_sid', test.admin_session(test.id('admin'))::text, true);
select public.admin_get_client(test.id('client_a'));
select public.admin_get_client(test.id('client_a'));
select public.admin_get_shop(test.id('shop1'));
select public.admin_get_booking(test.id('booking_a'));
select public.admin_list_bookings(p_q => 'Ana Marin');
select public.admin_list_reviews('prompt');
select public.admin_list_clients();
select public.admin_list_shops();
select test.logout();
select test.eq(test.count($$select 1 from public.admin_audit_log where action = 'view_client' and entity_id = '$$ || test.id('client_a') || $$'$$),
               1::bigint, 'a client card opened twice in 10 minutes: one entry');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'view_client'), 'the row checked next exists');
select test.ok(actor_role = 'admin' and actor_display_id is not null and admin_id = test.id('admin')
               and session_id = current_setting('test.admin_sid')::uuid and created_at is not null,
               'who, with which session, when')
from public.admin_audit_log where action = 'view_client';
select test.eq(test.count($$select 1 from public.admin_audit_log where action = 'view_shop' and entity_id = '$$ || test.id('shop1') || $$'$$), 1::bigint, 'a shop card');
select test.eq(test.count($$select 1 from public.admin_audit_log where action = 'view_booking' and entity_id = '$$ || test.id('booking_a') || $$'$$), 1::bigint, 'a booking card');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'search_bookings'), 'the row checked next exists');
select test.eq(after->>'search', 'true', 'a booking search: that there were words')
from public.admin_audit_log where action = 'search_bookings';
select test.ok(not exists (select 1 from public.admin_audit_log where coalesce(after::text, '') ~* 'ana marin|prompt'),
               'never the words searched');
select test.eq(test.count($$select 1 from public.admin_audit_log where action in ('view_client_list', 'view_shop_list', 'search_reviews')$$), 3::bigint,
               'the lists with personal data');
-- A client reading its own data, a shop its bookings: nothing in the admin log.
select test.login(test.id('client_a'));
select public.export_my_data();
select test.login(test.id('owner1'));
select public.list_shop_bookings();
select test.logout();
select test.eq(test.count($$select 1 from public.admin_audit_log where admin_id in ('$$ || test.id('client_a') || $$', '$$ || test.id('owner1') || $$')$$),
               0::bigint, 'ordinary reads are not admin access');
-- Nobody writes a false entry.
select test.login(test.id('client_a'));
select test.fails($$select public.audit_view('view_client', 'profile', 'x')$$, 'permission denied', 'a client cannot log a view');
select test.fails($$select public.staff_audit('view_client', 'profile', 'x', null, null)$$, 'permission denied', 'nor write an entry');
select test.fails($$insert into public.admin_audit_log (admin_id, action, entity_type) values (auth.uid(), 'view_client', 'profile')$$,
                  'permission denied', 'nor insert a row');

-- ================================================================================ M1: suspended accounts
select test.logout();
update public.profiles set suspended = true where id in (test.id('client_a'), test.id('owner1'));
create function pg_temp.n(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to public;

select test.login(test.id('client_a'));
select test.fails($$update public.profiles set name = 'Alt nume' where id = auth.uid()$$, 'account_suspended', 'a suspended client cannot change its profile');
select test.fails($$update public.profiles set phone = '0723999999' where id = auth.uid()$$, 'account_suspended', 'nor its phone');
select test.eq(pg_temp.n($$update public.profiles set lang = 'en' where id = auth.uid()$$), 1::bigint, 'it may still switch the language');
select test.eq(pg_temp.n($$update public.cars set model = 'Alt model' where owner_id = auth.uid()$$), 0::bigint, 'nor change a car');
select test.eq(pg_temp.n($$delete from public.cars where owner_id = auth.uid()$$), 0::bigint, 'nor delete one');
select test.fails($$insert into public.cars (make, model, plate) values ('Dacia', 'Logan', 'B 123 XYZ')$$,
                  'row-level security', 'nor add one');
select test.ok(test.count('select 1 from public.cars where owner_id = auth.uid()') > 0, 'it still reads its cars');

select test.login(test.id('owner1'));
select test.eq(pg_temp.n($$update public.shops set description = 'Suspendat' where id = test.id('shop1')$$), 0::bigint, 'a suspended owner cannot change its shop');
select test.eq(pg_temp.n($$update public.shop_billing set iban = 'RO49AAAA1B31007593840000' where shop_id = test.id('shop1')$$), 0::bigint, 'nor its IBAN');
select test.eq(pg_temp.n($$update public.shop_hours set is_closed = true where shop_id = test.id('shop1')$$), 0::bigint, 'nor its hours');
select test.fails($$insert into public.shop_closures (shop_id, start_date, end_date) values (test.id('shop1'), current_date + 30, current_date + 31)$$,
                  'row-level security', 'nor add a closure');
select test.eq(pg_temp.n($$delete from public.shop_services where shop_id = test.id('shop1')$$), 0::bigint, 'nor remove its services');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('logos', test.id('shop1') || '/logo.png', auth.uid())$$,
                  'row-level security', 'nor upload a logo');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('shop-photos', test.id('shop1') || '/p.jpg', auth.uid())$$,
                  'row-level security', 'nor a photo');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('intake-photos', test.id('booking_a') || '/i.jpg', auth.uid())$$,
                  'row-level security', 'nor an intake photo');
-- Its colleague: the shop of a suspended owner is suspended in effect.
select test.login(test.id('staff1'));
select test.eq(pg_temp.n($$update public.shop_photos set position = position where shop_id = test.id('shop1')$$), 0::bigint,
               'a colleague cannot change the photos of a suspended owner''s shop');

-- A shop suspended by the admin (its owner active).
select test.logout();
update public.profiles set suspended = false where id = test.id('owner1');
update public.shops set suspended = true where id = test.id('shop1');
select test.login(test.id('owner1'));
select test.eq(pg_temp.n($$update public.shops set description = 'X' where id = test.id('shop1')$$), 0::bigint, 'a suspended shop cannot be changed by its owner');
select test.eq(pg_temp.n($$update public.shop_billing set billing_email = 'x@test.local' where shop_id = test.id('shop1')$$), 0::bigint, 'nor its billing data');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('logos', test.id('shop1') || '/logo2.png', auth.uid())$$,
                  'row-level security', 'nor its files');
-- An active shop and an active client work as before.
select test.logout();
update public.shops set suspended = false where id = test.id('shop1');
update public.profiles set suspended = false where id = test.id('client_a');
select test.login(test.id('owner1'));
select test.eq(pg_temp.n($$update public.shops set description = 'Activ' where id = test.id('shop1')$$), 1::bigint, 'an active owner changes its shop');
select test.login(test.id('client_a'));
select test.eq(pg_temp.n($$update public.profiles set name = 'Ana Marin' where id = auth.uid()$$), 1::bigint, 'an active client its profile');
-- The admin still acts on a suspended shop through its functions.
select test.logout();
update public.shops set suspended = true where id = test.id('shop1');
select test.login(test.id('admin'));
select test.eq((public.admin_update_shop(test.id('shop1'), '{"description":"De admin"}', null, test.rid(), 'Corectură'))->'shop'->>'description',
               'De admin', 'the admin edits a suspended shop');
select test.logout();
update public.shops set suspended = false where id = test.id('shop1');

-- ================================================================================ M2: append-only log
select test.login(test.id('admin'));
select public.admin_get_client(test.id('client_b'));
select test.logout();
set local role service_role;
select test.fails($$update public.admin_audit_log set reason = 'schimbat'$$, 'permission denied', 'the service role cannot change the log');
select test.fails($$delete from public.admin_audit_log$$, 'permission denied', 'nor delete from it');
select test.fails($$truncate public.admin_audit_log$$, 'permission denied', 'nor empty it');
select test.fails($$select public.audit_log_unlock('retention')$$, 'permission denied', 'nor unlock it');
select test.fails($$insert into public.audit_log_unlocks (txid, purpose) values (txid_current(), 'retention')$$, 'permission denied',
                  'nor write the unlock table');
select test.fails($$select public.run_audit_retention_a5('support_log', now())$$, 'permission denied', 'nor run the inner retention');
select test.fails($$select public.audit_forget_account_a5(gen_random_uuid(), 'x', 'x', 'x')$$, 'permission denied', 'nor the inner erasure');
reset role;
select test.login(test.id('admin'));
select test.fails($$update public.admin_audit_log set reason = 'schimbat'$$, 'permission denied', 'an admin cannot change it');
select test.logout();
-- Even the table's owner is stopped without an unlock (the protection is in the table, not the API).
select test.fails($$update public.admin_audit_log set reason = 'schimbat'$$, 'audit_log_append_only', 'an update by the owner is refused');
select test.fails($$delete from public.admin_audit_log$$, 'audit_log_append_only', 'a delete too');
select test.fails($$truncate public.admin_audit_log$$, 'audit_log_append_only', 'a truncate too');
select test.ok((select count(*) from public.admin_audit_log) > 0, 'the rows are all there');
-- The two mechanisms still work: retention (off: nothing, no error) and the erasure of an account.
select test.eq(public.run_audit_retention('support_log'), null::jsonb, 'the retention job runs (switched off: nothing to do)');
select test.eq(test.count('select 1 from public.audit_log_unlocks'), 0::bigint, 'and locks the log again');
select test.ok(public.audit_forget_account(test.id('client_b'), 'Bogdan Pop', 'bogdan@test.local', '0723000002') >= 0,
               'the erasure of an account''s data runs');
select test.eq(test.count('select 1 from public.audit_log_unlocks'), 0::bigint, 'and locks the log again');

-- ================================================================================ M5: reasons
select test.login(test.id('admin'));
select test.fails($$select public.admin_verify_phone(test.id('owner2'), test.rid())$$, 'reason_required', 'verifying a phone needs a reason');
select test.fails($$select public.admin_verify_phone(test.id('owner2'), test.rid(), '   ')$$, 'reason_required', 'a blank one is no reason');
select test.fails($$select public.admin_verify_phone(test.id('owner2'), test.rid(), repeat('x', 501))$$, 'reason_too_long', 'at most 500 characters');
select test.fails($$select public.admin_grant_report_credit(test.id('client_a'), test.rid())$$, 'reason_required', 'a report credit');
select test.fails($$select public.admin_set_subscription_price(test.id('shop1'), 120, test.rid())$$, 'reason_required', 'a price');
select test.fails($$select public.admin_extend_trial(test.id('shop1'), 10, test.rid())$$, 'reason_required', 'a free period');
select test.fails($$select public.admin_extend_company_trial(test.id('co'), 10, test.rid())$$, 'reason_required', 'a company''s free period');
select test.fails($$select public.admin_set_company_plan(test.id('co'), 'start', test.rid())$$, 'reason_required', 'a company plan');
select test.fails($$select public.admin_update_settings('{"trial_days": 60}', test.rid())$$, 'reason_required', 'the platform settings');
select test.fails($$select public.admin_update_shop(test.id('shop2'), '{"name":"Nou"}', null, test.rid())$$, 'reason_required', 'a shop''s data');
select test.fails($$select public.admin_export('clients')$$, 'reason_required', 'an export');
select test.fails($$select public.admin_set_account_suspended(test.id('client_b'), true, '', test.rid())$$, 'reason_required', 'a suspension');
select public.admin_set_account_suspended(test.id('client_b'), true, 'Abuz', test.rid());
select test.fails($$select public.admin_set_account_suspended(test.id('client_b'), false, null, test.rid())$$, 'reason_required',
                  'reactivating needs one too');
select public.admin_set_account_suspended(test.id('client_b'), false, 'Verificat', test.rid());
select public.admin_verify_phone(test.id('owner2'), test.rid(), 'Confirmat la telefon');
select test.logout();
select test.ok(exists (select 1 from public.admin_audit_log where action in ('verify_phone', 'verify_phone_manually')
                                                               and entity_id = test.id('owner2')::text and reason = 'Confirmat la telefon'),
               'the reason is in the audit entry');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'unsuspend_account' and entity_id = test.id('client_b')::text
                                                               and reason = 'Verificat'),
               'the reactivation''s too');

-- The owner is told when the admin changes the IBAN or the billing email; once; only the end of the IBAN.
delete from public.notification_events;
select test.login(test.id('admin'));
select set_config('test.bill', gen_random_uuid()::text, true);
select public.admin_update_shop(test.id('shop1'), null, '{"iban":"RO66BACX0000001234567890"}', current_setting('test.bill')::uuid, 'Cerere scrisă');
select public.admin_update_shop(test.id('shop1'), null, '{"iban":"RO66BACX0000001234567890"}', current_setting('test.bill')::uuid, 'Cerere scrisă');
select test.fails($$select public.admin_update_shop(test.id('shop1'), null, '{"iban":"RO00XXXX"}', test.rid(), 'Greșit')$$, 'field_invalid',
                  'an invalid IBAN is refused');
select public.admin_update_shop(test.id('shop1'), '{"description":"Doar descrierea"}', null, test.rid(), 'Corectură');
select public.admin_update_shop(test.id('shop1'), null, '{"iban":"RO66BACX0000001234567890"}', test.rid(), 'Același IBAN');
select test.logout();
select test.eq(test.count($$select 1 from public.notification_events where event = 'billing_changed'$$), 1::bigint,
               'one notice, not repeated by the retry, none for a refused or other change');
select test.ok(exists (select 1 from public.notification_events where event = 'billing_changed'), 'the row checked next exists');
select test.ok(user_id = test.id('owner1') and params->'fields' = '["iban"]'::jsonb and params->>'iban_end' = '7890'
               and params::text !~ 'RO66BACX' and 'email' = any (channels) and 'push' = any (channels),
               'to the owner, by push and email, the field and the last 4 characters only')
from public.notification_events where event = 'billing_changed';

-- Exports: 100 rows at most, no phone or VIN, the words of a search kept out, 5 an hour.
do $$
begin
  for i in 1..101 loop
    perform test.sign_up(format('export-%s@test.local', i), jsonb_build_object('role', 'client', 'name', 'Client ' || i, 'phone', '0723' || lpad(i::text, 6, '0')));
  end loop;
end
$$;
select test.forget_rate('admin_export');
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.admin_export('clients', '{}', 'Raport lunar')), 100, 'an export has at most 100 rows');
select test.ok(not exists (select 1 from jsonb_array_elements(public.admin_export('clients', '{}', 'Raport lunar')) x where x ? 'phone'),
               'and no phone number');
select test.ok(not exists (select 1 from jsonb_array_elements(public.admin_export('bookings', '{"q":"Ana"}', 'Verificare')) x
                           where x ? 'vin' or x ? 'client_phone'), 'nor a VIN');
select test.ok((select bool_and(x->>'id' = test.id('shop1')::text) and count(*) = 1
                from jsonb_array_elements(public.admin_export('shops', jsonb_build_object('ids', jsonb_build_array(test.id('shop1'), gen_random_uuid())), 'Verificare')) x),
               'a screen''s own selection: only the rows it shows (an unknown id adds nothing)');
select public.admin_export('reviews', '{}', 'Verificare');
select test.fails($$select public.admin_export('clients', '{}', 'Încă una')$$, 'limit_exports', 'the sixth export in an hour is refused');
select test.logout();
select test.ok(exists (select 1 from public.admin_audit_log where action = 'export' and entity_id = 'clients'), 'the row checked next exists');
select test.ok(after->>'truncated' = 'true' and (after->>'total')::int > 100 and (after->>'rows')::int = 100 and reason = 'Raport lunar',
               'the log knows it was cut, and why it was made')
from public.admin_audit_log where action = 'export' and entity_id = 'clients' order by created_at limit 1;
select test.ok(not exists (select 1 from public.admin_audit_log where action = 'export' and after::text ~ 'Ana'), 'no search words in the log');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'export' and entity_id = 'shops'), 'the row checked next exists');
select test.ok(after->'filters'->>'selected' = '2' and not (after->'filters' ? 'ids'), 'the selection is counted, its ids not copied')
from public.admin_audit_log where action = 'export' and entity_id = 'shops';

-- ================================================================================ M6: admins
select test.sign_up('admin2@test.local', '{"role":"client","name":"Al doilea admin"}');
select public.promote_to_admin('admin2@test.local');
insert into test.ids select 'admin2', id from auth.users where email = 'admin2@test.local';
select test.admin_session(test.id('admin2'));
insert into auth.sessions (user_id) values (test.id('admin2'));
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.admin_team_admins()), 2, 'the admins, for the team screen');
select test.ok((select bool_and((a->>'me')::boolean = (a->>'id' = test.id('admin')::text)) from jsonb_array_elements(public.admin_team_admins()) a),
               'with who is me');
select test.fails($$select public.admin_set_admin_suspended(test.id('admin'), true, 'Test', test.rid())$$, 'cannot_target_self',
                  'never oneself');
select test.fails($$select public.admin_end_admin_sessions(test.id('admin'), 'Test', test.rid())$$, 'cannot_target_self',
                  'nor one''s own sessions this way');
select test.fails($$select public.admin_set_admin_suspended(test.id('admin2'), true, '', test.rid())$$, 'reason_required', 'a reason');
select test.fails($$select public.admin_set_admin_suspended(test.id('client_a'), true, 'x', test.rid())$$, 'not_found', 'only an admin');
select test.eq((public.admin_end_admin_sessions(test.id('admin2'), 'Telefon pierdut', test.rid()))->>'sessions_ended', '2',
               'every session of the other admin ends');
select test.logout();
select test.eq(test.count($$select 1 from auth.sessions where user_id = '$$ || test.id('admin2') || $$'$$), 0::bigint, 'none left');
select set_config('request.jwt.claim.sub', test.id('admin2')::text, true);
select set_config('request.jwt.claims', jsonb_build_object('sub', test.id('admin2'), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', gen_random_uuid())::text, true);
set local role authenticated;
select test.fails($$select public.admin_list_clients()$$, 'not_signed_in', 'its old tokens are refused at once');
reset role;
select test.ok(exists (select 1 from public.security_events where kind = 'admin_sessions_ended'), 'the row checked next exists');
select test.ok(severity = 'warning' and actor_id = test.id('admin') and subject_id = test.id('admin2')::text,
               'a security event names who ended whose sessions')
from public.security_events where kind = 'admin_sessions_ended';

select test.admin_session(test.id('admin2'));
select test.login(test.id('admin'));
select public.admin_set_admin_suspended(test.id('admin2'), true, 'Acces neautorizat suspectat', test.rid());
select test.logout();
select test.ok((select suspended from public.profiles where id = test.id('admin2')), 'the other admin is suspended');
select test.eq(test.count($$select 1 from auth.sessions where user_id = '$$ || test.id('admin2') || $$'$$), 0::bigint,
               'and its sessions ended with it');
select test.login(test.id('admin2'));
select test.fails($$select public.admin_set_admin_suspended(test.id('admin'), true, 'Răzbunare', test.rid())$$, 'account_suspended',
                  'a suspended admin cannot act, not even on the one who suspended it');
select test.login(test.id('admin'));
select test.fails($$select public.admin_set_admin_suspended(test.id('admin2'), true, 'x', test.rid())$$, 'wrong_status', 'already suspended');
select public.admin_set_admin_suspended(test.id('admin2'), false, 'Verificat', test.rid());
select test.login(test.id('admin2'));
select test.ok(jsonb_array_length(public.admin_team_admins()) = 2, 'reactivated, it signs in again and works');
-- Its own other devices: the session in use stays.
select test.logout();
insert into auth.sessions (user_id) values (test.id('admin2')), (test.id('admin2'));
select test.login(test.id('admin2'));
select test.eq((public.admin_end_my_other_sessions('Laptop pierdut', test.rid()))->>'sessions_ended', '2', 'its other sessions end');
select test.ok(jsonb_array_length(public.admin_team_admins()) = 2, 'and the one in use keeps working');
select test.logout();
select test.ok(exists (select 1 from public.admin_audit_log where admin_id = test.id('admin2') and action = 'end_own_sessions'), 'the row checked next exists');
select test.eq(action, 'end_own_sessions', 'logged') from public.admin_audit_log where admin_id = test.id('admin2') and action = 'end_own_sessions';
select test.ok(exists (select 1 from public.admin_audit_log where action = 'suspend_admin' and reason = 'Acces neautorizat suspectat')
               and exists (select 1 from public.admin_audit_log where action = 'unsuspend_admin' and reason = 'Verificat'),
               'suspending and reactivating an admin are logged with their reason');
-- The account's own suspension functions still never touch an admin.
select test.login(test.id('admin'));
select test.fails($$select public.admin_set_account_suspended(test.id('admin2'), true, 'x', test.rid())$$, 'not_found',
                  'an admin is not suspended as an account');

-- ================================================================================ L3: an agent's sessions
select test.logout();
select set_config('test.ag', test.sign_up('agent161@test.local', '{"role":"client","name":"Agent A6"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agent161@test.local', 'Echipă', test.rid());
select test.logout();
insert into auth.sessions (user_id) values (current_setting('test.ag')::uuid), (current_setting('test.ag')::uuid);
select test.login(test.id('admin'));
select public.admin_revoke_support(current_setting('test.ag')::uuid, 'Plecat', test.rid());
select test.logout();
select test.eq(test.count($$select 1 from auth.sessions where user_id = '$$ || current_setting('test.ag') || $$'$$), 0::bigint,
               'withdrawing the role ends the agent''s sessions');
select test.eq(test.count($$select 1 from public.security_events where kind = 'session_cleanup_failed'$$), 0::bigint, 'with no failure recorded');
-- When the sessions cannot be deleted (simulated: Auth refuses the delete), the change still stands,
-- the failure is recorded as a high security event (never silent), and the old token is refused anyway.
select set_config('test.ag2', test.sign_up('agent161b@test.local', '{"role":"client","name":"Agent A6 b"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agent161b@test.local', 'Echipă', test.rid());
select test.logout();
insert into auth.sessions (user_id) values (current_setting('test.ag2')::uuid) returning id as ag2_sid \gset
create function pg_temp.no_session_delete() returns trigger language plpgsql as $f$
begin raise exception 'simulated' using errcode = '42501'; end $f$;
create trigger no_session_delete before delete on auth.sessions for each row execute function pg_temp.no_session_delete();
select test.login(test.id('admin'));
select public.admin_revoke_support(current_setting('test.ag2')::uuid, 'Plecat', test.rid());
select test.logout();
drop trigger no_session_delete on auth.sessions;
select test.eq((select role from public.profiles where id = current_setting('test.ag2')::uuid), 'client', 'the role is withdrawn even so');
select test.eq(test.count($$select 1 from public.security_events where kind = 'session_cleanup_failed' and severity = 'high'
                                and subject_id = '$$ || current_setting('test.ag2') || $$'$$), 1::bigint,
               'the failed cleanup is a high security event');
select set_config('request.jwt.claim.sub', current_setting('test.ag2'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.ag2'), 'role', 'authenticated', 'aal', 'aal2',
  'session_id', :'ag2_sid')::text, true);
set local role authenticated;
select test.fails($$select public.support_list_requests()$$, 'not_allowed', 'and the former agent''s live session is refused');
reset role;
select test.logout();

-- ================================================================================ M3: security events are grouped and closed
select test.login(test.id('client_a'));
select test.fails($$select * from public.security_events$$, 'permission denied', 'nobody reads the security events directly');
select test.fails($$select public.security_report(auth.uid(), 'file_rejected', 'warning', '{}')$$, 'permission denied',
                  'nor reports one');
select test.logout();
set local role service_role;
select public.security_report(test.id('client_a'), 'file_rejected', 'warning', '{"reason": "pdf_active"}');
select public.security_report(test.id('client_a'), 'file_rejected', 'warning', '{"reason": "type"}');
reset role;
select test.ok(exists (select 1 from public.security_events where kind = 'file_rejected' and actor_id = test.id('client_a')), 'the row checked next exists');
select test.eq(occurrences, 2, 'the same event twice in an hour is one row, counted')
from public.security_events where kind = 'file_rejected' and actor_id = test.id('client_a');
select test.fails($$select public.security_report(gen_random_uuid(), 'anything', 'warning', '{}')$$, 'field_invalid',
                  'only the known kinds');
-- The admins read them (Activitate → Securitate); nobody else.
select test.login(test.id('admin'));
select test.ok((select bool_or(e->>'kind' = 'file_rejected' and (e->>'occurrences')::int = 2
                               and e->>'subject_display_id' is not null and e->>'actor_display_id' is not null)
                from jsonb_array_elements(public.admin_security_events()) e),
               'the admin sees the grouped event, with IDs, not names');
select test.ok(not exists (select 1 from jsonb_array_elements(public.admin_security_events('high')) e where e->>'severity' <> 'high'),
               'filtered by severity');
select test.eq(jsonb_array_length(public.admin_security_events(null, now() - interval '1 day')), 0, 'paged by time');
select test.fails($$select public.admin_security_events('everything')$$, 'field_invalid', 'only known severities');
select test.login(test.id('client_a'));
select test.fails($$select public.admin_security_events()$$, 'not_allowed', 'a client cannot read them');
select test.logout();

-- ================================================================================ M4: fleet files
-- client_b drives v1 of `co`; `co2` belongs to someone else.
select test.login(test.id('client_b'));
select set_config('test.fp', (public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'image/jpeg', 120000))->>'path', true);
select test.ok(current_setting('test.fp') ~ ('^' || test.id('co') || '/' || test.id('v1') || '/[0-9a-f-]{36}\.jpg$'), 'a driver gets a path for its vehicle');
select test.fails($$select public.fleet_file_begin(test.id('co2'), test.id('v1'), null, 'image/jpeg', 1000)$$, 'not_allowed',
                  'never in another company');
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'text/html', 1000)$$, 'file_invalid', 'only images and PDF');
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'image/jpeg', 5 * 1024 * 1024 + 1)$$, 'file_invalid',
                  'at most 5 MB');
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), gen_random_uuid(), 'application/pdf', 1000)$$, 'file_invalid',
                  'a report photo is never a PDF');
-- Without a ticket, the browser cannot store anything in fleet-files, even on a right path.
select test.fails(format($$insert into storage.objects (bucket_id, name, owner) values ('fleet-files', %L, auth.uid())$$, current_setting('test.fp')),
                  'row-level security', 'no direct upload without the Edge Function''s ticket');
reset role;
select public.fleet_file_ticket(test.id('client_b'), current_setting('test.fp'));
select test.login(test.id('client_a'));
select test.fails(format($$insert into storage.objects (bucket_id, name, owner) values ('fleet-files', %L, auth.uid())$$, current_setting('test.fp')),
                  'row-level security', 'another person cannot use the ticket');
select test.login(test.id('client_b'));
insert into storage.objects (bucket_id, name, owner, metadata) select 'fleet-files', current_setting('test.fp'), auth.uid(), '{"size": 120000}';
select test.ok(test.count(format($$select 1 from storage.objects where name = %L$$, current_setting('test.fp'))) = 1,
               'with the ticket, the file is stored and the driver reads it');
reset role;
select public.fleet_file_ticket_done(current_setting('test.fp'));
update public.fleet_file_tickets set expires_at = now() - interval '1 second';
-- An expired ticket is worth nothing.
select public.fleet_file_ticket(test.id('client_b'), test.id('co') || '/' || test.id('v1') || '/late.jpg');
update public.fleet_file_tickets set expires_at = now() - interval '1 second';
select test.login(test.id('client_b'));
select test.fails(format($$insert into storage.objects (bucket_id, name, owner) values ('fleet-files', %L, auth.uid())$$,
                  test.id('co') || '/' || test.id('v1') || '/late.jpg'), 'row-level security', 'an expired ticket is refused');
-- A suspended person cannot upload.
reset role;
update public.profiles set suspended = true where id = test.id('client_b');
select test.login(test.id('client_b'));
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'image/jpeg', 1000)$$, 'account_suspended',
                  'a suspended account cannot upload');
reset role;
update public.profiles set suspended = false where id = test.id('client_b');
-- At most 6 photos per report.
select set_config('test.issue', gen_random_uuid()::text, true);
insert into storage.objects (bucket_id, name, owner)
select 'fleet-files', test.id('co') || '/' || test.id('v1') || '/issues/' || current_setting('test.issue') || '/' || i || '.jpg', test.id('client_b')
from generate_series(1, 6) i;
select test.login(test.id('client_b'));
select test.fails(format($$select public.fleet_file_begin(test.id('co'), test.id('v1'), %L, 'image/jpeg', 1000)$$, current_setting('test.issue')),
                  'too_many_photos', 'a seventh photo on one report is refused');
-- At most 500 MB per company.
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('fleet-files', test.id('co') || '/' || test.id('v1') || '/big.pdf', test.id('client_a'), jsonb_build_object('size', 500 * 1024 * 1024));
select test.login(test.id('client_b'));
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'image/jpeg', 1000)$$, 'limit_fleet_storage',
                  'a company over 500 MB cannot add more');
reset role;
delete from storage.objects where name = test.id('co') || '/' || test.id('v1') || '/big.pdf';
-- At most 60 files an hour per person.
insert into public.rate_events (kind, subject) select 'fleet_upload', test.id('client_b') from generate_series(1, 60);
select test.login(test.id('client_b'));
select test.fails($$select public.fleet_file_begin(test.id('co'), test.id('v1'), null, 'image/jpeg', 1000)$$, 'limit_fleet_uploads',
                  'the 61st file in an hour is refused');
select test.logout();

-- ================================================================================ L2: generated PDFs
select test.login(test.id('owner1'));
select test.fails($$select public.document_limit(auth.uid(), 'job_document')$$, 'permission denied', 'a person cannot call the limit itself');
select test.logout();
set local role service_role;
do $$ begin for i in 1..30 loop perform public.document_limit(test.id('owner1'), 'job_document'); end loop; end $$;
select test.fails($$select public.document_limit(test.id('owner1'), 'job_document')$$, 'limit_documents', 'the 31st job document in an hour is refused');
select public.document_limit(test.id('owner2'), 'job_document');
select public.document_limit(test.id('owner1'), 'report_generate');
do $$ begin for i in 1..10 loop perform public.document_limit(test.id('client_a'), 'report_generate'); end loop; end $$;
select test.fails($$select public.document_limit(test.id('client_a'), 'report_generate')$$, 'limit_documents', 'the 11th report made again in an hour is refused');
select test.fails($$select public.document_limit(test.id('client_a'), 'anything')$$, 'field_invalid', 'only the known kinds');
reset role;
select test.eq(test.count($$select 1 from public.rate_events where kind = 'job_document' and subject = '$$ || test.id('owner2') || $$'$$), 1::bigint,
               'another person keeps its own limit');

-- ================================================================================ the rest is unchanged
select test.eq((select version from public.schema_version), 119, 'schema 119');
rollback;
