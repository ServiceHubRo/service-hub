-- Sign-up trigger (ARCHITECTURE §2 Identity, §15), email sync, visibility (§5), promote_to_admin.
begin;

-- Client sign-up builds only the profile.
select test.sign_up('client@test.local',
  '{"role":"client","name":"  Ana Marin ","phone":"0723 375 248","lang":"en","terms_version":"2026-09"}');
select test.eq(p.role, 'client', 'client role'),
       test.ok(p.display_id ~ '^C-[0-9]{5}$', 'client display id C-00000'),
       test.eq(p.name, 'Ana Marin', 'name trimmed'),
       test.eq(p.phone, '0723 375 248', 'phone copied'),
       test.eq(p.lang, 'en', 'language copied'),
       test.ok(p.email_verified_at is not null, 'confirmed email copied'),
       test.eq(p.terms_version, '2026-09', 'terms version copied'),
       test.ok(p.terms_accepted_at is not null, 'terms acceptance time set'),
       test.eq(test.count(format('select 1 from public.shops where owner_id = %L', p.id)), 0::bigint,
               'a client gets no shop')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'client@test.local';

-- "admin" (or anything unknown) in the metadata becomes a client.
select test.sign_up('sneaky@test.local', '{"role":"admin","name":"Sneaky"}');
select test.sign_up('service@test.local', '{"role":"service"}');
select test.sign_up('empty@test.local', null);
select test.eq(p.role, 'client', 'metadata role ' || coalesce(u.raw_user_meta_data->>'role', 'none') || ' becomes client'),
       test.ok(p.display_id like 'C-%', 'display id is a client id'),
       test.eq(p.lang, 'ro', 'language defaults to ro')
from public.profiles p join auth.users u on u.id = p.id
where u.email in ('sneaky@test.local', 'service@test.local', 'empty@test.local');
select test.eq(count(*), 0::bigint, 'nobody became admin through sign-up')
from public.profiles where role = 'admin';

-- Display ids come from one sequence per role and are unique.
select test.eq(count(distinct display_id), count(*), 'display ids unique') from public.profiles;

-- Shop sign-up also builds the shop, default hours, billing row, trial and owner row.
select test.sign_up('shop@test.local',
  '{"role":"shop","name":"Ion Popescu","phone":"0268312499","shop_name":"Atelier Demo","city":"Brașov","lang":"ro","terms_version":"2026-09"}');

select test.eq(p.role, 'shop', 'shop role'),
       test.ok(p.display_id ~ '^S-[0-9]{5}$', 'shop display id S-00000'),
       test.eq(s.name, 'Atelier Demo', 'shop name from metadata'),
       test.eq(s.city, 'Brașov', 'shop city from metadata'),
       test.eq(s.phone, '0268312499', 'shop phone from sign-up'),
       test.eq(s.daily_capacity, 5, 'default daily capacity'),
       test.eq(s.cars_per_slot, 1, 'default cars per slot'),
       test.eq(s.slot_minutes, 60, 'default slot'),
       test.eq(s.min_notice_hours, 2, 'default notice'),
       test.eq(s.max_advance_days, 30, 'default advance'),
       test.eq(s.cancel_deadline_hours, 2, 'default cancel deadline'),
       test.ok(s.active and not s.suspended, 'shop active, not suspended'),
       test.eq(sub.status, 'trial', 'subscription starts in trial'),
       test.ok(sub.trial_ends_at between now() + interval '89 days 23 hours' and now() + interval '90 days 1 hour',
               'trial lasts 90 days'),
       test.eq(sub.price_ron, 100.00::numeric(10,2), 'price from settings'),
       test.eq(b.billing_email, 'shop@test.local', 'billing email defaults to login email'),
       test.ok(b.vat_id is null and b.iban is null, 'fiscal data empty until filled in'),
       test.eq(st.role, 'owner', 'owner staff row'),
       test.ok(st.accepted_at is not null, 'owner row accepted'),
       test.eq(public.is_shop_public(s.id), false, 'new shop not public (phone unverified, no services)')
from public.profiles p
join auth.users u on u.id = p.id
join public.shops s on s.owner_id = p.id
join public.subscriptions sub on sub.shop_id = s.id
join public.shop_billing b on b.shop_id = s.id
join public.shop_staff st on st.shop_id = s.id and st.user_id = p.id
where u.email = 'shop@test.local';

select test.eq(count(*), 7::bigint, '7 weekday rows'),
       test.eq(count(*) filter (where not is_closed and open_time = '08:00' and close_time = '18:00'), 5::bigint,
               'Mon–Fri 08:00–18:00'),
       test.eq(count(*) filter (where is_closed and weekday in (0, 6)), 2::bigint, 'Sat–Sun closed')
from public.shop_hours h join public.shops s on s.id = h.shop_id join auth.users u on u.id = s.owner_id
where u.email = 'shop@test.local';

-- Missing shop name and city do not break sign-up.
select test.sign_up('bare-shop@test.local', '{"role":"shop","name":"Vasile"}');
select test.eq(s.name, 'Vasile', 'shop name falls back to the person name'),
       test.eq(s.city, '', 'empty city until set')
from public.shops s join auth.users u on u.id = s.owner_id where u.email = 'bare-shop@test.local';

-- Email confirmation later is synced to the profile.
select test.sign_up('late@test.local', '{"role":"client"}', false);
select test.ok(p.email_verified_at is null, 'unconfirmed email not verified')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'late@test.local';
update auth.users set email_confirmed_at = now() where email = 'late@test.local';
select test.ok(p.email_verified_at is not null, 'confirmation synced to the profile')
from public.profiles p join auth.users u on u.id = p.id where u.email = 'late@test.local';

-- A shop becomes public once every condition of §5 holds, and stops being public when one fails.
select test.make_world();
select test.eq(public.is_shop_public(test.id('shop1')), true, 'shop1 public');
select test.eq(public.is_shop_public(test.id('shop2')), false, 'shop2 not public');

update public.shops set suspended = true where id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'suspended shop not public');
update public.shops set suspended = false, active = false where id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'inactive shop not public');
update public.shops set active = true where id = test.id('shop1');
update public.subscriptions set status = 'inactive' where shop_id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'inactive subscription not public');
update public.subscriptions set status = 'trial', trial_ends_at = now() - interval '1 minute'
  where shop_id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'ended trial not public');
update public.subscriptions set status = 'past_due' where shop_id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), true, 'past_due still public');
update public.shop_hours set is_closed = true, open_time = null, close_time = null where shop_id = test.id('shop1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'no open weekday not public');
update public.shop_hours set is_closed = false, open_time = '08:00', close_time = '18:00' where shop_id = test.id('shop1');
update public.services set enabled = false where id in ('ulei', 'frane');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'only disabled services not public');
update public.services set enabled = true where id in ('ulei', 'frane');
update auth.users set email_confirmed_at = null where id = test.id('owner1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'unconfirmed owner email not public');
update auth.users set email_confirmed_at = now() where id = test.id('owner1');
select test.eq(public.is_shop_public(test.id('shop1')), true, 'public again');

-- Changing the phone number drops its verification.
update public.profiles set phone = '0723999999' where id = test.id('owner1');
select test.ok(not phone_verified_by_admin and phone_verified_at is null, 'new phone is unverified')
from public.profiles where id = test.id('owner1');
select test.eq(public.is_shop_public(test.id('shop1')), false, 'shop hidden until the new phone is verified');

-- promote_to_admin: works from the SQL editor, not from any API role.
select test.eq(role, 'admin', 'promoted account is admin'),
       test.ok(display_id ~ '^A-[0-9]{5}$', 'admin display id A-00000')
from public.profiles where id = test.id('admin');
select test.eq(count(*), 1::bigint, 'promotion is in the audit log')
from public.admin_audit_log where action = 'promote_to_admin' and entity_id = test.id('admin')::text;
select test.eq(public.promote_to_admin('ADMIN@test.local'), display_id, 'promoting twice is a no-op')
from public.profiles where id = test.id('admin');
select test.fails($$select public.promote_to_admin('owner1@test.local')$$, 'shop account', 'a shop cannot be promoted');
select test.fails($$select public.promote_to_admin('nobody@test.local')$$, 'no account', 'unknown email refused');

select test.login(test.id('client_a'));
select test.fails($$select public.promote_to_admin('ana@test.local')$$, 'permission denied',
  'authenticated cannot call promote_to_admin');
select test.login_anon();
select test.fails($$select public.promote_to_admin('ana@test.local')$$, 'permission denied',
  'anon cannot call promote_to_admin');
select test.logout();
set local role service_role;
select test.fails($$select public.promote_to_admin('ana@test.local')$$, 'permission denied',
  'service_role cannot call promote_to_admin');
reset role;
select test.eq(role, 'client', 'client_a still a client') from public.profiles where id = test.id('client_a');

rollback;
