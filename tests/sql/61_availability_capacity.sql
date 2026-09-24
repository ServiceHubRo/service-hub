-- get_availability and capacity (ARCHITECTURE §4): day and slot limits in the RPCs and in the
-- bookings trigger, released by cancellation; reschedule fails safely. Concurrency: 90_concurrency.sql.
begin;
select test.make_world();
update public.platform_settings
  set limits = limits || '{"new_bookings_per_24h": 100, "active_bookings_per_shop": 100, "active_bookings_total": 100}';
select set_config('test.day1', test.workday(1)::text, true);
select set_config('test.day2', test.workday(2)::text, true);
select set_config('test.day3', test.workday(3)::text, true);

-- ------------------------------------------------------------------ availability: days
select test.login(test.id('client_a'));
select set_config('test.av', public.get_availability(test.id('shop1'), test.today(), 40)::text, true);
select test.logout();
select test.eq(jsonb_array_length(current_setting('test.av')::jsonb->'days'), 40, '40 days returned');
select test.eq(d->>'reason', 'closed', 'Saturday closed by default'), test.eq(d->>'bookable', 'false', 'closed day not bookable')
from jsonb_array_elements(current_setting('test.av')::jsonb->'days') d where (d->>'date')::date = test.saturday();
select test.eq(d->>'bookable', 'true', 'a workday is bookable'),
       test.eq(d->>'places_left', '5', 'default capacity 5'),
       test.eq(d->>'reason', null, 'no reason when bookable')
from jsonb_array_elements(current_setting('test.av')::jsonb->'days') d where (d->>'date')::date = current_setting('test.day1')::date;
select test.eq(count(*), 0::bigint, 'nothing bookable beyond max_advance_days')
from jsonb_array_elements(current_setting('test.av')::jsonb->'days') d
where (d->>'date')::date > test.today() + 30 and (d->>'bookable')::boolean;
select test.ok(bool_and(d->>'reason' in ('too_far', 'closed')), 'days beyond the window say too_far (or closed)')
from jsonb_array_elements(current_setting('test.av')::jsonb->'days') d where (d->>'date')::date > test.today() + 30;

insert into public.shop_closures (shop_id, start_date, end_date) values
  (test.id('shop1'), current_setting('test.day3')::date, current_setting('test.day3')::date);
select test.login(test.id('client_a'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day3')::date, 1)->'days'->0->>'reason',
  'closure', 'holiday shows as closure');
select test.eq(jsonb_array_length(public.get_availability(test.id('shop1'), current_setting('test.day3')::date, 1, current_setting('test.day3')::date)->'slots'),
  0, 'no slots on a holiday');
-- Slots: 08:00 … 17:00 every 60 minutes.
select set_config('test.slots', (public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1, current_setting('test.day1')::date)->'slots')::text, true);
select test.logout();
select test.eq(jsonb_array_length(current_setting('test.slots')::jsonb), 10, '10 hourly slots from 08:00 to 17:00');
select test.eq(current_setting('test.slots')::jsonb->0->>'time', '08:00', 'first slot at opening');
select test.eq(current_setting('test.slots')::jsonb->9->>'time', '17:00', 'last slot ends at closing');

-- 30-minute slots double the grid.
update public.shops set slot_minutes = 30 where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.eq(jsonb_array_length(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1, current_setting('test.day1')::date)->'slots'),
  20, '20 half-hour slots');
select test.logout();
update public.shops set slot_minutes = 60 where id = test.id('shop1');

-- Today's passed slots are never offered.
update public.shop_hours set is_closed = false, open_time = '00:00', close_time = '23:59'
where shop_id = test.id('shop1') and weekday = extract(dow from test.today())::int;
select test.login(test.id('client_a'));
select test.eq(s->>'reason', 'past', 'today 00:00 is past'), test.eq(s->>'available', 'false', 'and not available')
from jsonb_array_elements(public.get_availability(test.id('shop1'), test.today(), 1, test.today())->'slots') s
where s->>'time' = '00:00';
select test.logout();

-- Minimum notice applies to clients; the shop itself sees its own grid.
update public.shops set min_notice_hours = 168 where id = test.id('shop1');
select test.login(test.id('client_a'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1, current_setting('test.day1')::date)->'slots'->0->>'reason',
  'too_soon', 'client: inside the notice');
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1)->'days'->0->>'reason',
  'no_slots', 'client: day without an available slot is not bookable');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1, current_setting('test.day1')::date)->'slots'->0->>'available',
  'true', 'shop: own grid without the client notice');
select test.logout();
update public.shops set min_notice_hours = 2 where id = test.id('shop1');

-- Only shops the caller may see.
select test.login(test.id('client_a'));
select test.fails(format($$select public.get_availability(%L)$$, test.id('shop2')), 'shop_not_found', 'private shop availability hidden');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.get_availability(%L)$$, test.id('shop1')), 'permission denied', 'signed-out visitors cannot read availability');
select test.logout();

-- ------------------------------------------------------------------ daily capacity
update public.shops set daily_capacity = 2 where id = test.id('shop1');
select set_config('test.c1', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day1')::date, '09:00')::text, true);
select set_config('test.c2', test.book(test.id('client_b'), test.id('shop1'), current_setting('test.day1')::date, '10:00')::text, true);
select test.login(test.id('client_a'));
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1)->'days'->0->>'reason', 'full', 'day shows full');
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1)->'days'->0->>'places_left', '0', 'no places left');
select test.eq(public.get_availability(test.id('shop1'), current_setting('test.day1')::date, 1, current_setting('test.day1')::date)->'slots'->5->>'reason',
  'full', 'free slots of a full day are not offered');
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00', p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}')$$,
  test.id('shop1'), current_setting('test.day1')), 'day_full', 'third booking on a 2-per-day shop refused');
select test.logout();

-- Every active status holds its place: a car in inspection still counts.
update public.bookings set status = 'confirmed' where id = current_setting('test.c1')::uuid;
update public.bookings set status = 'in_inspection' where id = current_setting('test.c1')::uuid;
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '15:00')$$, test.id('client_a'), test.id('shop1'), current_setting('test.day1'))),
  'day_full', 'in_inspection still counts toward capacity');

-- Cancelling releases the place.
select test.login(test.id('client_b'));
select public.cancel_booking(current_setting('test.c2')::uuid, gen_random_uuid());
select test.logout();
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '15:00')$$, test.id('client_a'), test.id('shop1'), current_setting('test.day1'))),
  'ok', 'a cancelled booking frees its place');

-- The trigger repeats the check for any direct write (safety net).
select test.fails(format($$insert into public.bookings (shop_id, client_id, service_id, date, slot) values (%L, %L, 'ulei', %L, '16:00')$$,
  test.id('shop1'), test.id('client_b'), current_setting('test.day1')), 'day_full', 'direct insert on a full day refused');
select set_config('test.c3', test.book(test.id('client_b'), test.id('shop1'), current_setting('test.day2')::date, '09:00')::text, true);
select test.fails(format($$update public.bookings set date = %L where id = %L$$,
  current_setting('test.day1'), current_setting('test.c3')), 'day_full', 'moving a booking onto a full day directly is refused');
-- Terminal bookings do not count and are not checked.
insert into public.bookings (shop_id, client_id, service_id, date, slot, status)
values (test.id('shop1'), test.id('client_b'), 'ulei', current_setting('test.day1')::date, '16:00', 'cancelled');

-- ------------------------------------------------------------------ per-slot capacity (cars at the same time)
update public.shops set daily_capacity = 10, cars_per_slot = 2 where id = test.id('shop1');
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '09:00')$$, test.id('client_b'), test.id('shop1'), current_setting('test.day2'))),
  'ok', 'second car at 09:00 fits (2 per slot)');
select test.eq(test.error_of(format($$select test.book(%L, %L, %L, '09:00')$$, test.id('client_a'), test.id('shop1'), current_setting('test.day2'))),
  'slot_full', 'third car at 09:00 refused');
select test.login(test.id('client_a'));
select test.eq(s->>'taken', '2', 'slot shows 2 taken'), test.eq(s->>'capacity', '2', 'of 2'), test.eq(s->>'reason', 'full', 'slot full')
from jsonb_array_elements(public.get_availability(test.id('shop1'), current_setting('test.day2')::date, 1, current_setting('test.day2')::date)->'slots') s
where s->>'time' = '09:00';
select test.logout();
select test.fails(format($$insert into public.bookings (shop_id, client_id, service_id, date, slot) values (%L, %L, 'ulei', %L, '09:00')$$,
  test.id('shop1'), test.id('client_b'), current_setting('test.day2')), 'slot_full', 'direct insert into a full slot refused');

-- ------------------------------------------------------------------ reschedule re-checks at submit, fails safely
update public.shops set cars_per_slot = 1 where id = test.id('shop1');
delete from public.shop_closures where shop_id = test.id('shop1');
select set_config('test.r1', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day3')::date, '11:00')::text, true);
select test.login(test.id('owner1'));
select test.fails(format($$select public.reschedule_booking(%L, %L, '09:00', gen_random_uuid())$$,
  current_setting('test.r1'), current_setting('test.day2')), 'slot_full', 'reschedule into a full slot refused');
update public.shops set daily_capacity = 2 where id = test.id('shop1');
select test.fails(format($$select public.reschedule_booking(%L, %L, '12:00', gen_random_uuid())$$,
  current_setting('test.r1'), current_setting('test.day1')), 'day_full', 'reschedule onto a full day refused');
select test.fails(format($$select public.reschedule_booking(%L, test.today() - 1, '12:00', gen_random_uuid())$$,
  current_setting('test.r1')), 'past_slot', 'reschedule into the past refused');
select test.fails(format($$select public.reschedule_booking(%L, test.today(), '00:00', gen_random_uuid())$$,
  current_setting('test.r1')), 'past_slot', 'reschedule to an hour that passed today refused');
select test.fails(format($$select public.reschedule_booking(%L, %L, '10:00', gen_random_uuid())$$,
  current_setting('test.r1'), test.saturday()), 'shop_closed', 'reschedule onto a closed day refused');
select test.logout();
select test.eq(date, current_setting('test.day3')::date, 'failed reschedules left the date'),
       test.eq(slot, '11:00'::time, 'and the time'),
       test.eq(status, 'pending', 'and the status')
from public.bookings where id = current_setting('test.r1')::uuid;
select test.eq(count(*), 1::bigint, 'failed reschedules wrote no message (only the request)')
from public.messages where booking_id = current_setting('test.r1')::uuid;

-- A successful reschedule confirms, moves and tells the client.
select test.login(test.id('owner1'));
select test.eq((public.reschedule_booking(current_setting('test.r1')::uuid, current_setting('test.day3')::date, '15:00', gen_random_uuid())).status,
  'confirmed', 'reschedule confirms the booking');
select test.logout();
select test.eq(slot, '15:00'::time, 'moved to 15:00'), test.ok(confirmed_at is not null, 'confirmed_at set')
from public.bookings where id = current_setting('test.r1')::uuid;
select test.eq(params->>'old_slot', '11:00', 'message names the old time'), test.eq(params->>'slot', '15:00', 'and the new one')
from public.messages where booking_id = current_setting('test.r1')::uuid and event = 'booking_rescheduled';
select test.eq(count(*), 1::bigint, 'client notified of the new time')
from public.notification_events where booking_id = current_setting('test.r1')::uuid and event = 'booking_rescheduled'
  and user_id = test.id('client_a');

rollback;
