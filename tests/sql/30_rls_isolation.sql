-- Row Level Security: who sees which rows (ARCHITECTURE §2, CLAUDE.md §6.1, §6.11).
begin;
select test.make_world();

-- ---------------------------------------------------------------- client A
select test.login(test.id('client_a'));
select test.eq(test.count('select 1 from public.profiles'), 1::bigint, 'A sees only own profile');
select test.eq(test.count('select 1 from public.cars'), 1::bigint, 'A sees only own car');
select test.eq(test.count(format('select 1 from public.cars where id = %L', test.id('car_b'))), 0::bigint,
  'A cannot see B''s car');
select test.eq(test.count('select 1 from public.bookings'), 1::bigint, 'A sees only own booking');
select test.eq(test.count('select 1 from public.quotes'), 1::bigint, 'A sees own quote');
select test.eq(test.count('select 1 from public.quote_items'), 2::bigint, 'A sees own quote items');
select test.eq(test.count('select 1 from public.threads'), 1::bigint, 'A sees only own thread');
select test.eq(test.count('select 1 from public.messages'), 2::bigint, 'A sees only own messages');
select test.eq(test.count('select 1 from public.push_subscriptions'), 1::bigint, 'A sees only own devices');
select test.eq(test.count('select 1 from public.history_reports'), 1::bigint, 'A sees own report');
select test.eq(test.count('select 1 from public.shop_billing'), 0::bigint, 'A sees no fiscal data');
select test.eq(test.count('select 1 from public.subscriptions'), 0::bigint, 'A sees no subscriptions');
select test.eq(test.count('select 1 from public.shop_staff'), 0::bigint, 'A sees no staff');
select test.eq(test.count('select 1 from public.admin_audit_log'), 0::bigint, 'A sees no audit log');
select test.eq(test.count('select 1 from public.notification_events'), 0::bigint, 'A sees no outbox');
-- Shops: public ones, never the private one A has no booking with.
select test.eq(test.count('select 1 from public.shops'), 1::bigint, 'A sees only the public shop');
select test.eq(test.count(format('select 1 from public.shops where id = %L', test.id('shop2'))), 0::bigint,
  'A cannot see the private shop');
select test.eq(test.count(format('select 1 from public.shop_hours where shop_id = %L', test.id('shop2'))), 0::bigint,
  'A cannot see the private shop''s hours');
select test.eq(test.count(format('select 1 from public.shop_services where shop_id = %L', test.id('shop1'))), 2::bigint,
  'A sees the public shop''s services');
-- Reviews: removed ones are hidden from everyone but the author, the shop and admin.
select test.eq(test.count('select 1 from public.reviews'), 1::bigint, 'A sees only the visible review');
select test.eq(review_count, 1, 'rating ignores removed reviews'),
       test.eq(rating_sum, 5, 'rating sum'),
       test.eq(weighted_score, round((5 + 4.3 * 3) / (1 + 3.0), 4), 'weighted score (§8)')
from public.shop_ratings where shop_id = test.id('shop1');
-- Notices for clients and everyone, not for shops or a city.
select test.eq(test.count('select 1 from public.notices'), 2::bigint, 'A sees client + all notices');
-- Writes on another client's rows touch nothing.
update public.cars set model = 'Hacked' where id = test.id('car_b');
delete from public.cars where id = test.id('car_b');
delete from public.push_subscriptions where endpoint = 'https://push.test/b';
update public.profiles set name = 'Hacked' where id = test.id('client_b');
-- A car is always created for the caller (owner_id is not writable).
insert into public.cars (make, model) values ('Skoda', 'Octavia');
select test.eq(owner_id, test.id('client_a'), 'new car belongs to the caller')
from public.cars where model = 'Octavia';
select test.fails(format($$insert into public.cars (owner_id, make, model) values (%L, 'X', 'Y')$$, test.id('client_b')),
  'permission denied', 'A cannot create a car for B');
-- Device subscriptions always belong to the caller.
insert into public.push_subscriptions (endpoint, subscription) values ('https://push.test/a2', '{}');
select test.eq(user_id, test.id('client_a'), 'device subscription belongs to the caller')
from public.push_subscriptions where endpoint = 'https://push.test/a2';
select test.logout();

select test.eq(model, 'Logan', 'B''s car untouched') from public.cars where id = test.id('car_b');
select test.eq(name, 'Bogdan Pop', 'B''s profile untouched') from public.profiles where id = test.id('client_b');
select test.eq(test.count($$select 1 from public.push_subscriptions where endpoint = 'https://push.test/b'$$), 1::bigint,
  'B''s device untouched');

-- ---------------------------------------------------------------- client B
select test.login(test.id('client_b'));
select test.eq(test.count('select 1 from public.cars'), 1::bigint, 'B sees only own car');
select test.eq(test.count('select 1 from public.bookings'), 2::bigint, 'B sees only own bookings');
select test.eq(test.count('select 1 from public.quotes'), 0::bigint, 'B cannot see A''s quote');
select test.eq(test.count('select 1 from public.quote_items'), 0::bigint, 'B cannot see A''s quote items');
select test.eq(test.count('select 1 from public.history_reports'), 0::bigint, 'B cannot see A''s report');
select test.eq(test.count('select 1 from public.messages'), 1::bigint, 'B sees only own messages');
-- B keeps seeing the private shop they have a booking with.
select test.eq(test.count(format('select 1 from public.shops where id = %L', test.id('shop2'))), 1::bigint,
  'B sees the shop B booked with, even though it is not public');
select test.eq(test.count('select 1 from public.reviews'), 2::bigint, 'B sees own removed review');
select test.logout();

-- ---------------------------------------------------------------- shop 1 owner
select test.login(test.id('owner1'));
select test.eq(test.count('select 1 from public.cars'), 0::bigint, 'a shop cannot read the cars table');
select test.eq(test.count('select 1 from public.profiles'), 1::bigint, 'shop reads no client profiles');
select test.eq(test.count('select 1 from public.bookings'), 2::bigint, 'owner1 sees shop1 bookings only');
select test.eq(test.count(format('select 1 from public.bookings where shop_id = %L', test.id('shop2'))), 0::bigint,
  'owner1 cannot see shop2 bookings');
select test.eq(test.count('select 1 from public.quotes'), 1::bigint, 'owner1 sees shop1 quotes');
select test.eq(test.count('select 1 from public.threads'), 1::bigint, 'owner1 sees shop1 threads only');
select test.eq(test.count('select 1 from public.messages'), 2::bigint, 'owner1 sees shop1 messages only');
select test.eq(test.count('select 1 from public.shop_billing'), 1::bigint, 'owner1 sees own fiscal data');
select test.eq(test.count(format('select 1 from public.shop_billing where shop_id = %L', test.id('shop2'))), 0::bigint,
  'owner1 cannot see shop2 fiscal data');
select test.eq(test.count('select 1 from public.subscriptions'), 1::bigint, 'owner1 sees own subscription');
select test.eq(test.count('select 1 from public.shop_staff'), 2::bigint, 'owner1 sees own team');
select test.eq(test.count('select 1 from public.reviews'), 2::bigint, 'owner1 sees own removed review too');
select test.eq(test.count('select 1 from public.notices'), 2::bigint, 'owner1 sees shop + all notices');
select test.eq(test.count('select 1 from public.shops'), 1::bigint, 'owner1 does not see the private shop2');
select test.eq(public.my_shop_id(), test.id('shop1'), 'my_shop_id');
select test.fails('select invite_token_hash from public.shop_staff', 'permission denied',
  'invite token hash is never readable');
-- Settings of the own shop are editable; another shop's are not.
update public.shops set daily_capacity = 6, inspection_fee = 80 where id = test.id('shop1');
update public.shops set daily_capacity = 99 where id = test.id('shop2');
update public.shop_billing set legal_name = 'Hacked' where shop_id = test.id('shop2');
update public.shop_hours set is_closed = true where shop_id = test.id('shop2');
update public.shop_billing set legal_name = 'AUTO UNU SRL NOU' where shop_id = test.id('shop1');
insert into public.shop_closures (shop_id, start_date, end_date, label)
  values (test.id('shop1'), current_date + 10, current_date + 12, 'Concediu');
select test.fails(format($$insert into public.shop_closures (shop_id, start_date, end_date) values (%L, current_date, current_date)$$, test.id('shop2')),
  'row-level security', 'owner1 cannot add a closure to shop2');
select test.fails(format($$insert into public.shop_services (shop_id, service_id) values (%L, 'ulei')$$, test.id('shop2')),
  'row-level security', 'owner1 cannot add services to shop2');
select test.logout();

select test.eq(daily_capacity, 6, 'owner1 changed own capacity') from public.shops where id = test.id('shop1');
select test.eq(daily_capacity, 5, 'shop2 capacity untouched') from public.shops where id = test.id('shop2');
select test.eq(legal_name, 'AUTO DOI SRL', 'shop2 fiscal data untouched') from public.shop_billing where shop_id = test.id('shop2');
select test.eq(legal_name, 'AUTO UNU SRL NOU', 'owner1 changed own fiscal data') from public.shop_billing where shop_id = test.id('shop1');
select test.eq(count(*) filter (where is_closed), 2::bigint, 'shop2 hours untouched')
from public.shop_hours where shop_id = test.id('shop2');

-- A disabled service cannot be picked.
update public.services set enabled = false where id = 'vulcanizare';
select test.login(test.id('owner1'));
select test.fails(format($$insert into public.shop_services (shop_id, service_id) values (%L, 'vulcanizare')$$, test.id('shop1')),
  'row-level security', 'disabled service cannot be selected');
insert into public.shop_services (shop_id, service_id) values (test.id('shop1'), 'geometrie');
select test.logout();
update public.services set enabled = true where id = 'vulcanizare';

-- ---------------------------------------------------------------- shop 1 staff
select test.login(test.id('staff1'));
select test.eq(test.count('select 1 from public.bookings'), 2::bigint, 'staff sees the shop bookings');
select test.eq(test.count('select 1 from public.shop_billing'), 0::bigint, 'staff cannot see fiscal data');
select test.eq(test.count('select 1 from public.subscriptions'), 0::bigint, 'staff cannot see the subscription');
select test.eq(test.count('select 1 from public.cars'), 0::bigint, 'staff cannot read cars');
update public.shop_billing set legal_name = 'Staff edit' where shop_id = test.id('shop1');
delete from public.shop_staff where user_id = test.id('owner1');
select test.logout();
select test.eq(legal_name, 'AUTO UNU SRL NOU', 'staff cannot edit fiscal data') from public.shop_billing where shop_id = test.id('shop1');
select test.eq(test.count(format('select 1 from public.shop_staff where shop_id = %L', test.id('shop1'))), 2::bigint,
  'staff cannot remove anyone');

-- The owner can remove staff, never the owner row.
select test.login(test.id('owner1'));
delete from public.shop_staff where shop_id = test.id('shop1') and role = 'owner';
delete from public.shop_staff where user_id = test.id('staff1');
select test.logout();
select test.eq(test.count(format('select 1 from public.shop_staff where shop_id = %L', test.id('shop1'))), 1::bigint,
  'owner removed staff, owner row kept');

-- ---------------------------------------------------------------- shop 2 owner
select test.login(test.id('owner2'));
select test.eq(test.count('select 1 from public.bookings'), 1::bigint, 'owner2 sees only shop2 bookings');
select test.eq(test.count('select 1 from public.quotes'), 0::bigint, 'owner2 cannot see shop1 quotes');
select test.eq(test.count('select 1 from public.shop_billing'), 1::bigint, 'owner2 sees only own fiscal data');
select test.eq(test.count('select 1 from public.notices'), 3::bigint, 'owner2 sees shop + all + Codlea notices');
select test.eq(test.count('select 1 from public.shops'), 2::bigint, 'owner2 sees own shop and the public shop1');
select test.logout();

-- ---------------------------------------------------------------- admin
select test.login(test.id('admin'));
select test.ok(public.is_admin(), 'is_admin');
select test.eq(test.count('select 1 from public.shop_billing'), 2::bigint, 'admin sees all fiscal data');
select test.eq(test.count('select 1 from public.bookings'), 3::bigint, 'admin sees all bookings');
select test.eq(test.count('select 1 from public.shops'), 2::bigint, 'admin sees all shops');
select test.eq(test.count('select 1 from public.profiles'), 6::bigint, 'admin sees all profiles');
select test.eq(test.count('select 1 from public.admin_audit_log'), 1::bigint, 'admin reads the audit log');
select test.eq(test.count('select 1 from public.cars'), 0::bigint, 'admin does not read cars');
select test.logout();

-- ---------------------------------------------------------------- signed out
select test.login_anon();
select test.fails('select * from public.profiles', 'permission denied', 'anon cannot read profiles');
select test.fails('select * from public.shops', 'permission denied', 'anon cannot read shops');
select test.fails('select * from public.bookings', 'permission denied', 'anon cannot read bookings');
select test.fails('select * from public.platform_settings', 'permission denied', 'anon cannot read settings');
select test.eq(test.count('select 1 from public.services'), 150::bigint, 'anon reads the catalog');
select test.eq(public.get_schema_version() > 0, true, 'anon reads the schema version');
select test.logout();

rollback;
