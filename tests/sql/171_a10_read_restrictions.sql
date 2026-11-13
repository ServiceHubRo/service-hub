-- A10 — read restrictions (master audit, 13 Nov 2026): a company's budgets and the manager's
-- approval limit reach only the members who see its costs or manage its budget, on every path
-- (the table, get_company, accept_company_invite); a review's moderation fields reach nobody
-- through the table. Fails on schema 120.
begin;
select test.make_fleet();
update public.companies set budget_monthly = 5000, budget_yearly = 60000, manager_approval_limit = 1500 where id = test.id('co');

-- ------------------------------------------------------------------ companies: the table
-- A driver (no costs.view): the row, never the amounts.
select test.login(test.id('drv2'));
select test.eq(test.count($$select id, name, vat_id, reg_com, address, created_at, archived_at from public.companies$$), 1::bigint,
  'a driver still reads the company they belong to');
select test.fails($$select budget_monthly from public.companies$$, 'permission denied', 'a driver cannot read the monthly budget from the table');
select test.fails($$select budget_yearly from public.companies$$, 'permission denied', 'nor the yearly budget');
select test.fails($$select manager_approval_limit from public.companies$$, 'permission denied', 'nor the approval limit');
select test.fails($$select * from public.companies$$, 'permission denied', 'nor the whole row');
select test.logout();
-- Nobody reads them from the table, the admin of the company included: they come through functions.
select test.login(test.id('client_a'));
select test.fails($$select budget_monthly from public.companies$$, 'permission denied', 'the company admin reads the budget through functions, not the table');
select test.logout();

-- ------------------------------------------------------------------ companies: get_company
select test.login(test.id('drv2'));
select test.ok((select c->>'name' = 'Flota SRL' and c->>'my_role' = 'driver'
                       and c ? 'budget_monthly' and c->>'budget_monthly' is null
                       and c->>'budget_yearly' is null and c->>'manager_approval_limit' is null
                from public.get_company(test.id('co')) c),
  'get_company: a driver gets the company without the amounts');
select test.ok(public.get_company(test.id('co2')) is null, 'get_company: another company answers nothing');
select test.ok((public.fleet_overview(test.id('co'))->'company'->'budget'->>'monthly') is null, 'fleet_overview keeps hiding them (unchanged)');
select test.logout();

select test.login(test.id('client_a'));
select test.ok((select (c->>'budget_monthly')::numeric = 5000 and (c->>'budget_yearly')::numeric = 60000
                       and (c->>'manager_approval_limit')::numeric = 1500 and c->>'my_role' = 'admin'
                from public.get_company(test.id('co')) c),
  'get_company: the admin gets the amounts');
select test.logout();
select test.login(test.id('mgr'));
select test.eq((public.get_company(test.id('co'))->>'manager_approval_limit')::numeric, 1500::numeric, 'a manager (costs.view) gets them');
select test.logout();
select test.login(test.id('acc'));
select test.eq((public.get_company(test.id('co'))->>'budget_monthly')::numeric, 5000::numeric, 'an accountant (costs.view) gets them');
select test.logout();
select test.login(test.id('out'));
select test.ok(public.get_company(test.id('co')) is null, 'the admin of another company gets nothing');
select test.logout();
select test.login(test.id('owner1'));
select test.ok(public.get_company(test.id('co')) is null, 'a shop gets nothing');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.get_company(%L)$$, test.id('co')), 'permission denied', 'a visitor cannot call get_company');
select test.logout();

-- A driver the admin lets manage the budget sees them from the next request; taken back, no longer.
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_drv2'), array['budget.manage'], null, gen_random_uuid());
select test.logout();
select test.login(test.id('drv2'));
select test.eq((public.get_company(test.id('co'))->>'budget_yearly')::numeric, 60000::numeric, 'budget.manage granted: the amounts appear');
select test.logout();
select test.login(test.id('client_a'));
select public.set_company_member_rights(test.id('m_drv2'), array[]::text[], null, gen_random_uuid());
select test.logout();
select test.login(test.id('drv2'));
select test.ok((public.get_company(test.id('co'))->>'budget_yearly') is null, 'and disappear when the right is taken back');
select test.logout();

-- ------------------------------------------------------------------ companies: accepting an invitation
insert into test.ids (name, id) values ('newdrv', test.sign_up('nou@test.local',
  '{"role":"client","name":"Nou Sofer","phone":"0723000031","lang":"ro","terms_version":"2026-09"}'));
select test.login(test.id('client_a'));
select public.invite_company_member(test.id('co'), 'nou@test.local', 'driver', repeat('f9', 32), gen_random_uuid());
select test.logout();
select test.login(test.id('newdrv'));
select set_config('test.rid', gen_random_uuid()::text, true);
select test.ok((select c->>'name' = 'Flota SRL' and c->>'budget_monthly' is null and c->>'manager_approval_limit' is null
                from public.accept_company_invite(repeat('f9', 32), current_setting('test.rid')::uuid) c),
  'accept_company_invite answers a new driver the company without the amounts');
select test.ok((public.accept_company_invite(repeat('f9', 32), current_setting('test.rid')::uuid)->>'budget_yearly') is null,
  'and so does the same request replayed');
select test.logout();

-- The functions that save still answer the amounts to whoever may change them.
select test.login(test.id('client_a'));
select test.eq((public.set_company_rules(test.id('co'), 2000, 7000, 80000, gen_random_uuid())->>'budget_monthly')::numeric, 7000::numeric,
  'set_company_rules answers the new amounts to the admin');
select test.logout();

-- ------------------------------------------------------------------ reviews
update public.reviews
  set report_reason = 'fake', reported_at = now(), report_status = 'kept', report_decided_at = now(),
      report_note = 'Notă internă', signals_cleared_at = now()
  where booking_id = test.id('booking_a');

-- Another client: the public review, without the moderation fields or the author's account.
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select id, rating, text, reply, client_display_name, created_at from public.reviews where booking_id = %L$$,
  test.id('booking_a'))), 1::bigint, 'another client still reads the public review');
select test.fails($$select report_note from public.reviews$$, 'permission denied', 'the internal moderation note is not readable');
select test.fails($$select report_decided_at from public.reviews$$, 'permission denied', 'nor the time of the decision');
select test.fails($$select signals_cleared_at from public.reviews$$, 'permission denied', 'nor the fraud-check mark');
select test.fails($$select client_id from public.reviews$$, 'permission denied', 'nor the author''s account id');
select test.fails($$select * from public.reviews$$, 'permission denied', 'nor the whole row');
select test.logout();

-- The author: their own review, through the rule that names client_id, which they cannot select.
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select id from public.reviews where booking_id = %L$$, test.id('booking_a'))), 1::bigint,
  'the author still reads their review');
select test.logout();
-- A removed review stays readable by its author and the shop only.
select test.login(test.id('client_b'));
select test.eq(test.count(format($$select id from public.reviews where booking_id = %L$$, test.id('booking_b1'))), 1::bigint,
  'the author of a removed review still reads it');
select test.logout();
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select id from public.reviews where booking_id = %L$$, test.id('booking_b1'))), 0::bigint,
  'another client does not');
select test.logout();

-- The shop's Recenzii screen: exactly the columns it asks for (src/data/reviews.ts).
select test.login(test.id('owner1'));
select test.eq(test.count(format($$select id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at,
  report_reason, reported_at, report_status, removed_at, created_at from public.reviews where shop_id = %L$$, test.id('shop1'))), 2::bigint,
  'the shop reads its reviews with the report state');
select test.fails($$select report_note from public.reviews$$, 'permission denied', 'the shop does not read the admin''s note either');
select test.logout();

-- The admin: the badge counts through the table; the note comes through the admin's functions.
update public.reviews set report_status = 'pending', report_decided_at = null where booking_id = test.id('booking_a');
select test.login(test.id('admin'));
select test.eq(test.count($$select id from public.reviews where report_status = 'pending'$$), 1::bigint, 'the admin counts the reports waiting');
select test.ok((select r->>'report_note' = 'Notă internă' from jsonb_array_elements(public.admin_list_reviews(null)->'queue') r
                where r->>'booking_id' = test.id('booking_a')::text),
  'admin_list_reviews still answers the note');
select test.logout();

select test.ok((select version from public.schema_version) >= 121, 'schema 121 or later');
rollback;
