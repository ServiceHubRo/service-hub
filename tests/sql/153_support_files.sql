-- A3b — files of support requests: who may upload and open (author, team, never anyone else), the
-- limits (5 per message, 20 per request, 30 uploads an hour, 20 waiting), attaching only one's own
-- files not sent within 24 hours (the team's files the same way), every opening in the audit log, no
-- direct access to the tables or the bucket, and the cleanup: files not sent after 24 hours, files of
-- requests closed 90 days ago, files of deleted requests and accounts, stray objects.
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

select set_config('test.ag', test.sign_up('agf@test.local', '{"role":"client","name":"Agent Fisiere","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agf@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('54000000-0000-4000-8000-000000000001', current_setting('test.ag')::uuid);
select set_config('test.sid', '54000000-0000-4000-8000-000000000001', true);

-- What the Edge Function does after a file passed its checks: begin, store, register.
create function test.upload(p_user uuid, p_name text default 'captura.png', p_aal text default 'aal1', p_session uuid default null)
returns uuid language plpgsql as $$
declare
  v_path text := p_user::text || '/' || gen_random_uuid()::text;
begin
  perform public.support_file_begin(p_user, p_aal, p_session);
  insert into storage.objects (bucket_id, name, owner) values ('support-files', v_path, null);
  return (public.support_file_register(p_user, p_aal, p_session, v_path, 'image/png', 1234, p_name,
    encode(extensions.digest(v_path, 'sha256'), 'hex'))->>'id')::uuid;
end
$$;
grant execute on function test.upload(uuid, text, text, uuid) to public;

-- ------------------------------------------------------------------ nothing is reachable directly
select test.login(test.id('client_a'));
select test.fails('select id from public.suggestion_files', 'permission denied', 'a user cannot read the files table');
select test.fails('select path from public.support_file_deletions', 'permission denied', 'nor the deletion queue');
select test.fails($$insert into public.suggestion_files (from_staff, path, mime, size, name, sha256) values (false, 'x', 'image/png', 1, 'x', 'x')$$,
  'permission denied', 'nor write it');
do $$
declare
  fn text;
begin
  foreach fn in array array[
    format('support_file_begin(%L, ''aal1'', null)', test.id('client_a')),
    format('support_file_register(%L, ''aal1'', null, ''x'', ''image/png'', 1, ''x'', ''x'')', test.id('client_a')),
    format('support_file_open(%L, ''aal1'', null, gen_random_uuid())', test.id('client_a')),
    'support_files_collect()', 'support_file_deletions_next()', 'support_file_deletions_done(''{}'')', 'support_files_stray()',
    format('support_attach_files(%L, null, null, ''{}'')', test.id('client_a')),
    'kick_support_files_cleanup()']
  loop
    perform test.ok(test.error_of('select public.' || fn) ilike '%permission denied%', 'a user cannot call ' || fn);
  end loop;
end
$$;
select test.logout();
select test.eq(public, false, 'the bucket is private') from storage.buckets where id = 'support-files';
select test.eq(file_size_limit, 5242880::bigint, 'with a 5 MB limit') from storage.buckets where id = 'support-files';
select test.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                           and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%support-files%'),
               'and no storage policy opens it');
select test.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                           and coalesce(qual, '') !~ 'bucket_id' and coalesce(with_check, '') !~ 'bucket_id'),
               'no storage policy covers every bucket');

-- ------------------------------------------------------------------ who may upload
select test.eq(test.error_of(format($$select test.upload(%L, 'x.png', 'aal1', null)$$, current_setting('test.ag'))), 'mfa_required',
  'an agent needs the second step');
select test.eq(test.error_of(format($$select test.upload(%L, 'x.png', 'aal2', null)$$, current_setting('test.ag'))), 'not_signed_in',
  'and a live session');
select test.ok(test.upload(current_setting('test.ag')::uuid, 'pas.png', 'aal2', current_setting('test.sid')::uuid) is not null,
  'then it uploads like anyone');
update public.profiles set suspended = true where id = test.id('client_b');
select test.ok(test.upload(test.id('client_b')) is not null, 'a suspended author may still upload (to contest)');
update public.profiles set suspended = false where id = test.id('client_b');
select test.fails(format($$select public.support_file_register(%L, 'aal1', null, %L, 'image/png', 1, 'x', %L)$$,
    test.id('client_a'), test.id('client_b')::text || '/' || gen_random_uuid()::text, repeat('a', 64)),
  'file_invalid', 'a file is always stored under its uploader');

-- 30 uploads an hour; 20 waiting at most.
insert into public.rate_events (kind, subject) select 'support_upload', test.id('owner1') from generate_series(1, 30);
select test.fails(format($$select test.upload(%L)$$, test.id('owner1')), 'limit_support_uploads', '30 uploads an hour');
delete from public.rate_events where kind = 'support_upload';
select test.upload(test.id('owner2')) from generate_series(1, 20);
select test.fails(format($$select test.upload(%L)$$, test.id('owner2')), 'too_many_files', '20 files waiting at most');
delete from public.suggestion_files where uploaded_by = test.id('owner2');

-- ------------------------------------------------------------------ attaching: one's own, fresh, not sent
select set_config('test.f1', test.upload(test.id('client_a'), 'ecran-1.png')::text, true);
select set_config('test.f2', test.upload(test.id('client_a'), 'ecran-2.png')::text, true);
select set_config('test.fb', test.upload(test.id('client_b'), 'al-altcuiva.png')::text, true);
select set_config('test.fold', test.upload(test.id('client_a'), 'vechi.png')::text, true);
update public.suggestion_files set created_at = now() - interval '25 hours' where id = current_setting('test.fold')::uuid;

select test.login(test.id('client_a'));
select test.fails(format($$select public.create_support_request('technical', 'Cu fișier', 'Text', null, test.rid(), array[%L]::uuid[])$$,
  current_setting('test.fb')), 'file_invalid', 'never another person''s file');
select test.fails(format($$select public.create_support_request('technical', 'Cu fișier', 'Text', null, test.rid(), array[%L]::uuid[])$$,
  current_setting('test.fold')), 'file_invalid', 'never a file older than 24 hours');
select set_config('test.rid1', gen_random_uuid()::text, true);
select set_config('test.req', (public.create_support_request('technical', 'Cu fișier', 'Text', null,
  current_setting('test.rid1')::uuid, array[current_setting('test.f1')::uuid]))->>'id', true);
select test.eq((public.create_support_request('technical', 'Cu fișier', 'Text', null,
  current_setting('test.rid1')::uuid, array[current_setting('test.f1')::uuid]))->>'id', current_setting('test.req'),
  'sending again with the same request id answers the first result, no error');
select test.eq(jsonb_array_length(r->'files'), 1, 'the request has its file'),
       test.ok(r->'files'->0->'message_id' = 'null'::jsonb, 'with its description'),
       test.ok(not (r->'files'->0 ? 'path') and not (r->'files'->0 ? 'opens'), 'never its storage path, never who opened it')
from public.get_my_support_request(current_setting('test.req')::uuid) r;
select test.fails(format($$select public.reply_my_support_request(%L, 'Încă unul', test.rid(), array[%L]::uuid[])$$,
  current_setting('test.req'), current_setting('test.f1')), 'file_invalid', 'a file is sent once');
select test.ok((public.reply_my_support_request(current_setting('test.req')::uuid, 'Încă o captură', test.rid(),
  array[current_setting('test.f2')::uuid])) ? 'id', 'a message takes files too');
select test.logout();

-- 5 per message.
select set_config('test.six', array_to_string(array(select test.upload(test.id('client_a')) from generate_series(1, 6)), ','), true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.reply_my_support_request(%L, 'Șase', test.rid(), string_to_array(%L, ',')::uuid[])$$,
  current_setting('test.req'), current_setting('test.six')), 'too_many_files', 'at most 5 files per message');
select test.logout();
delete from public.suggestion_files where uploaded_by = test.id('client_a') and suggestion_id is null;

-- 20 per request (2 already).
do $$
declare
  k int;
  v_ids uuid[];
begin
  for k in 1..3 loop
    v_ids := array(select test.upload(test.id('client_a')) from generate_series(1, 5));
    perform test.login(test.id('client_a'));
    perform public.reply_my_support_request(current_setting('test.req')::uuid, 'Lot ' || k, gen_random_uuid(), v_ids);
    perform test.logout();
  end loop;
end
$$;
select set_config('test.extra', array_to_string(array(select test.upload(test.id('client_a')) from generate_series(1, 4)), ','), true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.reply_my_support_request(%L, 'Prea multe', test.rid(), string_to_array(%L, ',')::uuid[])$$,
  current_setting('test.req'), current_setting('test.extra')), 'too_many_files', 'at most 20 files per request');
select test.logout();
select test.eq(count(*), 17::bigint, '17 files on the request (2 + 15), the refused ones not attached')
from public.suggestion_files where suggestion_id = current_setting('test.req')::uuid;

-- ------------------------------------------------------------------ the team's files: same rules
select set_config('test.fs', test.upload(current_setting('test.ag')::uuid, 'pasi.png', 'aal2', current_setting('test.sid')::uuid)::text, true);
select test.login_session(current_setting('test.ag')::uuid, current_setting('test.sid')::uuid);
select test.fails(format($$select public.support_reply_request(%L, 'Al clientului', null, test.rid(), array[%L]::uuid[])$$,
  current_setting('test.req'), split_part(current_setting('test.extra'), ',', 1)), 'file_invalid', 'the team sends only its own files');
select test.ok((public.support_reply_request(current_setting('test.req')::uuid, 'Pașii de urmat', null, test.rid(),
  array[current_setting('test.fs')::uuid])) ? 'id', 'an agent attaches its file');
select public.support_escalate_request(current_setting('test.req')::uuid, 'Verificare', test.rid());
select test.logout();
select set_config('test.fs2', test.upload(current_setting('test.ag')::uuid, 'altul.png', 'aal2', current_setting('test.sid')::uuid)::text, true);
select test.login_session(current_setting('test.ag')::uuid, current_setting('test.sid')::uuid);
select test.fails(format($$select public.support_reply_request(%L, 'x', null, test.rid(), array[%L]::uuid[])$$,
  current_setting('test.req'), current_setting('test.fs2')), 'request_escalated', 'not on an escalated request');
select test.logout();
select test.eq(from_staff, true, 'the team''s file is marked as the team''s'),
       test.ok(suggestion_id = current_setting('test.req')::uuid, 'and attached')
from public.suggestion_files where id = current_setting('test.fs')::uuid;
select test.ok(suggestion_id is null, 'the refused one stays not sent')
from public.suggestion_files where id = current_setting('test.fs2')::uuid;

-- ------------------------------------------------------------------ opening: author or team, always logged
select test.ok(public.support_file_open(test.id('client_a'), 'aal1', null, current_setting('test.f1')::uuid)->>'path' is not null,
  'the author opens its file');
select test.fails(format($$select public.support_file_open(%L, 'aal1', null, %L)$$, test.id('client_b'), current_setting('test.f1')),
  'file_not_found', 'another client cannot');
select test.fails(format($$select public.support_file_open(%L, 'aal1', null, %L)$$, test.id('owner1'), current_setting('test.f1')),
  'file_not_found', 'nor a shop');
select test.fails(format($$select public.support_file_open(%L, 'aal1', null, %L)$$, test.id('client_b'), current_setting('test.fb')),
  'file_not_found', 'a file not sent opens for nobody, its uploader included');
select test.fails(format($$select public.support_file_open(%L, 'aal1', null, %L)$$, current_setting('test.ag'), current_setting('test.f1')),
  'mfa_required', 'the agent needs the second step');
select test.ok(public.support_file_open(current_setting('test.ag')::uuid, 'aal2', current_setting('test.sid')::uuid,
  current_setting('test.fs')::uuid)->>'path' is not null, 'the agent opens one (escalated requests stay readable)');
select test.ok(public.support_file_open(test.id('admin'), 'aal2', null, current_setting('test.f1')::uuid)->>'path' is not null,
  'the admin opens one');
select test.eq(count(*), 3::bigint, 'every opening is in the audit log'),
       test.eq(string_agg(coalesce(actor_role, '?'), ',' order by created_at), 'client,support,admin', 'with who opened it'),
       test.ok(bool_and(after->>'file_id' is not null and entity_id = current_setting('test.req')), 'and which file of which request')
from public.admin_audit_log where action = 'open_request_file';

select test.login(test.id('admin'));
select test.eq(jsonb_array_length(f->'opens'), 2, 'the admin sees who opened the file')
from public.support_get_request(current_setting('test.req')::uuid) r, jsonb_array_elements(r->'files') f
where f->>'id' = current_setting('test.f1');
select test.login_session(current_setting('test.ag')::uuid, current_setting('test.sid')::uuid);
select test.ok(bool_and(not (f ? 'opens')), 'an agent does not')
from public.support_get_request(current_setting('test.req')::uuid) r, jsonb_array_elements(r->'files') f;
select test.logout();

-- "Datele mele": the files of the author's requests, the team's signed „Service-Hub”, never another's.
select set_config('test.a_files', (select count(*) from public.suggestion_files f join public.suggestions s on s.id = f.suggestion_id
                                     where s.author_id = test.id('client_a'))::text, true);
select test.ok(current_setting('test.a_files')::int >= 3, 'the author''s requests have files');
select test.login(test.id('client_a'));
select test.ok(public.export_my_data() ? 'support_requests', 'the export keeps what was there before'),
       test.eq((select count(*) from jsonb_array_elements(public.export_my_data()->'support_files')),
               current_setting('test.a_files')::bigint, 'the export lists every file of the author''s requests'),
       test.ok(exists (select 1 from jsonb_array_elements(public.export_my_data()->'support_files') x
                       where x->>'from' = 'Service-Hub' and x->>'name' = 'pasi.png'), 'the team''s file signed Service-Hub'),
       test.ok(not public.export_my_data()::text like '%' || current_setting('test.ag') || '%', 'never the agent''s id');
select test.login(test.id('client_b'));
select test.ok(not exists (select 1 from jsonb_array_elements(public.export_my_data()->'support_files') x where x->>'name' = 'pasi.png'),
  'another client''s export does not list them');
select test.logout();

-- ------------------------------------------------------------------ cleanup
select set_config('test.pending_old', test.upload(test.id('client_b'), 'uitat.png')::text, true);
select set_config('test.pending_new', test.upload(test.id('client_b'), 'recent.png')::text, true);
update public.suggestion_files set created_at = now() - interval '25 hours' where id = current_setting('test.pending_old')::uuid;
select set_config('test.old_path', (select path from public.suggestion_files where id = current_setting('test.pending_old')::uuid), true);

-- A request closed 91 days ago and one closed 89 days ago, each with a file.
select test.login(test.id('client_b'));
select set_config('test.r91', (public.create_support_request('technical', 'Închisă demult', 'x', null, test.rid()))->>'id', true);
select set_config('test.r89', (public.create_support_request('technical', 'Închisă recent', 'x', null, test.rid()))->>'id', true);
select test.logout();
update public.suggestion_files set suggestion_id = current_setting('test.r91')::uuid, attached_at = now()
where id = current_setting('test.pending_new')::uuid;
select set_config('test.f89', test.upload(test.id('client_b'))::text, true);
update public.suggestion_files set suggestion_id = current_setting('test.r89')::uuid, attached_at = now() where id = current_setting('test.f89')::uuid;
update public.suggestions set status = 'closed', closed_at = now() - interval '91 days' where id = current_setting('test.r91')::uuid;
update public.suggestions set status = 'closed', closed_at = now() - interval '89 days' where id = current_setting('test.r89')::uuid;

select test.ok(public.support_files_collect() >= 2, 'the daily cleanup collects what is due');
select test.eq((select count(*) from public.suggestion_files where id in (current_setting('test.pending_old')::uuid, current_setting('test.pending_new')::uuid)),
  0::bigint, 'a file not sent for 24 hours and the file of a request closed 91 days ago: their rows are gone');
select test.eq((select count(*) from public.suggestion_files where id = current_setting('test.f89')::uuid), 1::bigint,
  'a request closed 89 days ago keeps its file');
select test.ok(current_setting('test.old_path') = any (public.support_file_deletions_next()), 'their paths wait for Storage');
select test.ok(public.support_file_deletions_done(array[current_setting('test.old_path')]) = 1, 'and leave the queue once deleted there');

-- Deleting a request (an account deleted, A3a) queues its files.
select set_config('test.req_paths', (select string_agg(path, ',') from public.suggestion_files where suggestion_id = current_setting('test.req')::uuid), true);
delete from auth.users where id = test.id('client_a');
select test.eq((select count(*) from public.suggestion_files where suggestion_id = current_setting('test.req')::uuid), 0::bigint,
  'an account deleted: its requests'' file rows go');
select test.ok(string_to_array(current_setting('test.req_paths'), ',') <@ public.support_file_deletions_next(1000),
  'and every path is queued for Storage');

-- An object no row knows, older than 24 hours.
insert into storage.objects (bucket_id, name, created_at) values
  ('support-files', test.id('client_b')::text || '/00000000-0000-4000-8000-0000000000aa', now() - interval '2 days'),
  ('support-files', test.id('client_b')::text || '/00000000-0000-4000-8000-0000000000bb', now());
select test.ok((test.id('client_b')::text || '/00000000-0000-4000-8000-0000000000aa') = any (public.support_files_stray()),
  'a stray object older than 24 hours is found'),
       test.ok(not ((test.id('client_b')::text || '/00000000-0000-4000-8000-0000000000bb') = any (public.support_files_stray())),
  'a fresh one (an upload in progress) is left alone');

rollback;
