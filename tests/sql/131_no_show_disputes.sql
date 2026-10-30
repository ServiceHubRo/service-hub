-- No-shows (T53): marked only after the slot and the grace period, a level in the client's
-- notification, an acknowledgement from `no_shows_before_ack` on, disputes the admin decides, and
-- one count everywhere that leaves out disputed no-shows.
begin;
select test.make_world();
update public.shops set slot_minutes = 60, daily_capacity = 100, cars_per_slot = 20 where id = test.id('shop1');
update public.platform_settings
  set limits = limits || '{"active_bookings_per_shop": 20, "active_bookings_total": 50, "new_bookings_per_24h": 50}'::jsonb
where id = 1;
delete from public.notification_events;

-- ------------------------------------------------------------------ the grace period
-- A slot that started 50 minutes ago: it ends in 10 minutes, then 15 minutes of grace.
select set_config('test.early', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed',
  ((now() - interval '50 minutes') at time zone 'Europe/Bucharest')::date,
  date_trunc('minute', (now() - interval '50 minutes') at time zone 'Europe/Bucharest')::time)::text, true);
select test.login(test.id('owner1'));
select test.eq(test.error_of(format($$select public.mark_no_show(%L, gen_random_uuid())$$, current_setting('test.early'))),
  'too_early', 'not while the slot lasts');
select test.ok((test.error_params(format($$select public.mark_no_show(%L, gen_random_uuid())$$, current_setting('test.early')))->>'from')::timestamptz
  between now() + interval '24 minutes' and now() + interval '26 minutes', 'says from when: end of the slot + 15 minutes');
select set_config('test.from', (select x->>'no_show_from' from jsonb_array_elements(public.list_shop_bookings()->'bookings') x
  where x->>'id' = current_setting('test.early')), true);
select test.logout();
select test.eq(current_setting('test.from')::timestamptz, public.no_show_from(b), 'the shop''s list says from when')
from public.bookings b where b.id = current_setting('test.early')::uuid;

-- Ended 20 minutes ago: 5 minutes past the grace.
select set_config('test.late', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed',
  ((now() - interval '80 minutes') at time zone 'Europe/Bucharest')::date,
  date_trunc('minute', (now() - interval '80 minutes') at time zone 'Europe/Bucharest')::time)::text, true);
select test.login(test.id('owner1'));
select test.eq((public.mark_no_show(current_setting('test.late')::uuid, gen_random_uuid())).status, 'no_show', 'after the grace');
select test.logout();
select test.eq(params->>'level', '1', 'first one: level 1'), test.eq(params->>'count', '1', 'with the count'),
       test.eq(params->>'counts', 'true', 'a booking made in the app counts')
from public.notification_events where event = 'no_show' and booking_id = current_setting('test.late')::uuid;

-- The grace is an admin setting (0–120 minutes).
update public.platform_settings set limits = limits || '{"no_show_grace_minutes": 0}' where id = 1;
select test.ok(public.no_show_from(b) = public.slot_starts_at(b.date, b.slot) + interval '60 minutes', 'grace 0: the end of the slot')
from public.bookings b where b.id = current_setting('test.early')::uuid;
update public.platform_settings set limits = limits || '{"no_show_grace_minutes": 15}' where id = 1;
select test.eq(public.limit_range('no_show_grace_minutes'), int4range(0, 120, '[]'), 'grace range'),
       test.eq(public.limit_range('no_shows_before_ack'), int4range(1, 20, '[]'), 'acknowledgement range');

-- ------------------------------------------------------------------ levels
select set_config('test.c2', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.today() - 3, '10:00')::text, true);
select set_config('test.c3', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.today() - 2, '10:00')::text, true);
update public.platform_settings set limits = limits || '{"no_shows_before_ack": 3}' where id = 1;
select test.login(test.id('owner1'));
select public.mark_no_show(current_setting('test.c2')::uuid, gen_random_uuid());
select public.mark_no_show(current_setting('test.c3')::uuid, gen_random_uuid());
select test.logout();
select test.eq((select params->>'level' from public.notification_events where booking_id = current_setting('test.c2')::uuid and event = 'no_show'),
  '2', 'second: level 2');
select test.eq((select params->>'level' from public.notification_events where booking_id = current_setting('test.c3')::uuid and event = 'no_show'),
  '3', 'third: level 3');
select test.eq(public.no_show_level(5), 3, 'stays at 3');

-- A booking the shop added never counts.
select set_config('test.walk', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.today() - 1, '09:00')::text, true);
update public.bookings set source = 'shop' where id = current_setting('test.walk')::uuid;
select test.login(test.id('owner1'));
select public.mark_no_show(current_setting('test.walk')::uuid, gen_random_uuid());
select test.logout();
select test.eq(params->>'counts', 'false', 'added by the shop: does not count'), test.eq(params->>'level', '1', 'and no warning')
from public.notification_events where event = 'no_show' and booking_id = current_setting('test.walk')::uuid;

select test.login(test.id('client_a'));
select test.eq(public.client_no_show_count(test.id('client_a')), 3, 'three count');
select test.eq((public.my_no_show_summary()->>'count')::int, 3, 'the client sees the same count');
select test.eq((public.my_no_show_summary()->>'ack_from')::int, 3, 'and the threshold');
select test.eq(jsonb_array_length(public.my_no_show_summary()->'disputable'), 3, 'three may be contested (not the shop''s one)');
select test.logout();

-- ------------------------------------------------------------------ the acknowledgement
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '10:00')$$),
  'no_show_ack_required', 'three no-shows: the client confirms first');
select test.eq((test.error_params($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '10:00')$$)->>'no_shows')::int,
  3, 'says how many');
select test.login(test.id('owner1'));
select test.fails($$select public.acknowledge_no_show_notice(gen_random_uuid())$$, 'not_allowed', 'only a client acknowledges');
select test.logout();
select test.login(test.id('client_a'));
select set_config('test.ack_rid', gen_random_uuid()::text, true);
select set_config('test.ack', (public.acknowledge_no_show_notice(current_setting('test.ack_rid')::uuid)->>'id'), true);
select test.eq(public.acknowledge_no_show_notice(current_setting('test.ack_rid')::uuid)->>'id', current_setting('test.ack'),
  'the same request twice: one acknowledgement');
select test.logout();
select test.eq((select count(*) from public.no_show_acknowledgements where client_id = test.id('client_a')), 1::bigint, 'stored once');
select set_config('test.acked', test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '10:00')::text, true);
select test.eq((select booking_id from public.no_show_acknowledgements where id = current_setting('test.ack')::uuid),
  current_setting('test.acked')::uuid, 'used by that booking');
select test.eq(test.status_of(current_setting('test.acked')::uuid), 'pending', 'and the booking waits for the shop');
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '11:00')$$),
  'no_show_ack_required', 'the next booking asks again');
-- An old acknowledgement is not enough.
select test.login(test.id('client_a'));
select public.acknowledge_no_show_notice(gen_random_uuid());
select test.logout();
update public.no_show_acknowledgements set created_at = now() - interval '31 minutes' where used_at is null;
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(2), '11:00')$$),
  'no_show_ack_required', 'older than 30 minutes: asks again');
-- Instant confirmation stays off for such a client.
update public.shops set auto_confirm = true where id = test.id('shop1');
select test.login(test.id('client_a'));
select public.acknowledge_no_show_notice(gen_random_uuid());
select test.logout();
select set_config('test.inst', test.book(test.id('client_a'), test.id('shop1'), test.workday(3), '11:00')::text, true);
select test.eq(test.status_of(current_setting('test.inst')::uuid), 'pending', 'never confirmed at once');
update public.shops set auto_confirm = false where id = test.id('shop1');
-- The client cannot read or write acknowledgements from the browser.
select test.login(test.id('client_a'));
select test.fails($$select * from public.no_show_acknowledgements$$, 'permission denied', 'acknowledgements: no direct read');
select test.fails($$insert into public.no_show_acknowledgements (client_id) values (auth.uid())$$, 'permission denied', 'nor direct write');
select test.logout();

-- ------------------------------------------------------------------ disputes
select test.login(test.id('client_b'));
select test.fails(format($$select public.dispute_no_show(%L, 'Am fost la service la ora stabilită.', gen_random_uuid())$$, current_setting('test.c2')),
  'not_allowed', 'only the booking''s client');
select test.logout();
select test.login(test.id('owner1'));
select test.fails(format($$select public.dispute_no_show(%L, 'Am fost la service la ora stabilită.', gen_random_uuid())$$, current_setting('test.c2')),
  'not_allowed', 'not the shop');
select test.logout();
select test.login(test.id('client_a'));
select test.fails(format($$select public.dispute_no_show(%L, 'Scurt', gen_random_uuid())$$, current_setting('test.c2')),
  'reason_required', 'a reason of at least 10 characters');
select test.fails(format($$select public.dispute_no_show(%L, repeat('a', 1001), gen_random_uuid())$$, current_setting('test.c2')),
  'reason_too_long', 'at most 1000');
select test.fails(format($$select public.dispute_no_show(%L, 'Am fost la service la ora stabilită.', gen_random_uuid())$$, current_setting('test.acked')),
  'wrong_status', 'only a no-show');
select test.fails(format($$select public.dispute_no_show(%L, 'Am fost la service la ora stabilită.', gen_random_uuid())$$, current_setting('test.walk')),
  'dispute_window_closed', 'not one the shop added');
select set_config('test.rid', gen_random_uuid()::text, true);
select set_config('test.d2', public.dispute_no_show(current_setting('test.c2')::uuid, '  Am fost la service la ora stabilită.  ',
  current_setting('test.rid')::uuid)->>'id', true);
select test.eq(public.dispute_no_show(current_setting('test.c2')::uuid, 'Alt motiv, altă cerere.', current_setting('test.rid')::uuid)->>'id',
  current_setting('test.d2'), 'the same request twice: one dispute');
select test.fails(format($$select public.dispute_no_show(%L, 'Încă o dată, alt motiv.', gen_random_uuid())$$, current_setting('test.c2')),
  'already_disputed', 'once per booking');
select test.eq(reason, 'Am fost la service la ora stabilită.', 'reason trimmed'), test.eq(status, 'pending', 'waiting')
from public.no_show_disputes where id = current_setting('test.d2')::uuid;
-- Under review: it does not count.
select test.eq(public.client_no_show_count(test.id('client_a')), 2, 'a disputed no-show does not count while waiting');
select test.eq(jsonb_array_length(public.my_no_show_summary()->'disputes'), 1, 'the client sees the dispute');
select test.ok(not (public.my_no_show_summary()->'disputable' ? current_setting('test.c2')), 'no longer to contest');
select test.ok(not (public.my_no_show_summary()->'disputes'->0 ? 'decision_note'), 'without an internal note');
select test.eq(test.count($$select 1 from public.no_show_disputes$$), 1::bigint, 'reads its own dispute');
select test.fails($$select decision_note from public.no_show_disputes$$, 'permission denied', 'never the internal note');
select test.fails($$update public.no_show_disputes set status = 'upheld'$$, 'permission denied', 'cannot decide it');
select test.fails($$insert into public.no_show_disputes (booking_id, client_id, reason) values (gen_random_uuid(), auth.uid(), 'xxxxxxxxxxxx')$$,
  'permission denied', 'nor write it directly');
select test.ok(test.book(test.id('client_a'), test.id('shop1'), test.workday(4), '12:00') is not null, 'two count: no acknowledgement needed');
select test.logout();
select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.no_show_disputes$$), 0::bigint, 'another client sees nothing');
select test.fails($$select public.admin_list_no_show_disputes()$$, 'not_allowed', 'admin list: admin only');
select test.fails(format($$select public.admin_decide_no_show_dispute(%L, 'upheld', '', gen_random_uuid())$$, current_setting('test.d2')),
  'not_allowed', 'admin decision: admin only');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(test.count($$select 1 from public.no_show_disputes$$), 0::bigint, 'the shop reads no dispute rows');
select test.eq((select x->>'no_show_dispute' from jsonb_array_elements(public.list_shop_history()->'bookings') x
                where x->>'id' = current_setting('test.c2')), 'pending', 'the shop''s history shows it is under review');
select test.eq((select (x->>'client_no_shows')::int from jsonb_array_elements(public.list_shop_bookings()->'bookings') x
                where x->>'id' = current_setting('test.acked')), 2, 'the shop''s card counts the same');
select test.logout();

-- The admin decides.
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.admin_list_no_show_disputes()->'pending'), 1, 'one waiting');
select test.eq((public.admin_list_no_show_disputes()->'pending'->0->'booking'->>'ref'), (select ref from public.bookings where id = current_setting('test.c2')::uuid),
  'with the booking');
select test.fails(format($$select public.admin_decide_no_show_dispute(%L, 'maybe', '', gen_random_uuid())$$, current_setting('test.d2')),
  'decision_invalid', 'upheld or rejected');
select test.fails(format($$select public.admin_decide_no_show_dispute(%L, 'upheld', '', gen_random_uuid())$$, gen_random_uuid()),
  'dispute_not_found', 'unknown dispute');
select set_config('test.rid', gen_random_uuid()::text, true);
select test.eq(public.admin_decide_no_show_dispute(current_setting('test.d2')::uuid, 'upheld', 'Service-ul a confirmat la telefon.',
  current_setting('test.rid')::uuid)->>'status', 'upheld', 'upheld');
select test.eq(public.admin_decide_no_show_dispute(current_setting('test.d2')::uuid, 'upheld', 'x',
  current_setting('test.rid')::uuid)->>'status', 'upheld', 'the same request twice answers the first');
select test.fails(format($$select public.admin_decide_no_show_dispute(%L, 'rejected', '', gen_random_uuid())$$, current_setting('test.d2')),
  'wrong_status', 'decided once');
select test.eq(jsonb_array_length(public.admin_list_no_show_disputes()->'decided'), 1, 'in the decided list');
select test.logout();
select test.eq(decision_note, 'Service-ul a confirmat la telefon.', 'note stored'), test.ok(decided_at is not null, 'decided_at'),
       test.eq(decided_by, test.id('admin'), 'by the admin')
from public.no_show_disputes where id = current_setting('test.d2')::uuid;
select test.eq(test.status_of(current_setting('test.c2')::uuid), 'no_show', 'the booking keeps its status');
select test.eq((select count(*) from public.admin_audit_log where action = 'uphold_no_show_dispute'
                and entity_id = current_setting('test.d2')), 1::bigint, 'audited');
select test.eq(params->>'decision', 'upheld', 'the client is told')
from public.notification_events where event = 'no_show_dispute_decided' and user_id = test.id('client_a');
select test.ok((select not (params ? 'decision_note') and params::text not like '%confirmat la telefon%'
                from public.notification_events where event = 'no_show_dispute_decided'), 'without the internal note');
select test.login(test.id('client_a'));
select test.eq(public.client_no_show_count(test.id('client_a')), 2, 'upheld: it no longer counts');
select test.eq(public.my_no_show_summary()->'disputes'->0->>'status', 'upheld', 'the client sees the outcome');
select test.logout();

-- Rejected: it counts again.
select test.login(test.id('client_a'));
select set_config('test.d3', public.dispute_no_show(current_setting('test.c3')::uuid, 'Am anunțat service-ul prin telefon.',
  gen_random_uuid())->>'id', true);
select test.eq(public.client_no_show_count(test.id('client_a')), 1, 'second dispute waiting');
select test.logout();
select test.login(test.id('admin'));
select public.admin_decide_no_show_dispute(current_setting('test.d3')::uuid, 'rejected', '', gen_random_uuid());
select test.eq((public.admin_get_client(test.id('client_a'))->>'no_shows')::int, 2, 'rejected: counts again (admin view)');
select test.eq((select (x->>'no_shows')::int from jsonb_array_elements(public.admin_list_clients()) x
                where x->>'id' = test.id('client_a')::text), 2, 'the admin''s list counts the same');
select test.logout();
select test.eq((select count(*) from public.admin_audit_log where action = 'reject_no_show_dispute'), 1::bigint, 'audited');
select test.eq(decision_note, null, 'an empty note is not stored') from public.no_show_disputes where id = current_setting('test.d3')::uuid;

-- Old no-shows cannot be contested.
select set_config('test.old', test.raw_booking(test.id('shop1'), test.id('client_a'), 'no_show', test.today() - 120, '10:00')::text, true);
select test.login(test.id('client_a'));
select test.fails(format($$select public.dispute_no_show(%L, 'Am fost la service la ora stabilită.', gen_random_uuid())$$, current_setting('test.old')),
  'dispute_window_closed', 'over 90 days: no longer counts, nothing to contest');
select test.logout();

-- The phone rule uses the same count: a pending dispute lifts it.
update public.platform_settings set limits = limits || '{"no_shows_before_phone": 2}' where id = 1;
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(5), '13:00')$$),
  'phone_verification_required', 'two count: phone code first');
select set_config('test.c4', test.raw_booking(test.id('shop1'), test.id('client_a'), 'no_show', test.today() - 4, '10:00')::text, true);
select test.login(test.id('client_a'));
select public.dispute_no_show(current_setting('test.c4')::uuid, 'Am fost la service la ora stabilită.', gen_random_uuid());
select test.logout();
-- c3 (rejected) and late count; c4 is waiting.
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(5), '13:00')$$),
  'phone_verification_required', 'still two');
update public.platform_settings set limits = limits || '{"no_shows_before_phone": 3}' where id = 1;
select test.ok(test.book(test.id('client_a'), test.id('shop1'), test.workday(5), '13:00') is not null, 'the waiting one does not count');

-- The admin's morning email counts the waiting disputes.
select test.eq((public.admin_digest_counts()->>'no_show_disputes')::int, 1, 'digest: one waiting');

rollback;
