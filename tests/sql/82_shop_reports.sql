-- Rapoarte (T17): shop_reports answers the owner of a shop with its own rows only — finished jobs
-- and refused quotes, decided quotes, cars per day up to today, its week and closures — and
-- answers staff with null (the takings are the owner's). Nobody else gets anything.
begin;
select test.make_world();

-- shop1 already has two done jobs from the fixtures (booking_a 10 days ago, booking_b1 20 days ago)
-- and booking_a's quote, accepted.
select set_config('test.refused', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_refused', test.today() - 2, '09:00')::text, true);
select set_config('test.expired', test.raw_booking(test.id('shop1'), test.id('client_b'), 'expired', test.today() - 3, '09:00')::text, true);
select set_config('test.progress', test.raw_booking(test.id('shop1'), test.id('client_b'), 'in_progress', test.today() - 3, '10:00')::text, true);
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'cancelled', test.today() - 3, '11:00');
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'no_show', test.today() - 3, '12:00');
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'declined', test.today() - 3, '13:00');
select test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.workday(2), '09:00');
select test.raw_booking(test.id('shop2'), test.id('client_b'), 'done', test.today() - 1, '10:00');

update public.bookings set cost = 80, status_changed_at = now() - interval '2 days' where id = current_setting('test.refused')::uuid;
update public.bookings set status_changed_at = now() - interval '3 days' where id = current_setting('test.expired')::uuid;

-- Quotes: refused (5 hours to decide), expired, one replaced and one still waiting (neither is a decision).
select test.raw_quote(current_setting('test.refused')::uuid);
update public.quotes set status = 'refused', sent_at = now() - interval '2 days 5 hours', decided_at = now() - interval '2 days'
where booking_id = current_setting('test.refused')::uuid;
select test.raw_quote(current_setting('test.expired')::uuid);
update public.quotes set status = 'expired', decided_at = now() - interval '3 days' where booking_id = current_setting('test.expired')::uuid;
select test.raw_quote(current_setting('test.progress')::uuid);
update public.quotes set status = 'superseded', decided_at = now() where booking_id = current_setting('test.progress')::uuid;
select test.raw_quote(current_setting('test.progress')::uuid);
update public.quotes set decided_at = coalesce(decided_at, now() - interval '1 day') where booking_id = test.id('booking_a');

insert into public.shop_closures (shop_id, start_date, end_date, label)
values (test.id('shop1'), test.today() + 30, test.today() + 31, 'Concediu');

-- ------------------------------------------------------------------ owner of shop1
select test.login(test.id('owner1'));
select set_config('test.r', public.shop_reports()::text, true);
select test.logout();

select test.eq(current_setting('test.r')::jsonb->'shop'->>'id', test.id('shop1')::text, 'the caller''s shop'),
       test.eq(current_setting('test.r')::jsonb->'shop'->>'daily_capacity', '5', 'its daily capacity'),
       test.eq(current_setting('test.r')::jsonb->'shop'->>'since', test.today()::text, 'the day it joined, in Bucharest'),
       test.eq(current_setting('test.r')::jsonb->'open_weekdays', '[1,2,3,4,5]'::jsonb, 'the open weekdays (default week)'),
       test.eq(current_setting('test.r')::jsonb->'closures'->0->>'end', (test.today() + 31)::text, 'the closures');

select test.eq(
  (select string_agg(j->>'status', ',' order by ord) from jsonb_array_elements(current_setting('test.r')::jsonb->'jobs') with ordinality x(j, ord)),
  'quote_refused,done,done', 'finished jobs and refused quotes only, newest first; never shop2''s');
select test.eq(j->>'cost', '80.00', 'a refused quote carries the inspection fee'),
       test.eq(j->>'client', test.id('client_a')::text, 'the client, to count who came back'),
       test.ok((j->>'ended_at')::timestamptz < now() - interval '1 day', 'when it was refused')
from jsonb_array_elements(current_setting('test.r')::jsonb->'jobs') j
where j->>'id' = current_setting('test.refused');
select test.eq(j->>'service_ro', 'Schimb ulei + filtru ulei', 'the service, in Romanian'),
       test.ok(j->>'service_en' is not null, 'and in English'),
       test.eq(j->>'cost', '340.00', 'what the job brought in'),
       test.eq(j->'car_snapshot'->>'plate', 'BV 12 ABC', 'the car, for the CSV')
from jsonb_array_elements(current_setting('test.r')::jsonb->'jobs') j
where j->>'id' = test.id('booking_a')::text;

select test.eq(
  (select string_agg(q->>'status', ',' order by q->>'status') from jsonb_array_elements(current_setting('test.r')::jsonb->'quotes') q),
  'accepted,expired,refused', 'decided quotes only: replaced and waiting ones are not decisions');
select test.eq(
  ((q->>'decided_at')::timestamptz - (q->>'sent_at')::timestamptz)::text, '05:00:00', 'when it was sent and decided')
from jsonb_array_elements(current_setting('test.r')::jsonb->'quotes') q
where q->>'status' = 'refused';

-- Cars that took a place, per day, up to today: 3 days ago the expired quote and the job in
-- progress (not the cancellation, the no-show or the declined request); nothing in the future.
select test.eq(d->>'cars', '2', 'cars that took a place on a day')
from jsonb_array_elements(current_setting('test.r')::jsonb->'days') d
where d->>'date' = (test.today() - 3)::text;
select test.eq(
  (select count(*)::int from jsonb_array_elements(current_setting('test.r')::jsonb->'days') d where (d->>'date')::date > test.today()),
  0, 'no future days');
select test.eq(
  (select sum((d->>'cars')::int)::int from jsonb_array_elements(current_setting('test.r')::jsonb->'days') d),
  5, 'every car of shop1 up to today: two done, refused, expired, in progress');

-- ------------------------------------------------------------------ everyone else
select test.login(test.id('staff1'));
select test.ok(public.shop_reports() is null, 'staff get nothing: the takings are the owner''s');
select test.logout();

select test.login(test.id('owner2'));
select test.eq(jsonb_array_length(public.shop_reports()->'jobs'), 1, 'shop2 sees only its own job');
select test.eq(jsonb_array_length(public.shop_reports()->'quotes'), 0, 'and none of shop1''s quotes');
select test.logout();

select test.login(test.id('client_a'));
select test.eq(test.error_of('select public.shop_reports()'), 'not_allowed', 'a client has no reports');
select test.logout();
select test.login(test.id('admin'));
select test.eq(test.error_of('select public.shop_reports()'), 'not_allowed', 'an admin has no shop of their own');
select test.logout();
select test.login_anon();
select test.fails('select public.shop_reports()', 'permission denied', 'anon cannot call it');
select test.logout();

rollback;
