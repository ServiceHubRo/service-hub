-- "Anunță-mă dacă se eliberează un loc" (T37b): a client waits for a full day; when a booking of
-- that day leaves it and the day has a place again, everyone waiting is told once; booking that
-- day ends the wait; the rows are the client's own.
begin;
select test.make_world();
select set_config('test.day', test.workday(3)::text, true);
update public.shops set daily_capacity = 1 where id = test.id('shop1');
-- The day is full: client_b holds its only place.
select set_config('test.b', test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed',
  current_setting('test.day')::date, '10:00', 'BV 11 WTL')::text, true);

-- ------------------------------------------------------------------ asking
select test.login(test.id('client_a'));
select test.fails($$select public.join_slot_waitlist(test.id('shop1'), current_date - 1, test.rid())$$, 'past_slot',
  'not for a day already gone');
select test.eq(public.join_slot_waitlist(test.id('shop1'), current_setting('test.day')::date, '00000000-0000-4000-8000-000000000125')->>'date',
  current_setting('test.day'), 'client_a waits for the full day');
select test.eq(public.join_slot_waitlist(test.id('shop1'), current_setting('test.day')::date, '00000000-0000-4000-8000-000000000125')->>'date',
  current_setting('test.day'), 'the same request twice is one');
select test.eq((select count(*) from public.slot_waitlist), 1::bigint, 'the client reads their own wait');
select test.fails(format($$insert into public.slot_waitlist (client_id, shop_id, date) values (%L, %L, %L)$$,
  test.id('client_a'), test.id('shop1'), current_setting('test.day')), 'permission denied', 'not written from the browser');
select test.login(test.id('client_b'));
select test.eq((select count(*) from public.slot_waitlist), 0::bigint, 'another client does not see it');
select test.login(test.id('owner1'));
select test.fails(format($$select public.join_slot_waitlist(%L, %L, test.rid())$$, test.id('shop1'), current_setting('test.day')),
  'not_allowed', 'a shop does not wait for places');
select test.logout();

-- ------------------------------------------------------------------ a place frees
delete from public.notification_events;
update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = current_setting('test.b')::uuid;
select test.eq(count(*), 1::bigint, 'the cancellation tells client_a, with the shop and the day')
from public.notification_events
where user_id = test.id('client_a') and event = 'slot_freed'
  and params->>'date' = current_setting('test.day') and params->>'shop_id' = test.id('shop1')::text;
select test.ok((select notified_at is not null from public.slot_waitlist where client_id = test.id('client_a')), 'marked as told');

-- Full again, then freed again: told once only, unless they ask again.
select set_config('test.c', test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed',
  current_setting('test.day')::date, '11:00', 'BV 12 WTL')::text, true);
delete from public.notification_events;
update public.bookings set status = 'cancelled', cancelled_by = 'client' where id = current_setting('test.c')::uuid;
select test.eq((select count(*) from public.notification_events where event = 'slot_freed'), 0::bigint, 'told once');

-- A day still full after a cancellation (capacity 2, three bookings): nobody is told.
update public.shops set daily_capacity = 2 where id = test.id('shop1');
select test.login(test.id('client_a'));
select public.join_slot_waitlist(test.id('shop1'), current_setting('test.day')::date, test.rid());
select test.logout();
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed', current_setting('test.day')::date, '12:00', 'BV 13 WTL');
select test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed', current_setting('test.day')::date, '13:00', 'BV 14 WTL');
select set_config('test.d', test.raw_booking(test.id('shop1'), test.id('client_b'), 'confirmed',
  current_setting('test.day')::date, '14:00', 'BV 15 WTL')::text, true);
update public.shops set daily_capacity = 2 where id = test.id('shop1');
delete from public.notification_events;
update public.bookings set status = 'cancelled', cancelled_by = 'shop' where id = current_setting('test.d')::uuid;
select test.eq((select count(*) from public.notification_events where event = 'slot_freed'), 0::bigint,
  'two bookings left for two places: still full, nobody told');

-- Moved to another day: the old day frees.
select set_config('test.e', (select id::text from public.bookings
  where shop_id = test.id('shop1') and date = current_setting('test.day')::date and status = 'confirmed' limit 1), true);
update public.bookings set date = current_setting('test.day')::date + 1 where id = current_setting('test.e')::uuid;
select test.eq((select count(*) from public.notification_events where event = 'slot_freed' and user_id = test.id('client_a')), 1::bigint,
  'a booking moved to another day frees its place');

-- ------------------------------------------------------------------ booking ends the wait
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', current_setting('test.day')::date, '15:00', 'BV 16 WTL');
select test.eq((select count(*) from public.slot_waitlist where client_id = test.id('client_a')), 0::bigint,
  'their booking that day ends the wait');

-- ------------------------------------------------------------------ taking it back, and the limit
select test.login(test.id('client_a'));
select public.join_slot_waitlist(test.id('shop1'), test.workday(5), test.rid());
select public.leave_slot_waitlist(test.id('shop1'), test.workday(5), test.rid());
select test.eq((select count(*) from public.slot_waitlist), 0::bigint, 'taken back');
select public.join_slot_waitlist(test.id('shop1'), current_date + n, test.rid()) from generate_series(1, 10) n;
select test.fails($$select public.join_slot_waitlist(test.id('shop1'), current_date + 11, test.rid())$$, 'waitlist_limit',
  'at most 10 days at once');
select test.eq(jsonb_array_length(public.export_my_data()->'slot_waitlist'), 10, 'in "Datele mele"');
select test.ok(public.export_my_data() ? 'report_credits', 'with what was there before');
select test.logout();

rollback;
