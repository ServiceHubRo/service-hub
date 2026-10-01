-- T25: the company checked at ANAF, suspicious reviews, a confirmed phone after no-shows, and the
-- admin only after the second step of sign-in.
begin;
select test.make_world();

-- ------------------------------------------------------------------ the company at ANAF
select test.eq(public.company_check_target(test.id('owner1'), null, 'aal1')->>'vat_id', 'RO14872301',
  'the owner checks their own company');
select test.fails($$select public.company_check_target(test.id('staff1'), null, 'aal2')$$, 'not_allowed', 'not a colleague');
select test.fails($$select public.company_check_target(test.id('client_a'), null, 'aal2')$$, 'not_allowed', 'not a client');
select test.fails($$select public.company_check_target(test.id('owner1'), test.id('shop2'), 'aal2')$$, 'not_allowed',
  'not someone else''s shop');
select test.fails($$select public.company_check_target(test.id('admin'), test.id('shop1'), 'aal1')$$, 'not_allowed',
  'the admin only after the second step');
select test.eq(public.company_check_target(test.id('admin'), test.id('shop1'), 'aal2')->>'shop_id', test.id('shop1')::text,
  'the admin checks any shop');
update public.shop_billing set vat_id = null where shop_id = test.id('shop2');
select test.fails($$select public.company_check_target(test.id('owner2'), null, 'aal1')$$, 'no_vat_id', 'nothing to check without a CUI');

select public.record_company_check(test.id('shop1'), 'RO14872301',
  '{"status":"active","name":"AUTO UNU SRL","address":"Brașov, Str. Lungă 1","vat_payer":true,"name_match":true}');
select test.login(test.id('owner1'));
select test.eq(anaf_status, 'active', 'the owner sees the answer'),
       test.ok(anaf_name_match and anaf_vat_payer and anaf_checked_at is not null, 'name, VAT and when')
from public.shop_billing where shop_id = test.id('shop1');
select test.fails($$update public.shop_billing set anaf_status = 'active' where shop_id = test.id('shop1')$$,
  'permission denied', 'the owner cannot write the answer');
update public.shop_billing set legal_name = 'AUTO UNU SERVICE SRL' where shop_id = test.id('shop1');
select test.ok((select anaf_status is null and anaf_checked_at is null from public.shop_billing where shop_id = test.id('shop1')),
  'a new legal name forgets the old answer');
select test.logout();
select test.ok(public.record_company_check(test.id('shop1'), 'RO160796', '{"status":"active"}') is null,
  'an answer for a CUI that is no longer there is not written');
select test.fails($$select public.record_company_check(test.id('shop1'), 'RO14872301', '{"status":"maybe"}')$$,
  'unknown status', 'only known answers');
select test.login(test.id('client_a'));
select test.fails($$select public.company_check_target(auth.uid(), null, 'aal2')$$, 'permission denied', 'server only');
select test.logout();

-- ------------------------------------------------------------------ suspicious reviews
-- booking_a: done, reviewed by client_a. Made to look staged: the shop's phone, finished within the hour.
alter table public.bookings disable trigger bookings_guard;
update public.bookings set client_phone = '+40 268 312 445', created_at = done_at - interval '40 minutes'
where id = test.id('booking_a');
alter table public.bookings enable trigger bookings_guard;
update public.profiles set created_at = now() - interval '1 year' where id = test.id('client_a');
select test.eq(public.review_signals(r), array['same_phone', 'quick_job'], 'the shop''s phone, a job done at once')
from public.reviews r where r.booking_id = test.id('booking_a');

select test.login(test.id('admin'));
select test.eq((select count(*) from jsonb_array_elements(public.admin_list_suspect_reviews()) x
                where x->>'booking_id' = test.id('booking_a')::text), 1::bigint, 'listed in Moderare');
select test.eq((select x->'signals' from jsonb_array_elements(public.admin_list_suspect_reviews()) x
                where x->>'booking_id' = test.id('booking_a')::text), '["same_phone", "quick_job"]'::jsonb, 'with why');
select set_config('test.review', (select id::text from public.reviews where booking_id = test.id('booking_a')), true);
select test.fails($$select public.admin_decide_suspect_review(current_setting('test.review')::uuid, 'maybe', '', gen_random_uuid())$$,
  'decision_invalid', 'clear or remove');
select public.admin_decide_suspect_review(current_setting('test.review')::uuid, 'clear', 'Client cunoscut', gen_random_uuid());
select test.eq((select count(*) from jsonb_array_elements(public.admin_list_suspect_reviews()) x
                where x->>'id' = current_setting('test.review')), 0::bigint, 'marked as fine: off the list');
select test.eq((select count(*) from public.admin_audit_log where action = 'clear_review_signals'), 1::bigint, 'logged');
select test.logout();
update public.reviews set signals_cleared_at = null where id = current_setting('test.review')::uuid;
delete from public.notification_events;
select test.login(test.id('admin'));
select public.admin_decide_suspect_review(current_setting('test.review')::uuid, 'remove', '', gen_random_uuid());
select test.ok((select removed_at is not null from public.reviews where id = current_setting('test.review')::uuid), 'removed');
select test.eq((select count(*) from public.notification_events where event = 'review_report_decided' and user_id = test.id('client_a')),
  1::bigint, 'the client is told');
select test.fails($$select public.admin_decide_suspect_review(current_setting('test.review')::uuid, 'remove', '', gen_random_uuid())$$,
  'wrong_status', 'not twice');
select test.logout();

-- A burst of reviews from new accounts: two weaker signs make a suspect.
select test.eq(public.is_suspect_review(array['burst', 'new_account']), true, 'two weaker signs'),
       test.eq(public.is_suspect_review(array['new_account']), false, 'a new account alone is not');

select test.login(test.id('owner1'));
select test.fails($$select public.admin_list_suspect_reviews()$$, 'not_allowed', 'admin only');
select test.fails($$update public.reviews set signals_cleared_at = now()$$, 'permission denied', 'not from the browser');
select test.logout();

-- ------------------------------------------------------------------ a confirmed phone after no-shows
update public.platform_settings set limits = limits || '{"no_shows_before_phone": 2}' where id = 1;
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 10, '10:00');
select test.book(test.id('client_b'), test.id('shop1'), test.workday(2), '10:00');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'no_show', test.today() - 5, '11:00');
select test.eq(test.error_of($$select test.book(test.id('client_b'), test.id('shop1'), test.workday(3), '11:00')$$),
  'phone_verification_required', 'two no-shows: a phone code first');
select test.eq((test.error_params($$select test.book(test.id('client_b'), test.id('shop1'), test.workday(3), '11:00')$$)->>'no_shows')::int,
  2, 'says how many');
-- Clients may ask for the code now.
select test.eq(public.phone_verify_begin(test.id('client_b'), '482913')->>'status', 'send', 'the client gets a code');
select test.login(test.id('client_b'));
select test.eq(public.check_phone_code('482913', gen_random_uuid())->>'status', 'verified', 'and confirms it');
select test.logout();
select test.ok(test.book(test.id('client_b'), test.id('shop1'), test.workday(3), '11:00') is not null, 'then books again');
-- Old no-shows (over 90 days) do not count.
update public.profiles set phone_verified_at = null where id = test.id('client_b');
alter table public.bookings disable trigger bookings_guard;
update public.bookings set date = test.today() - 120 where client_id = test.id('client_b') and status = 'no_show';
alter table public.bookings enable trigger bookings_guard;
select test.ok(test.book(test.id('client_b'), test.id('shop1'), test.workday(4), '12:00') is not null, 'old no-shows are forgiven');

-- ------------------------------------------------------------------ the admin after the second step
select test.login(test.id('admin'), 'aal1');
select test.ok(not public.is_admin(), 'password only: not an admin yet');
select test.fails($$select public.admin_overview()$$, 'mfa_required', 'admin functions ask for the code');
select test.eq((select count(*) from public.shop_billing), 0::bigint, 'and the admin''s reads show nothing');
select test.logout();
select test.login(test.id('admin'));
select test.ok(public.is_admin(), 'after the code: admin');
select test.ok((select count(*) from public.shop_billing) >= 2, 'reads everything');
select test.logout();
-- Clients and shops never need the second step.
select test.login(test.id('client_a'), 'aal1');
select test.ok(test.count($$select 1 from public.bookings where client_id = auth.uid()$$) > 0, 'a client works with aal1');
select test.logout();

rollback;
