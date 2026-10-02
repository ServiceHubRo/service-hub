-- Raport ANAF: every shop's company in one list for the admin, sorted into categories; admins only;
-- the same rows as an audited Excel export.
begin;
select test.make_world();

-- Atelier Unu: RO14872301, ANAF knows it under another name, VAT payer at ANAF but not ticked.
update public.shop_billing set vat_payer = false where shop_id = test.id('shop1');
select public.record_company_check(test.id('shop1'), 'RO14872301',
  '{"status":"active","name":"ALT NUME S.R.L.","address":"Brașov","vat_payer":true,"name_match":false}');
-- Atelier Doi: a CUI never checked.

select test.login(test.id('admin'));
select set_config('test.rows', public.admin_list_company_checks()::text, true);
select test.logout();

select test.eq((select r->>'category' from jsonb_array_elements(current_setting('test.rows')::jsonb) r
  where r->>'shop_id' = test.id('shop1')::text), 'name_mismatch', 'active under another name');
select test.eq((select (r->>'vat_mismatch')::boolean from jsonb_array_elements(current_setting('test.rows')::jsonb) r
  where r->>'shop_id' = test.id('shop1')::text), true, 'the VAT tick disagrees with ANAF');
select test.eq((select r->>'anaf_name' from jsonb_array_elements(current_setting('test.rows')::jsonb) r
  where r->>'shop_id' = test.id('shop1')::text), 'ALT NUME S.R.L.', 'the official name');
select test.ok((select r->>'display_id' from jsonb_array_elements(current_setting('test.rows')::jsonb) r
  where r->>'shop_id' = test.id('shop1')::text) like 'S-%', 'the shop code');
select test.eq((select r->>'category' from jsonb_array_elements(current_setting('test.rows')::jsonb) r
  where r->>'shop_id' = test.id('shop2')::text), 'unchecked', 'a CUI not checked yet');
select test.eq(current_setting('test.rows')::jsonb->0->>'shop_id', test.id('shop1')::text, 'problems first');

-- Every other category.
select public.record_company_check(test.id('shop2'), '160796', '{"status":"not_found","name_match":null}');
select test.login(test.id('admin'));
select test.eq((select r->>'category' from jsonb_array_elements(public.admin_list_company_checks()) r
  where r->>'shop_id' = test.id('shop2')::text), 'not_found', 'unknown at ANAF');
select test.logout();
select public.record_company_check(test.id('shop2'), '160796', '{"status":"inactive","name":"AUTO DOI SRL","name_match":true}');
select test.login(test.id('admin'));
select test.eq((select r->>'category' from jsonb_array_elements(public.admin_list_company_checks()) r
  where r->>'shop_id' = test.id('shop2')::text), 'inactive', 'inactive at ANAF');
select test.logout();
select public.record_company_check(test.id('shop2'), '160796', '{"status":"active","name":"AUTO DOI SRL","name_match":true,"vat_payer":false}');
select test.login(test.id('admin'));
select test.eq((select r->>'category' from jsonb_array_elements(public.admin_list_company_checks()) r
  where r->>'shop_id' = test.id('shop2')::text), 'ok', 'active with the same name');
select test.logout();
update public.shop_billing set vat_id = null where shop_id = test.id('shop2');
select test.login(test.id('admin'));
select test.eq((select r->>'category' from jsonb_array_elements(public.admin_list_company_checks()) r
  where r->>'shop_id' = test.id('shop2')::text), 'no_cui', 'no CUI, no answer kept');

-- The Excel export: same rows, written to the audit log.
select test.eq(jsonb_array_length(public.admin_export('company_checks')), jsonb_array_length(public.admin_list_company_checks()),
  'the export has every shop');
select test.logout();
select test.ok(exists (select 1 from public.admin_audit_log where action = 'export' and after->>'kind' = 'company_checks'),
  'the export is audited');

-- Nobody else.
select test.login(test.id('owner1'));
select test.fails('select public.admin_list_company_checks()', 'not_allowed', 'a shop owner cannot read it');
select test.logout();
select test.login(test.id('admin'), 'aal1');
select test.fails('select public.admin_list_company_checks()', 'mfa_required', 'an admin without the second step cannot');
select test.logout();
select test.login_anon();
select test.fails('select public.admin_list_company_checks()', 'permission denied', 'signed in only');
select test.logout();

select test.eq(version, 47, 'schema version') from public.schema_version;
rollback;
