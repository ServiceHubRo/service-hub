-- Shop settings (T05): first-run checklist and visibility reasons, hours saved in one go, the
-- offered services as one set, capacity stamp, billing reminder, staff invitations, manual phone
-- verification.
begin;
select test.make_world();

select set_config('test.week', '[
  {"weekday":0,"is_closed":true},
  {"weekday":1,"is_closed":false,"open_time":"08:00","close_time":"18:00"},
  {"weekday":2,"is_closed":false,"open_time":"08:00","close_time":"18:00"},
  {"weekday":3,"is_closed":false,"open_time":"08:00","close_time":"18:00"},
  {"weekday":4,"is_closed":false,"open_time":"08:00","close_time":"18:00"},
  {"weekday":5,"is_closed":false,"open_time":"08:30","close_time":"17:00"},
  {"weekday":6,"is_closed":false,"open_time":"09:00","close_time":"13:00"}]', true);

-- ------------------------------------------------------------------ get_shop_setup: a new shop
select test.login(test.id('owner2'));
select set_config('test.setup', public.get_shop_setup()::text, true);
select test.eq(current_setting('test.setup')::jsonb -> 'steps',
  '{"services":false,"hours":false,"capacity":false,"phone":false}'::jsonb, 'new shop: no step done');
select test.eq(current_setting('test.setup')::jsonb -> 'reasons', '["phone_unverified","no_services"]'::jsonb,
  'new shop: not in search because of phone and services');
select test.eq(current_setting('test.setup')::jsonb ->> 'public', 'false', 'new shop: not public');
select test.eq(current_setting('test.setup')::jsonb ->> 'is_owner', 'true', 'owner flag');
select test.eq(current_setting('test.setup')::jsonb ->> 'setup_completed', 'false', 'checklist still shown');
select test.eq(current_setting('test.setup')::jsonb #>> '{billing,complete}', 'false', 'billing incomplete');
select test.eq(current_setting('test.setup')::jsonb #>> '{billing,reminder}', 'false', 'no billing reminder at the start of the trial');

-- A public shop: no reasons. Staff get no billing section.
select test.login(test.id('owner1'));
select test.eq(public.get_shop_setup() -> 'reasons', '[]'::jsonb, 'public shop: no reasons');
select test.eq(public.get_shop_setup() ->> 'public', 'true', 'public shop: public');
select test.login(test.id('staff1'));
select test.eq(public.get_shop_setup() ->> 'is_owner', 'false', 'staff: not owner');
select test.ok(not (public.get_shop_setup() ? 'billing'), 'staff: no billing data');
select test.login(test.id('client_a'));
select test.eq(test.error_of('select public.get_shop_setup()'), 'not_allowed', 'client: no shop setup');
select test.login_anon();
select test.fails('select public.get_shop_setup()', 'permission denied', 'visitor: no shop setup');

-- ------------------------------------------------------------------ save_shop_hours
select test.login(test.id('owner2'));
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)',
  (select jsonb_agg(e) from jsonb_array_elements(current_setting('test.week')::jsonb) e where (e->>'weekday')::int < 6), test.rid())),
  'hours_invalid', 'hours: all seven days are required');
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)',
  jsonb_set(current_setting('test.week')::jsonb, '{1,weekday}', '2'), test.rid())),
  'hours_invalid', 'hours: each weekday once');
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)',
  jsonb_set(current_setting('test.week')::jsonb, '{2,open_time}', '"08:15"'), test.rid())),
  'hours_invalid', 'hours: on the half hour');
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)',
  jsonb_set(current_setting('test.week')::jsonb, '{2,open_time}', '"nine"'), test.rid())),
  'hours_invalid', 'hours: a time that is not a time');
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)',
  jsonb_set(current_setting('test.week')::jsonb, '{3,close_time}', '"07:00"'), test.rid())),
  'hours_close_before_open', 'hours: closing after opening');
select test.eq(test.error_params(format('select public.save_shop_hours(%L::jsonb, %L)',
  jsonb_set(current_setting('test.week')::jsonb, '{3,close_time}', '"07:00"'), test.rid())),
  '{"weekday": 3}'::jsonb, 'hours: the error names the day');
select test.logout();
select test.eq((select count(*) from public.shop_hours where shop_id = test.id('shop2') and weekday = 6 and not is_closed),
  0::bigint, 'a refused week changes nothing');

select test.login(test.id('owner2'));
select set_config('test.rid', test.rid()::text, true);
select test.eq(jsonb_array_length(public.save_shop_hours(current_setting('test.week')::jsonb, current_setting('test.rid')::uuid)),
  7, 'hours saved: seven rows back');
-- The same request again returns the first result and changes nothing.
select test.eq(public.save_shop_hours('[]'::jsonb, current_setting('test.rid')::uuid) #>> '{6,close_time}', '13:00',
  'hours: a repeated request returns the first result');
select test.logout();
select test.eq(open_time, '09:00'::time, 'Saturday opens at 9'),
       test.eq(close_time, '13:00'::time, 'Saturday closes at 13')
from public.shop_hours where shop_id = test.id('shop2') and weekday = 6;
select test.eq((select open_time from public.shop_hours where shop_id = test.id('shop2') and weekday = 5), '08:30'::time,
  'half hours are kept');
select test.ok((select hours_reviewed_at is not null from public.shops where id = test.id('shop2')), 'hours step done');
select test.eq((select count(*) from public.shop_hours where shop_id = test.id('shop1') and weekday = 6 and not is_closed),
  0::bigint, 'another shop''s hours untouched');

select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select public.save_shop_hours(%L::jsonb, %L)', current_setting('test.week'), test.rid())),
  'not_allowed', 'hours: a client has no shop');

-- ------------------------------------------------------------------ capacity stamp (step 3)
select test.login(test.id('owner2'));
update public.shops set daily_capacity = 6, capacity_reviewed_at = '2000-01-01' where id = test.id('shop2');
select test.logout();
select test.eq((select capacity_reviewed_at from public.shops where id = test.id('shop2')), now(),
  'capacity stamp is the server time, not what the browser sent');
select test.login(test.id('owner2'));
update public.shops set capacity_reviewed_at = null where id = test.id('shop2');
select test.logout();
select test.eq((select capacity_reviewed_at from public.shops where id = test.id('shop2')), now(), 'capacity stamp is never cleared');
select test.login(test.id('owner2'));
select test.fails($$update public.shops set hours_reviewed_at = now() where id = test.id('shop2')$$, 'permission denied',
  'hours step only through save_shop_hours');

-- ------------------------------------------------------------------ set_shop_services (step 1)
select test.eq(public.set_shop_services(array['ulei', 'frane', 'ulei'], test.rid()), '["frane", "ulei"]'::jsonb, 'services saved once each');
select test.eq(public.set_shop_services(array['frane'], test.rid()), '["frane"]'::jsonb, 'unticked service removed');
select test.eq(test.error_of(format('select public.set_shop_services(%L, %L)', array['frane', 'nu-exista'], test.rid())),
  'service_unavailable', 'unknown service refused');
select test.logout();
update public.services set enabled = false where id = 'ulei';
select test.login(test.id('owner2'));
select test.eq(test.error_of(format('select public.set_shop_services(%L, %L)', array['ulei'], test.rid())),
  'service_unavailable', 'disabled service refused');
select test.logout();
update public.services set enabled = true where id = 'ulei';
select test.eq((select count(*) from public.shop_services where shop_id = test.id('shop2')), 1::bigint, 'refused sets change nothing');
select test.eq((select count(*) from public.shop_services where shop_id = test.id('shop1')), 2::bigint, 'shop1 services untouched');
select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select public.set_shop_services(%L, %L)', array['ulei'], test.rid())),
  'not_allowed', 'services: a client has no shop');

-- ------------------------------------------------------------------ manual phone verification (step 4)
select test.login(test.id('owner2'));
select test.fails($$select public.verify_phone_manually('owner2@test.local')$$, 'permission denied',
  'phone verification is not callable from the app');
select test.logout();
set local role service_role;
select test.fails($$select public.verify_phone_manually('owner2@test.local')$$, 'permission denied',
  'not even with the service role');
reset role;
select test.ok(public.verify_phone_manually('OWNER2@test.local') like 'S-% 0268251108', 'verified by hand (any case)');
select test.eq((select phone_verified_by_admin from public.profiles where id = test.id('owner2')), true, 'phone verified');
select test.eq((select count(*) from public.admin_audit_log where action = 'verify_phone_manually'), 1::bigint, 'audit log');
select test.fails($$select public.verify_phone_manually('nobody@test.local')$$, 'no account', 'unknown address');

-- All four steps done: the checklist is stamped and the shop is public.
select test.login(test.id('owner2'));
select set_config('test.setup', public.get_shop_setup()::text, true);
select test.eq(current_setting('test.setup')::jsonb ->> 'setup_completed', 'true', 'checklist complete');
select test.eq(current_setting('test.setup')::jsonb -> 'reasons', '[]'::jsonb, 'no reasons left');
select test.eq(current_setting('test.setup')::jsonb ->> 'public', 'true', 'shop2 now public');
-- Removing every service later hides the shop again, but never brings the checklist back.
select public.set_shop_services('{}', test.rid());
select set_config('test.setup', public.get_shop_setup()::text, true);
select test.eq(current_setting('test.setup')::jsonb ->> 'setup_completed', 'true', 'checklist stays done');
select test.eq(current_setting('test.setup')::jsonb -> 'reasons', '["no_services"]'::jsonb, 'reason: no services');
select test.eq(current_setting('test.setup')::jsonb ->> 'public', 'false', 'hidden without services');
select public.set_shop_services(array['frane'], test.rid());

-- Every reason matches is_shop_public() (the banner never says "visible" when it is not).
select test.logout();
update public.shop_hours set is_closed = true, open_time = null, close_time = null where shop_id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() -> 'reasons', '["no_open_days"]'::jsonb, 'reason: no open day');
select test.logout();
update public.shop_hours set is_closed = false, open_time = '08:00', close_time = '16:00' where shop_id = test.id('shop2') and weekday = 1;
update public.subscriptions set trial_ends_at = now() - interval '1 day' where shop_id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() -> 'reasons', '["subscription_inactive"]'::jsonb, 'reason: trial over');
select test.eq(public.get_shop_setup() ->> 'public', 'false', 'trial over: hidden');
select test.logout();
update public.subscriptions set status = 'active', trial_ends_at = null where shop_id = test.id('shop2');
update public.shops set suspended = true where id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() -> 'reasons', '["shop_suspended"]'::jsonb, 'reason: suspended');
select test.logout();
update public.shops set suspended = false, active = false where id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() -> 'reasons', '["shop_inactive"]'::jsonb, 'reason: inactive');
select test.logout();
update public.shops set active = true where id = test.id('shop2');
update public.profiles set phone = '0268251109' where id = test.id('owner2');
update auth.users set email_confirmed_at = null where id = test.id('owner2');
update public.profiles set email_verified_at = null where id = test.id('owner2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() -> 'reasons', '["email_unverified", "phone_unverified"]'::jsonb,
  'reasons: email and a new phone number');
select test.eq(public.get_shop_setup() ->> 'public', 'false', 'unverified: hidden');
select test.logout();
update public.profiles set email_verified_at = now(), phone_verified_by_admin = true where id = test.id('owner2');
update public.subscriptions set status = 'trial' where shop_id = test.id('shop2');

-- ------------------------------------------------------------------ billing reminder (from day 60)
update public.subscriptions set trial_ends_at = now() + interval '40 days' where shop_id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() #>> '{billing,reminder}', 'false', 'day 50: no reminder');
select test.logout();
update public.subscriptions set trial_ends_at = now() + interval '20 days' where shop_id = test.id('shop2');
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() #>> '{billing,reminder}', 'true', 'day 70: reminder');
update public.shops set billing_reminder_dismissed_at = now() where id = test.id('shop2');
select test.eq(public.get_shop_setup() #>> '{billing,reminder}', 'false', 'dismissed: hidden for a week');
select test.logout();
alter table public.shops disable trigger shops_stamp_times; -- (the browser can only ever send "now")
update public.shops set billing_reminder_dismissed_at = now() - interval '8 days' where id = test.id('shop2');
alter table public.shops enable trigger shops_stamp_times;
select test.login(test.id('owner2'));
select test.eq(public.get_shop_setup() #>> '{billing,reminder}', 'true', 'back after a week');
update public.shop_billing set reg_com = 'J08/1234/2015', legal_address = 'Str. Lungă 3, Codlea', billing_email = 'facturi@doi.ro'
  where shop_id = test.id('shop2');
select test.eq(public.get_shop_setup() #>> '{billing,complete}', 'true', 'billing complete');
select test.eq(public.get_shop_setup() #>> '{billing,reminder}', 'false', 'complete: no reminder');
select test.fails($$update public.shop_billing set vat_id = '14872302' where shop_id = test.id('shop2')$$,
  'shop_billing_vat_id_check', 'an invalid CUI is refused by the database');
select test.fails($$update public.shop_billing set iban = 'RO49AAAA1B31007593840001' where shop_id = test.id('shop2')$$,
  'shop_billing_iban_check', 'an invalid IBAN is refused by the database');
select test.fails($$update public.shops set postal_code = '50005' where id = test.id('shop2')$$,
  'shops_postal_code_check', 'a 5-digit postal code is refused by the database');

-- ------------------------------------------------------------------ closures
select test.fails(format($$insert into public.shop_closures (shop_id, start_date, end_date) values (%L, current_date, current_date + 400)$$,
  test.id('shop2')), 'shop_closures_max_length', 'a closure is at most a year');
select test.fails(format($$insert into public.shop_closures (shop_id, start_date, end_date) values (%L, current_date, current_date + 2)$$,
  test.id('shop1')), 'row-level security', 'no closures in another shop');
insert into public.shop_closures (shop_id, start_date, end_date, label) values (test.id('shop2'), current_date + 10, current_date + 12, 'Concediu');

-- ------------------------------------------------------------------ staff invitations
select set_config('test.tok1', md5('one') || md5('uno'), true);
select set_config('test.tok2', md5('two') || md5('due'), true);
select set_config('test.tok3', md5('three') || md5('tre'), true);

select test.login(test.id('owner1'));
select test.eq(public.invite_staff(' Nou@Test.local ', current_setting('test.tok1'), test.rid()) ->> 'email', 'nou@test.local',
  'invitation for a normalized address');
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'nu-e-email', current_setting('test.tok2'), test.rid())),
  'email_invalid', 'invitation: address checked');
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'staff1@test.local', current_setting('test.tok2'), test.rid())),
  'staff_exists', 'invitation: already on the team');
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'x@test.local', 'short', test.rid())),
  'invite_invalid', 'invitation: token format checked');
select test.logout();
select test.eq((select invite_token_hash from public.shop_staff where invited_email = 'nou@test.local'),
  encode(sha256(convert_to(current_setting('test.tok1'), 'UTF8')), 'hex'), 'only the hash of the token is stored');

select test.login(test.id('staff1'));
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'y@test.local', current_setting('test.tok2'), test.rid())),
  'not_allowed', 'staff cannot invite');
select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'y@test.local', current_setting('test.tok2'), test.rid())),
  'not_allowed', 'a client cannot invite');

-- The link shows the shop and the address, even before signing in; a wrong link shows nothing.
select test.login_anon();
select test.eq(public.get_staff_invite(current_setting('test.tok1')),
  '{"shop_name":"Atelier Unu","city":"Brașov","email":"nou@test.local"}'::jsonb, 'invitation readable by its link');
select test.eq(public.get_staff_invite(current_setting('test.tok2')), null, 'unknown link: nothing');
select test.eq(public.get_staff_invite('x'), null, 'malformed link: nothing');

-- Signing up with the link but another address is refused.
select test.logout();
select test.eq(test.error_of(format('select test.sign_up(%L, %L::jsonb)', 'altcineva@test.local',
  jsonb_build_object('role', 'shop', 'name', 'Alt', 'invite_token', current_setting('test.tok1')))),
  'invite_invalid', 'invitation only for the invited address');
select test.eq(test.error_of(format('select test.sign_up(%L, %L::jsonb)', 'nou@test.local',
  jsonb_build_object('role', 'shop', 'name', 'Nou', 'invite_token', current_setting('test.tok2')))),
  'invite_invalid', 'unknown token refused');

-- The right address joins shop1 as staff (even if the metadata said client), with no shop of its own.
select set_config('test.shops_before', (select count(*) from public.shops)::text, true);
select set_config('test.new_staff', test.sign_up('Nou@test.local',
  jsonb_build_object('role', 'client', 'name', 'Mihai Nou', 'phone', '0723000009', 'invite_token', current_setting('test.tok1')))::text, true);
select test.eq((select role from public.profiles where id = current_setting('test.new_staff')::uuid), 'shop', 'invited account is a shop account');
select test.eq((select count(*) from public.shops)::text, current_setting('test.shops_before'), 'no new shop created');
select test.eq(shop_id, test.id('shop1'), 'staff of shop1'),
       test.ok(accepted_at is not null, 'invitation accepted'),
       test.eq(invite_token_hash, null, 'token used up')
from public.shop_staff where user_id = current_setting('test.new_staff')::uuid;
select test.login(current_setting('test.new_staff')::uuid);
select test.eq(public.my_shop_id(), test.id('shop1'), 'the new member works for shop1');
select test.eq(test.count($$select 1 from public.shop_billing$$), 0::bigint, 'the new member never sees billing');
select test.login_anon();
select test.eq(public.get_staff_invite(current_setting('test.tok1')), null, 'a used link shows nothing');

-- Inviting the same address again replaces its link; an old invitation expires after 14 days.
select test.login(test.id('owner1'));
select public.invite_staff('later@test.local', current_setting('test.tok2'), test.rid());
select public.invite_staff('LATER@test.local', current_setting('test.tok3'), test.rid());
select test.login_anon();
select test.eq(public.get_staff_invite(current_setting('test.tok2')), null, 'the replaced link stops working');
select test.eq(public.get_staff_invite(current_setting('test.tok3')) ->> 'email', 'later@test.local', 'the new link works');
select test.logout();
select test.eq((select count(*) from public.shop_staff where invited_email = 'later@test.local'), 1::bigint, 'one row per address');
update public.shop_staff set invited_at = now() - interval '15 days' where invited_email = 'later@test.local';
select test.login_anon();
select test.eq(public.get_staff_invite(current_setting('test.tok3')), null, 'expired link shows nothing');
select test.logout();
select test.eq(test.error_of(format('select test.sign_up(%L, %L::jsonb)', 'later@test.local',
  jsonb_build_object('role', 'shop', 'name', 'Later', 'invite_token', current_setting('test.tok3')))),
  'invite_invalid', 'expired link refused at sign-up');

-- The team list: names and addresses of the caller's own shop only.
select test.login(test.id('owner1'));
select set_config('test.team', public.list_shop_staff()::text, true);
select test.eq(jsonb_array_length(current_setting('test.team')::jsonb), 4, 'owner1: owner, two staff, one pending');
select test.eq(current_setting('test.team')::jsonb #>> '{0,role}', 'owner', 'owner listed first');
select test.eq(current_setting('test.team')::jsonb #>> '{0,is_me}', 'true', 'owner is me');
select test.ok(current_setting('test.team')::jsonb @> '[{"name":"Mihai Nou","email":"nou@test.local"}]', 'staff name and email');
select test.ok(current_setting('test.team')::jsonb @> '[{"email":"later@test.local","accepted_at":null,"expired":true}]', 'expired invitation flagged');
select test.login(test.id('owner2'));
select test.eq(jsonb_array_length(public.list_shop_staff()), 1, 'owner2 sees only its own team');
select test.login(test.id('client_a'));
select test.eq(test.error_of('select public.list_shop_staff()'), 'not_allowed', 'a client has no team');

-- At most 10 staff rows per shop.
select test.login(test.id('owner2'));
select public.invite_staff('p' || n || '@test.local', md5('p' || n) || md5('q' || n), test.rid()) from generate_series(1, 10) n;
select test.eq(test.error_of(format('select public.invite_staff(%L, %L, %L)', 'p11@test.local', md5('p11') || md5('q11'), test.rid())),
  'limit_staff', 'invitation limit');

-- Removing: the owner removes staff (never the owner row); staff cannot remove anyone.
select test.login(test.id('staff1'));
delete from public.shop_staff where user_id = current_setting('test.new_staff')::uuid;
select test.login(test.id('owner1'));
delete from public.shop_staff where role = 'owner';
select test.logout();
select test.eq((select count(*) from public.shop_staff where shop_id = test.id('shop1') and accepted_at is not null), 3::bigint,
  'staff and owner rows cannot be removed by staff or by the owner themself');
select test.login(test.id('owner1'));
delete from public.shop_staff where user_id = current_setting('test.new_staff')::uuid;
select test.login(current_setting('test.new_staff')::uuid);
select test.eq(public.my_shop_id(), null, 'removed member no longer works for shop1');
select test.eq(test.error_of('select public.get_shop_setup()'), 'not_allowed', 'removed member: no shop');

rollback;
