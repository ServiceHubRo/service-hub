-- T65 correction — which spaces a client may select, and what they may reach in each. The switch
-- lists `my_companies()`: only the companies where the caller is an accepted member. Being a member
-- (or admin) of one company never opens another company of the same owner; removed means gone from
-- the list and refused everywhere (RLS and every function), whatever id is sent.
begin;
select test.make_world();

select set_config('test.c3', test.sign_up('ioana@test.local', '{"role":"client","name":"Ioana Trei"}')::text, true);

-- An owner with three companies.
select test.login(test.id('client_a'));
select set_config('test.a', (public.create_company('Alfa SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.b', (public.create_company('Beta SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.c', (public.create_company('Gama SRL', null, null, null, gen_random_uuid())->>'id'), true);
select public.fleet_save_vehicle(current_setting('test.b')::uuid, null, '{"make":"Ford","model":"Transit","plate":"B 502 FLT"}', gen_random_uuid());
select test.eq(jsonb_array_length(public.my_companies()), 3, 'C: an owner with three companies sees the three');

-- No company: nothing to select.
select test.login(current_setting('test.c3')::uuid);
select test.eq(jsonb_array_length(public.my_companies()), 0, 'A: a client without a company has none');

-- Invited into one company only.
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.a')::uuid, 'bogdan@test.local', 'driver', repeat('a7', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq(jsonb_array_length(public.my_companies()), 0, 'an invitation not yet accepted opens nothing');
select public.accept_company_invite(repeat('a7', 32), gen_random_uuid());
select test.eq(jsonb_array_length(public.my_companies()), 1, 'D: invited into one company: only that one');
select test.eq(public.my_companies()->0->>'id', current_setting('test.a'), 'and it is Alfa');
select test.eq(test.count(format($$select 1 from public.companies where id in (%L, %L)$$, current_setting('test.b'), current_setting('test.c'))), 0::bigint,
  'the owner''s other companies are not readable');
select test.eq(test.count(format($$select 1 from public.company_vehicles where company_id = %L$$, current_setting('test.b'))), 0::bigint,
  'nor their vehicles');
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.b')), 'company_not_found', 'nor through the fleet read');
select test.fails(format($$select public.list_company_members(%L)$$, current_setting('test.b')), 'company_not_found', 'nor their team');
select test.fails(format($$select public.fleet_plan_summary(%L)$$, current_setting('test.b')), 'company_not_found', 'nor their plan');
select test.fails(format($$select public.fleet_save_vehicle(%L, null, '{"make":"X","model":"Y"}', gen_random_uuid())$$, current_setting('test.b')),
  'company_not_found', 'nor can write there');

-- Invited into two of the three.
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.c')::uuid, 'bogdan@test.local', 'accountant', repeat('c7', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('c7', 32), gen_random_uuid());
select test.eq((select string_agg(x->>'name', ', ' order by x->>'name') from jsonb_array_elements(public.my_companies()) x), 'Alfa SRL, Gama SRL',
  'E: member of two companies: exactly those two');

-- An admin of one company is not let into the owner's others.
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.a')::uuid, 'ioana@test.local', 'admin', repeat('d7', 32), gen_random_uuid());
select test.login(current_setting('test.c3')::uuid);
select public.accept_company_invite(repeat('d7', 32), gen_random_uuid());
select test.eq(jsonb_array_length(public.my_companies()), 1, 'an admin of Alfa sees Alfa only');
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.c')), 'company_not_found', 'and nothing of Gama');

-- Removed: gone from the list, refused everywhere.
select test.login(test.id('client_a'));
select public.remove_company_member((select id from public.company_members where company_id = current_setting('test.a')::uuid
  and user_id = test.id('client_b')), gen_random_uuid());
select test.login(test.id('client_b'));
select test.eq((select string_agg(x->>'name', ', ') from jsonb_array_elements(public.my_companies()) x), 'Gama SRL', 'F: removed from Alfa: Alfa is gone');
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.a')), 'company_not_found', 'its fleet read is refused');
select test.eq(test.count(format($$select 1 from public.companies where id = %L$$, current_setting('test.a'))), 0::bigint, 'the company row too');
select test.eq(test.count(format($$select 1 from public.company_members where company_id = %L$$, current_setting('test.a'))), 0::bigint, 'and its team');
select test.fails(format($$select public.fleet_report(%L, null, current_date, null, null, '{}')$$, current_setting('test.a')),
  'company_not_found', 'and its reports');

rollback;
