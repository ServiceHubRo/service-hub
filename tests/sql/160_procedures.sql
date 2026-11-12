-- A5 — Internal procedures: nobody outside the team reads or writes them (signed out, client, shop,
-- directly or through any function), an agent needs the second step and a live session, an agent writes
-- drafts but never approves, publishes, archives or decides who reads them; any admin approves (its own
-- draft included); an approved version never changes (by any path); a change is a new version; „Am
-- citit” belongs to one version, once per person, never written by opening a page; responsibles per
-- category; the procedures next to a support request; every write audited and idempotent; the rollback
-- refuses once real data exists.
begin;
select test.make_fleet();

create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;

-- The id of a procedure by its Romanian title (first version) and of its versions.
create function test.proc_id(p_title text) returns uuid
language sql security definer as $$
  select p.id from public.procedures p
  where exists (select 1 from public.procedure_versions v where v.procedure_id = p.id and v.content_ro->>'title' = p_title)
  limit 1
$$;
grant execute on function test.proc_id(text) to public;
create function test.open_version(p_proc uuid) returns uuid
language sql security definer as $$
  select v.id from public.procedure_versions v where v.procedure_id = p_proc and v.status in ('draft', 'pending')
$$;
grant execute on function test.open_version(uuid) to public;
create function test.version_id(p_proc uuid, p_version int) returns uuid
language sql security definer as $$
  select v.id from public.procedure_versions v where v.procedure_id = p_proc and v.version = p_version
$$;
grant execute on function test.version_id(uuid, int) to public;

-- What the caller's library lists: titles of the published versions, and of the versions in work.
create function test.lib_published() returns text[]
language sql as $$
  select coalesce(array(select x->'published'->>'title_ro' from jsonb_array_elements(public.staff_procedures()->'procedures') x
                        where x->'published' is not null and jsonb_typeof(x->'published') = 'object' order by 1), '{}')
$$;
grant execute on function test.lib_published() to public;
create function test.lib_count() returns int
language sql as $$ select jsonb_array_length(public.staff_procedures()->'procedures') $$;
grant execute on function test.lib_count() to public;

-- A refusal naming the field.
create function test.fails_field(statement text, expected_code text, expected_field text, description text) returns void
language plpgsql as $$
declare
  msg text;
  det text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    if msg <> expected_code or coalesce(nullif(det, '')::jsonb->>'field', '') <> expected_field then
      raise exception 'FAILED: % (expected % %, got "%" %)', description, expected_code, expected_field, msg, det;
    end if;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded: %)', description, statement;
end
$$;
grant execute on function test.fails_field(text, text, text, text) to public;

-- A valid content, with changes.
create function test.content(p jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('title', 'Procedură de test', 'applies_when', 'Când apare situația de test.',
    'purpose', 'Ca testul să verifice procedura.', 'steps', jsonb_build_array('Primul pas.', 'Al doilea pas.'),
    'escalation', 'Escaladează când pașii nu ajung.') || p
$$;
grant execute on function test.content(jsonb) to public;

-- The tables as the database holds them (the test reads them directly, past their closed grants).
create function test.t_procedures() returns setof public.procedures language sql security definer as $$ select * from public.procedures $$;
create function test.t_versions() returns setof public.procedure_versions language sql security definer as $$ select * from public.procedure_versions $$;
create function test.t_acks() returns setof public.procedure_acknowledgements language sql security definer as $$ select * from public.procedure_acknowledgements $$;
create function test.t_resps() returns setof public.procedure_responsibilities language sql security definer as $$ select * from public.procedure_responsibilities $$;
create function test.t_audit() returns setof public.admin_audit_log language sql security definer as $$ select * from public.admin_audit_log $$;
create function test.t_profiles() returns setof public.profiles language sql security definer as $$ select * from public.profiles $$;
create function test.t_suggestions() returns setof public.suggestions language sql security definer as $$ select * from public.suggestions $$;
grant execute on all functions in schema test to public;

-- Two agents (with live sessions), a second admin.
select set_config('test.agent', test.sign_up('procagent@test.local', '{"role":"client","name":"Ana Proceduri","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.agent2', test.sign_up('procagent2@test.local', '{"role":"client","name":"Mihai Proceduri","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.admin2', test.sign_up('procadmin2@test.local', '{"role":"client","name":"Al doilea admin","lang":"ro","terms_version":"2026-09"}')::text, true);
update public.profiles set role = 'admin' where id = current_setting('test.admin2')::uuid;
select test.login(test.id('admin'));
select public.admin_grant_support((select display_id from public.profiles where id = current_setting('test.agent')::uuid), 'Echipa suport', test.rid());
select public.admin_grant_support((select display_id from public.profiles where id = current_setting('test.agent2')::uuid), 'Echipa suport', test.rid());
reset role;
insert into auth.sessions (id, user_id) values
  ('60000000-0000-4000-8000-000000000001', current_setting('test.agent')::uuid),
  ('60000000-0000-4000-8000-000000000002', current_setting('test.agent2')::uuid);
create function test.as_agent() returns void language sql as $$
  select test.login_session(current_setting('test.agent')::uuid, '60000000-0000-4000-8000-000000000001')
$$;
grant execute on function test.as_agent() to public;
create function test.as_agent2() returns void language sql as $$
  select test.login_session(current_setting('test.agent2')::uuid, '60000000-0000-4000-8000-000000000002')
$$;
grant execute on function test.as_agent2() to public;

-- ------------------------------------------------------------------ the tables are closed to everyone
select test.ok(not exists (select 1 from pg_policies where tablename like 'procedure%'), 'no policy opens a procedure table');
select test.ok(not exists (select 1 from pg_publication_tables where tablename like 'procedure%'), 'no procedure table in Realtime');
select test.eq((select count(*) from information_schema.role_table_grants
                where table_schema = 'public' and table_name like 'procedure%' and grantee in ('anon', 'authenticated')), 0::bigint,
  'no grant on any procedure table to anon or authenticated');
select test.ok((select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace
                and c.relname in ('procedures', 'procedure_versions', 'procedure_acknowledgements', 'procedure_responsibilities')),
  'RLS is on for the four tables');

select test.login_anon();
select test.fails($$select * from public.procedures$$, 'permission denied', 'signed out: no table');
select test.fails($$select public.staff_procedures()$$, 'permission denied', 'signed out: no library');
select test.fails($$select public.staff_procedure_get(gen_random_uuid())$$, 'permission denied', 'signed out: no procedure');
select test.fails($$select public.support_procedures_for_request(gen_random_uuid())$$, 'permission denied', 'signed out: nothing for a request');
select test.fails($$select public.staff_procedure_create('{}', '{}', null, gen_random_uuid())$$, 'permission denied', 'signed out: no writing');

select test.login(test.id('client_a'));
select test.fails($$select * from public.procedure_versions$$, 'permission denied', 'a client cannot read the versions table');
select test.fails($$select * from public.procedure_acknowledgements$$, 'permission denied', 'nor the confirmations');
select test.fails($$select * from public.procedure_responsibilities$$, 'permission denied', 'nor the responsibles');
select test.fails($$select public.staff_procedures()$$, 'not_allowed', 'a client has no library');
select test.fails(format($$select public.staff_procedure_get(%L)$$, test.proc_id('Cont compromis')), 'not_allowed', 'nor any procedure');
select test.fails($$select public.staff_procedure_create('{"category": "access"}', test.content(), null, test.rid())$$, 'not_allowed', 'nor writes one');
select test.fails(format($$select public.staff_procedure_acknowledge(%L, test.rid())$$, test.open_version(test.proc_id('Cont compromis'))),
  'not_allowed', 'nor confirms one');
select test.fails(format($$select public.admin_procedure_approve(%L, true, test.rid())$$, test.open_version(test.proc_id('Cont compromis'))),
  'not_allowed', 'nor approves one');
select test.ok(position('Cont compromis' in public.help_center('ro')::text) = 0 and position('procedur' in public.help_center('ro')::text) = 0,
  'no procedure reaches the Help Center');

select test.login(test.id('owner1'));
select test.fails($$select * from public.procedures$$, 'permission denied', 'a shop cannot read the procedures table');
select test.fails($$select public.staff_procedures()$$, 'not_allowed', 'a shop has no library');
select test.fails(format($$select public.staff_procedure_get(%L)$$, test.proc_id('Cont compromis')), 'not_allowed', 'nor any procedure');
select test.fails($$select public.admin_procedure_set_responsible('access', auth.uid(), test.rid())$$, 'not_allowed', 'nor names itself responsible');

-- ------------------------------------------------------------------ the team: second step and a live session
select test.login_session(current_setting('test.agent')::uuid, '60000000-0000-4000-8000-000000000001', 'aal1');
select test.fails($$select public.staff_procedures()$$, 'mfa_required', 'an agent before the second step: refused');
select test.login(current_setting('test.agent')::uuid);
select test.fails($$select public.staff_procedures()$$, 'not_signed_in', 'an agent without a session id: refused');
select test.login_session(current_setting('test.agent')::uuid, '60000000-0000-4000-8000-0000000000ff');
select test.fails($$select public.staff_procedures()$$, 'not_signed_in', 'an agent whose session ended: refused');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.staff_procedures()$$, 'mfa_required', 'an admin before the second step: refused');
select test.fails($$select public.admin_procedure_set_responsible('access', null, test.rid())$$, 'mfa_required', 'nor administers');

-- ------------------------------------------------------------------ the first content: drafts only
select test.as_agent();
select test.eq(test.lib_count(), 0, 'nothing published by the migration: an agent sees no procedure');
select test.eq(jsonb_array_length(public.staff_procedures()->'categories'), 11, 'the 11 categories are listed');
select test.ok(public.staff_procedures()->'team' = 'null'::jsonb, 'an agent does not get the team list');
select test.fails(format($$select public.staff_procedure_get(%L)$$, test.proc_id('Cont compromis')), 'procedure_not_found',
  'an agent cannot open a draft it does not write');
select test.login(test.id('admin'));
select test.eq(test.lib_count(), 16, 'the admin sees the 16 first procedures');
select test.ok((select bool_and(x->>'status' = 'draft' and x->'published' = 'null'::jsonb and x->'open'->>'status' = 'draft')
                from jsonb_array_elements(public.staff_procedures()->'procedures') x), 'every first procedure is a draft');
select test.eq((select count(*) from jsonb_array_elements(public.staff_procedures()->'procedures') x where (x->>'critical')::boolean), 5::bigint,
  'five critical exceptional procedures');
select test.ok((select bool_and(x->>'kind' = 'exceptional') from jsonb_array_elements(public.staff_procedures()->'procedures') x where (x->>'critical')::boolean),
  'only exceptional procedures are critical');
select test.ok((select bool_and(v.content_en is not null and v.seeded and v.author_id is null) from test.t_versions() v),
  'every first procedure has English and is marked as written by the migration');
select test.ok(jsonb_array_length(public.staff_procedures()->'team') >= 4, 'the admin gets the team to name responsibles');

-- ------------------------------------------------------------------ approving: any admin, its own draft included
select set_config('test.p_escal', test.proc_id('Escaladarea unei solicitări')::text, true);
select set_config('test.p_comp', test.proc_id('Cont compromis')::text, true);
select set_config('test.p_abuse', test.proc_id('Abuz și limbaj ofensator')::text, true);
select set_config('test.p_auth', test.proc_id('Probleme de autentificare')::text, true);

select test.as_agent();
select test.fails(format($$select public.admin_procedure_approve(%L, true, test.rid())$$, test.open_version(current_setting('test.p_escal')::uuid)),
  'not_allowed', 'an agent never approves');
select test.fails(format($$select public.admin_procedure_publish(%L, test.rid())$$, test.open_version(current_setting('test.p_escal')::uuid)),
  'not_allowed', 'nor publishes');
select test.fails(format($$select public.admin_procedure_archive(%L, true, test.rid())$$, current_setting('test.p_escal')),
  'not_allowed', 'nor archives');
select test.fails(format($$select public.admin_procedure_set_settings(%L, '{"critical": false}', test.rid())$$, current_setting('test.p_comp')),
  'not_allowed', 'nor changes the settings');
select test.fails(format($$select public.admin_procedure_acknowledgements(%L)$$, current_setting('test.p_comp')),
  'not_allowed', 'nor reads who confirmed');
select test.fails($$select public.admin_procedure_set_responsible('access', auth.uid(), test.rid())$$, 'not_allowed', 'nor names responsibles');

-- A single admin approves and publishes alone (the author of the seeded drafts is nobody; below, its own).
select test.login(test.id('admin'));
select set_config('test.ap_rid', test.rid()::text, true);
select set_config('test.ap', public.admin_procedure_approve(test.open_version(current_setting('test.p_escal')::uuid), true,
  current_setting('test.ap_rid')::uuid)::text, true);
select test.eq(current_setting('test.ap')::jsonb->>'published', 'true', 'approved and published in one step');
select test.eq(public.admin_procedure_approve(test.version_id(current_setting('test.p_escal')::uuid, 1), true,
  current_setting('test.ap_rid')::uuid)::text, current_setting('test.ap'), 'the same request again returns the first answer');
select test.fails(format($$select public.admin_procedure_approve(%L, true, test.rid())$$, test.version_id(current_setting('test.p_escal')::uuid, 1)),
  'version_locked', 'an approved version is not approved again');
select test.eq((select count(*) from test.t_audit() where action = 'approve_procedure' and entity_id = current_setting('test.p_escal')),
  1::bigint, 'one approval in the log, not two');
select public.admin_procedure_approve(test.open_version(current_setting('test.p_comp')::uuid), true, test.rid());
select public.admin_procedure_approve(test.open_version(current_setting('test.p_abuse')::uuid), false, test.rid());
select test.eq((select status from test.t_procedures() where id = current_setting('test.p_abuse')::uuid), 'draft',
  'approved without publishing: still not shown');
select test.fails(format($$select public.staff_procedure_acknowledge(%L, test.rid())$$, test.version_id(current_setting('test.p_abuse')::uuid, 1)),
  'procedure_not_found', 'an unpublished version cannot be confirmed');
select public.admin_procedure_publish(test.version_id(current_setting('test.p_abuse')::uuid, 1), test.rid());
select test.fails(format($$select public.admin_procedure_publish(%L, test.rid())$$, test.version_id(current_setting('test.p_abuse')::uuid, 1)),
  'wrong_status', 'the version shown is not published twice');

select test.as_agent();
select test.eq(test.lib_published(), array['Abuz și limbaj ofensator', 'Cont compromis', 'Escaladarea unei solicitări'],
  'an agent reads the published procedures only');
select test.ok(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'published'->'content_ro'->'steps' is not null,
  'with their whole text');

-- ------------------------------------------------------------------ an approved version never changes
select test.login(test.id('admin'));
select test.fails(format($$select public.staff_procedure_save(%L, test.content(), null, null, test.rid())$$,
  test.version_id(current_setting('test.p_escal')::uuid, 1)), 'version_locked', 'saving over an approved version: refused');
select test.fails(format($$select public.staff_procedure_step(%L, 'discard', test.rid())$$, test.version_id(current_setting('test.p_escal')::uuid, 1)),
  'version_locked', 'discarding an approved version: refused');
reset role;
select test.fails(format($$update public.procedure_versions set content_ro = test.content() where id = %L$$,
  test.version_id(current_setting('test.p_escal')::uuid, 1)), 'version_locked', 'not even directly in the database');
select test.fails(format($$update public.procedure_versions set approved_at = now() - interval '1 day' where id = %L$$,
  test.version_id(current_setting('test.p_escal')::uuid, 1)), 'version_locked', 'nor its approval');
select test.fails(format($$update public.procedure_versions set published_at = now() - interval '1 day' where id = %L$$,
  test.version_id(current_setting('test.p_escal')::uuid, 1)), 'version_locked', 'nor its publication');
select test.fails(format($$delete from public.procedure_versions where id = %L$$,
  test.version_id(current_setting('test.p_escal')::uuid, 1)), 'version_locked', 'nor deleted');

-- ------------------------------------------------------------------ an agent writes drafts
select test.as_agent();
select test.fails_field($$select public.staff_procedure_create('{"category": "nope"}', test.content(), null, test.rid())$$,
  'field_invalid', 'proc_category', 'an unknown category refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access", "kind": "rare"}', test.content(), null, test.rid())$$,
  'field_invalid', 'proc_kind', 'an unknown kind refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access", "support_categories": ["nope"]}', test.content(), null, test.rid())$$,
  'field_invalid', 'proc_support_categories', 'an unknown request category refused');
select test.fails($$select public.staff_procedure_create('{"category": "access", "kind": "exceptional", "critical": true}', test.content(), null, test.rid())$$,
  'not_allowed', 'an agent cannot make a procedure critical');
select test.fails($$select public.staff_procedure_create('{"category": "access", "visibility": "admin"}', test.content(), null, test.rid())$$,
  'not_allowed', 'nor decide who reads it');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"title": "<b>X</b> titlu"}'), null, test.rid())$$,
  'field_invalid', 'proc_title_ro', 'raw HTML refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"purpose": "Deschide [aici](javascript:alert(1)) acum."}'), null, test.rid())$$,
  'field_invalid', 'proc_purpose_ro', 'a javascript: link refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"steps": []}'), null, test.rid())$$,
  'field_invalid', 'proc_steps_ro', 'at least one step');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"steps": ["Pas <script>x</script>"]}'), null, test.rid())$$,
  'field_invalid', 'proc_steps_ro', 'a script in a step refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"escalation": null}'), null, test.rid())$$,
  'field_invalid', 'proc_escalation_ro', 'the escalation conditions are required');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"extra": "x"}'), null, test.rid())$$,
  'field_invalid', 'proc_content_ro', 'unknown fields refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"warnings": "Parola: Secret123 pentru test"}'), null, test.rid())$$,
  'secret_in_text', 'proc_warnings_ro', 'a password in the text refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content('{"steps": ["Cardul 4111 1111 1111 1111 nu se scrie."]}'), null, test.rid())$$,
  'secret_in_text', 'proc_steps_ro', 'a card number in a step refused');
select test.fails_field($$select public.staff_procedure_create('{"category": "access"}', test.content(), '{"title": "Only a title"}', test.rid())$$,
  'field_invalid', 'proc_applies_when_en', 'English is the whole content or nothing');

select set_config('test.cr_rid', test.rid()::text, true);
select set_config('test.mine', (public.staff_procedure_create('{"category": "access", "kind": "exceptional", "support_categories": ["account"]}',
  test.content('{"warnings": "Atenție la datele personale."}'), '{"title": "", "steps": [""]}', current_setting('test.cr_rid')::uuid)->>'id'), true);
select test.eq(public.staff_procedure_create('{"category": "access"}', test.content(), null, current_setting('test.cr_rid')::uuid)->>'id',
  current_setting('test.mine'), 'the same request id creates nothing more');
select test.eq((select count(*) from test.t_procedures() where created_by = current_setting('test.agent')::uuid), 1::bigint, 'one procedure created');
select test.eq((select visibility || '/' || critical::text || '/' || status from test.t_procedures() where id = current_setting('test.mine')::uuid),
  'support/false/draft', 'an agent''s procedure: for agents, not critical, a draft');
select test.ok((select content_en is null from test.t_versions() where procedure_id = current_setting('test.mine')::uuid),
  'an empty English content is stored as none');
select test.eq(public.staff_procedure_get(current_setting('test.mine')::uuid)->'open'->>'status', 'draft', 'the agent opens its own draft');
select test.ok((public.staff_procedure_get(current_setting('test.mine')::uuid)->>'can_edit')::boolean, 'and may edit it');
select public.staff_procedure_save(test.open_version(current_setting('test.mine')::uuid),
  test.content('{"title": "Procedură de test modificată"}'), null, '{"category": "accounts"}', test.rid());
select test.eq((select category from test.t_procedures() where id = current_setting('test.mine')::uuid), 'accounts',
  'its category changes while it was never published');
select test.eq((select content_ro->>'title' from test.t_versions() where procedure_id = current_setting('test.mine')::uuid),
  'Procedură de test modificată', 'the draft is saved');
select test.fails(format($$select public.staff_procedure_new_version(%L, test.rid())$$, current_setting('test.mine')),
  'procedure_not_found', 'a new version starts only from a published procedure an agent reads');

-- Another agent does not see it, until it is responsible for the category.
select test.as_agent2();
select test.fails(format($$select public.staff_procedure_get(%L)$$, current_setting('test.mine')), 'procedure_not_found',
  'another agent does not see a draft it does not write');
select test.fails(format($$select public.staff_procedure_save(%L, test.content(), null, null, test.rid())$$, test.open_version(current_setting('test.mine')::uuid)),
  'procedure_not_found', 'nor edits it');
select test.login(test.id('admin'));
select public.admin_procedure_set_responsible('accounts', current_setting('test.agent2')::uuid, test.rid());
select test.as_agent2();
select test.eq(public.staff_procedure_get(current_setting('test.mine')::uuid)->'open'->>'status', 'draft',
  'the category''s responsible opens the draft');
select public.staff_procedure_save(test.open_version(current_setting('test.mine')::uuid),
  test.content('{"title": "Procedură de test completată"}'), null, null, test.rid());

-- Sent for approval: no editing until it is back to draft; the agent still cannot approve.
select test.as_agent();
select public.staff_procedure_step(test.open_version(current_setting('test.mine')::uuid), 'submit', test.rid());
select test.eq(public.staff_procedure_get(current_setting('test.mine')::uuid)->'open'->>'status', 'pending', 'sent for approval');
select test.fails(format($$select public.staff_procedure_save(%L, test.content(), null, null, test.rid())$$, test.open_version(current_setting('test.mine')::uuid)),
  'wrong_status', 'a version sent for approval is not edited');
select test.fails(format($$select public.staff_procedure_step(%L, 'submit', test.rid())$$, test.open_version(current_setting('test.mine')::uuid)),
  'wrong_status', 'nor sent twice');
select test.fails(format($$select public.admin_procedure_approve(%L, true, test.rid())$$, test.open_version(current_setting('test.mine')::uuid)),
  'not_allowed', 'the author cannot approve it');
select public.staff_procedure_step(test.open_version(current_setting('test.mine')::uuid), 'to_draft', test.rid());
select public.staff_procedure_step(test.open_version(current_setting('test.mine')::uuid), 'submit', test.rid());

-- The second admin approves it; the procedure becomes readable by every agent.
select test.login(current_setting('test.admin2')::uuid);
select public.admin_procedure_approve(test.open_version(current_setting('test.mine')::uuid), true, test.rid());
select test.eq((select approved_by_display_id from test.t_versions() where procedure_id = current_setting('test.mine')::uuid),
  (select display_id from test.t_profiles() where id = current_setting('test.admin2')::uuid), 'the approver is recorded');
select test.as_agent2();
select test.ok('Procedură de test completată' = any (test.lib_published()), 'every agent reads it once published');

-- An admin approves its own draft.
select test.login(test.id('admin'));
select set_config('test.own', (public.staff_procedure_create('{"category": "billing", "kind": "exceptional", "critical": true, "visibility": "admin"}',
  test.content('{"title": "Procedură doar pentru administratori"}'), null, test.rid())->>'id'), true);
select public.admin_procedure_approve(test.open_version(current_setting('test.own')::uuid), true, test.rid());
select test.eq((select status from test.t_procedures() where id = current_setting('test.own')::uuid), 'published',
  'an admin approves and publishes its own draft');
select test.as_agent();
select test.ok(not ('Procedură doar pentru administratori' = any (test.lib_published())), 'a procedure for admins never reaches an agent');
select test.fails(format($$select public.staff_procedure_get(%L)$$, current_setting('test.own')), 'procedure_not_found', 'not even by its id');

-- ------------------------------------------------------------------ a change is a new version
select test.as_agent();
select set_config('test.v2', (public.staff_procedure_new_version(current_setting('test.p_comp')::uuid, test.rid())->>'version_id'), true);
select test.fails(format($$select public.staff_procedure_new_version(%L, test.rid())$$, current_setting('test.p_comp')),
  'version_open', 'one version in work at a time');
select test.eq((select version from test.t_versions() where id = current_setting('test.v2')::uuid), 2, 'version 2');
select test.eq((select content_ro from test.t_versions() where id = current_setting('test.v2')::uuid),
  (select content_ro from test.t_versions() where procedure_id = current_setting('test.p_comp')::uuid and version = 1),
  'it starts from the published text');
select public.staff_procedure_save(current_setting('test.v2')::uuid,
  (select content_ro from test.t_versions() where id = current_setting('test.v2')::uuid) || '{"deadlines": "Escaladarea se face în prima oră de la primire."}',
  (select content_en from test.t_versions() where id = current_setting('test.v2')::uuid), null, test.rid());
select test.eq(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'published'->>'version', '1',
  'readers still see version 1 while version 2 is in work');
select test.eq((select count(*) from jsonb_array_elements(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'versions')), 2::bigint,
  'the agent sees the published version and its own draft in the history');
select test.as_agent2();
select test.eq((select count(*) from jsonb_array_elements(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'versions')), 1::bigint,
  'another agent sees only the published version');
select test.ok(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'open' = 'null'::jsonb, 'and not the draft');

-- ------------------------------------------------------------------ „Am citit”: per version, once, never by opening
select test.as_agent();
select test.ok(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'acknowledged_at' = 'null'::jsonb,
  'opening the page confirms nothing');
select test.eq((select count(*) from test.t_acks()), 0::bigint, 'no confirmation written by reading');
select test.ok((public.staff_procedure_get(current_setting('test.p_comp')::uuid)->>'ack_required')::boolean, 'a critical procedure asks for it');
select test.fails(format($$select public.staff_procedure_acknowledge(%L, test.rid())$$, test.version_id(current_setting('test.p_escal')::uuid, 1)),
  'ack_not_required', 'a usual procedure needs no confirmation');
select test.fails(format($$insert into public.procedure_acknowledgements (version_id, user_id) values (%L, %L)$$,
  test.version_id(current_setting('test.p_comp')::uuid, 1), current_setting('test.agent2')), 'permission denied',
  'nobody writes a confirmation directly (nor for someone else)');
select set_config('test.ack_rid', test.rid()::text, true);
select public.staff_procedure_acknowledge(test.version_id(current_setting('test.p_comp')::uuid, 1), current_setting('test.ack_rid')::uuid);
select public.staff_procedure_acknowledge(test.version_id(current_setting('test.p_comp')::uuid, 1), current_setting('test.ack_rid')::uuid);
select public.staff_procedure_acknowledge(test.version_id(current_setting('test.p_comp')::uuid, 1), test.rid());
select test.eq((select count(*) from test.t_acks()), 1::bigint, 'one confirmation per person and version');
select test.eq((select user_id from test.t_acks()), current_setting('test.agent')::uuid, 'for the caller only');
select test.eq((select count(*) from test.t_audit() where action = 'acknowledge_procedure'), 1::bigint, 'logged once');
select test.ok(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'acknowledged_at' <> 'null'::jsonb, 'shown as confirmed');

select test.login(test.id('admin'));
select test.ok((select bool_or(x->>'id' = current_setting('test.agent') and x->'acknowledged_at' <> 'null'::jsonb)
                  and bool_or(x->>'id' = current_setting('test.agent2') and x->'acknowledged_at' = 'null'::jsonb)
                from jsonb_array_elements(public.admin_procedure_acknowledgements(current_setting('test.p_comp')::uuid)->'people') x),
  'the admin sees who confirmed and who did not');
select test.eq(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'acks'->>'done', '1', 'and the count in the library');

-- Version 2 published: the confirmation of version 1 does not count for it.
select public.admin_procedure_approve(current_setting('test.v2')::uuid, true, test.rid());
select test.as_agent();
select test.eq(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'published'->>'version', '2', 'readers now see version 2');
select test.ok(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'acknowledged_at' = 'null'::jsonb,
  'a new version asks again');
select test.fails(format($$select public.staff_procedure_acknowledge(%L, test.rid())$$, test.version_id(current_setting('test.p_comp')::uuid, 1)),
  'wrong_status', 'the old version cannot be confirmed any more');
select public.staff_procedure_acknowledge(current_setting('test.v2')::uuid, test.rid());
select test.eq((select count(*) from test.t_acks() where user_id = current_setting('test.agent')::uuid), 2::bigint,
  'both confirmations are kept, each with its version');
select test.eq((select count(*) from jsonb_array_elements(public.staff_procedure_get(current_setting('test.p_comp')::uuid)->'versions')), 2::bigint,
  'the history keeps both published versions');

-- ------------------------------------------------------------------ settings, archive
select test.login(test.id('admin'));
select test.fails_field(format($$select public.admin_procedure_set_settings(%L, '{"critical": true}', test.rid())$$, current_setting('test.p_escal')),
  'field_invalid', 'proc_critical', 'a usual procedure cannot be critical');
select public.admin_procedure_set_settings(current_setting('test.p_abuse')::uuid, '{"critical": true}', test.rid());
select test.as_agent();
select test.ok((public.staff_procedure_get(current_setting('test.p_abuse')::uuid)->>'ack_required')::boolean,
  'made critical: every reader is asked to confirm the version shown');
select test.login(test.id('admin'));
select public.admin_procedure_archive(current_setting('test.p_abuse')::uuid, true, test.rid());
select test.fails(format($$select public.admin_procedure_archive(%L, true, test.rid())$$, current_setting('test.p_abuse')), 'wrong_status',
  'archived once');
select test.as_agent();
select test.ok(not ('Abuz și limbaj ofensator' = any (test.lib_published())), 'an archived procedure disappears for agents');
select test.fails(format($$select public.staff_procedure_new_version(%L, test.rid())$$, current_setting('test.p_abuse')), 'procedure_not_found',
  'and cannot be changed by them');
select test.login(test.id('admin'));
select public.admin_procedure_archive(current_setting('test.p_abuse')::uuid, false, test.rid());
select test.eq((select status from test.t_procedures() where id = current_setting('test.p_abuse')::uuid), 'published', 'restored as published');

-- Discarding a draft: a procedure never approved goes with it; one with history keeps its versions.
select test.as_agent();
select set_config('test.tmp', (public.staff_procedure_create('{"category": "technical"}', test.content('{"title": "Ciornă de aruncat"}'), null, test.rid())->>'id'), true);
select test.eq(public.staff_procedure_step(test.open_version(current_setting('test.tmp')::uuid), 'discard', test.rid())->>'procedure_deleted', 'true',
  'a draft never approved is discarded with its procedure');
select set_config('test.v3', (public.staff_procedure_new_version(current_setting('test.p_escal')::uuid, test.rid())->>'version_id'), true);
select public.staff_procedure_step(current_setting('test.v3')::uuid, 'discard', test.rid());
select test.eq((select count(*) from test.t_versions() where procedure_id = current_setting('test.p_escal')::uuid), 1::bigint,
  'a discarded new version leaves the approved one');

-- ------------------------------------------------------------------ responsibles
select test.login(test.id('admin'));
select test.fails($$select public.admin_procedure_set_responsible('access', test.id('client_a'), test.rid())$$, 'assignee_invalid',
  'a client is never responsible');
select test.fails($$select public.admin_procedure_set_responsible('nope', null, test.rid())$$, 'field_invalid', 'an unknown category refused');
select public.admin_procedure_set_responsible('security', current_setting('test.agent')::uuid, test.rid());
select test.eq((select x->'responsible'->>'display_id' from jsonb_array_elements(public.staff_procedures()->'categories') x where x->>'key' = 'security'),
  (select display_id from test.t_profiles() where id = current_setting('test.agent')::uuid), 'the responsible is listed with its category');
select test.ok((select bool_or(x->'responsible'->>'assigned_at' is not null) from jsonb_array_elements(public.staff_procedures()->'categories') x
                where x->>'key' = 'security'), 'with the date it was named');
select test.as_agent2();
select test.eq((select x->'responsible'->>'display_id' from jsonb_array_elements(public.staff_procedures()->'categories') x where x->>'key' = 'security'),
  (select display_id from test.t_profiles() where id = current_setting('test.agent')::uuid), 'every agent sees who is responsible');
-- The agent's role withdrawn: the category is marked, nobody else is named automatically.
select test.login(test.id('admin'));
select public.admin_revoke_support(current_setting('test.agent')::uuid, 'Plecat din echipă', test.rid());
select test.eq((select x->'responsible'->>'needs_reassignment' from jsonb_array_elements(public.staff_procedures()->'categories') x where x->>'key' = 'security'),
  'true', 'a responsible no longer in the team: the category needs a new one');
select test.eq((select user_id from test.t_resps() where category = 'security'), current_setting('test.agent')::uuid,
  'and nobody else was named in its place');
select public.admin_procedure_set_responsible('security', current_setting('test.agent2')::uuid, test.rid());
select test.eq((select x->'responsible'->>'needs_reassignment' from jsonb_array_elements(public.staff_procedures()->'categories') x where x->>'key' = 'security'),
  'false', 'named again by the admin');
select public.admin_procedure_set_responsible('accounts', null, test.rid());
select test.ok(not exists (select 1 from test.t_resps() where category = 'accounts'), 'a responsible removed');
select test.login(current_setting('test.agent')::uuid);
select test.fails($$select public.staff_procedures()$$, 'not_allowed', 'a former agent reads no procedure');

-- ------------------------------------------------------------------ next to a support request
select test.login(test.id('client_a'));
select set_config('test.req', (public.create_support_request('account', 'Nu mai pot intra', 'Cineva mi-a schimbat parola contului.', null, test.rid())->>'id'), true);
select test.fails(format($$select public.support_procedures_for_request(%L)$$, current_setting('test.req')), 'not_allowed',
  'the author never sees the team''s procedures');
select test.as_agent2();
select test.eq((select string_agg(x->'published'->>'title_ro', ', ' order by x->'published'->>'title_ro')
                from jsonb_array_elements(public.support_procedures_for_request(current_setting('test.req')::uuid)) x),
  'Abuz și limbaj ofensator, Cont compromis, Escaladarea unei solicitări, Procedură de test completată',
  'the published procedures for the request''s category (and only those)');
select test.fails($$select public.support_procedures_for_request(gen_random_uuid())$$, 'request_not_found', 'an unknown request');
select test.login(test.id('admin'));
select public.admin_place_legal_hold(current_setting('test.req')::uuid, null, 'litigation',
  'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1/2026', null, test.rid());
select test.ok(jsonb_array_length(public.support_procedures_for_request(current_setting('test.req')::uuid)) >= 1, 'the admin still sees them');
select test.as_agent2();
select test.fails(format($$select public.support_procedures_for_request(%L)$$, current_setting('test.req')), 'request_not_found',
  'a request under legal hold does not exist for an agent');
-- Nothing of A3 changed: the request is still the same request.
select test.login(test.id('admin'));
select test.eq((select status from test.t_suggestions() where id = current_setting('test.req')::uuid), 'new', 'the request itself is untouched');

-- ------------------------------------------------------------------ the audit log
select test.eq((select string_agg(distinct action, ',' order by action) from test.t_audit() where entity_type in ('procedure', 'procedure_category')),
  'acknowledge_procedure,approve_procedure,archive_procedure,create_procedure,discard_procedure_draft,new_procedure_version,publish_procedure,'
  || 'restore_procedure,return_procedure_draft,save_procedure_draft,set_procedure_responsible,submit_procedure,update_procedure_settings',
  'every kind of write is in the audit log');
select test.eq((select count(*) from test.t_audit() where entity_id = current_setting('test.mine') and action = 'save_procedure_draft'), 2::bigint,
  'each saved draft is logged');
select test.ok(not exists (select 1 from test.t_audit() where entity_type = 'procedure'
                           and (coalesce(after, '{}')::text like '%"steps"%' or coalesce(after, '{}')::text like '%applies_when%')),
  'the log never keeps the long texts');
select test.ok((select bool_and(actor_display_id is not null) from test.t_audit() where entity_type = 'procedure'), 'each entry names who did it');
reset role;
select test.ok(exists (select 1 from public.audit_action_classes where action = 'approve_procedure' and class = 'admin'), 'the actions have an audit class');

-- ------------------------------------------------------------------ the rollback refuses once real data exists
\set rb `cat supabase/rollback/20261112120000_procedures.sql`
select test.fails(:'rb', 'Refused', 'the rollback refuses to delete what people wrote');
select test.ok(to_regclass('public.procedures') is not null and (select version from public.schema_version) >= 118, 'and changes nothing');

rollback;
