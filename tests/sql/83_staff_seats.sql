-- Paid staff accounts: the first colleague with an account is included; each one after it adds the
-- price per colleague to the subscription (an invitation costs nothing); while Stripe runs the
-- subscription, a change of paid seats asks for the Stripe quantity to be set, once.
begin;
select test.make_world();

-- ------------------------------------------------------------------ counting
select test.eq(seats, 0, 'shop1: its only colleague is included'),
       test.eq(free_seats, 1, 'one colleague included'),
       test.eq(seat_price_ron, 20.00::numeric(10,2), 'the others at 20 lei'),
       test.eq(public.subscription_monthly_ron(sub), 100.00::numeric, '100 lei a month, the colleague included')
from public.subscriptions sub where shop_id = test.id('shop1');
select test.eq(seats, 0, 'shop2: no colleagues') from public.subscriptions where shop_id = test.id('shop2');

-- An invitation not yet accepted costs nothing.
insert into public.shop_staff (shop_id, invited_email, role, invite_token_hash)
values (test.id('shop1'), 'nou@test.local', 'staff', 'hash-nou');
select test.eq(seats, 0, 'a pending invitation is not paid') from public.subscriptions where shop_id = test.id('shop1');

-- A second colleague joins: 120 lei.
select set_config('test.staff2', test.sign_up('coleg2@test.local', '{"role":"client","name":"Coleg Doi"}')::text, true);
update public.profiles set role = 'shop' where id = current_setting('test.staff2')::uuid;
update public.shop_staff set user_id = current_setting('test.staff2')::uuid, accepted_at = now()
where invited_email = 'nou@test.local';
select test.eq(seats, 1, 'the second colleague pays once the account joined'),
       test.eq(public.subscription_monthly_ron(sub), 120.00::numeric, '100 + 1 × 20 = 120 lei')
from public.subscriptions sub where shop_id = test.id('shop1');

-- The trial is not in Stripe: no request to Stripe.
select test.eq(count(*), 0::bigint, 'no Stripe subscription: nothing to sync')
from public.notification_events where event = 'seats_changed';

-- ------------------------------------------------------------------ Stripe runs the subscription
update public.subscriptions set stripe_subscription_id = 'sub_test', stripe_customer_id = 'cus_test',
       stripe_status = 'active', status = 'active'
where shop_id = test.id('shop1');

-- The owner removes a colleague: 100 lei, and Stripe is asked (once) to change the quantity.
select test.login(test.id('owner1'));
delete from public.shop_staff where user_id = current_setting('test.staff2')::uuid;
select test.logout();
select test.eq(seats, 0, 'removed: the one left is included') from public.subscriptions where shop_id = test.id('shop1');
select test.eq(count(*), 1::bigint, 'one request to set the Stripe quantity, to the owner, on the stripe channel')
from public.notification_events
where event = 'seats_changed' and user_id = test.id('owner1') and channels = array['stripe']
  and params->>'shop_id' = test.id('shop1')::text;

-- The included colleague leaves too: nothing changes in what is paid, no new request.
delete from public.shop_staff where user_id = test.id('staff1');
select test.eq(seats, 0, 'no colleagues left') from public.subscriptions where shop_id = test.id('shop1');
select test.eq(count(*), 1::bigint, 'still one waiting request')
from public.notification_events where event = 'seats_changed' and processed_at is null;

-- What the Edge Functions read and write (service role only).
select test.eq(i->>'seats', '0', 'seat info by shop'),
       test.eq(i->>'stripe_subscription_id', 'sub_test', 'with the Stripe subscription')
from public.stripe_seat_info(test.id('shop1')) i;
select test.eq(i->>'shop_id', test.id('shop1')::text, 'seat info by Stripe customer')
from public.stripe_seat_info(null, 'cus_test') i;
select public.set_billed_seats(test.id('shop1'), 0);
select test.eq(billed_seats, 0, 'what Stripe charges is recorded') from public.subscriptions where shop_id = test.id('shop1');
insert into public.notifications_log (user_id, channel, status) values (test.id('owner1'), 'stripe', 'updated');

select test.login(test.id('owner1'));
select test.fails($$select public.stripe_seat_info(test.id('shop1'))$$, 'permission denied', 'not callable from the browser');
select test.fails($$select public.set_billed_seats(test.id('shop1'), 5)$$, 'permission denied', 'nor this');
select test.fails($$update public.subscriptions set seats = 0$$, 'permission denied', 'seats cannot be written from the browser');
select test.eq(test.count($$select 1 from public.subscriptions where seats = 0 and seat_price_ron = 20$$), 1::bigint,
  'the owner reads the seats of the own subscription');
select test.login(test.id('client_a'));
select test.eq(test.count($$select 1 from public.subscriptions$$), 0::bigint, 'nobody else reads them');
select test.logout();

-- ------------------------------------------------------------------ the price per colleague
select test.login(test.id('admin'));
select test.eq(test.error_params($$select public.admin_update_settings('{"staff_seat_price_ron":-1}', test.rid())$$)->>'field',
               'staff_seat_price_ron', 'a negative price is refused');
select public.admin_update_settings('{"staff_seat_price_ron":25}', test.rid());
select test.eq(staff_seat_price_ron, 25.00::numeric(10,2), 'changed in the settings') from public.platform_settings;
select test.eq(count(*), 1::bigint, 'and logged')
from public.admin_audit_log where action = 'update_settings' and after->>'staff_seat_price_ron' = '25.00';
select test.eq((select (x->>'monthly_ron')::numeric from jsonb_array_elements(public.admin_list_subscriptions()->'subscriptions') x
                where x->>'shop_id' = test.id('shop2')::text), 100::numeric, 'the admin list shows the monthly total');
select test.logout();

-- The included colleagues are a setting too (whole number, 0–10), for shops signing up afterwards.
select test.login(test.id('admin'));
select test.eq(test.error_params($$select public.admin_update_settings('{"staff_free_seats":1.5}', test.rid())$$)->>'field',
               'staff_free_seats', 'a fraction is refused');
select test.eq(test.error_params($$select public.admin_update_settings('{"staff_free_seats":11}', test.rid())$$)->>'field',
               'staff_free_seats', 'more than 10 is refused');
select public.admin_update_settings('{"staff_free_seats":2}', test.rid());
select test.eq((public.public_pricing()->>'free_seats')::int, 2, 'the landing page shows the included colleagues');
select public.admin_update_settings('{"staff_free_seats":1}', test.rid());
select test.logout();

-- A shop signing up now pays 25 lei per colleague; the ones before keep 20.
select test.sign_up('owner3@test.local',
  '{"role":"shop","name":"Nou","phone":"0268000003","shop_name":"Atelier Trei","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
select test.eq(sub.seat_price_ron, 25.00::numeric(10,2), 'new shop: the new price per colleague'),
       test.eq(sub.free_seats, 1, 'with one colleague included'),
       test.eq(sub.seats, 0, 'and no colleagues')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Atelier Trei';
select test.eq(seat_price_ron, 20.00::numeric(10,2), 'an existing shop keeps its price per colleague')
from public.subscriptions where shop_id = test.id('shop2');

-- ------------------------------------------------------------------ the free period warning
-- shop2 with two colleagues (one included), its free period ending in 7 days: the warning names 120 lei.
select set_config('test.staff3', test.sign_up('coleg3@test.local', '{"role":"client","name":"Coleg Trei"}')::text, true);
select set_config('test.staff4', test.sign_up('coleg4@test.local', '{"role":"client","name":"Coleg Patru"}')::text, true);
update public.profiles set role = 'shop' where id in (current_setting('test.staff3')::uuid, current_setting('test.staff4')::uuid);
insert into public.shop_staff (shop_id, user_id, invited_email, role, accepted_at)
values (test.id('shop2'), current_setting('test.staff3')::uuid, 'coleg3@test.local', 'staff', now()),
       (test.id('shop2'), current_setting('test.staff4')::uuid, 'coleg4@test.local', 'staff', now());
update public.subscriptions set trial_ends_at = now() + interval '7 days', trial_reminded = '{}'
where shop_id = test.id('shop2');
select public.send_trial_warnings(now());
select test.eq((params->>'price')::numeric, 120::numeric, 'the free period warning names the monthly total')
from public.notification_events where event = 'trial_ending' and user_id = test.id('owner2');

rollback;
