-- Real concurrency (CLAUDE.md §6.3): two separate database sessions race for the same place.
-- Session A books and holds its transaction open; session B books the same place and must wait
-- for A's row lock; when A commits, B is refused. Uses dblink to open the second session, so this
-- file commits its own small world (unique emails) and deletes it at the end.
set client_min_messages = warning; -- dblink relays the losing session's error as a notice
create extension if not exists dblink schema test;

-- Leftovers of an interrupted earlier run on the same database.
delete from public.bookings where shop_id in (select s.id from public.shops s join auth.users u on u.id = s.owner_id
                                              where u.email = 'conc-owner@test.local');
delete from auth.users where email like 'conc-%@test.local';
delete from test.ids where name like 'conc_%';

do $$
declare
  v_owner uuid := test.sign_up('conc-owner@test.local', '{"role":"shop","name":"Conc","shop_name":"Concurență","city":"Brașov"}');
  v_shop uuid;
begin
  select id into v_shop from public.shops where owner_id = v_owner;
  update public.profiles set phone_verified_by_admin = true where id = v_owner;
  insert into public.shop_services (shop_id, service_id) values (v_shop, 'ulei');
  update public.shops set daily_capacity = 1 where id = v_shop;
  insert into test.ids values
    ('conc_owner', v_owner), ('conc_shop', v_shop),
    ('conc_c1', test.sign_up('conc-c1@test.local', '{"role":"client","name":"Unu Client"}')),
    ('conc_c2', test.sign_up('conc-c2@test.local', '{"role":"client","name":"Doi Client"}'));
end
$$;

-- Books as a client with a given request id; returns the booking id (or raises).
create or replace function test.book_rid(p_client uuid, p_date date, p_slot time, p_rid uuid) returns text
language plpgsql as $$
declare
  v public.bookings%rowtype;
begin
  perform test.login(p_client);
  v := public.create_booking(p_shop_id => test.id('conc_shop'), p_service_id => 'ulei', p_date => p_date,
                             p_slot => p_slot, p_request_id => p_rid, p_car => '{"make":"Dacia","model":"Logan"}');
  perform test.logout();
  return v.id::text;
end $$;

-- Runs `a_sql` in session A inside an open transaction, starts `b_sql` in session B, waits until B
-- is blocked on a lock, commits A, and returns B's outcome: its value, or its error message.
create or replace function test.race(a_sql text, b_sql text) returns text
language plpgsql as $$
declare
  -- On the local Supabase stack `postgres` is not a superuser, so dblink needs its password:
  -- PGOPTIONS='-c test.dblink_password=postgres' (the stack's default, nothing secret).
  v_db text := 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '');
  v_waiting boolean := false;
  v_result text;
  v_error text;
begin
  perform test.dblink_connect('race_a', v_db || ' application_name=race_a');
  perform test.dblink_connect('race_b', v_db || ' application_name=race_b');
  perform test.dblink_exec('race_a', 'begin');
  perform * from test.dblink('race_a', a_sql) as t(r text);
  perform test.dblink_send_query('race_b', b_sql);
  for i in 1..200 loop
    select exists (select 1 from pg_stat_activity where application_name = 'race_b' and wait_event_type = 'Lock')
      into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform test.dblink_exec('race_a', 'commit');
  select r into v_result from test.dblink_get_result('race_b', false) as t(r text);
  v_error := nullif(test.dblink_error_message('race_b'), 'OK');
  perform * from test.dblink_get_result('race_b', false) as t(r text); -- drain
  perform test.dblink_disconnect('race_a');
  perform test.dblink_disconnect('race_b');
  if not v_waiting then
    raise exception 'FAILED: session B never waited for session A''s lock (B: %)', coalesce(v_error, v_result);
  end if;
  return coalesce(v_error, v_result);
end $$;

-- ------------------------------------------------------------------ the last place of the day
select test.ok(test.race(
  format($$select test.book_rid(%L, %L, '09:00', gen_random_uuid())$$, test.id('conc_c1'), test.workday(1)),
  format($$select test.book_rid(%L, %L, '10:00', gen_random_uuid())$$, test.id('conc_c2'), test.workday(1))
) like '%day_full%', 'two clients, one place left in the day: the second waits, then gets day_full');
select test.eq(count(*), 1::bigint, 'exactly one booking on that day')
from public.bookings where shop_id = test.id('conc_shop') and date = test.workday(1);

-- ------------------------------------------------------------------ the last car in a slot
update public.shops set daily_capacity = 10 where id = test.id('conc_shop');
select test.ok(test.race(
  format($$select test.book_rid(%L, %L, '09:00', gen_random_uuid())$$, test.id('conc_c1'), test.workday(2)),
  format($$select test.book_rid(%L, %L, '09:00', gen_random_uuid())$$, test.id('conc_c2'), test.workday(2))
) like '%slot_full%', 'two clients, same time, one car per slot: the second gets slot_full');
select test.eq(count(*), 1::bigint, 'exactly one booking at that time')
from public.bookings where shop_id = test.id('conc_shop') and date = test.workday(2) and slot = '09:00';

-- ------------------------------------------------------------------ both fit: the lock only queues them
select test.ok(test.race(
  format($$select test.book_rid(%L, %L, '11:00', gen_random_uuid())$$, test.id('conc_c2'), test.workday(2)),
  format($$select test.book_rid(%L, %L, '12:00', gen_random_uuid())$$, test.id('conc_c2'), test.workday(2))
) ~ '^[0-9a-f-]{36}$', 'when there is room, the waiting booking succeeds after the first');

-- ------------------------------------------------------------------ the same tap sent twice at once
select set_config('test.rid', gen_random_uuid()::text, false);
select set_config('test.first', test.race(
  format($$select test.book_rid(%L, %L, '14:00', %L)$$, test.id('conc_c2'), test.workday(3), current_setting('test.rid')),
  format($$select test.book_rid(%L, %L, '14:00', %L)$$, test.id('conc_c2'), test.workday(3), current_setting('test.rid'))
), false);
select test.ok(current_setting('test.first') ~ '^[0-9a-f-]{36}$', 'the duplicate request waits and returns a booking, not an error');
select test.eq(count(*), 1::bigint, 'the duplicate request created nothing')
from public.bookings where shop_id = test.id('conc_shop') and date = test.workday(3);
select test.eq(min(id::text), current_setting('test.first'), 'both answers are the same booking')
from public.bookings where shop_id = test.id('conc_shop') and date = test.workday(3);

-- ------------------------------------------------------------------ per-client limits hold under a race
-- conc_c1 holds 2 active bookings at this shop (won the first two races); the limit is 3.
-- Racing two more: only one may win.
select test.eq(count(*), 2::bigint, 'conc_c1 starts with 2 active bookings here')
from public.bookings where shop_id = test.id('conc_shop') and client_id = test.id('conc_c1');
select test.ok(test.race(
  format($$select test.book_rid(%L, %L, '15:00', gen_random_uuid())$$, test.id('conc_c1'), test.workday(4)),
  format($$select test.book_rid(%L, %L, '16:00', gen_random_uuid())$$, test.id('conc_c1'), test.workday(4))
) like '%limit_active_shop%', 'one client racing two bookings past the per-shop limit: the second is refused');

-- ------------------------------------------------------------------ clean up the committed world
delete from public.request_log where user_id in (test.id('conc_c1'), test.id('conc_c2'));
delete from public.bookings where shop_id = test.id('conc_shop');
delete from auth.users where id in (test.id('conc_owner'), test.id('conc_c1'), test.id('conc_c2'));
delete from test.ids where name like 'conc_%';
drop function test.race(text, text);
drop function test.book_rid(uuid, date, time, uuid);
drop extension dblink;
select test.eq(count(*), 0::bigint, 'nothing left behind') from public.shops where name = 'Concurență';
