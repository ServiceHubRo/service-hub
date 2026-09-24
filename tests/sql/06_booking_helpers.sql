-- Helpers for the booking-engine tests (T03). Creates functions only; each test file builds its
-- world with test.make_world() inside its own transaction and rolls back.

-- Today in Bucharest (callable under any test role).
create function test.today() returns date
language sql
stable
security definer
as $$ select public.bucharest_today() $$;

-- The n-th Monday–Friday on or after the day after tomorrow (Bucharest), so a slot on it is always
-- open at the default hours, past the 2 h notice and inside the 30-day window.
create function test.workday(n int default 1) returns date
language sql
stable
security definer
as $$
  select d from (
    select public.bucharest_today() + i as d
    from generate_series(2, 60) i
    where extract(isodow from public.bucharest_today() + i) between 1 and 5
  ) x order by d offset greatest(n, 1) - 1 limit 1
$$;

-- The next Saturday (closed by default).
create function test.saturday() returns date
language sql
stable
security definer
as $$
  select public.bucharest_today() + i from generate_series(1, 7) i
  where extract(isodow from public.bucharest_today() + i) = 6 limit 1
$$;

-- A fresh request id.
create function test.rid() returns uuid
language sql
volatile
as $$ select gen_random_uuid() $$;

-- Runs a statement and returns the error code it raised ('ok' when it succeeded). Business errors
-- carry the code as their message; any other error comes back as its full message.
create function test.error_of(statement text) returns text
language plpgsql
as $$
declare
  msg text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics msg = message_text;
  return msg;
end
$$;

-- The JSON parameters (error detail) a statement raised with, or null.
create function test.error_params(statement text) returns jsonb
language plpgsql
as $$
declare
  d text;
begin
  execute statement;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return nullif(d, '')::jsonb;
end
$$;

-- Books a slot through create_booking as the given client; returns the booking id.
-- Without a car id, a typed car with the given plate is used (not saved).
create function test.book(p_client uuid, p_shop uuid, p_date date, p_slot time,
                          p_service text default 'ulei', p_plate text default 'BV 01 TST',
                          p_car_id uuid default null) returns uuid
language plpgsql
as $$
declare
  v public.bookings%rowtype;
begin
  perform test.login(p_client);
  v := public.create_booking(
    p_shop_id => p_shop, p_service_id => p_service, p_date => p_date, p_slot => p_slot,
    p_request_id => gen_random_uuid(), p_car_id => p_car_id,
    p_car => case when p_car_id is null
                  then jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', p_plate) end);
  perform test.logout();
  return v.id;
end
$$;

-- Writes a booking straight into the table with the safety trigger off: for states the engine can
-- only reach over time (a confirmed booking whose slot has passed, an old done job). Needs the
-- table owner (the role that runs the migrations); the tests roll it back with everything else.
create function test.raw_booking(p_shop uuid, p_client uuid, p_status text, p_date date, p_slot time,
                                 p_plate text default 'BV 01 TST', p_odometer int default null) returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  alter table public.bookings disable trigger bookings_guard;
  insert into public.bookings (id, ref, shop_id, client_id, service_id, client_name, client_lang, car_snapshot,
                               date, slot, status, odometer, done_at, created_at)
  values (v_id, 'T-' || left(v_id::text, 8), p_shop, p_client, 'ulei', 'Test Client', 'ro',
          jsonb_build_object('make', 'Dacia', 'model', 'Logan', 'plate', p_plate,
                             'plate_norm', upper(regexp_replace(p_plate, '[\s-]', '', 'g'))),
          p_date, p_slot, p_status, p_odometer,
          case when p_status = 'done' then (p_date + p_slot) at time zone 'Europe/Bucharest' end,
          now() - interval '30 days');
  alter table public.bookings enable trigger bookings_guard;
  return v_id;
end
$$;

-- Adds a sent quote (like send_quote would) to a booking written with test.raw_booking.
create function test.raw_quote(p_booking uuid, p_items jsonb default '[{"name":"Plăcuțe","price":280},{"name":"Manoperă","price":120}]',
                               p_fee numeric default 80) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.quotes (booking_id, version, status, inspection_fee, total_sent, expires_at)
  values (p_booking, coalesce((select max(version) from public.quotes where booking_id = p_booking), 0) + 1, 'sent', p_fee,
          (select sum((i->>'price')::numeric) from jsonb_array_elements(p_items) i), now() + interval '3 days')
  returning id into v_id;
  insert into public.quote_items (quote_id, position, name, price)
  select v_id, ord, i->>'name', (i->>'price')::numeric
  from jsonb_array_elements(p_items) with ordinality t(i, ord);
  return v_id;
end
$$;

-- The item ids of a quote, in position order.
create function test.quote_item_ids(p_quote uuid) returns uuid[]
language sql
stable
as $$ select array_agg(id order by position) from public.quote_items where quote_id = p_quote $$;

-- The current quote waiting for the client.
create function test.sent_quote(p_booking uuid) returns uuid
language sql
stable
security definer
as $$ select id from public.quotes where booking_id = p_booking and status = 'sent' order by version desc limit 1 $$;

-- A booking's current status, whoever is logged in.
create function test.status_of(p_booking uuid) returns text
language sql
stable
security definer
as $$ select status from public.bookings where id = p_booking $$;

grant execute on all functions in schema test to public;
