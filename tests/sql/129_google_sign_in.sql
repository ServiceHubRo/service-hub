-- T48: a Google sign-up has no account until complete_signup(), which makes it exactly like an
-- email sign-up (profile, shop, fingerprints, referral). Email sign-ups work as before.
begin;
select test.make_world();

-- A Google user as Supabase Auth inserts it: provider google, Google's own data, no role.
create function pg_temp.google_user(p_email text) returns uuid
language sql
as $$
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (gen_random_uuid(), 'authenticated', 'authenticated', p_email, now(),
          '{"provider":"google","providers":["google"]}',
          jsonb_build_object('full_name', 'Ion Google', 'email', p_email, 'email_verified', true))
  returning id
$$;

-- ------------------------------------------------------------------ the sign-up itself makes nothing
select set_config('test.g1', pg_temp.google_user('ion.google@gmail.test')::text, true);
select test.eq(test.count(format($$select 1 from public.profiles where id = '%s'$$, current_setting('test.g1'))), 0::bigint,
  'a Google sign-up has no profile yet');
select test.eq(test.count(format($$select 1 from public.admin_audit_log where entity_id = '%s'$$, current_setting('test.g1'))), 0::bigint,
  'nor anything in the audit log');

-- An email sign-up without a role is still a client, as before.
select set_config('test.e1', test.sign_up('fara.rol@test.local', '{"name":"Fără Rol"}')::text, true);
select test.eq((select role from public.profiles where id = current_setting('test.e1')::uuid), 'client',
  'an email sign-up is made at once');

-- ------------------------------------------------------------------ what complete_signup refuses
select test.login_anon();
select test.fails($$select public.complete_signup(gen_random_uuid(), 'client', 'Ion', '0722123456', 'ro', '2026-10-10')$$,
  'permission denied', 'a visitor cannot call it');
select test.logout();

select test.login(current_setting('test.g1')::uuid);
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'admin', 'Ion', '0722123456', 'ro', '2026-10-10')$$),
  'invalid_role', 'the role is client or shop, never admin');
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'client', '  ', '0722123456', 'ro', '2026-10-10')$$),
  'name_required', 'a name is needed');
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'client', 'Ion', '0722', 'ro', '2026-10-10')$$),
  'phone_invalid', 'a phone number is needed');
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'client', 'Ion', '0722123456', 'ro', null)$$),
  'terms_required', 'the terms must be accepted');
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'shop', 'Ion', '0722123456', 'ro', '2026-10-10', 'Atelier', null)$$),
  'shop_details_required', 'a shop needs its name and city');
select test.fails($$insert into public.signup_completions (id, raw_app_meta_data, raw_user_meta_data)
                    values (auth.uid(), '{}', '{"role":"shop"}')$$,
  'permission denied', 'nobody writes the completions directly');

-- ------------------------------------------------------------------ a client
select set_config('test.req', test.rid()::text, true);
select test.eq(public.complete_signup(current_setting('test.req')::uuid, 'client', ' Ion Popescu ', '0722 123 456', 'en', '2026-10-10')->>'role',
  'client', 'the account is made');
select test.logout();
select test.ok(exists (select 1 from public.profiles p
                       where p.id = current_setting('test.g1')::uuid and p.role = 'client' and p.name = 'Ion Popescu'
                         and p.phone = '0722 123 456' and p.lang = 'en' and p.terms_version = '2026-10-10'
                         and p.terms_accepted_at is not null and p.email_verified_at is not null
                         and p.display_id like 'C-%'),
  'with the name, phone, language and terms given, and the email verified by Google');
select test.eq((select raw_user_meta_data->>'role' from auth.users where id = current_setting('test.g1')::uuid), 'client',
  'the sign-up data is on the user too');
select test.eq((select raw_user_meta_data->>'full_name' from auth.users where id = current_setting('test.g1')::uuid), 'Ion Google',
  'next to what Google gave');

select test.login(current_setting('test.g1')::uuid);
select test.eq(public.complete_signup(current_setting('test.req')::uuid, 'client', 'Ion Popescu', '0722123456', 'en', '2026-10-10')->>'ok',
  'true', 'the same request again returns the first result');
select test.eq(test.error_of($$select public.complete_signup(test.rid(), 'shop', 'Ion', '0722123456', 'ro', '2026-10-10', 'Atelier', 'Cluj')$$),
  'account_exists', 'an account is made once: the role stays');
select test.logout();
select test.eq((select count(*) from public.shops where owner_id = current_setting('test.g1')::uuid), 0::bigint,
  'no shop for the client');

-- ------------------------------------------------------------------ a shop
select set_config('test.g2', pg_temp.google_user('atelier.google@gmail.test')::text, true);
select test.login(current_setting('test.g2')::uuid);
select public.complete_signup(test.rid(), 'shop', 'Maria Ionescu', '0733 444 555', 'ro', '2026-10-10', 'Atelier Google', 'Cluj-Napoca');
select test.logout();
select test.ok(exists (select 1 from public.shops s
                       join public.subscriptions sub on sub.shop_id = s.id and sub.status = 'trial'
                       join public.shop_billing b on b.shop_id = s.id and b.billing_email = 'atelier.google@gmail.test'
                       join public.shop_staff st on st.shop_id = s.id and st.user_id = s.owner_id and st.role = 'owner'
                       where s.owner_id = current_setting('test.g2')::uuid and s.name = 'Atelier Google' and s.city = 'Cluj-Napoca'),
  'a shop gets its shop, free period, billing email and owner seat, as by email');
select test.eq((select count(*) from public.shop_hours h join public.shops s on s.id = h.shop_id
                where s.owner_id = current_setting('test.g2')::uuid), 7::bigint, 'and its opening hours');
select test.ok(exists (select 1 from public.account_fingerprints where user_id = current_setting('test.g2')::uuid and reason = 'trial_used'),
  'its free period is recorded for the person');

-- ------------------------------------------------------------------ the checks of an email sign-up apply
-- A suspended client's phone number: the new account is made suspended.
update public.profiles set phone = '0744 999 888' where id = test.id('client_b');
update public.profiles set suspended = true where id = test.id('client_b');
select set_config('test.g3', pg_temp.google_user('alt.cont@gmail.test')::text, true);
select test.login(current_setting('test.g3')::uuid);
select public.complete_signup(test.rid(), 'client', 'Alt Nume', '+40744999888', 'ro', '2026-10-10');
select test.logout();
select test.eq((select suspended from public.profiles where id = current_setting('test.g3')::uuid), true,
  'the phone of a suspended account: made suspended');

-- The same shop owner again through Google: no second free period.
select set_config('test.g4', pg_temp.google_user('al.doilea@gmail.test')::text, true);
select test.login(current_setting('test.g4')::uuid);
select public.complete_signup(test.rid(), 'shop', 'Maria Ionescu', '+40733444555', 'ro', '2026-10-10', 'Atelier Doi', 'Cluj-Napoca');
select test.logout();
select test.eq((select sub.ended_reason from public.subscriptions sub join public.shops s on s.id = sub.shop_id
                where s.owner_id = current_setting('test.g4')::uuid), 'trial_used',
  'a phone that had a free period: none this time');

-- A shop referral code is taken, as on the email form.
select set_config('test.g5', pg_temp.google_user('recomandat@gmail.test')::text, true);
select set_config('test.code', (select display_id from public.profiles where id = test.id('owner1')), true);
select test.login(current_setting('test.g5')::uuid);
select public.complete_signup(test.rid(), 'shop', 'Dan Recomandat', '0755 111 222', 'ro', '2026-10-10', 'Atelier Trei', 'Iași',
  current_setting('test.code'));
select test.logout();
select test.eq((select r.referrer_shop_id from public.shop_referrals r join public.shops s on s.id = r.shop_id
                where s.owner_id = current_setting('test.g5')::uuid), test.id('shop1'),
  'the referral is recorded');

rollback;
