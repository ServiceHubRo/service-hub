-- Account fingerprints (after T19d): the free period once per person, no new account around a
-- suspension; only fingerprints are kept (never the email or the number), for nobody to read.
begin;
select test.make_world();

-- ------------------------------------------------------------------ what is kept, and who can read it
select test.ok(test.count($$select 1 from public.account_fingerprints where user_id = test.id('owner1') and reason = 'trial_used'$$) >= 1,
  'a shop owner that exists has its fingerprints');
select test.ok(not exists (select 1 from public.account_fingerprints fp
                           where fp.hash like '%owner1%' or fp.hash like '%@%' or fp.hash ~ '^\+?[0-9]{9,15}$'),
  'only hashes are stored');
select test.eq(public.account_fingerprint('phone', '0723 375 248'), public.account_fingerprint('phone', '+40723375248'),
  'a Romanian number matches written either way');
select test.eq(public.account_fingerprint('email', ' Ion@Test.LOCAL '), public.account_fingerprint('email', 'ion@test.local'),
  'an email matches whatever its case');

select test.login(test.id('client_a'));
select test.fails($$select * from public.account_fingerprints$$, 'permission denied', 'a client cannot read the fingerprints');
select test.fails($$select * from public.account_fingerprint_secret$$, 'permission denied', 'nor the secret');
select test.fails($$select public.account_fingerprint('email', 'x@y.z')$$, 'permission denied', 'nor compute one');
select test.logout();
select test.login_anon();
select test.fails($$select * from public.account_fingerprints$$, 'permission denied', 'a visitor neither');
select test.logout();

-- ------------------------------------------------------------------ the free period, once per person
select test.sign_up('prima@test.local',
  '{"role":"shop","name":"Prima","phone":"+40744111222","shop_name":"Prima Oară","city":"Brașov","lang":"ro","terms_version":"2026-09-26"}');
select test.eq(sub.status, 'trial', 'a first shop gets its free period')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Prima Oară';

-- The account is deleted; its fingerprints stay (released), without the account.
delete from auth.users where email = 'prima@test.local';
select test.ok(exists (select 1 from public.account_fingerprints where user_id is null and reason = 'trial_used'
                       and hash = public.account_fingerprint('phone', '+40744111222') and released_at is not null),
  'after deletion the fingerprints remain, released');

-- Signing up again with the same email: no free period, no launch price.
update public.platform_settings set launch_price_ron = 99, launch_shops = 1000 where id = 1;
select test.sign_up('prima@test.local',
  '{"role":"shop","name":"Prima","phone":"+40799000111","shop_name":"A Doua Oară","city":"Brașov","lang":"ro","terms_version":"2026-09-26"}');
select test.eq(sub.status, 'inactive', 'same email: the subscription starts inactive'),
       test.eq(sub.ended_reason, 'trial_used', 'because the free period was used'),
       test.ok(not sub.launch_offer, 'without the launch price'),
       test.eq(sub.price_ron, (select subscription_price_ron from public.platform_settings where id = 1), 'at the full price'),
       test.ok(not s.active, 'and the shop is not in search')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'A Doua Oară';
select test.eq(a.after->'matched', '["email"]'::jsonb, 'the admin sees why, in the audit log')
from public.admin_audit_log a
where a.action = 'auto_no_trial' and a.entity_id = (select id::text from public.shops where name = 'A Doua Oară');

-- The same phone with another email: the same.
select test.sign_up('alta@test.local',
  '{"role":"shop","name":"Prima","phone":"0744 111 222","shop_name":"A Treia Oară","city":"Brașov","lang":"ro","terms_version":"2026-09-26"}');
select test.eq(sub.ended_reason, 'trial_used', 'same phone, another email: no free period either')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'A Treia Oară';

-- Someone else: a free period as usual; and a client never loses anything.
select test.sign_up('altcineva@test.local',
  '{"role":"shop","name":"Altcineva","phone":"+40755333444","shop_name":"Alt Service","city":"Brașov","lang":"ro","terms_version":"2026-09-26"}');
select test.eq(sub.status, 'trial', 'another person gets the free period')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Alt Service';
select test.sign_up('client-prima@test.local', '{"role":"client","name":"Client","phone":"+40744111222"}');
select test.ok(not suspended, 'a client with a former shop''s phone is a normal client')
from public.profiles where id = (select id from auth.users where email = 'client-prima@test.local');

-- ------------------------------------------------------------------ suspended: no way around it
update public.profiles set suspended = true where id = test.id('client_a');
select test.ok(exists (select 1 from public.account_fingerprints where user_id = test.id('client_a') and reason = 'suspended_account'),
  'a suspension records the fingerprints');

-- A new account with the suspended one's phone, another email: created suspended.
select test.sign_up('ocolire@test.local',
  json_build_object('role', 'client', 'name', 'Ocolire', 'phone', (select phone from public.profiles where id = test.id('client_a')))::jsonb);
select test.ok(p.suspended, 'same phone as a suspended account: created suspended')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'ocolire@test.local';
select test.ok(a.admin_id is null, 'recorded as automatic'),
       test.eq(a.after->'matched', '["phone"]'::jsonb, 'with what matched')
from public.admin_audit_log a
where a.action = 'auto_suspend_account' and a.entity_id = (select id::text from auth.users where email = 'ocolire@test.local');

-- The suspended account deletes itself and comes back with the same email: still suspended.
select set_config('test.email_a', (select email from auth.users where id = test.id('client_a')), true);
update public.bookings set client_id = null where client_id = test.id('client_a');
delete from auth.users where id = test.id('client_a');
select test.sign_up(current_setting('test.email_a'), '{"role":"client","name":"Revenire","phone":"+40766999888"}');
select test.ok(p.suspended, 'deleted while suspended, back with the same email: suspended')
from public.profiles p join auth.users u on u.id = p.id where u.email = current_setting('test.email_a');

-- The admin lifts the new account's suspension: the fingerprints behind it are forgotten.
update public.profiles set suspended = false
where id = (select id from auth.users where email = current_setting('test.email_a'));
select test.sign_up('a-doua-sansa@test.local',
  json_build_object('role', 'client', 'name', 'Sansa', 'phone', '+40766999888')::jsonb);
select test.ok(not p.suspended, 'after the admin lifts it, the same details work again')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'a-doua-sansa@test.local';

-- A suspended shop: its owner's details are blocked too, until it is reactivated.
update public.shops set suspended = true where id = test.id('shop2');
select test.sign_up('owner2-nou@test.local',
  json_build_object('role', 'client', 'name', 'Nou', 'phone', (select phone from public.profiles where id = test.id('owner2')))::jsonb);
select test.ok(p.suspended, 'the owner of a suspended shop cannot start over with the same phone')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'owner2-nou@test.local';
update public.shops set suspended = false where id = test.id('shop2');
select test.ok(not exists (select 1 from public.account_fingerprints where user_id = test.id('owner2') and reason = 'suspended_shop'),
  'reactivating the shop forgets its suspension fingerprints');

-- ------------------------------------------------------------------ purge after 3 years
select test.eq(public.purge_account_fingerprints(now()), 0, 'nothing is purged before 3 years');
select test.ok(public.purge_account_fingerprints(now() + interval '3 years 1 day') >= 2, 'released fingerprints go after 3 years');
select test.ok(exists (select 1 from public.account_fingerprints where user_id = test.id('owner1')),
  'those of accounts that exist stay');

rollback;
