-- The subscription (T14, ARCHITECTURE §5, §10, §12): good standing, what Stripe's states become,
-- paid and failed invoices, the free-period warnings and end, and that the browser can change
-- none of it.
begin;
select test.make_world();

-- shop1 is public (phone verified, services, open days) and on its free period.
select test.ok(public.is_shop_public(test.id('shop1')), 'shop1 starts public, in its free period');

-- ------------------------------------------------------------------ checkout information
select test.eq(i->>'shop_id', test.id('shop1')::text, 'the owner gets their shop'),
       test.eq(i->>'email', 'owner1@test.local', 'with the account email'),
       test.eq((i->>'price_ron')::numeric, 100::numeric, 'and the shop''s own price'),
       test.eq((i->>'billing_complete')::boolean, false, 'billing data not complete yet')
from public.subscription_checkout_info(test.id('owner1')) i;
select test.fails($$select public.subscription_checkout_info(test.id('staff1'))$$, 'not_allowed', 'staff cannot pay');
select test.fails($$select public.subscription_checkout_info(test.id('client_a'))$$, 'not_allowed', 'clients cannot pay');

update public.shop_billing set legal_address = 'Str. Lungă 10, Brașov', billing_email = 'facturi@unu.test'
where shop_id = test.id('shop1');
select test.eq((public.subscription_checkout_info(test.id('owner1'))->>'billing_complete')::boolean, true,
  'complete once the registered office and billing email are there');

select test.eq(public.set_stripe_customer(test.id('shop1'), 'cus_1'), 'cus_1', 'the customer is recorded');
select test.eq(public.set_stripe_customer(test.id('shop1'), 'cus_other'), 'cus_1', 'the first customer wins');

-- ------------------------------------------------------------------ webhook idempotency
select test.eq(public.stripe_event_begin('evt_1', 'invoice.paid', '{}'), true, 'a new event is handled');
select test.eq(public.stripe_event_begin('evt_1', 'invoice.paid', '{}'), true, 'still to do until it is done');
select public.stripe_event_done('evt_1');
select test.eq(public.stripe_event_begin('evt_1', 'invoice.paid', '{}'), false, 'a repeated delivery is skipped');

-- ------------------------------------------------------------------ card given in the free period
delete from public.notification_events;
select public.sync_stripe_subscription('cus_1', test.id('shop1'), jsonb_build_object(
  'id', 'sub_1', 'status', 'trialing', 'cancel_at_period_end', false,
  'current_period_end', (now() + interval '80 days')::text));
select test.eq(status, 'trial', 'trialing stays in the free period'),
       test.eq(stripe_subscription_id, 'sub_1', 'the Stripe subscription is recorded'),
       test.eq(stripe_status, 'trialing', 'with Stripe''s status')
from public.subscriptions where shop_id = test.id('shop1');

-- The free period ends before Stripe's charge is heard of: the shop stays in search.
update public.subscriptions set trial_ends_at = now() - interval '1 minute' where shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'a card in the free period keeps the shop public until Stripe answers');
select test.eq(public.end_expired_trials(), 0, 'and the hourly job leaves it alone');

-- ------------------------------------------------------------------ paid
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object(
  'id', 'sub_1', 'status', 'active', 'cancel_at_period_end', false,
  'current_period_end', '2026-12-24T10:00:00Z'));
select test.eq(status, 'active', 'active'),
       test.eq(current_period_end, '2026-12-24T10:00:00Z'::timestamptz, 'next payment date')
from public.subscriptions where shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'an active shop is public');

select test.ok(public.record_stripe_invoice('cus_1', jsonb_build_object('id', 'in_0', 'amount_paid', 0)) is null,
  'a 0 lei invoice (start of a free period) is not recorded');
select test.eq((public.record_stripe_invoice('cus_1', jsonb_build_object(
  'id', 'in_1', 'number', 'ABC-0001', 'amount_paid', 100, 'currency', 'ron',
  'paid_at', '2026-11-24T10:00:00Z', 'receipt_url', 'https://pay.stripe.test/r/1',
  'period_end', '2026-12-24T10:00:00Z'))->>'amount')::numeric, 100::numeric, 'a paid invoice is recorded');
select public.record_stripe_invoice('cus_1', jsonb_build_object('id', 'in_1', 'amount_paid', 100));
select test.eq(count(*), 1::bigint, 'once, however often Stripe repeats it'),
       test.eq(min(currency), 'RON', 'in RON'),
       test.eq(min(status), 'paid', 'paid (the fiscal invoice comes later)'),
       test.eq(min(provider_ref), 'ABC-0001', 'with Stripe''s number')
from public.invoices where shop_id = test.id('shop1');
select test.eq(count(*), 1::bigint, 'one payment email'),
       test.eq(min(channels::text), '{email}', 'by email'),
       test.eq(min(user_id::text), test.id('owner1')::text, 'to the owner'),
       test.eq(min(params->>'receipt_url'), 'https://pay.stripe.test/r/1', 'with the receipt')
from public.notification_events where event = 'invoice_paid';
select test.ok(public.record_stripe_invoice('cus_unknown', jsonb_build_object('id', 'in_x', 'amount_paid', 100)) is null,
  'an unknown customer changes nothing');

-- The owner reads their invoices; the staff, the other shop and clients do not.
select test.login(test.id('owner1'));
select test.eq(test.count('select 1 from public.invoices'), 1::bigint, 'the owner sees the invoice');
select test.fails($$update public.invoices set amount = 1$$, 'permission denied', 'nobody edits an invoice');
select test.fails($$insert into public.invoices (shop_id, amount) values (test.id('shop1'), 1)$$, 'permission denied',
  'nobody adds an invoice');
select test.fails($$update public.subscriptions set stripe_status = 'active'$$, 'permission denied',
  'the owner cannot mark the subscription paid');
select test.fails($$select public.sync_stripe_subscription('cus_1', null, '{"id":"sub_1","status":"active"}')$$,
  'permission denied', 'nor call the webhook''s functions');
select test.fails($$select public.subscription_checkout_info(auth.uid())$$, 'permission denied',
  'the checkout information is for the Edge Function only');
select test.logout();
select test.login(test.id('staff1'));
select test.eq(test.count('select 1 from public.invoices'), 0::bigint, 'staff see no invoices');
select test.logout();
select test.login(test.id('owner2'));
select test.eq(test.count('select 1 from public.invoices'), 0::bigint, 'another shop sees no invoices');
select test.logout();

-- ------------------------------------------------------------------ a failed payment
delete from public.notification_events;
select test.eq(public.record_payment_failed('cus_1', jsonb_build_object(
  'id', 'in_2', 'amount_due', 100, 'attempt_count', 1, 'next_payment_attempt', '2026-12-27T10:00:00Z')), true,
  'a failed payment is recorded');
select test.eq(public.record_payment_failed('cus_1', jsonb_build_object(
  'id', 'in_2', 'amount_due', 100, 'attempt_count', 1, 'next_payment_attempt', '2026-12-27T10:00:00Z')), false,
  'the same attempt again is not told twice');
select test.eq(count(*), 1::bigint, 'one warning'),
       test.eq(min(channels::text), '{push,email}', 'by push and email'),
       test.eq(min(params->>'expiry'), '2026-12-27', 'with the date of the next try'),
       test.eq(min(params->>'final'), 'false', 'not the last try')
from public.notification_events where event = 'payment_failed';

select public.sync_stripe_subscription('cus_1', null, jsonb_build_object('id', 'sub_1', 'status', 'past_due'));
select test.eq(status, 'past_due', 'past due while Stripe retries') from public.subscriptions where shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'still in search while Stripe retries');

-- The last try fails: Stripe ends the subscription.
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object(
  'id', 'sub_1', 'status', 'canceled', 'cancellation_reason', 'payment_failed'));
select test.eq(sub.status, 'inactive', 'inactive after the last failed try'),
       test.eq(sub.ended_reason, 'payment_failed', 'because the payment failed'),
       test.eq(s.active, false, 'the shop is inactive')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where sub.shop_id = test.id('shop1');
select test.ok(not public.is_shop_public(test.id('shop1')), 'an inactive shop leaves search');
select test.eq(params->>'reason', 'payment_failed', 'the owner is told why'),
       test.eq(channels::text, '{push,email}', 'by push and email')
from public.notification_events where event = 'shop_inactive';

-- No new bookings; the existing ones are untouched.
select test.login(test.id('client_a'));
select test.fails(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => current_date + 2,
                                p_slot => '10:00', p_request_id => gen_random_uuid(), p_car_id => %L)$$,
                         test.id('shop1'), test.id('car_a')),
  'shop_unavailable', 'an inactive shop cannot be booked');
select test.logout();
select test.eq(status, 'done', 'past bookings stay') from public.bookings where id = test.id('booking_a');

select test.login(test.id('owner1'));
select test.eq(public.get_shop_setup()->'reasons', '["subscription_inactive"]'::jsonb,
  'Panou says the subscription is the reason (not also "shop inactive")');
select test.eq(public.get_shop_setup()->'subscription'->>'ended_reason', 'payment_failed', 'and why it ended');
select test.logout();

-- Paying again (a new checkout) reactivates at once.
delete from public.notification_events;
select public.sync_stripe_subscription('cus_1', test.id('shop1'), jsonb_build_object(
  'id', 'sub_2', 'status', 'active', 'current_period_end', '2027-01-24T10:00:00Z'));
select test.eq(sub.status, 'active', 'active again'),
       test.eq(sub.ended_reason, null, 'no end reason'),
       test.eq(s.active, true, 'the shop is active again')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where sub.shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'back in search');
select test.eq(count(*), 0::bigint, 'no inactive notice when coming back')
from public.notification_events where event = 'shop_inactive';

-- The end of the old subscription arriving late does not touch the new one.
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object('id', 'sub_1', 'status', 'canceled'));
select test.eq(status, 'active', 'an old subscription ending changes nothing'),
       test.eq(stripe_subscription_id, 'sub_2', 'the new one stays')
from public.subscriptions where shop_id = test.id('shop1');

-- ------------------------------------------------------------------ cancelled by the owner
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object(
  'id', 'sub_2', 'status', 'active', 'cancel_at_period_end', true, 'current_period_end', '2027-01-24T10:00:00Z'));
select test.eq(status, 'active', 'still active until the end of the paid month'),
       test.eq(cancel_at_period_end, true, 'marked to stop')
from public.subscriptions where shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'still public until then');
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object(
  'id', 'sub_2', 'status', 'canceled', 'cancel_at_period_end', true, 'cancellation_reason', 'cancellation_requested'));
select test.eq(status, 'cancelled', 'cancelled at the end of the month'),
       test.eq(ended_reason, 'cancelled', 'by the owner'),
       test.eq(cancel_at_period_end, false, 'nothing left to stop')
from public.subscriptions where shop_id = test.id('shop1');
select test.ok(not public.is_shop_public(test.id('shop1')), 'a cancelled shop leaves search');

-- A card given and taken back inside the free period gives the rest of the free period back.
update public.subscriptions set status = 'trial', trial_ends_at = now() + interval '20 days',
  stripe_subscription_id = 'sub_3', stripe_status = 'trialing', ended_reason = null where shop_id = test.id('shop1');
update public.shops set active = true where id = test.id('shop1');
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object(
  'id', 'sub_3', 'status', 'canceled', 'cancellation_reason', 'cancellation_requested'));
select test.eq(status, 'trial', 'back to the free period') from public.subscriptions where shop_id = test.id('shop1');
select test.ok(public.is_shop_public(test.id('shop1')), 'still public in the free period');

-- incomplete (a checkout waiting for 3-D Secure) changes nothing.
select public.sync_stripe_subscription('cus_1', null, jsonb_build_object('id', 'sub_4', 'status', 'incomplete'));
select test.eq(stripe_subscription_id, 'sub_3', 'incomplete changes nothing') from public.subscriptions where shop_id = test.id('shop1');

-- ------------------------------------------------------------------ free-period warnings and end
delete from public.notification_events;
-- shop2's free period ends in 7 days (Bucharest calendar), no card.
update public.subscriptions set trial_ends_at = '2026-12-24T12:00:00Z', stripe_status = null, stripe_subscription_id = null
where shop_id = test.id('shop2');
update public.subscriptions set trial_ends_at = '2027-06-01T12:00:00Z' where shop_id = test.id('shop1');

select test.eq(public.send_trial_warnings('2026-12-16T05:00:00Z'), 0, 'nothing 8 days before');
select test.eq(public.send_trial_warnings('2026-12-17T05:00:00Z'), 1, '7 days before: one warning');
select test.eq(public.send_trial_warnings('2026-12-17T05:30:00Z'), 0, 'not twice');
select test.eq(public.send_trial_warnings('2026-12-20T05:00:00Z'), 0, 'nothing in between');
select test.eq(public.send_trial_warnings('2026-12-23T05:00:00Z'), 1, '1 day before: the last warning');
select test.eq(public.send_trial_warnings('2026-12-24T05:00:00Z'), 0, 'and no more');
select test.eq(array_agg((params->>'days')::int order by created_at, (params->>'days')::int desc), array[7, 1],
  'the days left in each'),
       test.eq(min(params->>'expiry'), '2026-12-24', 'with the end date'),
       test.eq(min(user_id::text), test.id('owner2')::text, 'to the owner'),
       test.eq(min(channels::text), '{push,email}', 'by push and email')
from public.notification_events where event = 'trial_ending';
select test.eq(trial_reminded, '{"2026-12-24": [7, 1]}'::jsonb, 'both thresholds recorded')
from public.subscriptions where shop_id = test.id('shop2');

-- A free period extended to end in 5 days gets one warning (the 1-day one comes later).
delete from public.notification_events;
update public.subscriptions set trial_ends_at = '2026-12-29T12:00:00Z' where shop_id = test.id('shop2');
select test.eq(public.send_trial_warnings('2026-12-24T05:00:00Z'), 1, 'a new end date starts over');
select test.eq(public.send_trial_warnings('2026-12-25T05:00:00Z'), 0, 'once for the 7-day threshold');
-- With a card given there is nothing to warn about.
update public.subscriptions set stripe_status = 'trialing' where shop_id = test.id('shop2');
select test.eq(public.send_trial_warnings('2026-12-28T05:00:00Z'), 0, 'no warning when a card is given');
update public.subscriptions set stripe_status = null where shop_id = test.id('shop2');

-- The end: no card → inactive, once, with a notice.
delete from public.notification_events;
update public.subscriptions set trial_ends_at = now() - interval '1 hour' where shop_id = test.id('shop2');
select test.eq(public.end_expired_trials(), 1, 'the ended free period is closed');
select test.eq(public.end_expired_trials(), 0, 'once');
select test.eq(sub.status, 'inactive', 'inactive'),
       test.eq(sub.ended_reason, 'trial_ended', 'because the free period ended'),
       test.eq(s.active, false, 'the shop is inactive')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where sub.shop_id = test.id('shop2');
select test.eq(params->>'reason', 'trial_ended', 'the owner is told')
from public.notification_events where event = 'shop_inactive' and user_id = test.id('owner2');

-- The hourly job runs it; the warnings only at 07:00 Bucharest.
select test.ok(public.run_hourly_jobs('2026-12-17T08:00:00Z') ? 'trials_ended', 'the hourly job ends free periods'),
       test.ok(not (public.run_hourly_jobs('2026-12-17T08:00:00Z') ? 'trial_warnings'), 'warnings not at 10:00'),
       test.ok(public.run_hourly_jobs('2026-12-17T05:00:00Z') ? 'trial_warnings', 'warnings at 07:00');

-- A shop whose owner deleted the account never comes back through a late webhook.
update public.profiles set deleted_at = now() where id = test.id('owner2');
update public.subscriptions set stripe_customer_id = 'cus_2' where shop_id = test.id('shop2');
select public.sync_stripe_subscription('cus_2', null, jsonb_build_object('id', 'sub_9', 'status', 'active'));
select test.eq(active, false, 'a deleted owner''s shop stays inactive') from public.shops where id = test.id('shop2');

rollback;
