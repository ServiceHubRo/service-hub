-- M1 — the company's own expenses: who adds, edits, deletes and checks them; a driver adds fuel for
-- the vehicle assigned to them only and sees only what they added; another company never sees them;
-- a possible duplicate is refused unless confirmed (also when two requests race); an expense for a
-- job already counted never adds it again; another currency is listed, not summed; every change is
-- in the company log; the report includes them (not in the shops list).
begin;
select test.make_world();

select set_config('test.acc', test.sign_up('dan@test.local',
  '{"role":"client","name":"Dan Contabil","phone":"0723000012","lang":"ro","terms_version":"2026-09"}')::text, true);

select test.login(test.id('client_a'));
select set_config('test.co', (public.create_company('Cheltuieli SRL', null, null, null, gen_random_uuid())->>'id'), true);
select set_config('test.v1', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Dacia","model":"Logan","plate":"B 401 FLT"}', gen_random_uuid())->>'id'), true);
select set_config('test.v2', (public.fleet_save_vehicle(current_setting('test.co')::uuid, null,
  '{"make":"Ford","model":"Transit","plate":"B 402 FLT"}', gen_random_uuid())->>'id'), true);
select public.invite_company_member(current_setting('test.co')::uuid, 'bogdan@test.local', 'driver', repeat('e1', 32), gen_random_uuid());
select public.invite_company_member(current_setting('test.co')::uuid, 'dan@test.local', 'accountant', repeat('e2', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select public.accept_company_invite(repeat('e1', 32), gen_random_uuid());
select set_config('test.m_b', public.my_member_id(current_setting('test.co')::uuid)::text, true);
select test.login(current_setting('test.acc')::uuid);
select public.accept_company_invite(repeat('e2', 32), gen_random_uuid());
select test.login(test.id('client_a'));
select public.fleet_assign_driver(current_setting('test.v1')::uuid, current_setting('test.m_b')::uuid, gen_random_uuid());
select test.login(test.id('admin'));
select public.admin_set_company_plan(current_setting('test.co')::uuid, 'fleet_business', gen_random_uuid());

select test.logout();
create function pg_temp.save(p_fields jsonb, p_expense uuid default null) returns jsonb
language sql as $$ select public.fleet_save_expense(current_setting('test.co')::uuid, p_expense, p_fields, gen_random_uuid()) $$;
grant execute on function pg_temp.save(jsonb, uuid) to public;
create function pg_temp.fields(p_vehicle text, p_extra jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('vehicle_id', p_vehicle, 'category', 'parts', 'day', test.today() - 3, 'amount', 250,
                            'supplier', 'Auto Piese SRL', 'description', 'Plăcuțe frână') || p_extra
$$;
grant execute on function pg_temp.fields(text, jsonb) to public;
-- The table as the server sees it (the browser has no grant on it).
create function pg_temp.exp(p_id text) returns public.fleet_expenses
language sql security definer as $$ select * from public.fleet_expenses where id = p_id::uuid $$;
create function pg_temp.audit(p_id text, p_action text) returns setof public.company_audit_log
language sql security definer as $$ select * from public.company_audit_log where entity_id = p_id::uuid and action = p_action $$;
create function pg_temp.supplier_count(p_supplier text) returns bigint
language sql security definer as $$ select count(*) from public.fleet_expenses where supplier = p_supplier $$;
grant execute on function pg_temp.exp(text), pg_temp.audit(text, text), pg_temp.supplier_count(text) to public;

-- ------------------------------------------------------------------ the admin (costs.manage)
select test.login(test.id('client_a'));
select set_config('test.e1', (pg_temp.save(pg_temp.fields(current_setting('test.v1'))))->>'id', true);
select test.eq((pg_temp.exp(current_setting('test.e1'))).status, 'ok', 'an admin''s expense is checked already');
select test.fails($$select pg_temp.save(pg_temp.fields(current_setting('test.v1')))$$, 'expense_possible_duplicate',
  'the same vehicle, day, amount and supplier: a possible duplicate');
select test.ok(pg_temp.save(pg_temp.fields(current_setting('test.v1'), '{"confirm_duplicate":true}')) ? 'id', 'confirmed: saved');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L, jsonb_build_object('day', test.today() + 1)))$$, current_setting('test.v1')),
  'expense_invalid', 'a day in the future is refused');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L, '{"amount":0}'))$$, current_setting('test.v1')), 'expense_invalid', 'an amount of 0 is refused');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L, '{"category":"jewels"}'))$$, current_setting('test.v1')), 'expense_invalid', 'an unknown category');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L, '{"receipt_path":"../../other/x.jpg"}'))$$, current_setting('test.v1')),
  'expense_invalid', 'a receipt outside the company''s folder is refused');
select set_config('test.e_eur', (pg_temp.save(pg_temp.fields(current_setting('test.v2'), '{"amount":40,"currency":"EUR","supplier":"Péage"}')))->>'id', true);

-- Edit, check and delete, each in the log.
select pg_temp.save(pg_temp.fields(current_setting('test.v1'), '{"amount":260}'), current_setting('test.e1')::uuid);
select test.eq((pg_temp.exp(current_setting('test.e1'))).amount, 260.00, 'edited');
select test.eq((select (before->>'amount')::numeric || '→' || (after->>'amount')::numeric from pg_temp.audit(current_setting('test.e1'), 'expense_updated')), '250.00→260.00', 'the log keeps before and after');

-- ------------------------------------------------------------------ a job already counted is never added again
select test.logout();
insert into public.bookings (shop_id, client_id, service_id, client_name, client_lang, car_snapshot, date, slot, status, cost, odometer,
                             done_at, company_id, company_vehicle_id)
values (test.id('shop1'), test.id('client_a'), 'frane', 'Ana Marin', 'ro', '{"make":"Ford","model":"Transit","plate":"B 402 FLT"}',
        test.today() - 5, '10:00', 'done', 700, 80000, now() - interval '5 days', current_setting('test.co')::uuid, current_setting('test.v2')::uuid);
select set_config('test.job', (select id::text from public.bookings where company_vehicle_id = current_setting('test.v2')::uuid limit 1), true);
select test.login(test.id('client_a'));
select set_config('test.e_job', (pg_temp.save(pg_temp.fields(current_setting('test.v2'),
  jsonb_build_object('booking_id', current_setting('test.job'), 'amount', 700, 'category', 'repairs', 'supplier', 'Service Unu'))))->>'id', true);
select test.ok((select (x->>'counted_elsewhere')::boolean from jsonb_array_elements(public.fleet_overview(current_setting('test.co')::uuid)->'expenses') x
  where x->>'id' = current_setting('test.e_job')), 'the expense for the Service-Hub job is shown as counted already');
select test.eq((public.fleet_report(current_setting('test.co')::uuid, test.today() - 30, test.today())->>'total')::numeric, 1210.00,
  'the report: the job (700) + the two parts (260 + 250); the job''s receipt and the EUR expense are not added');
select test.eq(jsonb_array_length(public.fleet_report(current_setting('test.co')::uuid, test.today() - 30, test.today())->'by_shop'), 1,
  '„Service-uri folosite”: the shop only, not the suppliers');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L, jsonb_build_object('booking_id', %L)))$$, current_setting('test.v1'), current_setting('test.job')),
  'expense_invalid', 'a booking of another vehicle cannot be linked');

-- ------------------------------------------------------------------ the driver: fuel for their vehicle only
select test.login(test.id('client_b'));
select set_config('test.fuel', (pg_temp.save(jsonb_build_object('vehicle_id', current_setting('test.v1'), 'category', 'fuel', 'day', test.today() - 1,
  'amount', 300, 'liters', 42.5, 'fuel_type', 'diesel', 'full_tank', true, 'odometer', 120500, 'supplier', 'Petrom')))->>'id', true);
select test.eq((select x.status || '/' || x.liters from pg_temp.exp(current_setting('test.fuel')) x), 'to_check/42.50',
  'the driver''s fuel arrives „de verificat”');
select test.fails(format($$select pg_temp.save(jsonb_build_object('vehicle_id', %L, 'category', 'fuel', 'day', test.today(), 'amount', 100))$$,
  current_setting('test.v2')), 'not_allowed', 'not for a vehicle that is not theirs');
select test.fails(format($$select pg_temp.save(pg_temp.fields(%L))$$, current_setting('test.v1')), 'not_allowed', 'not another category');
select test.fails(format($$select public.fleet_delete_expense(%L, gen_random_uuid())$$, current_setting('test.fuel')), 'not_allowed', 'and never deletes');
select test.eq((select jsonb_agg(x->>'id') from jsonb_array_elements(public.fleet_overview(current_setting('test.co')::uuid)->'expenses') x),
  jsonb_build_array(current_setting('test.fuel')), 'the driver sees only what they added');

-- ------------------------------------------------------------------ the accountant: costs.manage, no bookings
select test.login(current_setting('test.acc')::uuid);
select test.eq((public.fleet_mark_expense(current_setting('test.fuel')::uuid, 'ok', gen_random_uuid()))->>'status', 'ok', 'the accountant checks the driver''s receipt');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'expenses'), 5, 'and sees every expense');
select public.fleet_delete_expense(current_setting('test.e_eur')::uuid, gen_random_uuid());
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co')::uuid)->'expenses'), 4, 'deleted: gone from the list');
select test.ok((pg_temp.exp(current_setting('test.e_eur'))).deleted_at is not null, 'kept, recoverable');
select test.eq((select count(*) from pg_temp.audit(current_setting('test.e_eur'), 'expense_deleted')), 1::bigint,
  'and logged as it was');

-- ------------------------------------------------------------------ another company never sees them
select test.login(test.id('client_b'));
select set_config('test.co2', (public.create_company('Alta SRL', null, null, null, gen_random_uuid())->>'id'), true);
select test.fails(format($$select public.fleet_save_expense(%L, null, pg_temp.fields(%L), gen_random_uuid())$$, current_setting('test.co2'),
  current_setting('test.v1')), 'vehicle_not_found', 'a vehicle of another company cannot be used');
select test.eq(jsonb_array_length(public.fleet_overview(current_setting('test.co2')::uuid)->'expenses'), 0, 'the other company has none');
select test.login(current_setting('test.acc')::uuid);
select public.remove_company_member(public.my_member_id(current_setting('test.co')::uuid), gen_random_uuid());
select test.fails(format($$select public.fleet_overview(%L)$$, current_setting('test.co')), 'company_not_found', 'a member who left reads nothing');
select test.fails('select 1 from public.fleet_expenses', 'permission denied', 'and the table is closed to the browser');

-- ------------------------------------------------------------------ the same request twice
select test.login(test.id('client_a'));
select set_config('test.rid', gen_random_uuid()::text, true);
select public.fleet_save_expense(current_setting('test.co')::uuid, null, pg_temp.fields(current_setting('test.v2'), '{"amount":55,"supplier":"Spălătorie"}'),
  current_setting('test.rid')::uuid);
select public.fleet_save_expense(current_setting('test.co')::uuid, null, pg_temp.fields(current_setting('test.v2'), '{"amount":55,"supplier":"Spălătorie"}'),
  current_setting('test.rid')::uuid);
select test.eq(pg_temp.supplier_count('Spălătorie'), 1::bigint, 'the same request twice: one expense');

rollback;
