-- Shop referrals: the code is the owner's S- number; a new shop names it at sign-up; at the new
-- shop's first payment the referrer gets 30 free days (still free, no Stripe) or one month of
-- credit in Stripe; never for the same person or company, at most 12; nobody reads or writes the
-- table from the browser.
begin;
select test.make_world();
select set_config('test.code1', (select display_id from public.profiles where id = test.id('owner1')), true);
select set_config('test.code2', (select display_id from public.profiles where id = test.id('owner2')), true);

-- A new shop signing up with a code; answers the new shop's id.
create function pg_temp.new_shop(p_n int, p_code text, p_phone text default null) returns uuid
language plpgsql as $$
declare v_user uuid;
begin
  v_user := test.sign_up(format('ref%s@test.local', p_n), jsonb_build_object(
    'role', 'shop', 'name', 'Owner ' || p_n, 'phone', coalesce(p_phone, '07231' || lpad(p_n::text, 5, '0')),
    'shop_name', 'Service Nou ' || p_n, 'city', 'Brașov', 'lang', 'ro', 'terms_version', '2026-09',
    'referral_code', p_code));
  return (select id from public.shops where owner_id = v_user);
end $$;

-- The shop pays an invoice of p_amount lei.
create function pg_temp.pays(p_shop uuid, p_invoice text, p_amount numeric) returns void
language plpgsql as $$
begin
  perform public.set_stripe_customer(p_shop, 'cus_' || p_shop::text);
  perform public.record_stripe_invoice('cus_' || p_shop::text, jsonb_build_object('id', p_invoice, 'amount_paid', p_amount));
end $$;

-- ------------------------------------------------------------------ the code
select test.ok(public.check_referral_code(current_setting('test.code1')), 'the owner''s S- number is the code');
select test.ok(public.check_referral_code(lower(replace(current_setting('test.code1'), '-', ''))), 'lower case, without the dash');
select test.ok(public.check_referral_code(' S ' || ltrim(substr(current_setting('test.code1'), 3), '0') || ' '), 'without the zeros, with spaces');
select test.ok(not public.check_referral_code((select display_id from public.profiles where id = test.id('client_a'))), 'a client''s number is not a code');
select test.ok(not public.check_referral_code((select display_id from public.profiles where id = test.id('staff1'))), 'nor a colleague''s');
select test.ok(not public.check_referral_code('S-99999'), 'a number nobody has');
select test.ok(not public.check_referral_code('drop table'), 'nonsense');
select test.ok(not public.check_referral_code(null), 'empty');
select test.login_anon();
select test.ok(public.check_referral_code(current_setting('test.code1')), 'the sign-up form can check it before signing in');
select test.logout();
update public.shops set suspended = true where id = test.id('shop2');
select test.ok(not public.check_referral_code(current_setting('test.code2')), 'a suspended shop''s code does not work');
update public.shops set suspended = false where id = test.id('shop2');

-- ------------------------------------------------------------------ sign-up
select set_config('test.a', pg_temp.new_shop(1, current_setting('test.code1'))::text, true);
select test.eq(status, 'signed_up', 'a new shop with a code is recorded'),
       test.eq(referrer_shop_id, test.id('shop1'), 'for the shop behind the code')
from public.shop_referrals where shop_id = current_setting('test.a')::uuid;
select pg_temp.new_shop(2, 'S-99999');
select test.eq(test.count($$select 1 from public.shop_referrals r join public.shops s on s.id = r.shop_id where s.name = 'Service Nou 2'$$),
  0::bigint, 'a wrong code: the account is made, without a referral');
select test.sign_up('refclient@test.local', jsonb_build_object('role', 'client', 'name', 'C', 'referral_code', current_setting('test.code1')));
select test.eq(test.count('select 1 from public.shop_referrals'), 1::bigint, 'a client cannot name a referrer');
-- The same person as the referrer (owner1's phone): refused, and no free period either.
select set_config('test.same', pg_temp.new_shop(3, current_setting('test.code1'), '0268312445')::text, true);
select test.eq(status, 'refused', 'the referrer''s own phone: refused'),
       test.eq(refused_reason, 'same_person', 'as the same person')
from public.shop_referrals where shop_id = current_setting('test.same')::uuid;

-- ------------------------------------------------------------------ what the owner sees
select test.login(test.id('owner1'));
select test.eq(public.my_referrals()->>'code', current_setting('test.code1'), 'the owner sees the code'),
       test.eq((public.my_referrals()->>'max_rewards')::int, 12, 'and the limit'),
       test.eq(jsonb_array_length(public.my_referrals()->'items'), 2, 'and the shops brought');
select test.eq(i->>'state', 'trial', 'a shop still in its free period'),
       test.eq(i->>'name', 'Service Nou 1', 'by name')
from jsonb_array_elements(public.my_referrals()->'items') i where i->>'name' = 'Service Nou 1';
select test.fails('select * from public.shop_referrals', 'permission denied', 'the table is not readable');
select test.fails($$select public.grant_referral_reward(test.id('shop1'))$$, 'permission denied', 'nobody grants a reward by hand');
select test.fails($$select public.referral_credit_info(test.id('shop1'))$$, 'permission denied', 'nor reads the Stripe side');
select test.logout();
select test.login(test.id('staff1'));
select test.ok(public.my_referrals() is null, 'a colleague sees nothing');
select test.logout();
select test.login(test.id('client_a'));
select test.ok(public.my_referrals() is null, 'a client sees nothing');
select test.logout();

-- ------------------------------------------------------------------ the first payment: 30 more free days
select set_config('test.end1', (select trial_ends_at::text from public.subscriptions where shop_id = test.id('shop1')), true);
delete from public.notification_events;
select pg_temp.pays(current_setting('test.a')::uuid, 'in_zero', 0);
select test.eq(status, 'signed_up', 'a 0 lei invoice (the start of a free period) is not a payment')
from public.shop_referrals where shop_id = current_setting('test.a')::uuid;
select pg_temp.pays(current_setting('test.a')::uuid, 'in_a1', 149);
select test.eq(status, 'rewarded', 'the first payment brings the reward'),
       test.eq(reward_kind, 'trial_days', 'the referrer is still free: more free days'),
       test.eq(reward_days, 30, '30 of them'),
       test.ok(applied_at is not null, 'given at once')
from public.shop_referrals where shop_id = current_setting('test.a')::uuid;
select test.eq(trial_ends_at, public.add_local_days(current_setting('test.end1')::timestamptz, 30), 'the free period ends 30 days later')
from public.subscriptions where shop_id = test.id('shop1');
select test.eq(params->>'kind', 'trial_days', 'the owner is told'),
       test.eq(params->>'referred_name', 'Service Nou 1', 'which shop paid'),
       test.eq(user_id, test.id('owner1'), 'the owner of the referrer'),
       test.eq(channels, array['push', 'email'], 'by push and email')
from public.notification_events where event = 'referral_reward';
select pg_temp.pays(current_setting('test.a')::uuid, 'in_a2', 149);
select test.eq(trial_ends_at, public.add_local_days(current_setting('test.end1')::timestamptz, 30), 'the next payment gives nothing more')
from public.subscriptions where shop_id = test.id('shop1');
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_reward'$$), 1::bigint, 'told once');

-- ------------------------------------------------------------------ Stripe runs the referrer: a month of credit
update public.subscriptions set status = 'active', stripe_status = 'active', stripe_customer_id = 'cus_owner1',
  stripe_subscription_id = 'sub_owner1' where shop_id = test.id('shop1');
delete from public.notification_events;
select set_config('test.b', pg_temp.new_shop(4, current_setting('test.code1'))::text, true);
select pg_temp.pays(current_setting('test.b')::uuid, 'in_b1', 99);
select test.eq(reward_kind, 'stripe_credit', 'a paying referrer gets credit'),
       test.eq(reward_amount, 100.00::numeric(10,2), 'one month of what it pays'),
       test.ok(applied_at is null, 'not in Stripe yet')
from public.shop_referrals where shop_id = current_setting('test.b')::uuid;
select test.eq(channels, array['stripe'], 'Stripe is asked for the credit'),
       test.eq(params->>'referral_shop_id', current_setting('test.b'), 'for this referral')
from public.notification_events where event = 'referral_credit';
select test.eq(params->>'total', '100.00', 'the owner is told how much')
from public.notification_events where event = 'referral_reward';
select test.eq(public.referral_credit_info(current_setting('test.b')::uuid)->>'customer', 'cus_owner1', 'the credit goes to the referrer''s customer'),
       test.eq(public.referral_credit_info(current_setting('test.b')::uuid)->>'amount', '100.00', 'the amount');
select public.enqueue_referral_credit(current_setting('test.b')::uuid);
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_credit'$$), 1::bigint, 'asked once while waiting');
select public.mark_referral_credit_applied(current_setting('test.b')::uuid, 'cbtxn_1');
select test.ok(applied_at is not null, 'Stripe took it'), test.eq(stripe_balance_transaction, 'cbtxn_1', 'the transaction is kept')
from public.shop_referrals where shop_id = current_setting('test.b')::uuid;
select test.ok((public.referral_credit_info(current_setting('test.b')::uuid)->>'applied')::boolean, 'a repeat sees it given');

-- ------------------------------------------------------------------ no Stripe customer yet: the credit waits for Checkout
update public.subscriptions set status = 'inactive', trial_ends_at = now() - interval '1 day' where shop_id = test.id('shop2');
delete from public.notification_events;
select set_config('test.c', pg_temp.new_shop(5, current_setting('test.code2'))::text, true);
select pg_temp.pays(current_setting('test.c')::uuid, 'in_c1', 99);
select test.eq(reward_kind, 'stripe_credit', 'a referrer whose free period ended gets credit')
from public.shop_referrals where shop_id = current_setting('test.c')::uuid;
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_credit'$$), 0::bigint, 'nothing to credit yet');
select public.set_stripe_customer(test.id('shop2'), 'cus_owner2');
select test.eq(test.count($$select 1 from public.notification_events where event = 'referral_credit'$$), 1::bigint,
  'Checkout made the customer: the credit goes now');

-- ------------------------------------------------------------------ the same company
select set_config('test.d', pg_temp.new_shop(6, current_setting('test.code2'))::text, true);
update public.shop_billing set vat_id = '160796' where shop_id = current_setting('test.d')::uuid;
select pg_temp.pays(current_setting('test.d')::uuid, 'in_d1', 99);
select test.eq(status, 'refused', 'the referrer''s own CUI: refused'), test.eq(refused_reason, 'same_company', 'as the same company')
from public.shop_referrals where shop_id = current_setting('test.d')::uuid;
update public.shop_billing set vat_id = '12345674' where shop_id = current_setting('test.a')::uuid;
update public.shop_referrals set referred_vat_id = '12345674' where shop_id = current_setting('test.a')::uuid;
select set_config('test.e', pg_temp.new_shop(7, current_setting('test.code2'))::text, true);
update public.shop_billing set vat_id = '12345674' where shop_id = current_setting('test.e')::uuid;
select pg_temp.pays(current_setting('test.e')::uuid, 'in_e1', 99);
select test.eq(refused_reason, 'same_company', 'a company that already brought a reward: refused')
from public.shop_referrals where shop_id = current_setting('test.e')::uuid;

-- ------------------------------------------------------------------ the referrer deleted the account
select set_config('test.f', pg_temp.new_shop(8, current_setting('test.code2'))::text, true);
update public.profiles set deleted_at = now() where id = test.id('owner2');
select pg_temp.pays(current_setting('test.f')::uuid, 'in_f1', 99);
select test.eq(refused_reason, 'referrer_gone', 'the referrer is gone: nothing to give')
from public.shop_referrals where shop_id = current_setting('test.f')::uuid;
update public.profiles set deleted_at = null where id = test.id('owner2');

-- ------------------------------------------------------------------ at most 12
do $$
declare i int; v uuid;
begin
  for i in 20..30 loop
    v := pg_temp.new_shop(i, current_setting('test.code2'));
    update public.shop_referrals set status = 'rewarded', reward_kind = 'trial_days', reward_days = 30, decided_at = now()
    where shop_id = v;
  end loop;
end $$;
select test.eq(test.count(format($$select 1 from public.shop_referrals where referrer_shop_id = %L and status = 'rewarded'$$, test.id('shop2'))),
  12::bigint, 'twelve rewards so far');
select set_config('test.g', pg_temp.new_shop(40, current_setting('test.code2'))::text, true);
select pg_temp.pays(current_setting('test.g')::uuid, 'in_g1', 99);
select test.eq(refused_reason, 'limit', 'the thirteenth is refused')
from public.shop_referrals where shop_id = current_setting('test.g')::uuid;
select test.login(test.id('owner2'));
select test.eq((public.my_referrals()->>'rewarded')::int, 12, 'the owner sees 12 of 12');
select test.eq(i->>'reason', 'limit', 'and why the last one brought nothing')
from jsonb_array_elements(public.my_referrals()->'items') i where i->>'name' = 'Service Nou 40';
select test.logout();

rollback;
