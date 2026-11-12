-- A3c2b1 — retention of support requests and anonymisation of suggestions: the real activity date
-- (what moves it and what never does), the jobs disabled after the migration, the preview that cannot
-- change anything and whose numbers are exactly what the run does, the admin-only switch (second
-- step, reason, the numbers confirmed, every step audited), the legal hold exceptions, the deletion
-- of a request whole and nothing else, the anonymous statistics, the suggestions' review (agent or
-- admin, 30 days, confirm / edit / remove), the batch and a failing row that undoes no other.
begin;
select test.make_world();

-- ------------------------------------------------------------------ helpers
create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;

select set_config('test.ag', test.sign_up('agent-ret@test.local', '{"role":"client","name":"Agent Retentie","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agent-ret@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('56000000-0000-4000-8000-000000000001', current_setting('test.ag')::uuid);
create function test.as_agent(p_aal text default 'aal2') returns void language sql as $$
  select test.login_session(current_setting('test.ag')::uuid, '56000000-0000-4000-8000-000000000001', p_aal)
$$;
grant execute on function test.as_agent(text) to public;

-- The last real activity, read past every grant.
create function test.activity(p uuid) returns timestamptz language sql security definer as $$
  select last_activity_at from public.suggestions where id = p
$$;
grant execute on function test.activity(uuid) to public;
create function test.status(p uuid) returns text language sql security definer as $$
  select status from public.suggestions where id = p
$$;
grant execute on function test.status(uuid) to public;

-- Moves a request's last activity into the past, past every trigger (a test fixture, not a path the
-- app has).
create function test.age(p uuid, p_ago interval) returns void language plpgsql security definer as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.suggestions set last_activity_at = now() - p_ago where id = p;
  perform set_config('session_replication_role', 'origin', true);
end
$$;
grant execute on function test.age(uuid, interval) to public;

-- A request with a message from each side, a note and a file, written straight into the tables, then
-- aged.
create function test.request(p_author uuid, p_title text, p_status text, p_ago interval,
  p_category text default 'technical', p_body text default null)
returns uuid language plpgsql security definer as $$
declare
  v uuid;
  v_msg uuid;
  v_path text := p_author::text || '/' || gen_random_uuid()::text;
begin
  insert into public.suggestions (author_id, author_role, title, body, category, status, closed_at, resolved_at,
                                  first_response_at, escalated_at, created_at)
  values (p_author, (select role from public.profiles where id = p_author), p_title, coalesce(p_body, 'Text ' || p_title),
          p_category, p_status,
          case when p_status = 'closed' then now() - p_ago end,
          case when p_status in ('resolved', 'closed') then now() - p_ago - interval '1 hour' end,
          now() - p_ago - interval '2 hours', null, now() - p_ago - interval '3 hours')
  returning id into v;
  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body) values (v, p_author, false, 'De la autor');
  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body)
  values (v, test.id('admin'), true, 'De la echipă') returning id into v_msg;
  insert into public.suggestion_notes (suggestion_id, author_id, author_display_id, body)
  values (v, test.id('admin'), 'A-00001', 'Notă internă');
  insert into storage.objects (bucket_id, name, owner) values ('support-files', v_path, null);
  insert into public.suggestion_files (suggestion_id, message_id, uploaded_by, from_staff, path, mime, size, name, sha256, attached_at)
  values (v, v_msg, p_author, false, v_path, 'image/png', 10, 'poza.png', repeat('a', 64), now());
  perform test.age(v, p_ago);
  return v;
end
$$;
grant execute on function test.request(uuid, text, text, interval, text, text) to public;

create function test.parts(p_request uuid) returns bigint language sql security definer as $$
  select (select count(*) from public.suggestions where id = p_request)
       + (select count(*) from public.suggestion_messages where suggestion_id = p_request)
       + (select count(*) from public.suggestion_notes where suggestion_id = p_request)
       + (select count(*) from public.suggestion_files where suggestion_id = p_request)
$$;
grant execute on function test.parts(uuid) to public;

-- Every row of every table of the given schemas, as one hash (tables in p_skip left out).
create function test.digest(p_skip text[] default '{}') returns text language plpgsql security definer as $$
declare
  t record;
  h text;
  acc text := '';
begin
  for t in select schemaname, tablename from pg_tables
           where schemaname in ('public', 'storage') and not (tablename = any (p_skip))
           order by schemaname, tablename loop
    execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from %I.%I x', t.schemaname, t.tablename) into h;
    acc := acc || t.tablename || ':' || h || ';';
  end loop;
  return md5(acc);
end
$$;
grant execute on function test.digest(text[]) to public;

create function test.place(p_request uuid, p_account text) returns jsonb language sql as $$
  select public.admin_place_legal_hold(p_request, p_account, 'litigation',
    'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1234/180/2026', null, test.rid())
$$;
grant execute on function test.place(uuid, text) to public;

create function test.switch(p_job text, p_on boolean, p_batch int default null) returns jsonb language sql as $$
  select public.admin_set_retention_job(p_job, p_on, 'Activare aprobată de Eduard, previzualizare verificată', p_batch,
    case when p_on then (public.admin_retention_preview(p_job))->'counts' end, test.rid())
$$;
grant execute on function test.switch(text, boolean, int) to public;

-- ------------------------------------------------------------------ the migration
select test.eq((select count(*) from public.retention_jobs where key in ('support_requests', 'suggestions')), 2::bigint, 'two jobs');
select test.eq((select count(*) from public.retention_jobs where enabled), 0::bigint, 'every job starts disabled');
select test.ok((select attnotnull from pg_attribute where attrelid = 'public.suggestions'::regclass and attname = 'last_activity_at'),
  'every request has its real activity date');
select test.ok(not has_table_privilege(r, 'public.' || t, 'select') and not has_table_privilege(r, 'public.' || t, 'update'),
  format('%s cannot read or change %s', r, t))
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['retention_jobs', 'retention_runs', 'support_stats_monthly', 'suggestions_anonymous']) t;
select test.ok(p.provolatile = 's', format('%s is stable: it cannot write', p.proname))
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('admin_retention_preview', 'retention_preview_counts', 'admin_list_retention_jobs',
                    'support_list_suggestion_reviews', 'admin_support_stats');

-- ------------------------------------------------------------------ real activity
select test.login(test.id('client_a'));
select set_config('test.r1', (public.create_support_request('technical', 'Nu merge ceva', 'Detalii despre problemă.', null, test.rid()))->>'id', true);
select test.logout();
select test.ok(test.activity(current_setting('test.r1')::uuid) is not null, 'a new request starts its activity');
select test.age(current_setting('test.r1')::uuid, '1 day');

create function test.moved(p_label text, p_expect boolean) returns void language plpgsql as $$
declare
  v_after timestamptz := test.activity(current_setting('test.r1')::uuid);
begin
  perform test.eq(v_after > now() - interval '1 hour', p_expect,
    case when p_expect then p_label || ' moves the real activity' else p_label || ' does not move the real activity' end);
  perform test.age(current_setting('test.r1')::uuid, '1 day');
end
$$;
grant execute on function test.moved(text, boolean) to public;

select test.as_agent();
select public.support_get_request(current_setting('test.r1')::uuid);
select test.moved('opening it (team)', false);
select public.support_take_request(current_setting('test.r1')::uuid, test.rid());
select test.eq(test.status(current_setting('test.r1')::uuid), 'in_progress', 'taken: in progress');
select test.moved('taking it (New → In progress)', false);
select public.support_add_note(current_setting('test.r1')::uuid, 'Notă internă de test', test.rid());
select test.moved('an internal note', false);
select public.support_assign_request(current_setting('test.r1')::uuid, test.id('admin'), test.rid());
select test.moved('assigning it', false);
select public.support_escalate_request(current_setting('test.r1')::uuid, 'Escaladare pentru verificarea plății', test.rid());
select test.moved('escalating it', false);
select test.login(test.id('admin'));
select public.admin_return_request(current_setting('test.r1')::uuid, 'Returnat agentului după verificare', test.rid());
select test.moved('returning it', false);
select public.support_reply_request(current_setting('test.r1')::uuid, 'Ce browser folosești?', 'waiting_user', test.rid());
select test.moved('a reply from the team', true);
select test.login(test.id('client_a'));
select public.get_my_support_request(current_setting('test.r1')::uuid);
select test.moved('the author reading it', false);
select public.reply_my_support_request(current_setting('test.r1')::uuid, 'Chrome pe Android.', test.rid());
select test.moved('a message from the author', true);
select test.login(test.id('admin'));
select public.support_set_request_status(current_setting('test.r1')::uuid, 'resolved', test.rid());
select test.moved('a state changed by a person', true);
select test.logout();
select public.close_resolved_support_requests(now() + interval '15 days');
select test.eq((select status from public.suggestions where id = current_setting('test.r1')::uuid), 'closed', 'the job closed it');
select test.moved('the automatic closing after 14 days', false);
update public.suggestions set last_activity_at = now() + interval '1 year', status = 'new' where id = current_setting('test.r1')::uuid;
select test.moved('a direct change of the date or the state without a signed-in person', false);
select test.login(test.id('client_a'));
select public.submit_suggestion('O idee pentru aplicație', test.rid());
select test.logout();
select test.ok(test.activity(id) > now() - interval '1 hour', 'a suggestion through the old app starts its activity')
from public.suggestions where body = 'O idee pentru aplicație';

-- The value saved at the migration for older rows.
select set_config('test.legacy', test.request(test.id('client_b'), 'Veche', 'closed', '400 days')::text, true);
select test.eq(public.support_initial_activity(s), now(),
  'an older request: its latest message or file (not its closing)')
from public.suggestions s where s.id = current_setting('test.legacy')::uuid;
update public.suggestion_messages set created_at = now() - interval '500 days' where suggestion_id = current_setting('test.legacy')::uuid;
update public.suggestion_files set attached_at = now() - interval '500 days' where suggestion_id = current_setting('test.legacy')::uuid;
update public.suggestions set last_user_message_at = now() - interval '500 days' where id = current_setting('test.legacy')::uuid;
select test.eq(public.support_initial_activity(s), s.resolved_at, 'else its resolution')
from public.suggestions s where s.id = current_setting('test.legacy')::uuid;
insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, created_at)
values (test.id('admin'), 'set_request_status', 'suggestion', current_setting('test.legacy'), now() - interval '390 days'),
       (null, 'set_request_status', 'suggestion', current_setting('test.legacy'), now() - interval '10 days'),
       (test.id('admin'), 'take_request', 'suggestion', current_setting('test.legacy'), now() - interval '10 days');
select test.eq(public.support_initial_activity(s), now() - interval '390 days',
  'or a state change a person made (never a job''s, never a take)')
from public.suggestions s where s.id = current_setting('test.legacy')::uuid;
update public.suggestions set closed_at = now() - interval '1 day', updated_at = now() where id = current_setting('test.legacy')::uuid;
select test.eq(public.support_initial_activity(s), now() - interval '390 days', 'the closing and update dates never count')
from public.suggestions s where s.id = current_setting('test.legacy')::uuid;
delete from public.suggestions where id = current_setting('test.legacy')::uuid;
delete from public.suggestions where body = 'O idee pentru aplicație';

-- ------------------------------------------------------------------ disabled: nothing happens
select set_config('test.old_closed', test.request(test.id('client_a'), 'Veche închisă', 'closed', '12 months 1 minute')::text, true);
select set_config('test.old_open', test.request(test.id('client_a'), 'Veche deschisă', 'new', '13 months')::text, true);
select set_config('test.recent', test.request(test.id('client_a'), 'Aproape', 'closed', '12 months -1 minute')::text, true);
select set_config('test.held_req', test.request(test.id('client_a'), 'Păstrată', 'closed', '14 months')::text, true);
select set_config('test.held_acc', test.request(test.id('client_b'), 'Cont păstrat', 'waiting_user', '15 months')::text, true);
select set_config('test.sug_old', test.request(test.id('client_a'), null, 'planned', '13 months', 'suggestions',
  'Ideea mea: sunați-mă la 0722 123 456 sau scrieți la ana.pop@gmail.com pentru B 123 ABC')::text, true);
select set_config('test.sug_recent', test.request(test.id('client_b'), null, 'new', '2 months', 'suggestions', 'Altă idee')::text, true);
insert into public.notification_events (user_id, event, params, channels)
values (test.id('client_a'), 'support_reply', jsonb_build_object('request_id', current_setting('test.old_closed'), 'title', 'Veche închisă'), array['push']),
       (null, 'support_escalated', jsonb_build_object('request_id', current_setting('test.old_open'), 'title', 'Veche deschisă'), array['email']),
       (test.id('client_a'), 'support_reply', jsonb_build_object('request_id', current_setting('test.recent'), 'title', 'Aproape'), array['push']);
select test.login(test.id('admin'));
select test.place(current_setting('test.held_req')::uuid, null);
select test.place(null, (select display_id from public.profiles where id = test.id('client_b')));
select test.logout();

select set_config('test.d0', test.digest(), true);
select test.eq(public.run_support_retention(), null::jsonb, 'a disabled job does nothing');
select test.eq(public.run_suggestion_anonymization(), null::jsonb, 'nor the suggestions'' job');
select test.eq(test.digest(), current_setting('test.d0'), 'not one row changed, no run recorded');

-- ------------------------------------------------------------------ the preview
select test.login(test.id('admin'));
select set_config('test.d1', test.digest(), true);
select set_config('test.preview', (public.admin_retention_preview('support_requests'))::text, true);
select set_config('test.preview_s', (public.admin_retention_preview('suggestions'))::text, true);
select public.admin_list_retention_jobs();
select test.eq(test.digest(), current_setting('test.d1'), 'previews and the job list change nothing (not even an audit row)');
select test.eq(p->'counts'->'eligible'->>'total', '2', 'requests: two are due (any state)'),
       test.eq(p->'counts'->'eligible'->'by_status', '{"new": 1, "closed": 1}'::jsonb, 'by state'),
       test.eq(p->'counts'->'eligible'->>'messages', '4', 'their messages'),
       test.eq(p->'counts'->'eligible'->>'notes', '2', 'their notes'),
       test.eq(p->'counts'->'eligible'->>'files', '2', 'their files'),
       test.eq(p->'counts'->'eligible'->>'notifications', '2', 'their notifications'),
       test.eq(p->'counts'->'exempt'->>'legal_hold', '2', 'two kept by a legal hold, apart'),
       test.eq(p->'counts'->'exempt'->>'legal_hold_request', '1', 'one by a hold on the request'),
       test.eq(p->'counts'->'exempt'->>'legal_hold_account', '1', 'one by a hold on the account'),
       test.eq(p->'counts'->'exempt'->>'author_deleted', '0', 'no author deleted'),
       test.ok((p->'counts'->>'next_due_at')::timestamptz <= now() + interval '1 minute', 'the next one is due within a minute'),
       test.eq(p->>'enabled', 'false', 'the job is off')
from (select current_setting('test.preview')::jsonb p) x;
select test.eq(p->'counts'->'eligible'->>'total', '1', 'suggestions: one is due'),
       test.eq(p->'counts'->'findings', '{"email": 1, "phone": 1, "plate": 1}'::jsonb, 'what its text holds'),
       test.eq(p->'counts'->'reviews'->>'pending', '0', 'no review yet')
from (select current_setting('test.preview_s')::jsonb p) x;

-- ------------------------------------------------------------------ the switch
select test.as_agent();
select test.fails($$select public.admin_retention_preview('support_requests')$$, 'not_allowed', 'an agent cannot preview');
select test.fails($$select test.switch('support_requests', true)$$, 'not_allowed', 'nor switch a job');
select test.login(test.id('client_a'));
select test.fails($$select public.admin_list_retention_jobs()$$, 'not_allowed', 'nor a client');
select test.login(test.id('owner1'));
select test.fails($$select public.admin_retention_preview('suggestions')$$, 'not_allowed', 'nor a shop');
select test.login_anon();
select test.fails($$select public.admin_list_retention_jobs()$$, 'permission denied', 'nor a visitor');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_retention_preview('support_requests')$$, 'mfa_required', 'the admin needs the second step');
select test.login(test.id('admin'));
select test.eq(test.error_params($$select public.admin_set_retention_job('support_requests', true, 'scurt', null,
  (public.admin_retention_preview('support_requests'))->'counts', test.rid())$$)->>'field', 'reason', 'a reason is required');
select test.eq(test.error_of($$select public.admin_set_retention_job('support_requests', true, 'Aprobat, parola: Secret123!', null,
  (public.admin_retention_preview('support_requests'))->'counts', test.rid())$$), 'secret_in_text', 'and holds no secret');
select test.eq(test.error_params($$select public.admin_set_retention_job('nope', true, 'Motiv suficient de lung', null, '{}', test.rid())$$)->>'field',
  'job', 'only the known jobs');
select test.eq(test.error_of($$select public.admin_set_retention_job('support_requests', true, 'Motiv suficient de lung', null, null, test.rid())$$),
  'preview_changed', 'switching on needs the numbers of the preview');
select test.eq(test.error_params(format($$select public.admin_set_retention_job('support_requests', true, 'Motiv suficient de lung', null, %L, test.rid())$$,
  jsonb_set(current_setting('test.preview')::jsonb->'counts', '{eligible,total}', '1')))->'counts',
  current_setting('test.preview')::jsonb->'counts', 'other numbers: refused, with the numbers as they are now');
select test.eq(test.error_params($$select public.admin_set_retention_job('support_requests', true, 'Motiv suficient de lung', 900,
  (public.admin_retention_preview('support_requests'))->'counts', test.rid())$$)->>'field', 'batch_size', 'at most 500 a run');
select test.logout();
select test.eq((select count(*) from public.retention_jobs where enabled), 0::bigint, 'still off after every refusal');
select test.eq(test.error_of($$update public.retention_jobs set enabled = true where key = 'support_requests'$$), 'not_allowed',
  'a direct update cannot switch a job on');
select test.login(test.id('admin'));

-- The numbers changed between the preview and the switch: refused.
select set_config('test.p_before', (public.admin_retention_preview('support_requests'))->>'counts', true);
select test.age(current_setting('test.recent')::uuid, '12 months 1 minute');
select test.eq(test.error_of(format($$select public.admin_set_retention_job('support_requests', true, 'Motiv suficient de lung', 1, %L, test.rid())$$,
  current_setting('test.p_before'))), 'preview_changed', 'a request became due after the preview: refused');
select test.age(current_setting('test.recent')::uuid, '12 months -1 minute');

select test.eq(r->>'enabled', 'true', 'the admin switches the requests job on with the exact numbers')
from test.switch('support_requests', true, 1) r;
select test.logout();
select test.eq((select count(*) from public.retention_jobs where enabled), 1::bigint, 'one job on');
select test.eq(a.after->'counts', current_setting('test.preview')::jsonb->'counts', 'the audit row holds the confirmed numbers'),
       test.eq(a.reason, 'Activare aprobată de Eduard, previzualizare verificată', 'and the reason'),
       test.eq(a.actor_role, 'admin', 'and who did it')
from public.admin_audit_log a where a.action = 'set_retention_job' and a.entity_id = 'support_requests';

-- ------------------------------------------------------------------ a run
select set_config('test.d2', test.digest(array['suggestions', 'suggestion_messages', 'suggestion_notes', 'suggestion_files',
  'support_file_deletions', 'notification_events', 'support_signals', 'support_stats_monthly', 'retention_runs', 'retention_jobs',
  'admin_audit_log', 'objects']), true);
select test.eq(r, '{"failed": 0, "remaining": 1, "deleted_files": 1, "deleted_requests": 1}'::jsonb, 'a batch of one: one deleted, one left')
from public.run_support_retention() r;
select test.eq(test.parts(current_setting('test.old_open')::uuid), 0::bigint, 'the oldest went first, whole (open, in any state)');
select test.eq(r, '{"failed": 0, "remaining": 0, "deleted_files": 1, "deleted_requests": 1}'::jsonb, 'the next run takes the next one')
from public.run_support_retention() r;
select test.eq(test.parts(current_setting('test.old_closed')::uuid), 0::bigint, 'the closed one: request, messages, notes, files gone');
select test.eq((select count(*) from public.notification_events where params->>'request_id' in (current_setting('test.old_closed'), current_setting('test.old_open'))),
  0::bigint, 'their notifications gone');
select test.eq((select count(*) from public.support_file_deletions where path like test.id('client_a')::text || '/%'), 2::bigint,
  'their Storage objects queued for deletion');
select test.eq(test.parts(current_setting('test.recent')::uuid), 5::bigint, 'one minute short of 12 months: kept');
select test.eq(test.parts(current_setting('test.held_req')::uuid), 5::bigint, 'a hold on the request: kept');
select test.eq(test.parts(current_setting('test.held_acc')::uuid), 5::bigint, 'a hold on the account: kept');
select test.eq(test.parts(current_setting('test.sug_old')::uuid), 5::bigint, 'the suggestions are not this job''s');
select test.eq((select count(*) from public.notification_events where params->>'request_id' = current_setting('test.recent')), 1::bigint,
  'other notifications kept');
select test.eq(test.digest(array['suggestions', 'suggestion_messages', 'suggestion_notes', 'suggestion_files',
  'support_file_deletions', 'notification_events', 'support_signals', 'support_stats_monthly', 'retention_runs', 'retention_jobs',
  'admin_audit_log', 'objects']), current_setting('test.d2'), 'nothing outside the support data changed');
select test.eq((select sum(requests) from public.support_stats_monthly), 2::bigint, 'the statistics count both'),
       test.eq((select sum(resolved) from public.support_stats_monthly), 1::bigint, 'one was resolved'),
       test.eq((select sum(first_response_minutes) from public.support_stats_monthly), 120::numeric, 'an hour to answer each'),
       test.eq((select string_agg(distinct category || '/' || author_role, ',') from public.support_stats_monthly), 'technical/client',
               'by category and role');
select test.eq((select string_agg(attname, ',' order by attnum) from pg_attribute
                where attrelid = 'public.support_stats_monthly'::regclass and attnum > 0 and not attisdropped),
  'month,category,author_role,requests,resolved,escalated,first_response_count,first_response_minutes,resolution_count,resolution_minutes',
  'the statistics have no column for an id, a person or a text');
select test.eq((select count(*) from public.retention_runs where job = 'support_requests'), 2::bigint, 'each run recorded'),
       test.eq((select count(*) from public.admin_audit_log where action = 'retention_run'), 2::bigint, 'and in the audit log'),
       test.ok(not exists (select 1 from public.admin_audit_log a where a.action = 'retention_run'
                           and (a.after::text like '%' || current_setting('test.old_closed') || '%' or a.after::text like '%Veche%')),
               'numbers only, no request named');

-- A failing row undoes no other.
select set_config('test.f1', test.request(test.id('client_a'), 'Eșuează', 'closed', '13 months')::text, true);
select set_config('test.f2', test.request(test.id('client_a'), 'Merge', 'closed', '12 months 2 days')::text, true);
create function test.refuse_f1() returns trigger language plpgsql as $$
begin
  if old.id = current_setting('test.f1')::uuid then
    raise exception 'test refusal';
  end if;
  return old;
end
$$;
create trigger test_refuse_f1 before delete on public.suggestions for each row execute function test.refuse_f1();
select test.login(test.id('admin'));
select test.switch('support_requests', true, 10);
select test.logout();
select test.eq(r, '{"failed": 1, "remaining": 1, "deleted_files": 1, "deleted_requests": 1}'::jsonb, 'one failed, the other went')
from public.run_support_retention() r;
select test.eq(test.parts(current_setting('test.f1')::uuid), 5::bigint, 'the failing one whole'),
       test.eq(test.parts(current_setting('test.f2')::uuid), 0::bigint, 'the other one gone');
drop trigger test_refuse_f1 on public.suggestions;

-- Switching off: a reason only, and at once.
select test.login(test.id('admin'));
select test.eq(r->>'enabled', 'false', 'switched off') from public.admin_set_retention_job('support_requests', false, 'Oprit pentru verificare', null, null, test.rid()) r;
select test.eq(test.error_of($$select public.admin_set_retention_job('support_requests', false, 'Oprit pentru verificare', null, null, test.rid())$$),
  'job_disabled', 'already off');
select test.logout();
select test.eq(public.run_support_retention(), null::jsonb, 'off: the next run does nothing');
update public.retention_jobs set enabled = false where key = 'support_requests';
select test.ok(true, 'switching off by hand (the emergency stop) is allowed');

-- ------------------------------------------------------------------ legal hold released
select test.login(test.id('admin'));
select test.switch('support_requests', true, 50);
select test.logout();
select test.eq((r->>'deleted_requests')::int, 1, 'the job takes the request left over') from public.run_support_retention() r;
select set_config('test.hold_req', (select id::text from public.legal_holds where suggestion_id = current_setting('test.held_req')::uuid), true);
select set_config('test.hold_acc', (select id::text from public.legal_holds where suggestion_id is null and released_at is null), true);
select test.login(test.id('admin'));
select test.eq((r->>'deleted_requests')::int, 1, 'a release with the job on deletes the released request past its 12 months at once')
from public.admin_release_legal_hold(current_setting('test.hold_req')::uuid,
  'Litigiul s-a încheiat prin hotărâre definitivă, dosar închis', test.rid()) r;
select test.eq(test.parts(current_setting('test.held_req')::uuid), 0::bigint, 'gone whole');
select public.admin_set_retention_job('support_requests', false, 'Oprit pentru verificare', null, null, test.rid());
select test.eq((r->>'deleted_requests')::int, 0, 'with the job off the release deletes nothing more than A3c2a')
from public.admin_release_legal_hold(current_setting('test.hold_acc')::uuid,
  'Litigiul s-a încheiat prin hotărâre definitivă, dosar închis', test.rid()) r;
select test.eq(test.parts(current_setting('test.held_acc')::uuid), 5::bigint, 'kept until the job runs');
select test.logout();
select test.login(test.id('admin'));

-- ------------------------------------------------------------------ suggestions
select test.eq(r->>'enabled', 'true', 'the suggestions job switched on') from test.switch('suggestions', true) r;
select test.logout();
select test.eq(r, '{"failed": 0, "remaining": 0, "to_review": 1, "deleted_files": 1, "expired_texts": 0}'::jsonb, 'one suggestion moved to review')
from public.run_suggestion_anonymization() r;
select test.eq(test.parts(current_setting('test.sug_old')::uuid), 0::bigint, 'the suggestion is gone whole (author, conversation, files)');
select test.eq(test.parts(current_setting('test.sug_recent')::uuid), 5::bigint, 'the recent one stays');
select test.eq(a.text_state, 'pending', 'its text waits for a review'),
       test.eq(a.proposed_text, 'Ideea mea: sunați-mă la [telefon] sau scrieți la [email] pentru [nr. înmatriculare]', 'with what identifies masked'),
       test.ok(a.id <> current_setting('test.sug_old')::uuid, 'under a new id'),
       test.eq(a.created_month, date_trunc('month', (now() - interval '13 months 3 hours') at time zone 'Europe/Bucharest')::date, 'only the month'),
       test.ok(a.review_due_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour', '30 days to review it'),
       test.ok(not exists (select 1 from public.admin_audit_log l where l.after::text like '%' || a.id::text || '%'
                           or l.before::text like '%' || a.id::text || '%' or l.entity_id = a.id::text), 'no audit row names the new id')
from public.suggestions_anonymous a;
select test.eq((select string_agg(attname, ',' order by attnum) from pg_attribute
                where attrelid = 'public.suggestions_anonymous'::regclass and attnum > 0 and not attisdropped),
  'id,created_month,author_role,final_status,text_state,text,pending_text,proposed_text,findings,review_due_at',
  'no column for an account, a shop, a booking or the old id');

-- The review: agent or admin.
select set_config('test.anon', (select id::text from public.suggestions_anonymous), true);
select test.as_agent();
select test.eq(jsonb_array_length(l->'items'), 1, 'the agent sees the suggestion to review'),
       test.ok(l->'items'->0->>'original' like '%0722 123 456%', 'with its original text, while the review lasts')
from public.support_list_suggestion_reviews('pending') l;
select test.eq((public.support_dashboard())->'counts'->>'reviews', '1', 'the support dashboard counts it');
select test.as_agent('aal1');
select test.fails($$select public.support_list_suggestion_reviews('pending')$$, 'mfa_required', 'an agent needs the second step');
select test.login_session(current_setting('test.ag')::uuid, '56000000-0000-4000-8000-0000000000ff');
select test.fails($$select public.support_list_suggestion_reviews('pending')$$, 'not_signed_in', 'and a live session');
select test.login(test.id('client_a'));
select test.fails($$select public.support_list_suggestion_reviews('pending')$$, 'not_allowed', 'a client cannot see the reviews');
select test.login(test.id('owner1'));
select test.fails(format($$select public.support_review_suggestion_text(%L, 'remove', null, test.rid())$$,
  current_setting('test.anon')), 'not_allowed', 'nor a shop review one');
select test.as_agent();
select test.eq(test.error_params(format($$select public.support_review_suggestion_text(%L, 'edit', 'Sunați la ion@ex.ro', test.rid())$$,
  current_setting('test.anon')))->'kinds', '["email"]'::jsonb, 'an edit that still identifies: refused, with what');
select test.eq(test.error_of(format($$select public.support_review_suggestion_text(%L, 'edit', 'Parola: Secret123!', test.rid())$$,
  current_setting('test.anon'))), 'text_identifies', 'a secret too');
select test.eq(r->>'state', 'edited', 'the agent keeps an edited text')
from public.support_review_suggestion_text(current_setting('test.anon')::uuid, 'edit', 'Ideea mea: contact direct cu echipa', test.rid()) r;
select test.logout();
select test.eq(a.text, 'Ideea mea: contact direct cu echipa', 'the checked text kept'),
       test.ok(a.pending_text is null and a.proposed_text is null and a.review_due_at is null, 'the original gone')
from public.suggestions_anonymous a;
select test.as_agent();
select test.eq(test.error_of(format($$select public.support_review_suggestion_text(%L, 'confirm', null, test.rid())$$,
  current_setting('test.anon'))), 'text_review_done', 'reviewed once');
select test.logout();
select test.eq(a.actor_role, 'support', 'the audit row says who'),
       test.ok(a.created_at is not null, 'and when'),
       test.eq(a.after, '{"action": "edit", "findings": 3}'::jsonb, 'the action and how many findings, no text'),
       test.ok(a.entity_id is null, 'and not which row')
from public.admin_audit_log a where a.action = 'review_suggestion_text';
select test.as_agent();
select test.eq(jsonb_array_length(l->'items'), 1, 'kept suggestions listed') from public.support_list_suggestion_reviews('kept') l;
select test.logout();

-- The admin confirms; a text that could not be masked needs an edit; 30 days without a review.
insert into public.suggestions_anonymous (created_month, author_role, final_status, pending_text, proposed_text, findings, review_due_at)
values ('2025-01-01', 'client', 'new', 'Text cu [email]', 'Text cu [email]', '{"email": 1}', now() + interval '3 days'),
       ('2025-01-01', 'shop', 'done', 'Text ascuns', null, '{"secret": 1}', now() + interval '3 days'),
       ('2025-01-01', 'client', 'new', 'Text uitat 0722 123 456', 'Text uitat [telefon]', '{"phone": 1}', now() - interval '1 minute');
select set_config('test.a_email', (select id::text from public.suggestions_anonymous where pending_text = 'Text cu [email]'), true);
select set_config('test.a_hidden', (select id::text from public.suggestions_anonymous where pending_text = 'Text ascuns'), true);
select set_config('test.a_old', (select id::text from public.suggestions_anonymous where proposed_text = 'Text uitat [telefon]'), true);
select test.login(test.id('admin'));
select test.eq((public.support_dashboard())->'counts'->>'reviews_soon', '3', 'due within 7 days: counted apart');
select test.eq(test.error_of(format($$select public.support_review_suggestion_text(%L, 'remove', null, test.rid())$$,
  current_setting('test.a_old'))), 'text_review_expired', 'past its term: no review any more');
select test.eq(r->>'state', 'confirmed', 'the admin confirms the proposed text')
from public.support_review_suggestion_text(current_setting('test.a_email')::uuid, 'confirm', null, test.rid()) r;
select test.eq(test.error_of(format($$select public.support_review_suggestion_text(%L, 'confirm', null, test.rid())$$,
  current_setting('test.a_hidden'))), 'text_review_needs_edit', 'nothing proposed: edit or remove');
select test.eq(r->>'state', 'removed', 'removed: no text kept')
from public.support_review_suggestion_text(current_setting('test.a_hidden')::uuid, 'remove', null, test.rid()) r;
select public.admin_set_retention_job('suggestions', false, 'Oprit pentru verificare', null, null, test.rid());
select test.logout();
select test.eq((r->>'expired_texts')::int, 1, 'after 30 days the text goes, even with the job off')
from public.run_suggestion_anonymization() r;
select test.ok(a.text is null and a.pending_text is null and a.proposed_text is null, 'only the month, role and state remain')
from public.suggestions_anonymous a where a.text_state = 'expired';
select test.eq((select count(*) from public.suggestions_anonymous where text_state = 'pending'), 0::bigint, 'no review open');
select test.login(test.id('admin'));

select test.login(test.id('admin'));
select test.switch('support_requests', true, 500);
select test.logout();
select public.run_support_retention(now() + interval '5 years');
select test.eq((select count(*) from public.suggestions where id = current_setting('test.recent')::uuid), 1::bigint,
  'a later moment passed to a run is ignored (never ahead of the clock): the recent request stays');
select test.ok(not has_function_privilege('service_role', 'public.support_retention_delete(public.suggestions)', 'execute')
  and not has_function_privilege('service_role', 'public.legal_hold_apply_rules(uuid, timestamptz)', 'execute'),
  'the service key cannot call the deleting helpers that skip the switch');

-- ------------------------------------------------------------------ the statistics (admin)
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.admin_support_stats(null, null)) > 0, true, 'the admin reads the statistics');
select test.as_agent();
select test.fails($$select public.admin_support_stats(null, null)$$, 'not_allowed', 'an agent does not');

-- ------------------------------------------------------------------ idempotent
select test.login(test.id('admin'));
select set_config('test.same', gen_random_uuid()::text, true);
select public.admin_set_retention_job('support_requests', true, 'Activare aprobată de Eduard, previzualizare verificată', 5,
  (public.admin_retention_preview('support_requests'))->'counts', current_setting('test.same')::uuid);
select test.eq(r->>'batch_size', '5', 'the same request twice answers the first result')
from public.admin_set_retention_job('support_requests', true, 'Alt motiv suficient de lung', 9, null, current_setting('test.same')::uuid) r;
select test.eq((select count(*) from public.admin_audit_log where action = 'set_retention_job' and reason = 'Alt motiv suficient de lung'),
  0::bigint, 'and does nothing else');

rollback;
