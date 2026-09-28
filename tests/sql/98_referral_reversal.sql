-- A referral's free month is taken back when the payment that earned it is refunded in full or
-- disputed and no other valid payment is left: only what was not used yet, nothing more charged.
begin;
select test.make_world();
select set_config('test.code1', (select display_id from public.profiles where id = test.id('owner1')), true);

create function pg_temp.new_shop(p_n int) returns uuid
language plpgsql as $$
declare v_user uuid;
begin
  v_user := test.sign_up(format('rev%s@test.local', p_n), jsonb_build_object(
    'role', 'shop', 'name', 'Owner ' || p_n, 'phone', '07232' || lpad(p_n::text, 5, '0'),
    'shop_name', 'Service Rev ' || p_n, 'city', 'Brașov', 'lang', 'ro', 'terms_version', '2026-09',
    'referral_code', current_setting('test.code1')));
  perform public.set_stripe_customer((select id from public.shops where owner_id = v_user), 'cus_rev' || p_n);
  return (select id from public.shops where owner_id = v_user);
end $$;

-- ------------------------------------------------------------------ free days: the unused ones go
select set_config('test.end0', (select trial_ends_at::text from public.subscriptions where shop_id = test.id('shop1')), true);
select set_config('test.a', pg_temp.new_shop(1)::text, true);
select public.record_stripe_invoice('cus_rev1', '{"id":"in_rev1","amount_paid":99}');
select test.eq(status, 'rewarded', 'rewarded at the payment') from public.shop_referrals where shop_id = current_setting('test.a')::uuid;
select test.ok(not public.record_invoice_reversed('cus_rev1', 'in_unknown', 'refunded'), 'an unknown invoice changes nothing');
select test.ok(not public.record_invoice_reversed('cus_other', 'in_rev1', 'refunded'), 'nor another customer''s');
select test.fails($$select public.record_invoice_reversed('cus_rev1', 'in_rev1', 'nonsense')$$, 'reason_invalid', 'a reason is required');
delete from public.notification_events;
select test.ok(public.record_invoice_reversed('cus_rev1', 'in_rev1', 'refunded'), 'the refund is recorded');
select test.eq(reversed_reason, 'refunded', 'on the invoice') from public.invoices where stripe_invoice_id = 'in_rev1';
select test.eq(status, 'revoked', 'the reward is taken back'), test.eq(revoked_reason, 'refunded', 'because of the refund')
from public.shop_referrals where shop_id = current_setting('test.a')::uuid;
select test.eq(trial_ends_at, current_setting('test.end0')::timestamptz, 'the 30 free days are gone again')
from public.subscriptions where shop_id = test.id('shop1');
select test.eq(params->>'reason', 'refunded', 'the owner is told why'), test.eq(user_id, test.id('owner1'), 'the referrer''s owner')
from public.notification_events where event = 'referral_revoked';
select public.record_invoice_reversed('cus_rev1', 'in_rev1', 'refunded');
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_revoked'$$), 1::bigint, 'a repeat changes nothing');
select test.login(test.id('owner1'));
select test.eq(i->>'state', 'revoked', 'the owner sees it canceled'), test.eq(i->>'reason', 'refunded', 'and why'),
       test.eq((public.my_referrals()->>'rewarded')::int, 0, 'it no longer counts')
from jsonb_array_elements(public.my_referrals()->'items') i where i->>'name' = 'Service Rev 1';
select test.logout();

-- The free period never ends before now.
select set_config('test.b', pg_temp.new_shop(2)::text, true);
select public.record_stripe_invoice('cus_rev2', '{"id":"in_rev2","amount_paid":99}');
update public.subscriptions set trial_ends_at = now() + interval '5 days' where shop_id = test.id('shop1');
select public.record_invoice_reversed('cus_rev2', 'in_rev2', 'disputed');
select test.ok(trial_ends_at between now() and now() + interval '1 minute', 'the days already lived stay: it ends now, not in the past')
from public.subscriptions where shop_id = test.id('shop1');
select test.eq(revoked_reason, 'disputed', 'a dispute counts too') from public.shop_referrals where shop_id = current_setting('test.b')::uuid;

-- ------------------------------------------------------------------ another valid payment: nothing is taken back
update public.subscriptions set trial_ends_at = now() + interval '60 days' where shop_id = test.id('shop1');
select set_config('test.c', pg_temp.new_shop(3)::text, true);
select public.record_stripe_invoice('cus_rev3', '{"id":"in_rev3a","amount_paid":99}');
select public.record_stripe_invoice('cus_rev3', '{"id":"in_rev3b","amount_paid":99}');
select public.record_invoice_reversed('cus_rev3', 'in_rev3b', 'refunded');
select test.eq(status, 'rewarded', 'one payment of two refunded: the reward stays')
from public.shop_referrals where shop_id = current_setting('test.c')::uuid;

-- ------------------------------------------------------------------ Stripe credit
update public.subscriptions set status = 'active', stripe_status = 'active', stripe_customer_id = 'cus_owner1',
  stripe_subscription_id = 'sub_owner1' where shop_id = test.id('shop1');
-- Not in Stripe yet: simply never given.
select set_config('test.d', pg_temp.new_shop(4)::text, true);
select public.record_stripe_invoice('cus_rev4', '{"id":"in_rev4","amount_paid":99}');
delete from public.notification_events;
select public.record_invoice_reversed('cus_rev4', 'in_rev4', 'refunded');
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_reversal'$$), 0::bigint,
  'a credit not given yet: nothing to take back in Stripe');
select test.ok(public.referral_credit_info(current_setting('test.d')::uuid) is null, 'and it will not be given');
-- Given: Stripe takes back the unused part.
select set_config('test.e', pg_temp.new_shop(5)::text, true);
select public.record_stripe_invoice('cus_rev5', '{"id":"in_rev5","amount_paid":99}');
select public.mark_referral_credit_applied(current_setting('test.e')::uuid, 'cbtxn_e');
delete from public.notification_events;
select public.record_invoice_reversed('cus_rev5', 'in_rev5', 'refunded');
select test.eq(channels, array['stripe'], 'Stripe is asked to take the credit back'),
       test.eq(params->>'referral_shop_id', current_setting('test.e'), 'for this referral')
from public.notification_events where event = 'referral_reversal';
select test.eq(public.referral_reversal_info(current_setting('test.e')::uuid)->>'customer', 'cus_owner1', 'from the referrer''s customer');
select public.mark_referral_reversed(current_setting('test.e')::uuid, 60, 'cbtxn_back');
select test.eq(reversed_amount, 60.00::numeric(10,2), 'what Stripe took back is kept'),
       test.ok((public.referral_reversal_info(current_setting('test.e')::uuid)->>'done')::boolean, 'a repeat sees it done')
from public.shop_referrals where shop_id = current_setting('test.e')::uuid;

-- ------------------------------------------------------------------ not from the browser
select test.login(test.id('owner1'));
select test.fails($$select public.record_invoice_reversed('cus_rev5', 'in_rev5', 'refunded')$$, 'permission denied', 'the browser cannot report a refund');
select test.logout();

rollback;
