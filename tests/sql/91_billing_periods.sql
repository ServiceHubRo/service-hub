-- Billing periods (after T19d): 1, 3, 6 or 12 months, 5% / 10% / 15% off, in whole lei, on the
-- shop's own prices (the launch price too) and its paid colleagues; the discount a subscription
-- was sold with stays when the settings change; only the owner sees the offers.
begin;
select test.make_world();

-- ------------------------------------------------------------------ the discounts and the formula
select test.eq(period_discount_3, 5.00::numeric(5,2), '3 months: 5% off'),
       test.eq(period_discount_6, 10.00::numeric(5,2), '6 months: 10% off'),
       test.eq(period_discount_12, 15.00::numeric(5,2), '12 months: 15% off')
from test.original_settings;

select test.eq(public.subscription_period_price(149, 1, 0), 149::numeric, 'a month is the monthly price'),
       test.eq(public.subscription_period_price(149, 3, 5), 425::numeric, '149 lei: 425 lei for 3 months'),
       test.eq(public.subscription_period_price(149, 6, 10), 805::numeric, '805 lei for 6 months'),
       test.eq(public.subscription_period_price(149, 12, 15), 1520::numeric, '1.520 lei for 12 months'),
       test.eq(public.subscription_period_price(99, 3, 5), 282::numeric, 'the launch price: 282 lei for 3 months'),
       test.eq(public.subscription_period_price(99, 6, 10), 535::numeric, '535 lei for 6 months'),
       test.eq(public.subscription_period_price(99, 12, 15), 1010::numeric, '1.010 lei for 12 months'),
       test.eq(public.subscription_period_price(19, 3, 5), 54::numeric, 'a colleague: 54 lei for 3 months'),
       test.eq(public.subscription_period_price(19, 6, 10), 103::numeric, '103 lei for 6 months'),
       test.eq(public.subscription_period_price(19, 12, 15), 194::numeric, '194 lei for 12 months');

-- ------------------------------------------------------------------ the offers, owner only
update public.subscriptions set price_ron = 149, seat_price_ron = 19, seats = 2 where shop_id = test.id('shop1');

select test.login(test.id('owner1'));
select test.eq(jsonb_array_length(public.my_subscription_offers()), 4, 'the owner sees four periods');
select test.eq(o->>'total_ron', '1908', '12 months: 1.520 + 2 × 194 lei'),
       test.eq(o->>'monthly_ron', '159.00', 'about 159 lei a month'),
       test.eq(o->>'discount_percent', '15.00', 'at 15% off')
from jsonb_array_elements(public.my_subscription_offers()) o where o->>'months' = '12';
select test.eq(o->>'total_ron', '187.00', 'a month: 149 + 2 × 19 lei')
from jsonb_array_elements(public.my_subscription_offers()) o where o->>'months' = '1';
select test.fails($$select public.subscription_period_price(1, 1, 0)$$, 'permission denied', 'the formula is not an API');
select test.fails($$select public.subscription_offers(sub) from public.subscriptions sub$$, 'permission denied',
  'nor are another shop''s offers');
select test.logout();

select test.login(test.id('staff1'));
select test.ok(public.my_subscription_offers() is null, 'a colleague sees no offers (the owner pays)');
select test.logout();
select test.login(test.id('client_a'));
select test.ok(public.my_subscription_offers() is null, 'a client sees none');
select test.logout();

select test.eq(jsonb_array_length(public.subscription_checkout_info(test.id('owner1'))->'offers'), 4,
  'Checkout gets the same offers');

-- ------------------------------------------------------------------ what Stripe sold is kept
select public.set_stripe_customer(test.id('shop1'), 'cus_periods');
select public.sync_stripe_subscription('cus_periods', test.id('shop1'), jsonb_build_object(
  'id', 'sub_periods', 'status', 'active', 'cancel_at_period_end', false,
  'current_period_end', (now() + interval '365 days')::text, 'billing_months', 12, 'discount_percent', 15));
select test.eq(billing_months, 12, 'the shop pays for 12 months'),
       test.eq(period_discount, 15.00::numeric(5,2), 'with 15% off'),
       test.eq(public.subscription_monthly_ron(sub), 159.00::numeric, 'the monthly figure is the total ÷ 12')
from public.subscriptions sub where shop_id = test.id('shop1');

update public.platform_settings set period_discount_12 = 20 where id = 1;
select test.eq(public.subscription_monthly_ron(sub), 159.00::numeric, 'a later change of the discount leaves it alone')
from public.subscriptions sub where shop_id = test.id('shop1');

-- An unknown period or a discount out of range is not taken as it is.
select public.sync_stripe_subscription('cus_periods', null, jsonb_build_object(
  'id', 'sub_periods', 'status', 'active', 'billing_months', 5, 'discount_percent', 90));
select test.eq(billing_months, 12, 'a period that is not offered changes nothing'),
       test.eq(period_discount, 15.00::numeric(5,2), 'nor the discount')
from public.subscriptions where shop_id = test.id('shop1');
select public.sync_stripe_subscription('cus_periods', null, jsonb_build_object(
  'id', 'sub_periods', 'status', 'active', 'billing_months', 1, 'discount_percent', 15));
select test.eq(billing_months, 1, 'back to monthly'),
       test.eq(period_discount, 0.00::numeric(5,2), 'a month has no discount'),
       test.eq(public.subscription_monthly_ron(sub), 187.00::numeric, 'the full monthly price')
from public.subscriptions sub where shop_id = test.id('shop1');

-- The browser cannot change them.
select test.login(test.id('owner1'));
select test.fails($$update public.subscriptions set billing_months = 12, period_discount = 50 where shop_id = test.id('shop1')$$,
  'permission denied', 'the owner cannot set a period or a discount');
select test.logout();

-- ------------------------------------------------------------------ settings and the landing page
select test.login_anon();
select test.eq(public.public_pricing()->'period_discounts'->>'3', '5.00', 'a visitor sees the 3-month discount'),
       test.eq(public.public_pricing()->'period_discounts'->>'12', '20.00', 'and the 12-month one');
select test.logout();

select test.sign_up('admin-perioade@test.local', '{"role":"client","name":"Admin Perioade"}');
update public.profiles set role = 'admin' where name = 'Admin Perioade';
select test.login((select id from public.profiles where name = 'Admin Perioade'));
select test.eq(test.error_params($$select public.admin_update_settings('{"period_discount_6":60}', test.rid())$$)->>'field',
  'period_discount_6', 'a discount over 50% is refused');
select test.eq((public.admin_update_settings('{"period_discount_3":7.5}', test.rid())->>'period_discount_3')::numeric, 7.5,
  'the admin changes a discount');
select test.logout();

rollback;
