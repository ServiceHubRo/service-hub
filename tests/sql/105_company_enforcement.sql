-- Raport ANAF, automated: the VAT tick follows ANAF; an unconfirmed company is told once, has
-- company_fix_days to fix it, then leaves the search only on a fresh ANAF answer, and comes back on
-- its own; another name is told once; the owner cannot change any of it.
begin;
select test.make_world();
-- shop1 is public in the fixtures; the clock for its company starts now.
select test.ok(public.is_shop_public(test.id('shop1')), 'shop1 starts in the search');

-- ------------------------------------------------------------------ VAT follows ANAF
update public.shop_billing set vat_payer = false where shop_id = test.id('shop1');
select public.record_company_check(test.id('shop1'), 'RO14872301',
  '{"status":"active","name":"AUTO UNU S.R.L.","vat_payer":true,"name_match":true}');
select test.eq(vat_payer, true, 'the VAT tick follows ANAF') from public.shop_billing where shop_id = test.id('shop1');
select test.eq(anaf_problem_since, null::timestamptz, 'an active company is no problem') from public.shop_billing where shop_id = test.id('shop1');

-- ------------------------------------------------------------------ unknown at ANAF: told once, 14 days
select public.record_company_check(test.id('shop1'), 'RO14872301', '{"status":"not_found","name_match":null}');
select test.ok(anaf_problem_since is not null, 'the problem starts') from public.shop_billing where shop_id = test.id('shop1');
select test.eq((select count(*) from public.notification_events where user_id = test.id('owner1') and event = 'company_problem'), 1::bigint,
  'the owner is told');
select test.eq((select params->>'expiry' from public.notification_events where user_id = test.id('owner1') and event = 'company_problem'),
  ((now() + interval '14 days') at time zone 'Europe/Bucharest')::date::text, 'with the deadline');
select test.eq((select channels from public.notification_events where user_id = test.id('owner1') and event = 'company_problem'),
  array['push', 'email'], 'by push and email');
select public.record_company_check(test.id('shop1'), 'RO14872301', '{"status":"not_found","name_match":null}');
select test.eq((select count(*) from public.notification_events where user_id = test.id('owner1') and event = 'company_problem'), 1::bigint,
  'only once');
select test.ok(public.is_shop_public(test.id('shop1')), 'still in the search while there is time');

-- Due for a check the day before the deadline.
update public.shop_billing set anaf_problem_since = now() - interval '13 days 23 hours', anaf_checked_at = now() - interval '1 day'
where shop_id = test.id('shop1');
select test.eq((public.company_checks_due(10)->0->>'shop_id'), test.id('shop1')::text, 'checked again before the deadline');

-- Deadline passed, but the last answer is old (ANAF down): nothing happens.
update public.shop_billing set anaf_problem_since = now() - interval '15 days', anaf_checked_at = now() - interval '3 days'
where shop_id = test.id('shop1');
select test.eq(public.enforce_company_deadlines(), 0, 'no fresh answer, no hiding');
select test.ok(public.is_shop_public(test.id('shop1')), 'still in the search');

-- A fresh answer that ANAF still does not know it: out of the search, the owner is told.
update public.shop_billing set anaf_checked_at = now() - interval '1 hour' where shop_id = test.id('shop1');
select test.eq(public.enforce_company_deadlines(), 1, 'hidden on a fresh answer');
select test.ok(not public.is_shop_public(test.id('shop1')), 'out of the search');
select test.ok('company_unconfirmed' = any (public.shop_hidden_reasons(test.id('shop1'))), 'with the reason');
select test.eq((select count(*) from public.notification_events where user_id = test.id('owner1') and event = 'company_hidden'), 1::bigint,
  'the owner is told');
select test.eq(public.enforce_company_deadlines(), 0, 'once');

select test.login(test.id('owner1'));
select test.ok(public.get_shop_setup()->'reasons' ? 'company_unconfirmed', 'Panou lists the reason');
select test.eq((public.get_shop_setup()->'company'->>'hidden')::boolean, true, 'and the owner sees it hidden');
-- The owner cannot bring the shop back by hand.
select test.fails(format('update public.shop_billing set anaf_hidden_at = null where shop_id = %L', test.id('shop1')),
  'permission denied', 'the owner cannot clear it');
select test.fails(format('update public.shop_billing set anaf_problem_since = null where shop_id = %L', test.id('shop1')),
  'permission denied', 'nor the problem');
-- A new CUI forgets ANAF's answer, not the problem.
update public.shop_billing set vat_id = 'RO18000003' where shop_id = test.id('shop1');
select test.logout();
select test.ok(anaf_hidden_at is not null and anaf_status is null, 'still hidden until ANAF confirms the new CUI')
from public.shop_billing where shop_id = test.id('shop1');
select test.eq((public.company_checks_due(10)->0->>'shop_id'), test.id('shop1')::text, 'a hidden shop is checked again');

-- ANAF confirms it: back in the search, told.
select public.record_company_check(test.id('shop1'), 'RO18000003',
  '{"status":"active","name":"AUTO UNU S.R.L.","vat_payer":true,"name_match":true}');
select test.ok(public.is_shop_public(test.id('shop1')), 'back in the search');
select test.ok(anaf_problem_since is null and anaf_hidden_at is null, 'the problem is gone') from public.shop_billing where shop_id = test.id('shop1');
select test.eq((select count(*) from public.notification_events where user_id = test.id('owner1') and event = 'company_ok'), 1::bigint,
  'the owner is told');

-- ------------------------------------------------------------------ another name: told once
select public.record_company_check(test.id('shop1'), 'RO18000003',
  '{"status":"active","name":"ALTA FIRMA S.R.L.","vat_payer":true,"name_match":false}');
select public.record_company_check(test.id('shop1'), 'RO18000003',
  '{"status":"active","name":"ALTA FIRMA S.R.L.","vat_payer":true,"name_match":false}');
select test.eq((select count(*) from public.notification_events where user_id = test.id('owner1') and event = 'company_name_mismatch'), 1::bigint,
  'another name: told once');
select test.ok(public.is_shop_public(test.id('shop1')), 'and nothing else happens');
update public.shop_billing set legal_name = 'Alta Firma SRL' where shop_id = test.id('shop1');
select test.eq(anaf_name_notified_at, null::timestamptz, 'a new legal name may be told again') from public.shop_billing where shop_id = test.id('shop1');

-- ------------------------------------------------------------------ the monthly check, the settings
update public.shop_billing set anaf_checked_at = now() - interval '31 days', anaf_status = 'active' where shop_id = test.id('shop1');
select test.ok(exists (select 1 from jsonb_array_elements(public.company_checks_due(100)) d where d->>'shop_id' = test.id('shop1')::text),
  'checked again after a month');
update public.shop_billing set anaf_checked_at = now() - interval '5 days' where shop_id = test.id('shop1');
select test.ok(not exists (select 1 from jsonb_array_elements(public.company_checks_due(100)) d where d->>'shop_id' = test.id('shop1')::text),
  'not before');
select test.ok(public.is_dispatch_token((select dispatch_token from public.push_config where id = 1)), 'the dispatcher''s token');
select test.ok(not public.is_dispatch_token('x'), 'nothing else');

select test.login(test.id('admin'));
select test.fails($$select public.admin_update_settings('{"limits":{"company_fix_days":0}}', gen_random_uuid())$$, 'field_invalid',
  'at least one day');
select public.admin_update_settings('{"limits":{"company_fix_days":21}}', gen_random_uuid());
select test.logout();
select test.eq(public.company_fix_deadline(timestamptz '2026-10-01 10:00+00'), date '2026-10-22', 'the deadline follows the setting');

rollback;
