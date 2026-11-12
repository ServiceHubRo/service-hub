-- A3c2b1 under real concurrency (a second database session through dblink, as 90_concurrency.sql):
-- while the author's reply holds a request, the retention run skips it (SKIP LOCKED) instead of
-- waiting or deleting it, and once the reply is committed the request is no longer due. This file
-- commits its own small world (unique emails) and removes it at the end.
set client_min_messages = warning;
create extension if not exists dblink schema test;

-- Leftovers of an interrupted earlier run on the same database.
delete from public.suggestions where author_id in (select id from auth.users where email like 'r157-%@test.local');
delete from auth.users where email like 'r157-%@test.local';
delete from test.ids where name like 'r157_%';

insert into test.ids values ('r157_client', test.sign_up('r157-client@test.local', '{"role":"client","name":"Autor Concurent"}'));
insert into public.suggestions (author_id, author_role, title, body, category, status)
values (test.id('r157_client'), 'client', 'Concurență', 'Text', 'technical', 'waiting_user');
insert into test.ids select 'r157_req', id from public.suggestions where author_id = test.id('r157_client');
set session_replication_role = replica;
update public.suggestions set last_activity_at = now() - interval '13 months' where id = test.id('r157_req');
set session_replication_role = origin;

-- The job switched on for this file only (as admin_set_retention_job does), off again at the end.
select set_config('sh.retention_switch', 'on', false);
update public.retention_jobs set enabled = true, batch_size = 50 where key = 'support_requests';
select set_config('sh.retention_switch', '', false);

create or replace function test.r157_conn() returns text language sql as $$
  select 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '')
    || ' application_name=r157'
$$;

-- Session B: the author starts replying and holds the request (its transaction stays open).
select test.dblink_connect('r157', test.r157_conn());
select test.dblink_exec('r157', 'begin');
select * from test.dblink('r157', format($q$
  select test.login(%L::uuid, 'aal1');
  select (public.reply_my_support_request(%L::uuid, 'Încă am problema.', gen_random_uuid()))->>'id'
$q$, test.id('r157_client'), test.id('r157_req'))) as t(r text);

-- The run does not wait for the author and does not delete the request.
select test.eq(r, '{"failed": 0, "remaining": 1, "deleted_files": 0, "deleted_requests": 0}'::jsonb,
  'a request held by a reply in progress is skipped, not waited for')
from public.run_support_retention() r;
select test.eq((select count(*) from public.suggestions where id = test.id('r157_req')), 1::bigint, 'the request is still there');

-- The reply is committed: the request is not due any more.
select test.dblink_exec('r157', 'commit');
select test.dblink_disconnect('r157');
select test.ok((select last_activity_at from public.suggestions where id = test.id('r157_req')) > now() - interval '1 hour',
  'the reply moved its real activity');
select test.eq(r, '{"failed": 0, "remaining": 0, "deleted_files": 0, "deleted_requests": 0}'::jsonb, 'the next run leaves it alone')
from public.run_support_retention() r;

-- Clean up: the job off, its runs and audit rows, the world of this file.
update public.retention_jobs set enabled = false where key = 'support_requests';
delete from public.retention_runs where job = 'support_requests';
update public.retention_jobs set last_run_at = null where key = 'support_requests';
delete from public.admin_audit_log where action = 'retention_run';
delete from public.request_log where user_id = test.id('r157_client');
delete from public.notification_events where params->>'request_id' = test.id('r157_req')::text;
delete from public.suggestions where id = test.id('r157_req');
delete from auth.users where id = test.id('r157_client');
delete from test.ids where name like 'r157_%';
drop function test.r157_conn();
drop extension dblink;
select test.eq((select count(*) from public.retention_runs), 0::bigint, 'nothing left behind'),
       test.eq((select count(*) from public.retention_jobs where enabled), 0::bigint, 'every job off again');
