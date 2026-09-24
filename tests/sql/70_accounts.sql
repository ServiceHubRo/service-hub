-- Accounts (T04): data export, cancelling a pending email change, account deletion.
begin;
select test.make_world();

-- ------------------------------------------------------------------ export_my_data
select test.login(test.id('client_a'));
select set_config('test.export', public.export_my_data()::text, true);
select test.eq(current_setting('test.export')::jsonb #>> '{account,email}', 'ana@test.local', 'export: own email');
select test.eq(current_setting('test.export')::jsonb #>> '{account,role}', 'client', 'export: role');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'cars'), 1, 'export: own car only');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'bookings'), 1, 'export: own booking only');
select test.eq(current_setting('test.export')::jsonb #>> '{bookings,0,quotes,0,items,1,name}', 'Manoperă', 'export: quote lines');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'reviews'), 1, 'export: own review');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'messages'), 2, 'export: own conversation (incl. automatic message)');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'history_reports'), 1, 'export: own report');
select test.ok(current_setting('test.export')::jsonb -> 'shop' is null, 'export: a client has no shop section');
select test.ok(position('bogdan' in lower(current_setting('test.export'))) = 0, 'export: nothing about another client');

select test.login(test.id('owner1'));
select set_config('test.export', public.export_my_data()::text, true);
select test.eq(current_setting('test.export')::jsonb #>> '{shop,name}', 'Atelier Unu', 'export: owner gets the shop');
select test.eq(current_setting('test.export')::jsonb #>> '{shop,billing,vat_id}', 'RO14872301', 'export: owner gets billing');
select test.eq(jsonb_array_length(current_setting('test.export')::jsonb -> 'bookings'), 0, 'export: the shop''s bookings are not the owner''s data');

select test.login(test.id('staff1'));
select set_config('test.export', public.export_my_data()::text, true);
select test.eq(current_setting('test.export')::jsonb #>> '{shop,my_role}', 'staff', 'export: staff role');
select test.ok(current_setting('test.export')::jsonb #> '{shop,billing}' = 'null'::jsonb, 'export: staff never gets billing');

select test.login_anon();
select test.fails('select public.export_my_data()', 'permission denied', 'export: signed-out visitors cannot call it');

-- ------------------------------------------------------------------ cancel_email_change
select test.logout();
update auth.users set email_change = 'ana.noua@test.local', email_change_token_new = 'tok-new',
                      email_change_token_current = 'tok-cur'
where id in (test.id('client_a'), test.id('client_b'));
select test.login(test.id('client_a'));
select public.cancel_email_change(test.rid());
select test.logout();
select test.eq((select email_change from auth.users where id = test.id('client_a')), '', 'pending change dropped');
select test.eq((select email from auth.users where id = test.id('client_a')), 'ana@test.local', 'current address kept');
select test.eq((select email_change from auth.users where id = test.id('client_b')), 'ana.noua@test.local', 'another user''s pending change untouched');
select test.login_anon();
select test.fails('select public.cancel_email_change(gen_random_uuid())', 'permission denied', 'cancel_email_change: not for visitors');

-- ------------------------------------------------------------------ prepare_account_deletion
-- Browser roles cannot call it, and cannot set deleted_at themselves.
select test.login(test.id('client_a'));
select test.fails(format('select public.prepare_account_deletion(%L)', test.id('client_a')), 'permission denied',
  'prepare_account_deletion: not callable when signed in');
select test.fails('update public.profiles set deleted_at = now() where id = auth.uid()', 'permission denied',
  'deleted_at is not writable from the browser');
select test.logout();

set local role service_role;
select test.eq(test.error_of(format('select public.prepare_account_deletion(%L)', test.id('admin'))), 'not_allowed',
  'admin accounts are not deleted this way');
select test.eq(test.error_of(format('select public.prepare_account_deletion(%L)', test.id('client_b'))),
  'account_has_active_bookings', 'a client with an active booking is refused');
select test.eq(test.error_of(format('select public.prepare_account_deletion(%L)', test.id('owner2'))),
  'shop_has_active_bookings', 'a shop with an active booking is refused');

-- A client: name and phone leave what the shop keeps; own data is gone; the login is deleted.
select test.eq(public.prepare_account_deletion(test.id('client_a')), 'delete', 'client → delete the login');
select test.eq(public.prepare_account_deletion(test.id('client_a')), 'delete', 'client → same answer on retry');
reset role;
select test.ok((select client_name is null and client_phone is null from public.bookings where id = test.id('booking_a')),
  'booking snapshot loses name and phone');
select test.eq((select car_snapshot->>'plate' from public.bookings where id = test.id('booking_a')), 'BV 12 ABC',
  'the car on the shop''s record stays');
select test.ok((select client_name is null from public.threads where id = test.id('thread_a')), 'thread loses the name');
select test.eq((select client_display_name from public.reviews where booking_id = test.id('booking_a')), '',
  'review loses the author name');
select test.eq((select count(*) from public.cars where owner_id = test.id('client_a')), 0::bigint, 'cars deleted');
select test.eq((select count(*) from public.push_subscriptions where user_id = test.id('client_a')), 0::bigint, 'push subscriptions deleted');
delete from auth.users where id = test.id('client_a'); -- what the Edge Function does next
select test.eq((select count(*) from public.profiles where id = test.id('client_a')), 0::bigint, 'profile gone with the login');
select test.eq((select count(*) from public.bookings where id = test.id('booking_a')), 1::bigint, 'the shop keeps its booking');
select test.eq((select count(*) from public.reviews where booking_id = test.id('booking_a')), 1::bigint, 'the review stays, anonymous');

-- A shop owner whose shop has records: the shop closes, the owner is anonymized, the login stays (closed).
set local role service_role;
select test.eq(public.prepare_account_deletion(test.id('owner1')), 'anonymize', 'shop with records → anonymize');
select test.eq(public.prepare_account_deletion(test.id('owner1')), 'anonymize', 'shop with records → same answer on retry');
reset role;
select test.ok((select name is null and phone is null and deleted_at is not null from public.profiles where id = test.id('owner1')),
  'owner profile anonymized');
select test.ok(not (select active from public.shops where id = test.id('shop1')), 'shop deactivated');
select test.ok(not public.is_shop_public(test.id('shop1')), 'shop no longer in search');
select test.eq((select status from public.subscriptions where shop_id = test.id('shop1')), 'inactive', 'subscription inactive');
select test.eq((select count(*) from public.shop_staff where shop_id = test.id('shop1') and role = 'staff'), 0::bigint, 'staff removed');
select test.eq((select count(*) from public.bookings where shop_id = test.id('shop1')), 2::bigint, 'the shop''s bookings are kept');

-- A shop owner without any records: the whole shop goes with the login.
delete from public.bookings where shop_id = test.id('shop2');
set local role service_role;
select test.eq(public.prepare_account_deletion(test.id('owner2')), 'delete', 'shop without records → delete');
reset role;
delete from auth.users where id = test.id('owner2');
select test.eq((select count(*) from public.shops where id = test.id('shop2')), 0::bigint, 'the empty shop is deleted with its owner');

rollback;
