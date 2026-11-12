-- A3c2b2 — the audit log: every action classified; secrets and the keys an action must not keep removed
-- from every new row (never refused); an account deleted or anonymised: its name, email and phone out of
-- the newer rows about it (not under a legal hold); the two log jobs disabled, admin_log locked until the
-- legal validation; rows older than the cutoff never touched; held rows exempt; the preview read-only
-- and exact; the privacy report: numbers only, admin only.
begin;
select test.make_world();

create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;
select set_config('test.ag', test.sign_up('agent-log@test.local', '{"role":"client","name":"Agent Jurnal","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agent-log@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('58000000-0000-4000-8000-000000000001', current_setting('test.ag')::uuid);
create function test.as_agent() returns void language sql as $$
  select test.login_session(current_setting('test.ag')::uuid, '58000000-0000-4000-8000-000000000001')
$$;
grant execute on function test.as_agent() to public;

-- A log row as an older version of the app wrote it: no trigger runs (no scrub).
create function test.raw_log(p_action text, p_entity_type text, p_entity_id text, p_after jsonb, p_at timestamptz,
  p_before jsonb default null) returns uuid
language plpgsql security definer as $$
declare
  v uuid;
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (test.id('admin'), p_action, p_entity_type, p_entity_id, p_before, p_after, p_at) returning id into v;
  perform set_config('session_replication_role', 'origin', true);
  return v;
end
$$;
grant execute on function test.raw_log(text, text, text, jsonb, timestamptz, jsonb) to public;

create function test.row_of(p uuid) returns public.admin_audit_log language sql security definer as $$
  select * from public.admin_audit_log where id = p
$$;
grant execute on function test.row_of(uuid) to public;

create function test.digest() returns text language plpgsql security definer as $$
declare
  t record;
  h text;
  acc text := '';
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('public', 'storage') order by 1, 2 loop
    execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from %I.%I x', t.schemaname, t.tablename) into h;
    acc := acc || t.tablename || ':' || h || ';';
  end loop;
  return md5(acc);
end
$$;
grant execute on function test.digest() to public;

-- ------------------------------------------------------------------ the classes and the install
-- Every action a database function writes has a class: the literals of the audit helpers and of the
-- direct inserts, plus the ones chosen by a CASE.
select test.eq(coalesce(string_agg(distinct m[1], ', '), ''), '', 'every action written by a function has a class')
from pg_proc p,
     lateral regexp_matches(p.prosrc, '(?:staff_audit|admin_audit|admin_audit_key)\(\s*''([a-z_]+)''', 'g') m
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from public.audit_action_classes c where c.action = m[1]);
select test.eq(coalesce(string_agg(distinct m[1], ', '), ''), '', 'and every action inserted directly')
from pg_proc p,
     lateral regexp_matches(p.prosrc, 'insert into public\.admin_audit_log\s*\([^)]*\)\s*values\s*\(\s*[^,]+,\s*''([a-z_]+)''', 'g') m
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from public.audit_action_classes c where c.action = m[1]);
select test.eq(count(*), 7::bigint, 'and the ones a CASE chooses')
from public.audit_action_classes
where action in ('suspend_account', 'unsuspend_account', 'suspend_shop', 'unsuspend_shop', 'keep_review', 'move_category', 'move_service');
select test.eq(public.audit_class('never_seen_action'), 'admin', 'an action without a class gets the longer period');
select test.ok(not has_table_privilege(r, 'public.audit_action_classes', 'select'), format('%s cannot read the classes', r))
from unnest(array['anon', 'authenticated', 'service_role']) r;
select test.eq((select string_agg(key || ':' || enabled || ':' || coalesce(locked_reason, '-'), ',' order by key)
                from public.retention_jobs where key in ('support_log', 'admin_log')),
  'admin_log:false:legal_validation,support_log:false:-', 'both log jobs off; admin_log locked for the legal validation');
select test.ok(p.provolatile = 's', format('%s cannot write', p.proname))
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('audit_preview_counts', 'retention_counts', 'admin_retention_preview', 'audit_privacy_report', 'admin_audit_privacy_report');

-- ------------------------------------------------------------------ secrets out of new rows
insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, reason)
values (test.id('admin'), 'update_settings', 'settings', null,
        '{"password": "x", "display_id": "C-00012"}',
        '{"nested": {"token": "abc", "v": "sk_live_abcdefgh12"}, "list": ["ok", "parola: Secret123"],
          "file_id": "5f0c1d2e-aaaa-bbbb-cccc-123456789012", "path": "5f0c1d2e-aaaa-bbbb-cccc-123456789012/5f0c1d2e-aaaa-bbbb-cccc-123456789013",
          "trial_days": 90, "price": "149 lei"}',
        'Motiv: parola: Secret123');
select test.eq(l.before, '{"display_id": "C-00012"}'::jsonb, 'a key named like a password goes, the account code stays'),
       test.eq(l.after, '{"nested": {"v": "[eliminat]"}, "list": ["ok", "[eliminat]"], "file_id": "5f0c1d2e-aaaa-bbbb-cccc-123456789012",
                          "path": "5f0c1d2e-aaaa-bbbb-cccc-123456789012/5f0c1d2e-aaaa-bbbb-cccc-123456789013", "trial_days": 90, "price": "149 lei"}'::jsonb,
               'nested keys and values that look like secrets go; ids, paths, numbers and prices stay'),
       test.eq(l.reason, '[eliminat]', 'the reason too'),
       test.eq(l.redacted, array['before.password', 'after.list[1]', 'after.nested.v', 'after.nested.token', 'reason'],
               'the removed paths are recorded')
from public.admin_audit_log l where l.action = 'update_settings' and l.reason = '[eliminat]';
insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
values (test.id('admin'), 'delete_account', 'profile', gen_random_uuid()::text,
        '{"display_id": "C-00099", "role": "client", "name": "Ion Pop", "email": "ion@ex.ro"}', '{"mode": "delete"}'),
       (test.id('admin'), 'open_request_file', 'suggestion', gen_random_uuid()::text, null, '{"file_id": "x", "file_name": "Ion Pop CI.pdf"}');
select test.eq(l.before, '{"display_id": "C-00099", "role": "client"}'::jsonb, 'a deleted account: only its code and role'),
       test.eq(l.redacted, array['before.name', 'before.email'], 'its name and email recorded as removed')
from public.admin_audit_log l where l.action = 'delete_account' and l.before->>'display_id' = 'C-00099';
select test.eq(l.after, '{"file_id": "x"}'::jsonb, 'an opened file: no file name')
from public.admin_audit_log l where l.action = 'open_request_file' and l.after->>'file_id' = 'x';
select test.ok(not exists (select 1 from public.admin_audit_log where redacted is not null and created_at < public.audit_retention_cutoff()),
  'no older row was written');

-- ------------------------------------------------------------------ an account goes
select set_config('test.gone', test.sign_up('plecat@test.local', '{"role":"client","name":"Maria Plecată","lang":"ro","terms_version":"2026-09"}')::text, true);
update public.profiles set phone = '+40722111222' where id = current_setting('test.gone')::uuid;
select set_config('test.r_new', test.raw_log('verify_phone', 'profile', current_setting('test.gone'),
  '{"phone": "+40722111222", "name": "Maria Plecată", "display_id": "C-07777"}', now())::text, true);
select set_config('test.r_search', test.raw_log('support_search', 'search', null, '{"q": "plecat@test.local", "results": 1}', now())::text, true);
select set_config('test.r_phone', test.raw_log('support_search', 'search', null, '{"q": "0722 111 222", "results": 1}', now())::text, true);
select set_config('test.r_other', test.raw_log('support_search', 'search', null, '{"q": "Altcineva", "results": 0}', now())::text, true);
select set_config('test.r_old', test.raw_log('verify_phone', 'profile', current_setting('test.gone'),
  '{"phone": "+40722111222", "name": "Maria Plecată"}', public.audit_retention_cutoff() - interval '1 day')::text, true);
-- The app's path (delete-account, admin-delete-account): prepare_account_deletion, then the Auth user.
select public.prepare_account_deletion(current_setting('test.gone')::uuid);
delete from auth.users where id = current_setting('test.gone')::uuid;
select test.eq((test.row_of(current_setting('test.r_new')::uuid)).after, '{"display_id": "C-07777"}'::jsonb,
  'deleted: its name and phone leave the newer rows about it, its code stays'),
       test.eq((test.row_of(current_setting('test.r_new')::uuid)).redacted, array['after.name', 'after.phone'], 'recorded as removed');
select test.eq((test.row_of(current_setting('test.r_search')::uuid)).after, '{"results": 1}'::jsonb, 'a search for its email loses the words'),
       test.eq((test.row_of(current_setting('test.r_phone')::uuid)).after, '{"results": 1}'::jsonb, 'a search for its phone too');
select test.eq((test.row_of(current_setting('test.r_other')::uuid)).after, '{"q": "Altcineva", "results": 0}'::jsonb, 'other searches stay');
select test.eq((test.row_of(current_setting('test.r_old')::uuid)).after, '{"phone": "+40722111222", "name": "Maria Plecată"}'::jsonb,
  'a row older than the cutoff is not touched (A3c2b3, separate approval)');

-- Anonymised (a shop with records): the same at deleted_at.
select set_config('test.r_shop', test.raw_log('update_shop', 'shop', test.id('shop2')::text,
  '{"shop_name": "Service Doi", "owner_name": "Proprietar Doi", "city": "Brașov"}', now())::text, true);
update public.profiles set deleted_at = now() where id = test.id('owner2');
select test.eq((test.row_of(current_setting('test.r_shop')::uuid)).after, '{"city": "Brașov"}'::jsonb,
  'an anonymised shop: its name and its owner''s leave the newer rows about the shop');

-- Under a legal hold: nothing changes (the identifiers are kept for the hold).
select set_config('test.held', test.sign_up('pastrat@test.local', '{"role":"client","name":"Ana Păstrată","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.r_held', test.raw_log('support_view_account', 'profile', current_setting('test.held'), '{"name": "Ana Păstrată"}', now())::text, true);
select test.login(test.id('admin'));
select public.admin_place_legal_hold(null, (select display_id from public.profiles where id = current_setting('test.held')::uuid), 'litigation',
  'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1234/180/2026', null, test.rid());
select test.logout();
delete from auth.users where id = current_setting('test.held')::uuid;
select test.eq((test.row_of(current_setting('test.r_held')::uuid)).after, '{"name": "Ana Păstrată"}'::jsonb, 'an account under a legal hold: its rows stay whole');

-- ------------------------------------------------------------------ the log jobs
-- The cutoff moved into the past for this test only (it is a constant of the migration), with rows
-- older than it.
select set_config('test.cut', (now() - interval '5 years')::text, true);
do $$
begin
  execute format('create or replace function public.audit_retention_cutoff() returns timestamptz language sql immutable set search_path = '''' as $b$ select %L::timestamptz $b$',
    current_setting('test.cut'));
end
$$;
delete from public.admin_audit_log;
-- support
select set_config('test.s_old', test.raw_log('support_view_request', 'suggestion', gen_random_uuid()::text, null, now() - interval '12 months 1 minute')::text, true);
select set_config('test.s_young', test.raw_log('support_view_request', 'suggestion', gen_random_uuid()::text, null, now() - interval '12 months -1 minute')::text, true);
select set_config('test.q_old', test.raw_log('support_search', 'search', null, '{"q": "Ion", "results": 2}', now() - interval '90 days 1 minute')::text, true);
select set_config('test.q_young', test.raw_log('support_search', 'search', null, '{"q": "Ana", "results": 1}', now() - interval '89 days')::text, true);
select set_config('test.s_legacy', test.raw_log('support_view_request', 'suggestion', gen_random_uuid()::text, null, now() - interval '6 years')::text, true);
select set_config('test.q_legacy', test.raw_log('support_search', 'search', null, '{"q": "Vechi", "results": 0}', now() - interval '6 years')::text, true);
insert into public.suggestions (author_id, author_role, title, body, category, status)
values (test.id('client_a'), 'client', 'Păstrată', 'Text', 'technical', 'new');
select set_config('test.req_held', (select id::text from public.suggestions where title = 'Păstrată' and author_id = test.id('client_a')), true);
select set_config('test.s_held', test.raw_log('support_view_request', 'suggestion', current_setting('test.req_held'), null, now() - interval '13 months')::text, true);
-- admin, security, legal
select set_config('test.a_old', test.raw_log('update_settings', 'settings', null, '{"trial_days": 30}', now() - interval '3 years 1 day')::text, true);
select set_config('test.a_young', test.raw_log('suspend_account', 'profile', gen_random_uuid()::text, null, now() - interval '2 years')::text, true);
select test.login(test.id('admin'));
select set_config('test.hold', (public.admin_place_legal_hold(current_setting('test.req_held')::uuid, null, 'litigation',
  'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1234/180/2026', null, test.rid()))->>'id', true);
select test.logout();
select set_config('test.l_active', test.raw_log('view_legal_hold', 'legal_hold', current_setting('test.hold'), null, now() - interval '4 years')::text, true);
delete from public.admin_audit_log where action = 'place_legal_hold';

select test.login(test.id('admin'));
select set_config('test.d0', test.digest(), true);
select set_config('test.p_support', (public.admin_retention_preview('support_log'))::text, true);
select set_config('test.p_admin', (public.admin_retention_preview('admin_log'))::text, true);
select test.eq(test.digest(), current_setting('test.d0'), 'the previews change nothing');
select test.eq(p->'counts'->'eligible', '{"total": 1, "by_class": {"support": 1}, "search_terms": 1}'::jsonb,
               'support: one row past 12 months, one search past 90 days'),
       test.eq(p->'counts'->'exempt', '{"legal_hold": 1, "legal_active": 0, "before_cutoff": 2}'::jsonb,
               'apart: a row of a held request, two rows older than the cutoff')
from (select current_setting('test.p_support')::jsonb p) x;
select test.eq(p->'counts'->'eligible', '{"total": 1, "by_class": {"admin": 1}, "search_terms": 0}'::jsonb, 'admin: one row past 3 years'),
       test.eq(p->'counts'->'exempt'->>'legal_active', '1', 'a row of an active hold waits for its release')
from (select current_setting('test.p_admin')::jsonb p) x;

-- admin_log is locked: nobody switches it on.
select test.eq(test.error_of($$select public.admin_set_retention_job('admin_log', true, 'Încercare de activare', 50,
  (public.admin_retention_preview('admin_log'))->'counts', test.rid())$$), 'job_locked', 'admin_log cannot be switched on');
select test.logout();
select test.eq(test.error_of($$select set_config('sh.retention_switch', 'on', true); update public.retention_jobs set enabled = true where key = 'admin_log'$$),
  'job_locked', 'not even by a direct update with the switch');
select test.eq(public.run_audit_retention('admin_log'), null::jsonb, 'its run does nothing');
select test.eq(public.run_audit_retention('support_log'), null::jsonb, 'support_log off: nothing');
select test.eq(test.digest(), current_setting('test.d0'), 'not one row changed');

-- support_log on, a batch of one.
select test.as_agent();
select test.fails($$select public.admin_set_retention_job('support_log', true, 'Motiv suficient de lung', 1,
  (public.admin_retention_preview('support_log'))->'counts', test.rid())$$, 'not_allowed', 'an agent cannot switch it');
select test.login(test.id('admin'));
select test.eq(r->>'enabled', 'true', 'the admin switches support_log on with the exact numbers')
from public.admin_set_retention_job('support_log', true, 'Activare aprobată de Eduard pentru jurnalul de suport', 1,
  (public.admin_retention_preview('support_log'))->'counts', test.rid()) r;
select test.logout();
select test.eq(r, '{"remaining": 0, "deleted_log_rows": 1, "removed_search_terms": 1}'::jsonb, 'one search loses its words, one row goes')
from public.run_audit_retention('support_log', now() + interval '10 years') r;
select test.eq((test.row_of(current_setting('test.q_old')::uuid)).after, '{"results": 2}'::jsonb, 'the words of a search 90 days old go'),
       test.eq((test.row_of(current_setting('test.q_old')::uuid)).redacted, array['after.q'], 'recorded'),
       test.eq((test.row_of(current_setting('test.q_young')::uuid)).after->>'q', 'Ana', 'at 89 days they stay'),
       test.ok((test.row_of(current_setting('test.s_old')::uuid)).id is null, 'a support row past 12 months goes'),
       test.ok((test.row_of(current_setting('test.s_young')::uuid)).id is not null, 'one minute short of it stays'),
       test.ok((test.row_of(current_setting('test.s_held')::uuid)).id is not null, 'a row of a held request stays'),
       test.ok((test.row_of(current_setting('test.s_legacy')::uuid)).id is not null, 'an older row than the cutoff stays'),
       test.eq((test.row_of(current_setting('test.q_legacy')::uuid)).after->>'q', 'Vechi', 'with its words'),
       test.ok((test.row_of(current_setting('test.a_old')::uuid)).id is not null, 'admin rows are not this job''s');
select test.eq((select count(*) from public.retention_runs where job = 'support_log'), 1::bigint, 'the run recorded'),
       test.eq((select after->>'deleted_log_rows' from public.admin_audit_log where action = 'retention_run' and entity_id = 'support_log'), '1',
               'and audited with its numbers');

-- admin_log once unlocked (what a later migration does after the legal validation).
update public.retention_jobs set locked_reason = null where key = 'admin_log';
select test.login(test.id('admin'));
select public.admin_set_retention_job('admin_log', true, 'Activare după validarea juridică a termenului', 50,
  (public.admin_retention_preview('admin_log'))->'counts', test.rid());
select test.logout();
select public.run_audit_retention('admin_log');
select test.ok((test.row_of(current_setting('test.a_old')::uuid)).id is null, 'an admin row past 3 years goes'),
       test.ok((test.row_of(current_setting('test.a_young')::uuid)).id is not null, 'a security row of 2 years stays'),
       test.ok((test.row_of(current_setting('test.l_active')::uuid)).id is not null, 'a row of an active hold stays, however old');

-- ------------------------------------------------------------------ the report
select test.raw_log('delete_account', 'profile', gen_random_uuid()::text,
  '{"name": "Ion Pop", "email": "ion@ex.ro", "display_id": "C-00042"}', now() - interval '6 years', null);
select test.raw_log('verify_phone_manually', 'profile', test.id('client_a')::text,
  '{"phone": "+40722333444"}', now() - interval '6 years', null);
select test.raw_log('update_settings', 'settings', null, '{"note": "parola: Secret123"}', now() - interval '6 years', null);
select test.login(test.id('admin'));
select set_config('test.d1', test.digest(), true);
select set_config('test.report', public.admin_audit_privacy_report()::text, true);
select test.eq(test.digest(), current_setting('test.d1'), 'the report changes nothing');
select test.ok((r->'totals'->>'names')::int >= 1 and (r->'totals'->>'emails')::int >= 1, 'names and emails counted'),
       test.ok((r->'totals'->>'phones')::int >= 1, 'phones counted'),
       test.ok((r->'totals'->>'secrets')::int >= 1, 'secrets counted'),
       test.ok((r->'totals'->>'search_terms')::int >= 2, 'search words counted'),
       test.ok((r->'totals'->>'deleted_accounts')::int >= 1, 'rows of deleted accounts counted'),
       test.ok((r->>'legacy_rows')::int >= 5, 'older rows included'),
       test.ok(r::text not like '%Ion Pop%' and r::text not like '%ion@ex.ro%' and r::text not like '%Secret123%'
               and r::text not like '%722333444%' and r::text not like '%Vechi%', 'numbers only, never a value')
from (select current_setting('test.report')::jsonb r) x;
select test.as_agent();
select test.fails($$select public.admin_audit_privacy_report()$$, 'not_allowed', 'an agent cannot read it');
select test.login(test.id('client_a'));
select test.fails($$select public.admin_audit_privacy_report()$$, 'not_allowed', 'nor a client');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_audit_privacy_report()$$, 'mfa_required', 'the admin needs the second step');

rollback;
