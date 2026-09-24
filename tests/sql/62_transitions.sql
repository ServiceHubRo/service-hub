-- The booking state machine (ARCHITECTURE §3): every RPC from every status. Allowed transitions
-- land in the documented status; every other one is refused with `wrong_status` and changes
-- nothing. Then: who may call what.
begin;
select test.make_world();
update public.shops set daily_capacity = 100, cars_per_slot = 20 where id = test.id('shop1');

create temporary table expect (fn text, from_status text[], to_status text, actor text);
insert into expect values
  ('confirm_booking',     '{pending}',                 'confirmed',     'owner1'),
  ('decline_booking',     '{pending}',                 'declined',      'owner1'),
  ('reschedule_booking',  '{pending,confirmed}',       'confirmed',     'owner1'),
  ('cancel_booking',      '{pending,confirmed}',       'cancelled',     'client_a'),
  ('shop_cancel_booking', '{confirmed}',               'cancelled',     'owner1'),
  ('mark_no_show',        '{confirmed}',               'no_show',       'owner1'),
  ('start_inspection',    '{confirmed}',               'in_inspection', 'owner1'),
  ('send_quote',          '{in_inspection}',           'quote_sent',    'owner1'),
  ('replace_quote',       '{quote_sent}',              'quote_sent',    'owner1'),
  ('withdraw_quote',      '{quote_sent}',              'in_inspection', 'owner1'),
  ('decide_quote',        '{quote_sent}',              'approved',      'client_a'),
  ('start_work',          '{approved}',                'in_progress',   'owner1'),
  ('complete_job',        '{in_progress}',             'done',          'owner1'),
  ('admin_force_cancel',  '{pending,confirmed,in_inspection,quote_sent,approved,in_progress}', 'cancelled', 'admin');

create temporary table outcome (fn text, from_status text, result text, final_status text, booking uuid);

do $$
declare
  e record;
  st text;
  v_booking uuid;
  v_quote uuid;
  v_call text;
  v_result text;
  v_n int := 0;
begin
  for e in select * from expect loop
    foreach st in array array['pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress',
                              'done', 'declined', 'cancelled', 'quote_refused', 'expired', 'no_show'] loop
      v_n := v_n + 1;
      -- No-show needs a slot that has passed; everything else a future one.
      if e.fn = 'mark_no_show' then
        v_booking := test.raw_booking(test.id('shop1'), test.id('client_a'), st, test.today() - 1, '10:00');
      else
        v_booking := test.raw_booking(test.id('shop1'), test.id('client_a'), st, test.workday(1 + v_n % 10), '10:00');
      end if;
      v_quote := case when st = 'quote_sent' then test.raw_quote(v_booking) end;

      v_call := case e.fn
        when 'reschedule_booking' then format('select public.reschedule_booking(%L, %L, ''16:00'', gen_random_uuid())', v_booking, test.workday(12))
        when 'shop_cancel_booking' then format('select public.shop_cancel_booking(%L, ''Utilaj defect'', gen_random_uuid())', v_booking)
        when 'admin_force_cancel' then format('select public.admin_force_cancel(%L, ''Cerere dublă'', gen_random_uuid())', v_booking)
        when 'send_quote' then format('select public.send_quote(%L, ''[{"name":"Plăcuțe","price":280}]'', gen_random_uuid())', v_booking)
        when 'replace_quote' then format('select public.replace_quote(%L, ''[{"name":"Plăcuțe","price":300}]'', gen_random_uuid())', v_booking)
        when 'decide_quote' then format('select public.decide_quote(%L, %L, %L, gen_random_uuid())', v_booking,
                                        coalesce(v_quote, gen_random_uuid()), coalesce(test.quote_item_ids(v_quote), '{}'))
        when 'complete_job' then format('select public.complete_job(%L, 1000, gen_random_uuid())', v_booking)
        when 'decline_booking' then format('select public.decline_booking(%L, gen_random_uuid())', v_booking)
        else format('select public.%I(%L, gen_random_uuid())', e.fn, v_booking)
      end;

      perform test.login(test.id(e.actor));
      v_result := test.error_of(v_call);
      perform test.logout();
      insert into outcome values (e.fn, st, v_result, test.status_of(v_booking), v_booking);
    end loop;
  end loop;
end
$$;

-- Allowed: succeeded and landed in the documented status.
select test.eq(string_agg(o.fn || ' from ' || o.from_status || ': ' || o.result || ' → ' || o.final_status, '; '), null,
  'every allowed transition succeeds and lands in its target status')
from outcome o join expect e on e.fn = o.fn
where o.from_status = any (e.from_status) and (o.result <> 'ok' or o.final_status <> e.to_status);

-- Refused: wrong_status, and the booking kept its status.
select test.eq(string_agg(o.fn || ' from ' || o.from_status || ': ' || o.result || ' → ' || o.final_status, '; '), null,
  'every other transition is refused with wrong_status and changes nothing')
from outcome o join expect e on e.fn = o.fn
where not (o.from_status = any (e.from_status)) and (o.result <> 'wrong_status' or o.final_status <> o.from_status);

select test.eq(count(*), 14 * 12::bigint, 'all 168 combinations tried') from outcome;

-- ------------------------------------------------------------------ who may call what
select set_config('test.p', test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', test.workday(2), '09:00')::text, true);
select set_config('test.q', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_sent', test.workday(2), '11:00')::text, true);
select set_config('test.qq', test.raw_quote(current_setting('test.q')::uuid)::text, true);

-- Another shop, the client and a stranger cannot act as the shop.
select test.login(test.id('owner2'));
select test.fails(format($$select public.confirm_booking(%L, gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'another shop cannot confirm');
select test.fails(format($$select public.send_quote(%L, '[{"name":"x","price":1}]', gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'another shop cannot quote');
select test.fails(format($$select public.last_odometer_for_booking(%L)$$, current_setting('test.p')), 'not_allowed', 'another shop cannot read the odometer');
select test.logout();
select test.login(test.id('client_a'));
select test.fails(format($$select public.confirm_booking(%L, gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'the client cannot confirm their own booking');
select test.fails(format($$select public.withdraw_quote(%L, gen_random_uuid())$$, current_setting('test.q')), 'not_allowed', 'the client cannot withdraw the quote');
select test.fails(format($$select public.admin_force_cancel(%L, 'x', gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'the client is not admin');
select test.logout();
select test.login(test.id('client_b'));
select test.fails(format($$select public.cancel_booking(%L, gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'another client cannot cancel');
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.q'), current_setting('test.qq'),
  test.quote_item_ids(current_setting('test.qq')::uuid)), 'not_allowed', 'another client cannot accept the quote');
select test.logout();

-- The shop can never accept (or refuse) the quote for the client.
select test.login(test.id('owner1'));
select test.fails(format($$select public.decide_quote(%L, %L, %L, gen_random_uuid())$$, current_setting('test.q'), current_setting('test.qq'),
  test.quote_item_ids(current_setting('test.qq')::uuid)), 'not_allowed', 'the shop cannot accept the quote for the client');
select test.fails(format($$select public.decide_quote(%L, %L, '{}', gen_random_uuid())$$, current_setting('test.q'), current_setting('test.qq')),
  'not_allowed', 'the shop cannot refuse the quote for the client');
select test.fails(format($$select public.cancel_booking(%L, gen_random_uuid())$$, current_setting('test.p')), 'not_allowed', 'the shop uses shop_cancel_booking, not the client''s cancel');
select test.fails(format($$select public.confirm_booking(%L, gen_random_uuid())$$, gen_random_uuid()), 'booking_not_found', 'unknown booking');
select test.logout();
select test.eq(test.status_of(current_setting('test.q')::uuid), 'quote_sent', 'quote still waiting for the client');

-- Staff operate bookings like the owner.
select test.login(test.id('staff1'));
select test.eq((public.confirm_booking(current_setting('test.p')::uuid, gen_random_uuid())).status, 'confirmed', 'staff can confirm');
select test.logout();

-- A suspended shop member cannot act.
update public.profiles set suspended = true where id = test.id('staff1');
select test.login(test.id('staff1'));
select test.fails(format($$select public.start_inspection(%L, gen_random_uuid())$$, current_setting('test.p')), 'account_suspended', 'suspended user refused');
select test.logout();

-- ------------------------------------------------------------------ rules inside transitions
-- Shop cancel needs a reason; the reason reaches the client's message and event.
select test.login(test.id('owner1'));
select test.fails(format($$select public.shop_cancel_booking(%L, '   ', gen_random_uuid())$$, current_setting('test.p')), 'reason_required', 'shop cancel needs a reason');
select public.shop_cancel_booking(current_setting('test.p')::uuid, 'Lipsă piese', gen_random_uuid());
select test.logout();
select test.eq(cancelled_by, 'shop', 'cancelled_by shop'), test.eq(cancel_reason, 'Lipsă piese', 'reason stored'),
       test.ok(cancelled_at is not null, 'cancelled_at set')
from public.bookings where id = current_setting('test.p')::uuid;
select test.eq(params->>'reason', 'Lipsă piese', 'reason in the automatic message') from public.messages
where booking_id = current_setting('test.p')::uuid and event = 'booking_cancelled_shop';
select test.eq(params->>'reason', 'Lipsă piese', 'reason in the client''s notification') from public.notification_events
where booking_id = current_setting('test.p')::uuid and event = 'booking_cancelled_shop' and user_id = test.id('client_a');

-- No-show only after the slot time.
select set_config('test.c', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.workday(3), '09:00')::text, true);
select test.login(test.id('owner1'));
select test.fails(format($$select public.mark_no_show(%L, gen_random_uuid())$$, current_setting('test.c')), 'too_early', 'no-show before the slot refused');
select test.logout();

-- Client cancellation deadline: a confirmed booking closes to the client N hours before the slot.
update public.shops set cancel_deadline_hours = 72 where id = test.id('shop1');
select set_config('test.soon', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.today() + 1, '10:00')::text, true);
select set_config('test.soonp', test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', test.today() + 1, '11:00')::text, true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.cancel_booking(%L, gen_random_uuid())$$, current_setting('test.soon')), 'cancel_deadline_passed', 'confirmed booking past the deadline cannot be cancelled by the client');
select test.eq(test.error_params(format($$select public.cancel_booking(%L, gen_random_uuid())$$, current_setting('test.soon')))->>'hours', '72',
  'the refusal names the deadline');
select test.eq((public.cancel_booking(current_setting('test.soonp')::uuid, gen_random_uuid())).status, 'cancelled',
  'a pending request can always be withdrawn');
select test.logout();
update public.shops set cancel_deadline_hours = 0 where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.eq((public.cancel_booking(current_setting('test.soon')::uuid, gen_random_uuid())).status, 'cancelled', 'deadline 0 = any time');
select test.logout();
select test.eq(count(*), 2::bigint, 'shop members told about the client''s cancellation')
from public.notification_events where booking_id = current_setting('test.soon')::uuid and event = 'booking_cancelled_client';

-- Admin force-cancel: reason required, both sides notified, audited.
select set_config('test.a', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_sent', test.workday(4), '09:00')::text, true);
select set_config('test.aq', test.raw_quote(current_setting('test.a')::uuid)::text, true);
select test.login(test.id('admin'));
select test.fails(format($$select public.admin_force_cancel(%L, '', gen_random_uuid())$$, current_setting('test.a')), 'reason_required', 'admin cancel needs a reason');
select public.admin_force_cancel(current_setting('test.a')::uuid, 'Service închis', gen_random_uuid());
select test.logout();
select test.eq(cancelled_by, 'admin', 'cancelled by admin') from public.bookings where id = current_setting('test.a')::uuid;
select test.eq(status, 'withdrawn', 'the waiting quote is closed with it') from public.quotes where id = current_setting('test.aq')::uuid;
select test.eq(count(distinct user_id), 3::bigint, 'client, owner and staff notified')
from public.notification_events where booking_id = current_setting('test.a')::uuid and event = 'booking_cancelled_admin';
select test.eq(count(*), 1::bigint, 'audit log entry') from public.admin_audit_log
where action = 'admin_force_cancel' and entity_id = current_setting('test.a');

-- Every successful transition wrote its automatic message and its outbox event in the same
-- transaction; refused ones wrote neither.
select test.eq(string_agg(o.fn || ' from ' || o.from_status, ', '), null, 'every successful transition wrote an automatic message')
from outcome o
where o.result = 'ok' and not exists (select 1 from public.messages m where m.booking_id = o.booking and m.kind = 'system');
select test.eq(string_agg(o.fn || ' from ' || o.from_status, ', '), null, 'every successful transition wrote a notification event')
from outcome o
where o.result = 'ok' and not exists (select 1 from public.notification_events n where n.booking_id = o.booking);
select test.eq(count(*), 0::bigint, 'refused transitions wrote no message and no event')
from outcome o
where o.result <> 'ok'
  and (exists (select 1 from public.messages m where m.booking_id = o.booking)
       or exists (select 1 from public.notification_events n where n.booking_id = o.booking));

rollback;
