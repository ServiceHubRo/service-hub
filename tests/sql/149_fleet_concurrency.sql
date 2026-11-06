-- T72–T77 under real concurrency (two database sessions through dblink, as 90_concurrency.sql):
--   M5  two cancels of the same booking: the second waits for the first's lock, then is refused;
--   M2  two expenses on the same vehicle: the second waits, then is checked against the first's km;
--   M6  two workers at once: every event processed once, one notice per user and key;
--       a worker killed mid-event: rolled back, the attempt counted, retried after its lease, once.
-- This file commits its own small world (unique emails) and deletes it at the end.
set client_min_messages = warning;
create extension if not exists dblink schema test;

-- Leftovers of an interrupted earlier run.
delete from public.companies where name = 'Concurență Flotă';
delete from public.bookings where shop_id in (select s.id from public.shops s join auth.users u on u.id = s.owner_id where u.email = 'c149-owner@test.local');
delete from auth.users where email like 'c149-%@test.local';
delete from test.ids where name like 'c149_%';

do $$
declare
  v_owner uuid := test.sign_up('c149-owner@test.local', '{"role":"shop","name":"Conc","shop_name":"Concurență 149","city":"Brașov"}');
  v_admin uuid := test.sign_up('c149-admin@test.local', '{"role":"client","name":"Admin Flotă","phone":"0723000149","lang":"ro","terms_version":"2026-09"}');
  v_mgr uuid := test.sign_up('c149-mgr@test.local', '{"role":"client","name":"Manager Flotă","phone":"0723000150","lang":"ro","terms_version":"2026-09"}');
  v_shop uuid;
  v_co uuid;
  v uuid;
  v_ids uuid[] := '{}';
begin
  select id into v_shop from public.shops where owner_id = v_owner;
  update public.profiles set fleet_beta = true where id in (v_admin, v_mgr);
  perform test.login(v_admin);
  v_co := (public.create_company('Concurență Flotă', null, null, null, gen_random_uuid())->>'id')::uuid;
  perform public.invite_company_member(v_co, 'c149-mgr@test.local', 'manager', repeat('c9', 32), gen_random_uuid());
  for i in 1..6 loop
    v := (public.fleet_save_vehicle(v_co, null, jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', 'B 14' || i || ' CON'), gen_random_uuid())->>'id')::uuid;
    v_ids := v_ids || v;
  end loop;
  perform test.login(v_mgr);
  perform public.accept_company_invite(repeat('c9', 32), gen_random_uuid());
  perform test.logout();
  insert into test.ids select 'c149_v' || n, x from unnest(v_ids) with ordinality u(x, n);
  insert into test.ids values ('c149_owner', v_owner), ('c149_admin', v_admin), ('c149_mgr', v_mgr), ('c149_shop', v_shop), ('c149_co', v_co);
end
$$;

-- A booking of a company vehicle, as the server writes it.
create or replace function test.c149_booking(p_vehicle text, p_status text, p_day date) returns uuid
language sql security definer as $$
  insert into public.bookings (shop_id, client_id, service_id, client_name, client_lang, car_snapshot, date, slot, status, company_id, company_vehicle_id)
  values (test.id('c149_shop'), test.id('c149_admin'), 'ulei', 'Admin Flotă', 'ro', '{"make":"Dacia","model":"Logan"}', p_day, '10:00', p_status,
          test.id('c149_co'), test.id(p_vehicle))
  returning id
$$;
create or replace function test.c149_cancel(p_booking uuid) returns text
language plpgsql as $$
declare
  v public.bookings%rowtype;
begin
  perform test.login(test.id('c149_mgr'));
  v := public.fleet_cancel_booking(p_booking, 'Anulare concurentă', gen_random_uuid());
  perform test.logout();
  return v.status;
end $$;
create or replace function test.c149_expense(p_day date, p_km int) returns text
language plpgsql as $$
declare
  v jsonb;
begin
  perform test.login(test.id('c149_mgr'));
  v := public.fleet_save_expense(test.id('c149_co'), null, jsonb_build_object('vehicle_id', test.id('c149_v1'), 'category', 'parts', 'day', p_day,
    'amount', 100 + p_km % 100, 'supplier', 'Furnizor ' || p_km, 'odometer', p_km), gen_random_uuid());
  perform test.logout();
  return v->>'id';
end $$;

-- Session A runs a_sql in an open transaction; session B runs b_sql and must wait for A's lock; A
-- commits; B's value or error is returned.
create or replace function test.race149(a_sql text, b_sql text) returns text
language plpgsql as $$
declare
  v_db text := 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '');
  v_waiting boolean := false;
  v_result text;
  v_error text;
begin
  perform test.dblink_connect('r149_a', v_db || ' application_name=r149_a');
  perform test.dblink_connect('r149_b', v_db || ' application_name=r149_b');
  perform test.dblink_exec('r149_a', 'begin');
  perform * from test.dblink('r149_a', a_sql) as t(r text);
  perform test.dblink_send_query('r149_b', b_sql);
  for i in 1..200 loop
    select exists (select 1 from pg_stat_activity where application_name = 'r149_b' and wait_event_type = 'Lock') into v_waiting;
    exit when v_waiting;
    perform pg_sleep(0.02);
  end loop;
  perform test.dblink_exec('r149_a', 'commit');
  select r into v_result from test.dblink_get_result('r149_b', false) as t(r text);
  v_error := nullif(test.dblink_error_message('r149_b'), 'OK');
  perform * from test.dblink_get_result('r149_b', false) as t(r text);
  perform test.dblink_disconnect('r149_a');
  perform test.dblink_disconnect('r149_b');
  if not v_waiting then
    raise exception 'FAILED: session B never waited for session A''s lock (B: %)', coalesce(v_error, v_result);
  end if;
  return coalesce(v_error, v_result);
end $$;

-- ------------------------------------------------------------------ M5: two cancels at once
select set_config('test.c149_b', test.c149_booking('c149_v2', 'pending', test.workday(5))::text, false);
select test.ok(test.race149(
  format($$select test.c149_cancel(%L)$$, current_setting('test.c149_b')),
  format($$select test.c149_cancel(%L)$$, current_setting('test.c149_b'))
) like '%wrong_status%', 'M5: the second cancel waits, then sees the booking cancelled and is refused');
select test.eq(count(*), 1::bigint, 'one thread message') from public.messages where booking_id = current_setting('test.c149_b')::uuid and event = 'booking_cancelled_company';

-- ------------------------------------------------------------------ M2: two expenses on one vehicle at once
select test.ok(test.race149(
  format($$select test.c149_expense(%L, 100500)$$, test.today() - 3),
  format($$select test.c149_expense(%L, 100400)$$, test.today() - 1)
) like '%odometer_lower%', 'M2: the second expense waits for the vehicle, then sees the first''s km and is refused');
select test.eq(count(*), 1::bigint, 'one reading') from public.fleet_odometer_readings where vehicle_id = test.id('c149_v1') and deleted_at is null;

-- ------------------------------------------------------------------ M6: a worker killed mid-event
delete from public.fleet_events where company_id = test.id('c149_co');
select test.raw_quote(test.c149_booking('c149_v3', 'quote_sent', test.workday(6)));
select set_config('test.c149_ev', (select id::text from public.fleet_events where company_id = test.id('c149_co') and event = 'fleet_quote_waiting'), false);
do $$
declare
  v_db text := 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '');
begin
  perform test.dblink_connect('w149', v_db);
  perform * from test.dblink('w149', 'select public.fleet_claim_event()::text') as t(r text);  -- committed: attempt counted
  perform test.dblink_exec('w149', 'begin');
  perform * from test.dblink('w149', format('select public.fleet_process_event(%s)::text', current_setting('test.c149_ev'))) as t(r text);
  perform test.dblink_disconnect('w149');  -- the session dies before its commit
end
$$;
select test.ok((select attempts = 1 and processed_at is null and locked_until > now() from public.fleet_events where id = current_setting('test.c149_ev')::bigint),
  'killed mid-event: rolled back, the attempt counted, still held');
select test.eq(count(*), 0::bigint, 'nothing was sent') from public.fleet_notices where fleet_event_id = current_setting('test.c149_ev')::bigint;
call public.process_fleet_events();
select test.eq((select processed_at is null from public.fleet_events where id = current_setting('test.c149_ev')::bigint), true,
  'while held, no other worker takes it');
update public.fleet_events set locked_until = now() - interval '1 second' where id = current_setting('test.c149_ev')::bigint;  -- the 5 minutes pass
call public.process_fleet_events();
select test.ok((select attempts = 2 and processed_at is not null from public.fleet_events where id = current_setting('test.c149_ev')::bigint),
  'after the lease: retried and processed (the procedure commits per event)');
select test.eq(count(*), 1::bigint, 'one notice for the manager (the admin booked it)') from public.fleet_notices where fleet_event_id = current_setting('test.c149_ev')::bigint;

-- ------------------------------------------------------------------ M6: two workers at once
delete from public.fleet_events where company_id = test.id('c149_co');
select test.raw_quote(test.c149_booking('c149_v' || i, 'quote_sent', test.workday(7 + i))) from generate_series(4, 6) i;
do $$
declare
  v_db text := 'dbname=' || current_database()
    || coalesce(' host=' || coalesce(host(inet_server_addr()), '127.0.0.1') || ' user=' || current_user
                || ' password=' || nullif(current_setting('test.dblink_password', true), ''), '');
begin
  perform test.dblink_connect('w149a', v_db);
  perform test.dblink_connect('w149b', v_db);
  perform test.dblink_send_query('w149a', 'call public.process_fleet_events()');
  perform test.dblink_send_query('w149b', 'call public.process_fleet_events()');
  perform * from test.dblink_get_result('w149a', false) as t(r text);
  perform * from test.dblink_get_result('w149b', false) as t(r text);
  perform test.dblink_disconnect('w149a');
  perform test.dblink_disconnect('w149b');
end
$$;
select test.eq(count(*), 3::bigint, 'two workers: every event processed') from public.fleet_events where company_id = test.id('c149_co') and processed_at is not null;
select test.eq(count(*), 3::bigint, 'each once: one notice per user and key') from public.fleet_notices n
join public.fleet_events e on e.id = n.fleet_event_id where e.company_id = test.id('c149_co');
select test.eq(count(*), 0::bigint, 'no attempt beyond the first') from public.fleet_events where company_id = test.id('c149_co') and attempts > 1;

-- ------------------------------------------------------------------ clean up the committed world
delete from public.notification_events where user_id in (test.id('c149_admin'), test.id('c149_mgr'), test.id('c149_owner'));
delete from public.request_log where user_id in (test.id('c149_admin'), test.id('c149_mgr'));
delete from public.fleet_odometer_readings where company_id = test.id('c149_co');
delete from public.fleet_expenses where company_id = test.id('c149_co');
delete from public.messages where booking_id in (select id from public.bookings where shop_id = test.id('c149_shop'));
delete from public.bookings where shop_id = test.id('c149_shop');
delete from public.companies where id = test.id('c149_co');
delete from auth.users where id in (test.id('c149_owner'), test.id('c149_admin'), test.id('c149_mgr'));
delete from test.ids where name like 'c149_%';
drop function test.race149(text, text);
drop function test.c149_booking(text, text, date);
drop function test.c149_cancel(uuid);
drop function test.c149_expense(date, int);
drop extension dblink;
select test.eq(count(*), 0::bigint, 'nothing left behind') from public.companies where name = 'Concurență Flotă';
