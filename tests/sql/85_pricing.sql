-- Pricing after T19b: 149 lei a month (19 lei per colleague after the first), a launch price of 99
-- lei for the first 50 shops (kept by
-- them), after which a new shop simply gets 149 — no manual step; the landing page shows the launch
-- price only while places are left, never how many shops signed up.
begin;

-- As the migrations left it (05_fixtures.sql kept a copy before setting the first prices back).
select test.eq(subscription_price_ron, 149.00::numeric(10,2), 'the subscription is 149 lei'),
       test.eq(launch_price_ron, 99.00::numeric(10,2), 'the launch price is 99 lei'),
       test.eq(launch_shops, 50, 'for the first 50 shops'),
       test.eq(staff_free_seats, 1, 'with the first colleague included'),
       test.eq(staff_seat_price_ron, 19.00::numeric(10,2), 'and 19 lei for each one after it')
from test.original_settings;
-- Since 8 Oct the places are per city (tests/sql/117_launch_per_city.sql); the landing page shows
-- the launch price while places are open, never how many.
update public.platform_settings set subscription_price_ron = 149, launch_price_ron = 99, launch_slots_per_city = 10 where id = 1;
select test.eq(launch_slots_per_city, 10, 'ten places in each city by default') from test.original_settings;

select test.login_anon();
select test.eq(public.public_pricing()->>'launch_price_ron', '99.00', 'a visitor sees the launch price'),
       test.ok(not public.public_pricing() ? 'launch_shops', 'never for how many shops'),
       test.ok(not public.public_pricing() ? 'launch_left', 'never how many signed up');
select test.logout();

-- Setări platformă: the launch price is 0 (none) or at least 1 leu; the places a whole number.
select test.sign_up('admin-pret@test.local', '{"role":"client","name":"Admin Preț"}');
update public.profiles set role = 'admin' where name = 'Admin Preț';
select test.login((select id from public.profiles where name = 'Admin Preț'));
select test.eq(test.error_params($$select public.admin_update_settings('{"launch_price_ron":0.5}', test.rid())$$)->>'field',
               'launch_price_ron', 'a launch price under 1 leu is refused');
select test.eq(test.error_params($$select public.admin_update_settings('{"launch_slots_per_city":2.5}', test.rid())$$)->>'field',
               'launch_slots_per_city', 'places must be a whole number');
select test.eq(test.error_params($$select public.admin_update_settings('{"launch_shops":50}', test.rid())$$)->>'field',
               'launch_shops', 'the country-wide places are no longer a setting');
select test.eq((public.admin_update_settings('{"launch_slots_per_city":12}', test.rid())->>'launch_slots_per_city')::int, 12,
               'the admin sets the places per city');
select public.admin_update_settings('{"launch_price_ron":0}', test.rid());
select test.logout();
select test.login_anon();
select test.ok(public.public_pricing()->'launch_price_ron' = 'null'::jsonb, 'launch price 0: no launch offer');
select test.logout();

rollback;
