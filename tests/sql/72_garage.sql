-- Garage (T07): a client saves cars with an id picked in the browser, so a retried save cannot add
-- the same car twice; the id never lets anyone write into someone else's garage.
begin;
select test.make_world();

select test.login(test.id('client_a'));
insert into public.cars (id, make, model, year, plate, itp_expiry)
values ('7a7a7a7a-0000-4000-8000-000000000001', 'Dacia', 'Duster', 2020, 'BV 07 DUS', current_date + 12);
select test.eq(owner_id, test.id('client_a'), 'car with a browser-made id belongs to the caller')
from public.cars where id = '7a7a7a7a-0000-4000-8000-000000000001';

-- The same save again (answer lost, "Încearcă din nou"): refused by the key, still one car.
select test.fails($$insert into public.cars (id, make, model) values ('7a7a7a7a-0000-4000-8000-000000000001', 'Dacia', 'Duster')$$,
  'cars_pkey', 'a repeated save cannot add the car twice');
select test.eq(test.count($$select 1 from public.cars where model = 'Duster'$$), 1::bigint, 'still one Duster');

-- Someone else's id: the key refuses it, and nothing of theirs is shown or changed.
select test.fails(format($$insert into public.cars (id, make, model) values (%L, 'X', 'Y')$$, test.id('car_b')),
  'cars_pkey', 'an id already used by another client is refused');
select test.logout();
select test.eq(model, 'Logan', 'B''s car untouched') from public.cars where id = test.id('car_b');

-- Client B cannot see or edit A's new car.
select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.cars where id = '7a7a7a7a-0000-4000-8000-000000000001'$$), 0::bigint,
  'B cannot see A''s new car');
update public.cars set model = 'Hacked' where id = '7a7a7a7a-0000-4000-8000-000000000001';
delete from public.cars where id = '7a7a7a7a-0000-4000-8000-000000000001';
select test.logout();
select test.eq(model, 'Duster', 'A''s car untouched by B') from public.cars where id = '7a7a7a7a-0000-4000-8000-000000000001';

-- A shop account has no garage at all.
select test.login(test.id('owner1'));
select test.fails($$insert into public.cars (id, make, model) values ('7a7a7a7a-0000-4000-8000-000000000002', 'X', 'Y')$$,
  'row-level security', 'a shop cannot create cars');
select test.logout();

-- Deleting a car keeps the bookings made with it (snapshot) — ARCHITECTURE §2, CLAUDE.md §6.6.
select test.login(test.id('client_a'));
delete from public.cars where id = test.id('car_a');
select test.logout();
select test.eq(car_snapshot ->> 'model', 'Golf 7', 'booking keeps the car snapshot after the car is deleted'),
       test.eq(car_id, null::uuid, 'booking no longer points at the deleted car')
from public.bookings where id = test.id('booking_a');

rollback;
