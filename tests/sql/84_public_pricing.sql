-- The landing page (T18) reads the shop prices without an account: exactly the subscription price,
-- the price per colleague and the free trial days, as currently set in Setări platformă.
begin;

select test.login_anon();
select test.eq(public.public_pricing(),
  '{"subscription_price_ron": 100.00, "seat_price_ron": 20.00, "trial_days": 90}'::jsonb,
  'a visitor reads the shop prices');
select test.fails('select vat_rate_percent from public.platform_settings', 'permission denied',
  'a visitor still cannot read the other platform settings');
select test.logout();

update public.platform_settings set subscription_price_ron = 120, staff_seat_price_ron = 25, trial_days = 60 where id = 1;
select test.login_anon();
select test.eq(public.public_pricing()->>'subscription_price_ron', '120.00', 'a new price shows at once'),
       test.eq(public.public_pricing()->>'seat_price_ron', '25.00', 'with the new price per colleague'),
       test.eq(public.public_pricing()->>'trial_days', '60', 'and the new trial');
select test.logout();

rollback;
