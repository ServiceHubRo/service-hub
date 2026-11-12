-- A6 under real concurrency (a second and third database session through dblink, as 90_concurrency.sql
-- and 157_retention_concurrency.sql):
--   M6  two admins suspending each other at the same moment: the second waits for the first, then is
--       refused (it is suspended by then); one active admin always remains.
--   H2  two openings of the same client card at the same moment: one audit entry, not two.
-- This file commits its own small world (unique emails) and removes it at the end.
set client_min_messages = warning;
create extension if not exists dblink schema test;

-- Leftovers of an interrupted earlier run on the same database.
do $$
begin
  if to_regclass('test.a162_parked') is not null then
    update public.profiles set suspended = false where id in (select id from test.a162_parked);
    drop table test.a162_parked;
  end if;
end
$$;
delete from public.security_events where actor_id in (select id from auth.users where email like 'a162-%@test.local');
delete from auth.users where email like 'a162-%@test.local';
delete from test.ids where name like 'a162_%';

insert into test.ids values ('a162_a', test.sign_up('a162-a@test.local', '{"role":"client","name":"Admin A162"}'));
insert into test.ids values ('a162_b', test.sign_up('a162-b@test.local', '{"role":"client","name":"Admin B162"}'));
insert into test.ids values ('a162_c', test.sign_up('a162-c@test.local', '{"role":"client","name":"Client C162"}'));
select public.promote_to_admin('a162-a@test.local');
select public.promote_to_admin('a162-b@test.local');
-- Only these two are active admins while the race runs (any other admin of the database is put aside
-- and restored at the end), so "the last active admin" is real here.
create table test.a162_parked as select id from public.profiles where role = 'admin' and not suspended and id not in (test.id('a162_a'), test.id('a162_b'));
update public.profiles set suspended = true where id in (select id from test.a162_parked);
select test.admin_session(test.id('a162_a'));
select test.admin_session(test.id('a162_b'));

create or replace function test.a162_conn(p_name text) returns text language sql as $$
  select 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '')
    || ' application_name=' || p_name
$$;

-- Waits (up to 10 s) until the session named waits on a lock.
create or replace function test.a162_waiting(p_name text) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    if exists (select 1 from pg_stat_activity where application_name = p_name and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.1);
  end loop;
  return false;
end
$$;

-- ================================================================================ M6: suspending each other
-- Session B suspends A and holds its transaction open (the admin rows stay locked).
select test.dblink_connect('a162b', test.a162_conn('a162b'));
select test.dblink_exec('a162b', 'begin');
select * from test.dblink('a162b', format('select 1 from (select test.login(%L::uuid)) x', test.id('a162_b'))) as t(r int);
select * from test.dblink('a162b', format($q$select (public.admin_set_admin_suspended(%L::uuid, true, 'Suspect', gen_random_uuid()))->>'suspended'$q$,
  test.id('a162_a'))) as t(r text);
-- Session A, at the same moment, suspends B: it waits for B's locks.
select test.dblink_connect('a162a', test.a162_conn('a162a'));
select test.dblink_exec('a162a', 'begin');
select * from test.dblink('a162a', format('select 1 from (select test.login(%L::uuid)) x', test.id('a162_a'))) as t(r int);
select test.dblink_send_query('a162a', format($q$select (public.admin_set_admin_suspended(%L::uuid, true, 'Suspect', gen_random_uuid()))->>'suspended'$q$,
  test.id('a162_b')));
select test.ok(test.a162_waiting('a162a'), 'the second admin waits for the first');
select test.dblink_exec('a162b', 'commit');
-- A's call, now that B committed: refused, because A is suspended by then.
select * from test.dblink_get_result('a162a', false) as t(r text);
select test.ok(test.dblink_error_message('a162a') like '%account_suspended%', 'the second suspension is refused (its author is suspended by then)');
select * from test.dblink_get_result('a162a', false) as t(r text);
select test.dblink_exec('a162a', 'rollback');
select test.dblink_disconnect('a162a');
select test.dblink_disconnect('a162b');
select test.eq((select suspended from public.profiles where id = test.id('a162_a')), true, 'A is suspended');
select test.eq((select suspended from public.profiles where id = test.id('a162_b')), false, 'B is still active');
select test.ok(exists (select 1 from public.profiles where role = 'admin' and not suspended and deleted_at is null),
               'one active admin always remains');
select test.eq((select count(*) from auth.sessions where user_id = test.id('a162_a')), 0::bigint, 'A''s sessions ended with it');

-- ================================================================================ H2: the same card opened twice at once
select test.dblink_connect('a162x', test.a162_conn('a162x'));
select test.dblink_exec('a162x', 'begin');
select * from test.dblink('a162x', format('select 1 from (select test.login(%L::uuid)) x', test.id('a162_b'))) as t(r int);
select * from test.dblink('a162x', format($q$select (public.admin_get_client(%L::uuid))->'profile'->>'display_id'$q$, test.id('a162_c'))) as t(r text);
select test.dblink_connect('a162y', test.a162_conn('a162y'));
select test.dblink_exec('a162y', 'begin');
select * from test.dblink('a162y', format('select 1 from (select test.login(%L::uuid)) x', test.id('a162_b'))) as t(r int);
select test.dblink_send_query('a162y', format($q$select (public.admin_get_client(%L::uuid))->'profile'->>'display_id'$q$, test.id('a162_c')));
select test.ok(test.a162_waiting('a162y'), 'the second opening waits for the first');
select test.dblink_exec('a162x', 'commit');
select test.eq((select count(*) from test.dblink_get_result('a162y') as t(r text) where r is not null), 1::bigint, 'the second opening answers too');
select * from test.dblink_get_result('a162y', false) as t(r text);
select test.dblink_exec('a162y', 'commit');
select test.dblink_disconnect('a162y');
select test.dblink_disconnect('a162x');
select test.eq(test.count($$select 1 from public.admin_audit_log where action = 'view_client' and entity_id = '$$ || test.id('a162_c') || $$'$$),
               1::bigint, 'two openings at the same moment: one audit entry');

-- Clean up: the other admins back, the world of this file, its audit rows and events.
update public.profiles set suspended = false where id in (select id from test.a162_parked);
drop table test.a162_parked;
do $$
begin
  perform test.unlock_audit_log();
  delete from public.admin_audit_log where admin_id in (test.id('a162_a'), test.id('a162_b'))
     or entity_id in (test.id('a162_a')::text, test.id('a162_b')::text, test.id('a162_c')::text);
  delete from public.audit_log_unlocks where txid = txid_current();
end
$$;
delete from public.security_events where actor_id in (test.id('a162_a'), test.id('a162_b'))
   or subject_id in (test.id('a162_a')::text, test.id('a162_b')::text);
delete from public.request_log where user_id in (test.id('a162_a'), test.id('a162_b'));
delete from auth.users where id in (test.id('a162_a'), test.id('a162_b'), test.id('a162_c'));
delete from test.ids where name like 'a162_%';
drop function test.a162_conn(text);
drop function test.a162_waiting(text);
drop extension dblink;
select test.eq((select count(*) from auth.users where email like 'a162-%@test.local'), 0::bigint, 'nothing left behind');
