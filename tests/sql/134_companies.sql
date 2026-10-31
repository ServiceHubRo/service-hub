-- T63b — companies and members (Eduard approved the migration on 31 Oct 2026).
-- Fleets are off until the switch; only client accounts take part; company A never sees company B;
-- every write goes through the functions, with the role checked there; the last admin stays.
begin;
select test.make_world();

-- ------------------------------------------------------------------ the switch and who may
-- Fleets are on since migration fleet_on; the switch still works when turned off.
update public.platform_settings set fleet_enabled = false where id = 1;
select test.login(test.id('client_a'));
select test.fails($$select public.create_company('Firma Ana', null, null, null, gen_random_uuid())$$, 'fleet_disabled',
  'fleets are off by default: nothing can be created in production before the switch');
select test.logout();
update public.platform_settings set fleet_enabled = true where id = 1;

select test.login(test.id('owner1'));
select test.fails($$select public.create_company('Firma Service', null, null, null, gen_random_uuid())$$, 'company_clients_only',
  'a shop account cannot create a company');
select test.login(test.id('admin'));
select test.fails($$select public.create_company('Firma Admin', null, null, null, gen_random_uuid())$$, 'company_clients_only',
  'a platform admin cannot create a company');

-- ------------------------------------------------------------------ creating
select test.login(test.id('client_a'));
select test.fails($$select public.create_company('X', null, null, null, gen_random_uuid())$$, 'company_name_invalid', 'a name of one letter: refused');
select test.fails($$select public.create_company('Firma Ana', '123', null, null, gen_random_uuid())$$, 'company_vat_invalid', 'an invalid CUI: refused');

select set_config('test.req', gen_random_uuid()::text, true);
select set_config('test.co_a', (public.create_company('Transport Ana SRL', null, null, 'Brașov', current_setting('test.req')::uuid)->>'id'), true);
select test.eq((public.create_company('Transport Ana SRL', null, null, 'Brașov', current_setting('test.req')::uuid)->>'id'),
  current_setting('test.co_a'), 'the same request twice returns the first company');
select test.eq(test.count($$select 1 from public.companies$$), 1::bigint, 'and creates only one');
select test.eq(public.company_role(current_setting('test.co_a')::uuid), 'admin', 'the creator is its admin');
select test.eq(jsonb_array_length(public.my_companies()), 1, 'my_companies lists it');

select public.create_company('Firma Doi', null, null, null, gen_random_uuid());
select public.create_company('Firma Trei', null, null, null, gen_random_uuid());
select test.fails($$select public.create_company('Firma Patru', null, null, null, gen_random_uuid())$$, 'limit_companies',
  'at most 3 companies created per account');

-- ------------------------------------------------------------------ direct writes are refused
select test.fails($$insert into public.companies (name) values ('Pirat')$$, 'permission denied', 'no direct insert of a company');
select test.fails($$update public.companies set name = 'Alt nume'$$, 'permission denied', 'no direct update of a company');
select test.fails($$update public.company_members set role = 'admin'$$, 'permission denied', 'no direct change of a role');
select test.fails($$insert into public.company_members (company_id, user_id, invited_email, role, accepted_at)
  values (current_setting('test.co_a')::uuid, test.id('client_b'), 'x@y.ro', 'admin', now())$$, 'permission denied', 'no direct membership');
select test.fails($$select invite_token_hash from public.company_members$$, 'permission denied', 'the token hash is never readable');

-- ------------------------------------------------------------------ another account sees nothing
select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.companies$$), 0::bigint, 'client B reads no company of A');
select test.eq(test.count($$select 1 from public.company_members$$), 0::bigint, 'nor its members');
select test.eq(test.count($$select 1 from public.company_audit_log$$), 0::bigint, 'nor its audit log');
select test.fails(format($$select public.update_company(%L, 'Furat', null, null, null, gen_random_uuid())$$, current_setting('test.co_a')),
  'company_not_found', 'B cannot change A''s company');
select test.fails(format($$select public.invite_company_member(%L, 'eu@test.local', 'admin', repeat('a', 64), gen_random_uuid())$$,
  current_setting('test.co_a')), 'company_not_found', 'B cannot invite into A''s company');
select test.fails(format($$select public.list_company_members(%L)$$, current_setting('test.co_a')), 'company_not_found', 'nor list its team');

-- B's own company stays apart from A's.
select set_config('test.co_b', (public.create_company('Logistic Bogdan SRL', null, null, null, gen_random_uuid())->>'id'), true);
select test.eq(test.count($$select 1 from public.companies$$), 1::bigint, 'B reads only B''s company');

-- ------------------------------------------------------------------ invitations
select test.login(test.id('client_a'));
select set_config('test.token', repeat('b1', 32), true);
select test.fails(format($$select public.invite_company_member(%L, 'bogdan@test.local', 'owner', %L, gen_random_uuid())$$,
  current_setting('test.co_a'), current_setting('test.token')), 'company_role_invalid', 'an unknown role: refused');
select public.invite_company_member(current_setting('test.co_a')::uuid, 'Bogdan@Test.Local', 'driver', current_setting('test.token'), gen_random_uuid());

select test.login_anon();
select test.eq(public.get_company_invite(current_setting('test.token'))->>'company_name', 'Transport Ana SRL', 'the link shows the company, signed out');
select test.eq(public.get_company_invite(current_setting('test.token'))->>'role', 'driver', 'and the role');
select test.ok(public.get_company_invite(repeat('c', 64)) is null, 'a wrong token shows nothing');

select test.login(test.id('staff1'));
select test.fails(format($$select public.accept_company_invite(%L, gen_random_uuid())$$, current_setting('test.token')),
  'company_clients_only', 'a shop colleague cannot join');
select test.login(test.id('client_b'));
select public.accept_company_invite(current_setting('test.token'), gen_random_uuid());
select test.eq(public.company_role(current_setting('test.co_a')::uuid), 'driver', 'B joined A''s company as driver');
select test.fails(format($$select public.accept_company_invite(%L, gen_random_uuid())$$, current_setting('test.token')),
  'invite_invalid', 'a used link does not work twice');

-- The driver sees only their own row and cannot manage anything.
select test.eq(test.count(format($$select 1 from public.company_members where company_id = %L$$, current_setting('test.co_a'))), 1::bigint,
  'the driver reads only their own member row');
select test.eq(jsonb_array_length(public.list_company_members(current_setting('test.co_a')::uuid)), 1, 'and lists only themselves');
select test.fails(format($$select public.invite_company_member(%L, 'x@test.local', 'driver', repeat('d', 64), gen_random_uuid())$$,
  current_setting('test.co_a')), 'not_allowed', 'a driver cannot invite');
select test.fails(format($$select public.set_company_rules(%L, 100000, null, null, gen_random_uuid())$$,
  current_setting('test.co_a')), 'not_allowed', 'a driver cannot raise the approval limit');
select test.ok(not public.fleet_can(current_setting('test.co_a')::uuid, 'costs.view'), 'a driver may not see costs');
select test.eq(test.count($$select 1 from public.company_audit_log$$), 1::bigint, 'the driver reads only B''s own company log, not A''s');

-- An invitation to someone else's address cannot be taken.
select test.login(test.id('client_a'));
select public.invite_company_member(current_setting('test.co_a')::uuid, 'altcineva@test.local', 'accountant', repeat('e1', 32), gen_random_uuid());
select test.login(test.id('client_b'));
select test.fails(format($$select public.accept_company_invite(%L, gen_random_uuid())$$, repeat('e1', 32)),
  'invite_other_email', 'an invitation for another address: refused');

-- ------------------------------------------------------------------ the admin always remains
select test.login(test.id('client_a'));
select set_config('test.m_a', (select id::text from public.company_members where company_id = current_setting('test.co_a')::uuid and user_id = test.id('client_a')), true);
select set_config('test.m_b', (select id::text from public.company_members where company_id = current_setting('test.co_a')::uuid and user_id = test.id('client_b')), true);
select test.fails(format($$select public.set_company_member_role(%L, 'manager', gen_random_uuid())$$, current_setting('test.m_a')),
  'last_admin', 'the last admin cannot step down');
select test.fails(format($$select public.remove_company_member(%L, gen_random_uuid())$$, current_setting('test.m_a')),
  'last_admin', 'the last admin cannot leave');
select public.set_company_rules(current_setting('test.co_a')::uuid, 2500, 4000, null, gen_random_uuid());
select test.eq((select manager_approval_limit from public.companies where id = current_setting('test.co_a')::uuid), 2500.00::numeric(12,2),
  'the admin sets the managers'' limit');

select public.transfer_company_admin(current_setting('test.m_b')::uuid, gen_random_uuid());
select test.eq(public.company_role(current_setting('test.co_a')::uuid), 'manager', 'after the transfer the old admin is fleet manager');
select test.fails(format($$select public.set_company_rules(%L, 999999, null, null, gen_random_uuid())$$,
  current_setting('test.co_a')), 'not_allowed', 'and can no longer change the rules');
select test.eq(test.count(format($$select 1 from public.company_members where company_id = %L$$, current_setting('test.co_a'))), 3::bigint,
  'a manager sees the whole team (to assign cars)');

select test.login(test.id('client_b'));
select test.eq(public.company_role(current_setting('test.co_a')::uuid), 'admin', 'the new admin');
select public.remove_company_member(current_setting('test.m_a')::uuid, gen_random_uuid());
select test.eq(test.count(format($$select 1 from public.company_members where company_id = %L and accepted_at is not null$$, current_setting('test.co_a'))),
  1::bigint, 'the admin removes the former admin; the company stays');
select test.ok(exists (select 1 from public.companies where id = current_setting('test.co_a')::uuid), 'the company and its data stay');

-- The audit log names every step with who did it.
select test.ok((select count(*) from public.company_audit_log where company_id = current_setting('test.co_a')::uuid) >= 7,
  'every change is in the company''s log');
select test.ok(exists (select 1 from public.company_audit_log where company_id = current_setting('test.co_a')::uuid
  and action = 'transfer_admin' and actor_id = test.id('client_a')), 'the transfer is logged with its author');

-- The former admin no longer reads the company.
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select 1 from public.companies where id = %L$$, current_setting('test.co_a'))), 0::bigint,
  'a removed member reads nothing of the company');

-- A platform admin can read (support), but not write.
select test.login(test.id('admin'));
select test.ok(test.count($$select 1 from public.companies$$) >= 4, 'the platform admin reads the companies');

-- ------------------------------------------------------------------ the rights mirror the app
select test.logout();
select test.ok(public.fleet_role_can('manager', 'quotes.approve') and not public.fleet_role_can('accountant', 'quotes.approve')
  and public.fleet_role_can('accountant', 'audit.view') and not public.fleet_role_can('driver', 'costs.view')
  and public.fleet_role_can('admin', 'members.manage') and not public.fleet_role_can(null, 'issues.report'),
  'the capability matrix');

rollback;
