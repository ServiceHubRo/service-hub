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
update public.platform_settings set subscription_price_ron = 149, launch_price_ron = 99, launch_shops = 50 where id = 1;

select test.login_anon();
select test.eq(public.public_pricing()->>'launch_price_ron', '99.00', 'a visitor sees the launch price'),
       test.eq(public.public_pricing()->>'launch_shops', '50', 'and for how many shops'),
       test.ok(not public.public_pricing() ? 'launch_left', 'never how many signed up');
select test.logout();

-- Two launch places left: two shops get 99 lei, the third 149.
update public.platform_settings set launch_shops = (select count(*) from public.subscriptions where launch_offer) + 2 where id = 1;
select test.sign_up('lansare1@test.local',
  '{"role":"shop","name":"L1","phone":"0268000011","shop_name":"Lansare Unu","city":"Brașov","lang":"ro","terms_version":"2026-09-25"}');
select test.sign_up('lansare2@test.local',
  '{"role":"shop","name":"L2","phone":"0268000012","shop_name":"Lansare Doi","city":"Brașov","lang":"ro","terms_version":"2026-09-25"}');
select test.eq(test.count($$select 1 from public.subscriptions sub join public.shops s on s.id = sub.shop_id
                            where s.name like 'Lansare %' and sub.price_ron = 99 and sub.launch_offer$$), 2::bigint,
               'the first two get the launch price');
select test.login_anon();
select test.ok(public.public_pricing()->'launch_price_ron' = 'null'::jsonb, 'no places left: the landing page stops showing it');
select test.logout();
select test.sign_up('lansare3@test.local',
  '{"role":"shop","name":"L3","phone":"0268000013","shop_name":"Lansare Trei","city":"Brașov","lang":"ro","terms_version":"2026-09-25"}');
select test.eq(sub.price_ron, 149.00::numeric(10,2), 'the next one pays 149 lei'),
       test.ok(not sub.launch_offer, 'without the launch offer')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Lansare Trei';
select test.eq(test.count($$select 1 from public.subscriptions sub join public.shops s on s.id = sub.shop_id
                            where s.name in ('Lansare Unu', 'Lansare Doi') and sub.price_ron = 99$$), 2::bigint,
               'the first two keep 99 lei');

-- Setări platformă: the launch price is 0 (none) or at least 1 leu; the places a whole number.
select test.sign_up('admin-pret@test.local', '{"role":"client","name":"Admin Preț"}');
update public.profiles set role = 'admin' where name = 'Admin Preț';
select test.login((select id from public.profiles where name = 'Admin Preț'));
select test.eq(test.error_params($$select public.admin_update_settings('{"launch_price_ron":0.5}', test.rid())$$)->>'field',
               'launch_price_ron', 'a launch price under 1 leu is refused');
select test.eq(test.error_params($$select public.admin_update_settings('{"launch_shops":2.5}', test.rid())$$)->>'field',
               'launch_shops', 'places must be a whole number');
select public.admin_update_settings('{"launch_price_ron":0}', test.rid());
select test.logout();
select test.login_anon();
select test.ok(public.public_pricing()->'launch_price_ron' = 'null'::jsonb, 'launch price 0: no launch offer');
select test.logout();

rollback;
