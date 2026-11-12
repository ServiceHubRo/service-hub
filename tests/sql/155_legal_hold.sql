-- A3c2a — legal hold of support data: only the admin places, reviews and releases it (concrete reason,
-- a basis from the closed list, a reference, no secrets in the texts), every step audited; held
-- requests, messages, notes and files survive every deletion path (the app's, the admin's, a direct
-- DELETE of auth.users / profiles / the rows, TRUNCATE), atomically, while the rest of the account goes;
-- agents lose a held request everywhere; the A3b cleanup skips held files only; a release applies the
-- deletion rules at once, also for accounts already deleted.
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

-- An agent with a live session.
select set_config('test.ag', test.sign_up('agent-lh@test.local', '{"role":"client","name":"Agent Pastrare","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agent-lh@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('55000000-0000-4000-8000-000000000001', current_setting('test.ag')::uuid);
create function test.as_agent() returns void language sql as $$
  select test.login_session(current_setting('test.ag')::uuid, '55000000-0000-4000-8000-000000000001')
$$;
grant execute on function test.as_agent() to public;

-- A request with a message from each side, a note and a file, written straight into the tables.
create function test.request(p_author uuid, p_title text, p_status text default 'new', p_closed_days int default null)
returns uuid language plpgsql security definer as $$
declare
  v uuid;
  v_msg uuid;
  v_path text := p_author::text || '/' || gen_random_uuid()::text;
begin
  insert into public.suggestions (author_id, author_role, title, body, category, status, closed_at, resolved_at)
  values (p_author, (select role from public.profiles where id = p_author), p_title, 'Text ' || p_title, 'technical',
          p_status, case when p_status = 'closed' then now() - make_interval(days => coalesce(p_closed_days, 1)) end,
          case when p_status in ('resolved', 'closed') then now() - make_interval(days => coalesce(p_closed_days, 1) + 14) end)
  returning id into v;
  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body) values (v, p_author, false, 'De la autor');
  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body)
  values (v, test.id('admin'), true, 'De la echipă') returning id into v_msg;
  insert into public.suggestion_notes (suggestion_id, author_id, author_display_id, body)
  values (v, test.id('admin'), 'A-00001', 'Notă internă');
  insert into storage.objects (bucket_id, name, owner) values ('support-files', v_path, null);
  insert into public.suggestion_files (suggestion_id, message_id, uploaded_by, from_staff, path, mime, size, name, sha256, attached_at)
  values (v, v_msg, p_author, false, v_path, 'image/png', 10, 'poza.png', repeat('a', 64), now());
  return v;
end
$$;
grant execute on function test.request(uuid, text, text, int) to public;

create function test.parts(p_request uuid) returns bigint language sql security definer as $$
  select (select count(*) from public.suggestions where id = p_request)
       + (select count(*) from public.suggestion_messages where suggestion_id = p_request)
       + (select count(*) from public.suggestion_notes where suggestion_id = p_request)
       + (select count(*) from public.suggestion_files where suggestion_id = p_request)
$$;
grant execute on function test.parts(uuid) to public;

create function test.place(p_request uuid, p_account text, p_reason text default 'Litigiu cu autorul solicitării, notificare primită de la avocat',
  p_reference text default 'Dosar nr. 1234/180/2026') returns jsonb language sql as $$
  select public.admin_place_legal_hold(p_request, p_account, 'litigation', p_reason, p_reference, null, test.rid())
$$;
grant execute on function test.place(uuid, text, text, text) to public;

create function test.release(p_hold uuid) returns jsonb language sql as $$
  select public.admin_release_legal_hold(p_hold, 'Litigiul s-a încheiat prin hotărâre definitivă, dosar închis', test.rid())
$$;
grant execute on function test.release(uuid) to public;

-- ------------------------------------------------------------------ the migration keeps every row
select test.ok(not exists (select 1 from public.suggestions where former_author_id is not null), 'no request was changed: no former author')
;
select test.eq((select confdeltype::text from pg_constraint where conname = 'suggestions_author_id_fkey'), 'n',
  'a request survives its author (the profile deletion trigger decides what goes)');

-- ------------------------------------------------------------------ nobody reaches the hold tables
do $$
declare
  t text;
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach t in array array['legal_holds', 'legal_hold_reviews', 'legal_hold_subjects'] loop
      perform test.ok(not has_table_privilege(r, 'public.' || t, 'select')
                      and not has_table_privilege(r, 'public.' || t, 'insert')
                      and not has_table_privilege(r, 'public.' || t, 'update')
                      and not has_table_privilege(r, 'public.' || t, 'delete')
                      and not has_table_privilege(r, 'public.' || t, 'truncate'), r || ' has no right on ' || t);
    end loop;
    foreach t in array array['suggestions', 'suggestion_messages', 'suggestion_notes', 'suggestion_files', 'support_signals', 'support_file_deletions'] loop
      perform test.ok(not has_table_privilege(r, 'public.' || t, 'truncate'), r || ' cannot truncate ' || t);
    end loop;
  end loop;
end
$$;
select test.ok(not exists (select 1 from pg_publication_tables where tablename like 'legal_hold%'), 'no hold table in Realtime');
select test.ok(not exists (select 1 from pg_policies where tablename like 'legal_hold%'), 'and no policy opens them');
do $$
declare
  fn text;
begin
  foreach fn in array array['legal_hold_covers(null, null)', 'legal_hold_covers_request(null)', 'text_has_secret(''x'')',
    'legal_hold_apply_rules(gen_random_uuid())', 'legal_hold_capture_subject(gen_random_uuid())', 'legal_holds_for_request(null)',
    'legal_hold_has_subject(null)'] loop
    perform test.login(test.id('client_a'));
    perform test.ok(test.error_of('select public.' || fn) ilike '%permission denied%', 'a user cannot call ' || fn);
    perform test.logout();
  end loop;
end
$$;

-- ------------------------------------------------------------------ the requests
select set_config('test.c', test.sign_up('carmen@test.local', '{"role":"client","name":"Carmen Ilie","phone":"0723000077","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.r_held', test.request(test.id('client_a'), 'Ținută: problemă plată')::text, true);
select set_config('test.r_open', test.request(test.id('client_a'), 'Deschisă', 'in_progress')::text, true);
select set_config('test.r_old', test.request(test.id('client_a'), 'Închisă demult', 'closed', 120)::text, true);
select set_config('test.r_res', test.request(test.id('client_a'), 'Rezolvată', 'resolved')::text, true);
select set_config('test.r_other', test.request(test.id('client_b'), 'Altcineva')::text, true);

-- ------------------------------------------------------------------ who may place a hold
select test.as_agent();
select test.eq(test.error_of(format('select test.place(%L, null)', current_setting('test.r_held'))), 'not_allowed', 'an agent cannot place a hold');
select test.eq(test.error_of('select public.admin_list_legal_holds()'), 'not_allowed', 'nor list them');
select test.login(test.id('client_a'));
select test.eq(test.error_of(format('select test.place(%L, null)', current_setting('test.r_held'))), 'not_allowed', 'nor a client');
select test.login(test.id('admin'), 'aal1');
select test.eq(test.error_of(format('select test.place(%L, null)', current_setting('test.r_held'))), 'mfa_required', 'the admin needs the second step');

-- ------------------------------------------------------------------ what a hold needs
select test.login(test.id('admin'));
select test.eq(test.error_params(format('select test.place(%L, null, %L)', current_setting('test.r_held'), 'Prea scurt'))->>'field', 'reason',
  'a reason of at least 30 characters');
select test.eq(test.error_params(format('select test.place(%L, null, %L, %L)', current_setting('test.r_held'),
  'Litigiu cu autorul solicitării, notificare primită', ' '))->>'field', 'reference', 'and a reference');
select test.eq(test.error_params(format($$select public.admin_place_legal_hold(%L, null, 'because', 'Litigiu cu autorul solicitării, notificare primită', 'Dosar 1/2026', null, test.rid())$$,
  current_setting('test.r_held')))->>'field', 'basis', 'a basis from the closed list only');
select test.eq(test.error_params($$select public.admin_place_legal_hold(null, null, 'litigation', 'Litigiu cu autorul solicitării, notificare primită', 'Dosar 1/2026', null, test.rid())$$)->>'field',
  'target', 'one request or one account');
select test.eq(test.error_params(format($$select public.admin_place_legal_hold(%L, 'C-00001', 'litigation', 'Litigiu cu autorul solicitării, notificare primită', 'Dosar 1/2026', null, test.rid())$$,
  current_setting('test.r_held')))->>'field', 'target', 'not both');
select test.eq(test.error_of('select test.place(gen_random_uuid(), null)'), 'request_not_found', 'an unknown request');
select test.eq(test.error_of($$select test.place(null, 'C-99999')$$), 'account_not_found', 'an unknown account');
select test.eq(test.error_of(format('select test.place(null, %L)', current_setting('test.ag'))), 'account_not_found', 'never an agent''s account');
select test.eq(test.error_params(format($$select public.admin_place_legal_hold(%L, null, 'litigation', 'Litigiu cu autorul solicitării, notificare primită', 'Dosar 1/2026', %L, test.rid())$$,
  current_setting('test.r_held'), current_setting('test.ag')))->>'field', 'responsible', 'the responsible is an active admin');

-- Secrets in the texts are refused, whatever the field is called.
do $$
declare
  v text;
begin
  foreach v in array array[
    'Litigiu în curs, parola: Secret123! pentru cont',
    'Litigiu în curs cu acces la cheia sk_live_51HxYzAbCdEfGhIjKl',
    'Litigiu în curs, token = abcdef0123456789zz',
    'Litigiu în curs, card 4111 1111 1111 1111 al clientului',
    'Litigiu în curs, cheie AKIAIOSFODNN7EXAMPLE pentru export',
    'Litigiu în curs eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    'Litigiu în curs, șir Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNb atașat',
    'Litigiu în curs -----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA'] loop
    perform test.eq(test.error_params(format('select test.place(%L, null, %L)', current_setting('test.r_held'), v))->>'field', 'reason',
      'a secret in the reason is refused: ' || left(v, 40));
    perform test.eq(test.error_of(format('select test.place(%L, null, %L)', current_setting('test.r_held'), v)), 'secret_in_text',
      'with secret_in_text');
  end loop;
end
$$;
select test.eq(test.error_params(format('select test.place(%L, null, %L, %L)', current_setting('test.r_held'),
  'Litigiu cu autorul solicitării, notificare primită', 'whsec_abcdefghij1234'))->>'field',
  'reference', 'and in the reference');
select test.logout();
select test.ok(not public.text_has_secret('Dosar nr. 1234/180/2026, Judecătoria Brașov, termen 12.12.2026, telefon 0723000001'),
  'a case number, a date and a phone are not secrets');
select test.ok(not public.text_has_secret('Cererea ' || gen_random_uuid()::text || ' din registrul ANPC nr. 55678'),
  'nor an identifier or a registry number');
select test.ok(not public.text_has_secret('Comanda 4111 1111 1111 1112 nu trece verificarea'), 'a number failing the Luhn check is not a card');
select test.eq((select count(*) from public.legal_holds), 0::bigint, 'nothing was kept from the refused attempts');

-- ------------------------------------------------------------------ placing
select test.login(test.id('admin'));
select set_config('test.rid1', gen_random_uuid()::text, true);
select set_config('test.h_req', (public.admin_place_legal_hold(current_setting('test.r_held')::uuid, null, 'litigation',
  'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1234/180/2026', null, current_setting('test.rid1')::uuid)->>'id'), true);
select test.eq(public.admin_place_legal_hold(current_setting('test.r_held')::uuid, null, 'litigation',
  'Litigiu cu autorul solicitării, notificare primită de la avocat', 'Dosar nr. 1234/180/2026', null, current_setting('test.rid1')::uuid)->>'id',
  current_setting('test.h_req'), 'the same tap twice places one hold');
select test.eq(test.error_of(format('select test.place(%L, null)', current_setting('test.r_held'))), 'hold_exists', 'one active hold per request');
select test.logout();
select test.eq((select review_due_at::date from public.legal_holds where id = current_setting('test.h_req')::uuid),
  (now() + interval '90 days')::date, 'reviewed every 90 days');
select test.eq((select display_id from public.legal_hold_subjects where user_id = test.id('client_a')),
  (select display_id from public.profiles where id = test.id('client_a')), 'the author''s identifiers are taken');
select test.eq((select email from public.legal_hold_subjects where user_id = test.id('client_a')), 'ana@test.local', 'its email too');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'place_legal_hold' and entity_id = current_setting('test.h_req')
                       and actor_role = 'admin' and after->>'basis' = 'litigation'), 'placing is in the audit log, as an admin action');
select test.ok(not exists (select 1 from public.admin_audit_log where action like '%legal_hold%'
                           and (coalesce(before::text, '') || coalesce(after::text, '') || coalesce(reason, '')) ilike any (array['%avocat%', '%1234/180%'])),
  'the audit names the hold, never its texts');

-- An account hold: placed by the account ID.
select test.login(test.id('admin'));
select set_config('test.h_acc', (test.place(null, (select display_id from public.profiles where id = current_setting('test.c')::uuid))->>'id'), true);
select test.eq(test.error_of(format('select test.place(null, %L)', current_setting('test.c'))), 'hold_exists', 'one active hold per account');
select test.logout();
select set_config('test.c1', test.request(current_setting('test.c')::uuid, 'Carmen 1', 'new')::text, true);
select set_config('test.c2', test.request(current_setting('test.c')::uuid, 'Carmen 2', 'waiting_user')::text, true);
select set_config('test.c3', test.request(current_setting('test.c')::uuid, 'Carmen 3', 'closed', 200)::text, true);
select test.ok(public.legal_hold_covers_request(current_setting('test.c3')::uuid), 'an account hold covers requests written after it');

-- ------------------------------------------------------------------ the agent: as if they did not exist
select test.login(test.id('admin'));
select public.support_take_request(current_setting('test.r_open')::uuid, test.rid());
select test.as_agent();
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_inbox('all', 'all', 'all', null, null, null, null, 100)->'items') i
                           where (i->>'id')::uuid in (current_setting('test.r_held')::uuid, current_setting('test.c1')::uuid,
                                                      current_setting('test.c2')::uuid, current_setting('test.c3')::uuid)),
  'the agent''s list leaves out every held request');
select test.ok(exists (select 1 from jsonb_array_elements(public.support_inbox('all', 'all', 'all', null, null, null, null, 100)->'items') i
                       where (i->>'id')::uuid = current_setting('test.r_open')::uuid), 'and keeps the others');
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_inbox('all', 'all', 'all', null, null, null, null, 100)->'items') i
                           where i ? 'held' or i ? 'former_author'), 'without a word about holds');
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_list_requests()->'items') i
                           where (i->>'id')::uuid = current_setting('test.r_held')::uuid), 'the A3a list too');
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_list_suggestions()->'items') i
                           where (i->>'id')::uuid = current_setting('test.r_held')::uuid), 'and the suggestions board');
select set_config('test.agent_counts', (public.support_dashboard()->'counts')::text, true);
select test.ok(not (current_setting('test.agent_counts')::jsonb ? 'holds_due'), 'no hold counter for an agent');
select test.eq(test.error_of(format('select public.support_get_request(%L)', current_setting('test.r_held'))),
  test.error_of('select public.support_get_request(gen_random_uuid())'), 'opening a held request answers like a request that does not exist');
select test.eq(test.error_of(format('select public.support_get_request(%L)', current_setting('test.r_held'))), 'request_not_found', 'request_not_found');
select test.eq(test.error_of(format('select public.support_take_request(%L, test.rid())', current_setting('test.r_held'))), 'request_not_found', 'cannot take it');
select test.eq(test.error_of(format('select public.support_assign_request(%L, %L, test.rid())', current_setting('test.r_held'), current_setting('test.ag'))),
  'request_not_found', 'nor assign it');
select test.eq(test.error_of(format($$select public.support_reply_request(%L, 'Răspuns', null, test.rid())$$, current_setting('test.r_held'))),
  'request_not_found', 'nor answer it');
select test.eq(test.error_of(format($$select public.support_set_request_status(%L, 'resolved', test.rid())$$, current_setting('test.r_held'))),
  'request_not_found', 'nor change its state');
select test.eq(test.error_of(format($$select public.support_escalate_request(%L, 'Motiv', test.rid())$$, current_setting('test.r_held'))),
  'request_not_found', 'nor escalate it');
select test.eq(test.error_of(format($$select public.support_add_note(%L, 'Notă', test.rid())$$, current_setting('test.r_held'))),
  'request_not_found', 'nor write a note');
select test.eq(test.error_of(format($$select public.support_set_suggestion_status(%L, 'planned', test.rid())$$, current_setting('test.r_held'))),
  'suggestion_not_found', 'nor change it on the suggestions board');
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_get_account(test.id('client_a'))->'suggestions') g
                           where (g->>'id')::uuid = current_setting('test.r_held')::uuid), 'the account card does not list it');
select test.ok(exists (select 1 from jsonb_array_elements(public.support_get_account(test.id('client_a'))->'suggestions') g
                       where (g->>'id')::uuid = current_setting('test.r_open')::uuid), 'but lists the others');
select test.eq(test.count(format('select 1 from public.support_signals where suggestion_id = %L', current_setting('test.r_held'))), 0::bigint,
  'no Realtime signal of a held request reaches an agent');
select test.ok(test.count('select 1 from public.support_signals where audience = ''team''') > 0, 'other signals do');
select test.logout();
select test.eq(test.error_of(format('select public.support_file_open(%L, ''aal2'', %L, %L)', current_setting('test.ag'),
  '55000000-0000-4000-8000-000000000001', (select id from public.suggestion_files where suggestion_id = current_setting('test.r_held')::uuid))),
  'file_not_found', 'its files do not open for an agent (support-files function)');
select test.eq(test.error_of(format('select public.support_file_open(%L, ''aal2'', %L, %L)', current_setting('test.ag'),
  '55000000-0000-4000-8000-000000000001', (select id from public.suggestion_files where suggestion_id = current_setting('test.r_open')::uuid))),
  'ok', 'the other files do');

-- The admin sees everything, and which requests are held.
select set_config('test.held_file_id', (select id from public.suggestion_files where suggestion_id = current_setting('test.r_held')::uuid)::text, true);
select test.login(test.id('admin'));
select test.eq((select (i->>'held')::boolean from jsonb_array_elements(public.support_inbox('all', 'all', 'all', null, null, null, null, 100)->'items') i
                where (i->>'id')::uuid = current_setting('test.r_held')::uuid), true, 'the admin lists a held request, marked');
select test.ok((public.support_dashboard()->'counts'->>'new')::int > (current_setting('test.agent_counts')::jsonb->>'new')::int,
  'its counters include held requests');
select test.eq(jsonb_array_length(public.support_get_request(current_setting('test.r_held')::uuid)->'legal_holds'), 1, 'its request page shows the hold');
select test.eq(test.count(format('select 1 from public.support_signals where suggestion_id = %L and audience = ''team''', current_setting('test.r_held'))), 1::bigint,
  'and hears its signals');
select test.logout();
select test.ok(public.support_file_open(test.id('admin'), 'aal2', test.admin_session(test.id('admin')),
  current_setting('test.held_file_id')::uuid) ? 'path', 'and opens its files');
-- An escalated held request is not given back to an agent.
select test.logout();
update public.suggestions set escalated_at = now(), escalated_by = current_setting('test.ag')::uuid, escalation_reason = 'x'
where id = current_setting('test.r_held')::uuid;
select test.login(test.id('admin'));
select test.eq(test.error_of(format($$select public.admin_return_request(%L, 'Înapoi', test.rid())$$, current_setting('test.r_held'))),
  'legal_hold', 'an escalated held request stays with the admin');
select test.logout();
update public.suggestions set escalated_at = null, escalated_by = null, escalation_reason = null where id = current_setting('test.r_held')::uuid;
-- The author still has its own request (its right of access), without a word about the hold.
select test.login(test.id('client_a'));
select test.ok(exists (select 1 from jsonb_array_elements(public.my_support_requests()) r where (r->>'id')::uuid = current_setting('test.r_held')::uuid)
               or exists (select 1 from jsonb_array_elements(public.my_support_requests()->'items') r where (r->>'id')::uuid = current_setting('test.r_held')::uuid),
  'the author keeps seeing its own held request');
select test.ok(public.get_my_support_request(current_setting('test.r_held')::uuid)::text !~* 'hold|păstr', 'with no trace of the hold');
select test.ok(jsonb_array_length(public.export_my_data()->'support_requests') >= 4, 'and exports it');
select test.logout();

-- ------------------------------------------------------------------ guards on every path
-- (as the database's owner: what the SQL Editor or a service key could try)
select test.eq(test.error_of(format('delete from public.suggestions where id = %L', current_setting('test.r_held'))), 'legal_hold',
  'a held request cannot be deleted directly');
select test.eq(test.error_of(format('delete from public.suggestion_messages where suggestion_id = %L', current_setting('test.r_held'))), 'legal_hold',
  'nor its messages');
select test.eq(test.error_of(format('delete from public.suggestion_notes where suggestion_id = %L', current_setting('test.r_held'))), 'legal_hold',
  'nor its notes');
select test.eq(test.error_of(format('delete from public.suggestion_files where suggestion_id = %L', current_setting('test.r_held'))), 'legal_hold',
  'nor its files');
select test.eq(test.error_of(format($$update public.suggestions set body = 'șters' where id = %L$$, current_setting('test.r_held'))), 'legal_hold',
  'nor its text changed');
select test.eq(test.error_of(format($$update public.suggestion_messages set body = 'șters' where suggestion_id = %L$$, current_setting('test.r_held'))),
  'legal_hold', 'nor a message''s');
select test.eq(test.error_of(format($$update public.suggestion_notes set body = 'șters' where suggestion_id = %L$$, current_setting('test.r_held'))),
  'legal_hold', 'nor a note''s');
select test.eq(test.error_of(format($$update public.suggestion_files set suggestion_id = null, attached_at = null, message_id = null where suggestion_id = %L$$,
  current_setting('test.r_held'))), 'legal_hold', 'nor a file moved away');
select test.eq(test.error_of(format($$update public.suggestions set status = 'in_progress' where id = %L$$, current_setting('test.r_held'))), 'ok',
  'the work on it goes on (its state)');
update public.suggestions set status = 'new' where id = current_setting('test.r_held')::uuid;

-- Atomic: one held row in a deletion undoes all of it.
select test.eq(test.error_of(format('delete from public.suggestions where author_id = %L', test.id('client_a'))), 'legal_hold',
  'deleting all of an author''s requests at once is refused');
select test.eq(test.count(format('select 1 from public.suggestions where author_id = %L', test.id('client_a'))), 4::bigint,
  'and none of them went');

-- TRUNCATE: no row trigger runs, so a statement trigger guards it (also through CASCADE).
select test.eq(test.error_of('truncate public.suggestions cascade'), 'legal_hold', 'TRUNCATE of the requests is refused while a hold is active');
select test.eq(test.error_of('truncate public.suggestion_messages cascade'), 'legal_hold', 'of the messages');
select test.eq(test.error_of('truncate public.suggestion_notes'), 'legal_hold', 'of the notes');
select test.eq(test.error_of('truncate public.suggestion_files'), 'legal_hold', 'of the files');
select test.eq(test.error_of('truncate public.shops cascade'), 'legal_hold', 'also when it cascades from shops');
select test.eq(test.error_of('truncate public.profiles cascade'), 'legal_hold', 'or from the profiles');
select test.eq(test.error_of('truncate auth.users cascade'), 'legal_hold', 'or from the logins');
select test.eq(test.error_of('truncate public.legal_holds cascade'), 'legal_hold', 'the holds themselves cannot be emptied');
select test.eq(test.error_of('truncate public.legal_hold_subjects'), 'legal_hold', 'nor the identifiers');
select test.eq(test.error_of(format('delete from public.legal_holds where id = %L', current_setting('test.h_req'))), 'legal_hold',
  'a hold is never deleted, only released');
set local role service_role;
select test.ok(test.error_of('truncate public.suggestions') ilike '%permission denied%', 'service_role has no TRUNCATE');
select test.ok(test.error_of('select * from public.legal_holds') ilike '%permission denied%', 'nor reads the holds');
select test.eq(test.error_of(format('delete from public.suggestions where id = %L', current_setting('test.r_held'))), 'legal_hold',
  'and its DELETE stops at the hold');
reset role;
select test.eq(test.count('select 1 from public.suggestions'), (select count(*) from public.suggestions), 'everything is still there');

-- ------------------------------------------------------------------ the A3b cleanup
select set_config('test.c3_file', (select path from public.suggestion_files where suggestion_id = current_setting('test.c3')::uuid), true);
select set_config('test.old_file', (select path from public.suggestion_files where suggestion_id = current_setting('test.r_old')::uuid), true);
select test.eq(public.support_files_collect(), 1, 'the daily cleanup runs and deletes the file it may');
select test.ok(not exists (select 1 from public.suggestion_files where path = current_setting('test.old_file')), 'the file of an old closed request goes');
select test.ok(exists (select 1 from public.support_file_deletions where path = current_setting('test.old_file')), 'its object is queued');
select test.ok(exists (select 1 from public.suggestion_files where path = current_setting('test.c3_file')), 'a held file of an old closed request stays');
select test.ok(not exists (select 1 from public.support_file_deletions where path = current_setting('test.c3_file')), 'and is not queued');
select test.ok(not (current_setting('test.c3_file') = any (public.support_files_stray(1000, now() + interval '2 days'))),
  'nor seen as a stray object');

-- ------------------------------------------------------------------ account deletion
-- A client without any hold: exactly as before — every request goes with the account.
select set_config('test.d', test.sign_up('dan@test.local', '{"role":"client","name":"Dan Nica","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.d1', test.request(current_setting('test.d')::uuid, 'Dan 1')::text, true);
select set_config('test.d2', test.request(current_setting('test.d')::uuid, 'Dan 2', 'closed', 3)::text, true);
select test.eq(public.prepare_account_deletion(current_setting('test.d')::uuid), 'delete', 'no hold: the account is deleted as before');
delete from auth.users where id = current_setting('test.d')::uuid;
select test.eq(test.parts(current_setting('test.d1')::uuid) + test.parts(current_setting('test.d2')::uuid), 0::bigint,
  'its requests went with messages, notes and files');
select test.ok(not exists (select 1 from public.legal_hold_subjects where user_id = current_setting('test.d')::uuid), 'no identifiers kept');

-- client_a: one held request among four — deleted directly in auth.users (SQL Editor, any path).
select set_config('test.a_cars', test.count(format('select 1 from public.cars where owner_id = %L', test.id('client_a')))::text, true);
select test.ok(current_setting('test.a_cars')::int > 0, 'client_a has cars before');
select set_config('test.open_file', (select path from public.suggestion_files where suggestion_id = current_setting('test.r_open')::uuid), true);
delete from auth.users where id = test.id('client_a');
select test.eq(test.count(format('select 1 from public.profiles where id = %L', test.id('client_a'))), 0::bigint, 'the account is gone');
select test.eq(test.count(format('select 1 from public.cars where owner_id = %L', test.id('client_a'))), 0::bigint, 'with its cars (nothing else is held)');
select test.eq(test.parts(current_setting('test.r_open')::uuid) + test.parts(current_setting('test.r_res')::uuid)
               + test.parts(current_setting('test.r_old')::uuid), 0::bigint, 'its three requests without a hold went, whole');
select test.ok(exists (select 1 from public.support_file_deletions where path = current_setting('test.open_file')), 'their objects are queued');
select test.eq(test.parts(current_setting('test.r_held')::uuid), 5::bigint, 'the held request stays whole: text, 2 messages, note, file');
select test.eq((select row(author_id, former_author_id, status)::text from public.suggestions where id = current_setting('test.r_held')::uuid),
  row(null::uuid, test.id('client_a'), 'closed')::text, 'independent of the account, with its former author, closed');
select test.eq((select row(name, email, phone)::text from public.legal_hold_subjects where user_id = test.id('client_a')),
  row('Ana Marin', 'ana@test.local', '0723000001')::text, 'the author''s identifiers kept, admin only');
select test.ok((select account_deleted_at from public.legal_hold_subjects where user_id = test.id('client_a')) is not null, 'with when the account went');
select test.ok(not exists (select 1 from public.support_signals where audience = 'author' and author_id = test.id('client_a')),
  'no author signal left for a deleted account');

-- Carmen (account hold): the app's path — prepare_account_deletion, then the login is deleted.
select test.eq(public.prepare_account_deletion(current_setting('test.c')::uuid), 'delete', 'an account hold does not stop the deletion');
delete from auth.users where id = current_setting('test.c')::uuid;
select test.eq(test.count(format('select 1 from public.profiles where id = %L', current_setting('test.c'))), 0::bigint, 'the account is gone');
select test.eq(test.parts(current_setting('test.c1')::uuid) + test.parts(current_setting('test.c2')::uuid) + test.parts(current_setting('test.c3')::uuid),
  15::bigint, 'its three held requests stay whole');
select test.eq((select email from public.legal_hold_subjects where user_id = current_setting('test.c')::uuid), 'carmen@test.local',
  'its email, taken before the login went');

-- A held request of a shop owner whose shop the law keeps ('anonymize'): the profile stays, linked.
select test.login(test.id('admin'));
select set_config('test.o1', test.request(test.id('owner2'), 'Service: factură')::text, true);
select set_config('test.h_o1', (test.place(current_setting('test.o1')::uuid, null)->>'id'), true);
select test.logout();
update public.bookings set status = 'cancelled' where shop_id = test.id('shop2') and public.is_active_status(status);
select test.eq(public.prepare_account_deletion(test.id('owner2')), 'anonymize', 'a shop with records is anonymized, as before');
select test.eq((select author_id from public.suggestions where id = current_setting('test.o1')::uuid), test.id('owner2'), 'its request keeps its author');
select test.ok((select account_deleted_at from public.legal_hold_subjects where user_id = test.id('owner2')) is not null,
  'its identifiers kept, the account marked deleted');

-- The orphans: only the admin, and only closed.
select set_config('test.a_display', (select display_id from public.legal_hold_subjects where user_id = test.id('client_a')), true);
select test.as_agent();
select test.eq(test.error_of(format('select public.support_get_request(%L)', current_setting('test.r_held'))), 'request_not_found',
  'an agent never sees a kept request');
select test.login(test.id('admin'));
select test.eq(public.support_get_request(current_setting('test.r_held')::uuid)->'former_author'->>'display_id',
  current_setting('test.a_display'), 'the admin sees whose it was');
select test.eq(test.error_of(format($$select public.support_reply_request(%L, 'Răspuns', null, test.rid())$$, current_setting('test.r_held'))),
  'request_closed', 'nobody answers an account that is gone');
select test.ok(exists (select 1 from jsonb_array_elements(public.admin_list_suggestions()->'items') i
                       where (i->>'id')::uuid = current_setting('test.r_held')::uuid), 'the admin''s suggestions board still lists it (author gone)');
select test.ok(exists (select 1 from jsonb_array_elements(public.support_inbox('all', 'all', 'all', null, null, null, null, 100)->'items') i
                       where (i->>'id')::uuid = current_setting('test.r_held')::uuid and i->'author'->>'id' is null
                         and i->>'former_author' = current_setting('test.a_display')), 'and the admin''s list, with the former author''s ID');
select test.eq(public.admin_get_legal_hold(current_setting('test.h_acc')::uuid)->'subject'->>'email', 'carmen@test.local',
  'the hold page shows the identifiers');
select test.eq(jsonb_array_length(public.admin_get_legal_hold(current_setting('test.h_acc')::uuid)->'covered'), 3, 'and the three requests it covers');
select test.logout();
select test.ok(exists (select 1 from public.admin_audit_log where action = 'view_legal_hold' and entity_id = current_setting('test.h_acc')),
  'the opening is logged');

-- ------------------------------------------------------------------ review
select test.login(test.id('admin'));
select test.eq(test.error_params(format($$select public.admin_review_legal_hold(%L, 'Încă', null, test.rid())$$, current_setting('test.h_acc')))->>'field',
  'note', 'a review needs a written reason');
select test.eq(test.error_of(format($$select public.admin_review_legal_hold(%L, 'Dosarul e încă pe rol, parola: Ab12345678', null, test.rid())$$,
  current_setting('test.h_acc'))), 'secret_in_text', 'without secrets');
select test.logout();
update public.legal_holds set review_due_at = now() - interval '1 day' where id = current_setting('test.h_acc')::uuid;
select test.login(test.id('admin'));
select test.eq((public.admin_list_legal_holds()->>'due')::int, 1, 'a hold past its review is counted');
select test.eq((public.support_dashboard()->'counts'->>'holds_due')::int, 1, 'also on the admin''s dashboard');
select test.eq(public.admin_list_legal_holds()->'items'->0->>'id', current_setting('test.h_acc'), 'and listed first');
select test.ok((public.admin_review_legal_hold(current_setting('test.h_acc')::uuid,
  'Dosarul este încă pe rol, următorul termen în ianuarie 2027', null, test.rid())->>'review_due_at')::timestamptz > now() + interval '89 days',
  'reviewed: the next review in 90 days');
select test.logout();
select test.eq((select count(*) from public.legal_hold_reviews where hold_id = current_setting('test.h_acc')::uuid), 1::bigint, 'the review is kept');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'review_legal_hold' and entity_id = current_setting('test.h_acc')
                       and actor_role = 'admin'), 'and audited');
select test.eq(test.error_of(format('delete from public.legal_hold_reviews where hold_id = %L', current_setting('test.h_acc'))), 'legal_hold',
  'a review cannot be deleted');
select test.eq(test.error_of(format($$update public.legal_hold_reviews set note = 'x' where hold_id = %L$$, current_setting('test.h_acc'))), 'legal_hold',
  'nor changed');
select test.ok(public.legal_hold_covers_request(current_setting('test.c1')::uuid), 'never released by itself');

-- ------------------------------------------------------------------ release
-- Two holds on one request (the request's own and the account's): one release keeps it.
select test.login(test.id('admin'));
select set_config('test.h_c1', (test.place(current_setting('test.c1')::uuid, null)->>'id'), true);
select set_config('test.rel', test.release(current_setting('test.h_acc')::uuid)::text, true);
select test.eq((current_setting('test.rel')::jsonb->>'deleted_requests')::int, 2, 'releasing the account hold deletes the two requests it alone kept');
select test.eq(test.parts(current_setting('test.c2')::uuid) + test.parts(current_setting('test.c3')::uuid), 0::bigint, 'whole: messages, notes, files');
select test.eq(test.parts(current_setting('test.c1')::uuid), 5::bigint, 'the request with its own hold stays');
select test.eq(test.error_of(format('select test.release(%L)', current_setting('test.h_acc'))), 'hold_released', 'a hold is released once');
select test.eq(test.error_of(format($$select public.admin_review_legal_hold(%L, 'Dosarul este încă pe rol, termen nou fixat', null, test.rid())$$,
  current_setting('test.h_acc'))), 'hold_released', 'and is not reviewed after');
select test.eq(test.error_params(format($$select public.admin_release_legal_hold(%L, 'Gata', test.rid())$$, current_setting('test.h_c1')))->>'field',
  'reason', 'a release needs a reason');
select test.logout();
select test.ok(exists (select 1 from public.support_file_deletions where path = current_setting('test.c3_file')), 'their objects queued for Storage');
select test.ok(exists (select 1 from public.legal_hold_subjects where user_id = current_setting('test.c')::uuid), 'the identifiers stay for the other hold');

select test.login(test.id('admin'));
select test.eq((test.release(current_setting('test.h_c1')::uuid)->>'deleted_requests')::int, 1, 'the last hold released: the last request goes');
select test.eq(test.parts(current_setting('test.c1')::uuid), 0::bigint, 'whole');
select test.logout();
select test.ok(not exists (select 1 from public.legal_hold_subjects where user_id = current_setting('test.c')::uuid), 'and the identifiers go');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'release_legal_hold' and entity_id = current_setting('test.h_c1')
                       and (after->>'deleted_requests')::int = 1), 'the release is audited with what it deleted');
select test.ok((select release_reason from public.legal_holds where id = current_setting('test.h_c1')::uuid) is not null, 'the hold''s history stays');

-- client_a's held request (account deleted before): released → deleted at once.
select test.login(test.id('admin'));
select test.eq((test.release(current_setting('test.h_req')::uuid)->>'deleted_requests')::int, 1, 'a kept request of a deleted account goes at release');
select test.eq(test.parts(current_setting('test.r_held')::uuid), 0::bigint, 'with everything in it');
select test.logout();
select test.ok(not exists (select 1 from public.suggestions where author_id is null), 'no request without an account is left');

-- A living account: the release applies the 90-day file rule, the request stays and the agents see it again.
select set_config('test.b_old', test.request(test.id('client_b'), 'Bogdan veche', 'closed', 100)::text, true);
select test.login(test.id('admin'));
select set_config('test.h_b', (test.place(current_setting('test.b_old')::uuid, null)->>'id'), true);
select test.logout();
select test.eq(public.support_files_collect(), 0, 'held, its old file survives the cleanup');
select test.login(test.id('admin'));
select set_config('test.rel_b', test.release(current_setting('test.h_b')::uuid)::text, true);
select test.eq(current_setting('test.rel_b')::jsonb->>'deleted_files', '1', 'released: its file older than 90 days goes at once');
select test.eq(current_setting('test.rel_b')::jsonb->>'deleted_requests', '0', 'the request of a living account stays');
select test.as_agent();
select test.ok(public.support_get_request(current_setting('test.b_old')::uuid) ? 'id', 'the agent sees it again');
select test.ok(test.count(format('select 1 from public.support_signals where suggestion_id = %L', current_setting('test.b_old'))) = 1,
  'and hears it again');
select test.logout();
select test.ok(not exists (select 1 from public.legal_hold_subjects where user_id = test.id('client_b')), 'no identifiers kept any more');

-- The anonymized shop owner's request: released, it follows the rules of an anonymized account (kept).
select test.login(test.id('admin'));
select test.eq((test.release(current_setting('test.h_o1')::uuid)->>'deleted_requests')::int, 0, 'an anonymized shop owner''s request follows its rules');
select test.logout();

-- ------------------------------------------------------------------ with no active hold, TRUNCATE works again
select test.eq((select count(*) from public.legal_holds where released_at is null), 0::bigint, 'every hold released');
select test.eq(test.error_of('truncate public.suggestion_notes'), 'ok', 'the support tables can be emptied again (the reset before launch)');
select test.eq(test.error_of('truncate public.legal_holds cascade'), 'legal_hold', 'but the holds'' history cannot');

rollback;
