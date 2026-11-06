-- M5 — the manager's cancel and „Cere modificări”: every booking status, the shop's deadline, a slot
-- already started, personal bookings untouched, rights per role, a read-only company (cancel only), the
-- same request twice, the slot freed and the waitlist told, one thread message and one shop
-- notification, a change request once per quote. Two cancels racing: tests/sql/149_fleet_concurrency.sql.
begin;
select test.make_fleet();

create function pg_temp.messages(p_booking uuid, p_event text) returns bigint
language sql security definer as $$ select count(*) from public.messages where booking_id = p_booking and event = p_event $$;
-- One per member of the shop (owner and staff1): no duplicates.
create function pg_temp.shop_notices(p_booking uuid, p_event text) returns bigint
language sql security definer as $$
  select case when count(*) = count(distinct user_id) and count(distinct user_id) =
                   (select count(*) from public.shop_staff st where st.shop_id = test.id('shop1') and st.accepted_at is not null)
              then 1 else count(*) end
  from public.notification_events where booking_id = p_booking and event = p_event
$$;
create function pg_temp.decisions(p_quote uuid) returns bigint
language sql security definer as $$ select count(*) from public.company_quote_decisions where quote_id = p_quote and decision = 'changes_requested' $$;
create function pg_temp.cancel(p_booking uuid, p_reason text default 'Vehiculul nu mai este disponibil') returns public.bookings
language sql as $$ select public.fleet_cancel_booking(p_booking, p_reason, gen_random_uuid()) $$;
create function pg_temp.set_deadline(p_hours int) returns void
language sql security definer as $$ update public.shops set cancel_deadline_hours = p_hours where id = test.id('shop1') $$;
-- Moves a booking's slot as time would (the guard refuses a past slot for real writes, so it is set aside here).
create function pg_temp.slot_of(p_booking uuid, p_at timestamptz) returns void
language plpgsql security definer as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.bookings set date = (p_at at time zone 'Europe/Bucharest')::date, slot = (p_at at time zone 'Europe/Bucharest')::time where id = p_booking;
  perform set_config('session_replication_role', 'origin', true);
end
$$;
create function pg_temp.decision_amount(p_quote uuid) returns numeric
language sql security definer as $$ select amount from public.company_quote_decisions where quote_id = p_quote and decision = 'changes_requested' $$;
create function pg_temp.waitlist_told() returns boolean
language sql security definer as $$
  select exists (select 1 from public.slot_waitlist w where w.client_id = test.id('client_a') and w.notified_at is not null)
      or exists (select 1 from public.notification_events where user_id = test.id('client_a') and event = 'slot_freed')
$$;
grant execute on all functions in schema pg_temp to public;

-- One booking per status, on v1 (booked by its driver) or v2.
select set_config('test.pending', test.fleet_booking('v1', test.id('client_b'), 'pending', test.workday(5))::text, true);
select set_config('test.confirmed', test.fleet_booking('v2', test.id('drv2'), 'confirmed', test.workday(6))::text, true);
select set_config('test.personal', test.raw_booking(test.id('shop1'), test.id('client_b'), 'pending', test.workday(7), '12:00')::text, true);

-- ------------------------------------------------------------------ rights
select test.login(test.id('client_b'));
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.pending')), 'not_allowed', 'a driver without quotes.approve cannot');
select test.login(test.id('acc'));
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.pending')), 'not_allowed', 'the accountant cannot');
select test.login(test.id('out'));
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.pending')), 'booking_not_found', 'another company: not found');
select test.login(test.id('mgr'));
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.personal')), 'booking_not_found', 'a personal booking: not found');
select test.fails(format($$select pg_temp.cancel(%L, 'ok')$$, current_setting('test.pending')), 'reason_required', 'a reason of 3 characters at least');

-- ------------------------------------------------------------------ pending: cancelled, once
select set_config('test.rid', gen_random_uuid()::text, true);
select test.eq((public.fleet_cancel_booking(current_setting('test.pending')::uuid, 'Vehiculul nu mai este disponibil', current_setting('test.rid')::uuid)).status,
  'cancelled', 'the manager cancels a pending booking');
select test.eq((public.fleet_cancel_booking(current_setting('test.pending')::uuid, 'Vehiculul nu mai este disponibil', current_setting('test.rid')::uuid)).status,
  'cancelled', 'the same request twice: the first answer');
select test.eq(pg_temp.messages(current_setting('test.pending')::uuid, 'booking_cancelled_company'), 1::bigint, 'one thread message');
select test.eq(pg_temp.shop_notices(current_setting('test.pending')::uuid, 'booking_cancelled_client'), 1::bigint, 'one notification to the shop');
select test.eq((select cancel_reason || '/' || cancelled_by from public.bookings where id = current_setting('test.pending')::uuid),
  'Vehiculul nu mai este disponibil/client', 'the reason is kept; cancelled on the client side');
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.pending')), 'wrong_status', 'cancelled already: refused');

-- ------------------------------------------------------------------ confirmed: the shop's deadline and the slot start
select pg_temp.set_deadline(24);
select pg_temp.slot_of(current_setting('test.confirmed')::uuid, now() + interval '5 hours');
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.confirmed')), 'cancel_deadline_passed', 'inside the shop''s 24 hours: refused');
select pg_temp.set_deadline(0);
select pg_temp.slot_of(current_setting('test.confirmed')::uuid, now() - interval '10 minutes');
select test.fails(format($$select pg_temp.cancel(%L)$$, current_setting('test.confirmed')), 'booking_started',
  'no deadline at the shop, but the slot has started: refused (decision 2)');
select pg_temp.slot_of(current_setting('test.confirmed')::uuid, now() + interval '2 days');
-- The waitlist for that day is told once the place is free.
select test.logout();
insert into public.slot_waitlist (client_id, shop_id, date)
select test.id('client_a'), test.id('shop1'), b.date from public.bookings b where b.id = current_setting('test.confirmed')::uuid;
select test.login(test.id('mgr'));
select test.eq((pg_temp.cancel(current_setting('test.confirmed')::uuid)).status, 'cancelled', 'confirmed, before the deadline: cancelled');
select test.eq(test.status_of(current_setting('test.confirmed')::uuid), 'cancelled', 'the slot is free (cancelled is not an active status)');
select test.ok(pg_temp.waitlist_told(), 'the waitlist is told');

-- ------------------------------------------------------------------ every other status
-- Started (one active booking per vehicle at a shop: each one is closed before the next).
select test.logout();
create function pg_temp.close(p_booking uuid) returns void
language sql security definer as $$ update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'shop' where id = p_booking $$;
grant execute on function pg_temp.close(uuid) to public;
create temp table st_cases (status text, code text, id uuid);
grant all on st_cases to public;
insert into st_cases (status, code) values
  ('in_inspection', 'booking_started'), ('quote_sent', 'booking_started'), ('approved', 'booking_started'), ('in_progress', 'booking_started'),
  ('done', 'wrong_status'), ('declined', 'wrong_status'), ('cancelled', 'wrong_status'), ('quote_refused', 'wrong_status'),
  ('expired', 'wrong_status'), ('no_show', 'wrong_status');
do $$
declare
  c record;
  n int := 9;
begin
  for c in select * from st_cases loop
    update st_cases set id = test.fleet_booking('v1', test.id('client_b'), c.status, test.workday(n)) where status = c.status;
    perform test.login(test.id('client_a'));
    perform test.fails(format('select pg_temp.cancel(%L)', (select id from st_cases where status = c.status)), c.code, 'status ' || c.status || ': ' || c.code);
    perform test.logout();
    if public.is_active_status(c.status) then
      perform pg_temp.close((select id from st_cases where status = c.status));
    end if;
    n := n + 1;
  end loop;
end
$$;

-- ------------------------------------------------------------------ a driver with quotes.approve may; the driver-booker keeps cancel_booking
select set_config('test.p2', test.fleet_booking('v2', test.id('drv2'), 'pending', test.workday(20))::text, true);
select test.login(test.id('appr'));
select test.eq((pg_temp.cancel(current_setting('test.p2')::uuid)).status, 'cancelled', 'a driver given quotes.approve cancels');
select set_config('test.p3', test.fleet_booking('v1', test.id('client_b'), 'pending', test.workday(21))::text, true);
select test.login(test.id('client_b'));
select test.eq((public.cancel_booking(current_setting('test.p3')::uuid, gen_random_uuid())).status, 'cancelled', 'the booker still cancels their own');

-- ------------------------------------------------------------------ read-only company: cancel only
select test.logout();
update public.platform_settings set fleet_billing_enabled = true where id = 1;
update public.company_subscriptions set status = 'inactive' where company_id = test.id('co');
select set_config('test.p4', test.fleet_booking('v2', test.id('drv2'), 'pending', test.workday(22))::text, true);
select set_config('test.q', test.fleet_booking('v1', test.id('client_b'), 'quote_sent', test.workday(23))::text, true);
select set_config('test.quote', test.raw_quote(current_setting('test.q')::uuid)::text, true);
select set_config('test.items', test.quote_item_ids(current_setting('test.quote')::uuid)::text, true);
select test.ok(public.company_read_only(test.id('co')), 'the company is read-only');
select test.login(test.id('mgr'));
select test.eq((pg_temp.cancel(current_setting('test.p4')::uuid)).status, 'cancelled', 'read-only: the cancel still works (decision 3)');
select test.fails(format($$select public.fleet_request_quote_changes(%L, %L, 'Prea scump', gen_random_uuid())$$, current_setting('test.q'), current_setting('test.quote')),
  'fleet_read_only', 'read-only: a change request is refused');
select test.fails(format($$select public.fleet_add_reading(%L, %L, %L, 1000, gen_random_uuid())$$, test.id('co'), test.id('v1'), test.today()),
  'fleet_read_only', 'read-only: nothing else is unlocked');
select test.logout();
update public.platform_settings set fleet_billing_enabled = false where id = 1;

-- ------------------------------------------------------------------ „Cere modificări”
select test.login(test.id('client_b'));
select test.fails(format($$select public.fleet_request_quote_changes(%L, %L, 'Prea scump', gen_random_uuid())$$, current_setting('test.q'), current_setting('test.quote')),
  'not_allowed', 'the driver-booker cannot ask for changes');
select test.login(test.id('mgr'));
select test.fails(format($$select public.fleet_request_quote_changes(%L, %L, 'Prea scump', gen_random_uuid())$$, current_setting('test.q'), gen_random_uuid()),
  'quote_changed', 'an older quote: refused');
select set_config('test.rid2', gen_random_uuid()::text, true);
select test.eq((public.fleet_request_quote_changes(current_setting('test.q')::uuid, current_setting('test.quote')::uuid, 'Fără manopera de diagnoză',
  current_setting('test.rid2')::uuid)).status, 'quote_sent', 'asked: the quote stays sent');
select public.fleet_request_quote_changes(current_setting('test.q')::uuid, current_setting('test.quote')::uuid, 'Fără manopera de diagnoză', current_setting('test.rid2')::uuid);
select test.eq(pg_temp.decisions(current_setting('test.quote')::uuid), 1::bigint, 'the same request twice: one decision');
select test.eq(pg_temp.messages(current_setting('test.q')::uuid, 'quote_changes_requested'), 1::bigint, 'one thread message');
select test.eq(pg_temp.shop_notices(current_setting('test.q')::uuid, 'quote_changes_requested'), 1::bigint, 'one notification to the shop');
select test.fails(format($$select public.fleet_request_quote_changes(%L, %L, 'Încă o dată', gen_random_uuid())$$, current_setting('test.q'), current_setting('test.quote')),
  'changes_already_requested', 'once per quote');
select test.eq(pg_temp.decision_amount(current_setting('test.quote')::uuid), 400.00, 'the decision keeps the total sent');
-- Meanwhile the quote may still be approved.
select test.eq((public.fleet_decide_quote(current_setting('test.q')::uuid, current_setting('test.quote')::uuid,
  current_setting('test.items')::uuid[], gen_random_uuid())).status, 'approved', 'and still approved meanwhile');
-- A personal booking is untouched by all of this.
select test.eq(test.status_of(current_setting('test.personal')::uuid), 'pending', 'the personal booking is untouched');

rollback;
