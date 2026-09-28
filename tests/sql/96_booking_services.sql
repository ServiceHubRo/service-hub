-- T21: several services in one booking — still one car, one time, one place of the day's capacity;
-- every service offered by the shop, each once, at most 5; every place that shows a booking's
-- service shows all of them; a reminder for each service that has an interval.
begin;
select test.make_world();

insert into public.shop_services (shop_id, service_id) values (test.id('shop1'), 'itp'), (test.id('shop1'), 'lichid_frana'),
  (test.id('shop1'), 'filtru_aer'), (test.id('shop1'), 'bujii');
select set_config('test.day', test.workday(2)::text, true);

create function pg_temp.book(p_extra text[]) returns text
language plpgsql as $$
declare r text;
begin
  perform test.login(test.id('client_b'));
  r := test.error_of(format(
    $f$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '15:00',
       p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan","plate":"BV 21 MUL"}',
       p_extra_service_ids => %L)$f$,
    test.id('shop1'), current_setting('test.day'), p_extra));
  perform test.logout();
  return r;
end $$;

-- ------------------------------------------------------------------ refused
select test.eq(pg_temp.book('{frane,frane}'), 'service_unavailable', 'the same service twice refused');
select test.eq(pg_temp.book('{ulei}'), 'service_unavailable', 'the first service again refused');
select test.eq(pg_temp.book('{frane,parbriz}'), 'service_unavailable', 'a service the shop does not offer refused');
select test.eq(pg_temp.book('{frane,itp,lichid_frana,filtru_aer,bujii}'), 'too_many_services', 'more than 5 services refused');
select test.login(test.id('client_b'));
select test.eq(test.error_params(format(
  $f$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '15:00',
     p_request_id => gen_random_uuid(), p_car => '{"make":"Dacia","model":"Logan"}',
     p_extra_service_ids => '{frane,itp,lichid_frana,filtru_aer,bujii}')$f$,
  test.id('shop1'), current_setting('test.day')))->>'limit', '5', 'the refusal names the limit');
select test.logout();
update public.services set enabled = false where id = 'itp';
select test.eq(pg_temp.book('{itp}'), 'service_unavailable', 'a switched-off service refused');
update public.services set enabled = true where id = 'itp';
select test.eq(count(*), 0::bigint, 'nothing was booked') from public.bookings where car_snapshot->>'plate' = 'BV 21 MUL';

-- ------------------------------------------------------------------ one booking, several services
delete from public.notification_events;
select test.eq(pg_temp.book('{frane,itp,lichid_frana,filtru_aer}'), 'ok', 'five services in one booking');
select set_config('test.b', (select id::text from public.bookings where car_snapshot->>'plate' = 'BV 21 MUL'), true);
select test.eq(count(*), 1::bigint, 'one booking') from public.bookings where car_snapshot->>'plate' = 'BV 21 MUL';
select test.eq(service_id, 'ulei', 'the first service'),
       test.eq(extra_service_ids, '{frane,itp,lichid_frana,filtru_aer}'::text[], 'the others, in the order ticked')
from public.bookings where id = current_setting('test.b')::uuid;
select test.eq((params->>'extra_count')::int, 4, 'the notification says how many were added')
from public.notification_events where event = 'booking_requested' and booking_id = current_setting('test.b')::uuid limit 1;
-- One place of the capacity: the shop has cars_per_slot = 1, so 15:00 is now taken.
select test.eq(pg_temp.book('{}'), 'slot_full', 'the booking holds one place, not five');

-- The client cannot change them afterwards.
select test.login(test.id('client_b'));
select test.fails(format($$update public.bookings set extra_service_ids = '{}' where id = %L$$, current_setting('test.b')),
  'permission denied', 'the client cannot edit the services');
select test.logout();

-- ------------------------------------------------------------------ shown everywhere
select test.eq(public.services_label('ulei', '{frane}', 'ro'),
  (select string_agg(name_ro, ', ' order by array_position(array['ulei','frane'], id)) from public.services where id in ('ulei', 'frane')),
  'one line, in order, in Romanian');
select test.login(test.id('owner1'));
select test.eq(jsonb_array_length(b->'extra_services'), 4, 'the shop sees every service on its list'),
       test.eq(b->'extra_services'->0->>'id', 'frane', 'in order'),
       test.ok(b->'extra_services'->0->>'name_ro' is not null, 'with their names')
from jsonb_array_elements(public.list_shop_bookings()->'bookings') b where b->>'id' = current_setting('test.b');
select test.logout();
select test.login(test.id('admin'));
select test.ok(b->>'service_ro' like '%, %, %, %, %', 'the admin list shows all five')
from jsonb_array_elements(public.admin_list_bookings()->'bookings') b where b->>'id' = current_setting('test.b');
select test.eq(jsonb_array_length(public.admin_get_booking(current_setting('test.b')::uuid)->'extra_services'), 4, 'and the booking page');
select test.ok(r->>'service_ro' like '%, %', 'the Excel export too')
from jsonb_array_elements(public.admin_export('bookings', '{}')) r where r->>'ref' = (select ref from public.bookings where id = current_setting('test.b')::uuid);
select test.logout();

-- ------------------------------------------------------------------ reminders for each service
delete from public.notification_events;
delete from public.client_reminders;
select set_config('test.done', test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', public.bucharest_today() - 30, '09:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set car_id = test.id('car_a'), service_id = 'frane', extra_service_ids = '{lichid_frana,filtru_aer}',
  done_at = now() - interval '24 months' + interval '10 days'
where id = current_setting('test.done')::uuid;
alter table public.bookings enable trigger bookings_guard;
-- Brake fluid (24 months) is due in 10 days; the air filter (12 months) is long past; brakes have no interval.
select test.eq(public.send_service_reminders(public.bucharest_today()), 1, 'an added service gets its reminder');
select test.eq(params->>'service_id', 'lichid_frana', 'for the added service')
from public.notification_events where event = 'service_due';
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'never twice');
select test.eq(service_id, 'lichid_frana', 'kept per service') from public.client_reminders where booking_id = current_setting('test.done')::uuid;
-- Already booked for it as an added service: nothing to remind.
delete from public.client_reminders;
delete from public.notification_events;
select set_config('test.active', test.raw_booking(test.id('shop1'), test.id('client_a'), 'pending', public.bucharest_today() + 5, '10:00')::text, true);
alter table public.bookings disable trigger bookings_guard;
update public.bookings set car_id = test.id('car_a'), service_id = 'ulei', extra_service_ids = '{lichid_frana}'
where id = current_setting('test.active')::uuid;
alter table public.bookings enable trigger bookings_guard;
select test.eq(public.send_service_reminders(public.bucharest_today()), 0, 'already booked for it among the added services');

-- The catalog counts a service used as an added one.
select test.login(test.id('admin'));
select test.ok((s->>'bookings')::int >= 2, 'lichid_frana counted in the catalog')
from jsonb_array_elements(public.admin_list_catalog()) c, jsonb_array_elements(c->'services') s where s->>'id' = 'lichid_frana';
select test.logout();

rollback;
