-- Billing periods (Eduard, 26 Sep 2026): besides paying every month, a shop can pay for 3, 6 or
-- 12 months at once, with a small discount — 5%, 10% and 15% by default (Setări platformă). The
-- discount is on the shop's own prices (the launch price too) and on its paid colleagues. The
-- period renews by itself, like the monthly subscription. ARCHITECTURE §2 (Money), §12.
--
-- · A period's price is the monthly price × months, less the discount, rounded to whole lei
--   (149 lei: 425 / 805 / 1.520 lei; 99 lei: 282 / 535 / 1.010 lei; 19 lei a colleague: 54 / 103 /
--   194 lei). subscription_period_price() is the one formula; src/lib/subscription.ts and
--   _shared/seats.ts mirror it and the tests hold them to the same figures.
-- · The owner picks the period on Abonament before Checkout; stripe-checkout reads the offers
--   from subscription_checkout_info (today's discounts) and marks the Stripe subscription with
--   the months and the discount it sold. The webhook copies them onto the subscription
--   (billing_months, period_discount), so a later change of the discounts never touches a shop
--   that already pays.
-- · The monthly figure of a subscription (admin lists, MRR) is its period's total ÷ months.

alter table public.platform_settings
  add column period_discount_3 numeric(5,2) not null default 5 check (period_discount_3 between 0 and 50),
  add column period_discount_6 numeric(5,2) not null default 10 check (period_discount_6 between 0 and 50),
  add column period_discount_12 numeric(5,2) not null default 15 check (period_discount_12 between 0 and 50);

alter table public.subscriptions
  add column billing_months int not null default 1 check (billing_months in (1, 3, 6, 12)),
  add column period_discount numeric(5,2) not null default 0 check (period_discount between 0 and 50);

-- ---------------------------------------------------------------------------------------------
-- Prices of a period
-- ---------------------------------------------------------------------------------------------

-- What a monthly price comes to for a period: the same price for one month, else months × price
-- less the discount, in whole lei.
create function public.subscription_period_price(p_monthly numeric, p_months int, p_discount numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_months, 1) <= 1 then p_monthly
    else round(p_monthly * p_months * (100 - coalesce(p_discount, 0)) / 100) end
$$;

-- Today's discount for a period (0 for a month; null for a period that is not offered).
create function public.period_discount_now(p_months int)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_months
    when 1 then 0
    when 3 then ps.period_discount_3
    when 6 then ps.period_discount_6
    when 12 then ps.period_discount_12
  end
  from public.platform_settings ps where ps.id = 1
$$;

-- The four periods a subscription can be paid for, at the shop's prices, its paid colleagues now
-- and today's discounts: [{ months, discount_percent, price_ron, seat_price_ron, seats, total_ron,
-- monthly_ron }] — prices per period, monthly_ron the total ÷ months.
create function public.subscription_offers(p public.subscriptions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object(
      'months', o.months,
      'discount_percent', o.discount,
      'price_ron', o.price,
      'seat_price_ron', o.seat,
      'seats', p.seats,
      'total_ron', o.price + p.seats * o.seat,
      'monthly_ron', round((o.price + p.seats * o.seat) / o.months, 2)
    ) order by o.months)
  from (
    select m.months, d.discount,
      public.subscription_period_price(p.price_ron, m.months, d.discount) as price,
      public.subscription_period_price(p.seat_price_ron, m.months, d.discount) as seat
    from unnest(array[1, 3, 6, 12]) as m(months)
    cross join lateral (select coalesce(public.period_discount_now(m.months), 0) as discount) d
  ) o
$$;

-- For the Abonament screen: the offers of the caller's own shop (null for anyone else — staff
-- included, like the subscription row itself).
create function public.my_subscription_offers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.subscription_offers(sub)
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  where s.owner_id = auth.uid()
$$;

revoke execute on function public.subscription_period_price(numeric, int, numeric),
  public.period_discount_now(int), public.subscription_offers(public.subscriptions),
  public.my_subscription_offers() from public, anon;
revoke execute on function public.subscription_period_price(numeric, int, numeric),
  public.period_discount_now(int), public.subscription_offers(public.subscriptions) from authenticated;
grant execute on function public.my_subscription_offers() to authenticated;

-- What the shop pays a month: its period's total ÷ months (the same as before for a month).
create or replace function public.subscription_monthly_ron(p public.subscriptions)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((public.subscription_period_price(p.price_ron, p.billing_months, p.period_discount)
    + p.seats * public.subscription_period_price(p.seat_price_ron, p.billing_months, p.period_discount))
    / greatest(p.billing_months, 1), 2)
$$;

-- ---------------------------------------------------------------------------------------------
-- Stripe: what Checkout sells, what the webhook records, what the colleagues' item costs
-- ---------------------------------------------------------------------------------------------

create or replace function public.subscription_checkout_info(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_sub public.subscriptions%rowtype;
  v_billing public.shop_billing%rowtype;
begin
  select * into v_me from public.profiles where id = p_user_id;
  if not found or v_me.role <> 'shop' or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  if v_me.suspended then
    perform public.fail('account_suspended');
  end if;
  select * into v_shop from public.shops where owner_id = p_user_id;
  if not found then
    perform public.fail('not_allowed');
  end if;
  select * into v_sub from public.subscriptions where shop_id = v_shop.id;
  if not found then
    perform public.fail('not_allowed');
  end if;
  select * into v_billing from public.shop_billing where shop_id = v_shop.id;
  return jsonb_build_object(
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'display_id', v_me.display_id,
    'lang', v_me.lang,
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'price_ron', v_sub.price_ron,
    'offers', public.subscription_offers(v_sub),
    'status', v_sub.status,
    'trial_ends_at', v_sub.trial_ends_at,
    'stripe_customer_id', v_sub.stripe_customer_id,
    'stripe_subscription_id', v_sub.stripe_subscription_id,
    'stripe_status', v_sub.stripe_status,
    'billing_complete', coalesce(nullif(btrim(v_billing.legal_name), '') is not null
      and v_billing.vat_id is not null and v_billing.reg_com is not null
      and nullif(btrim(v_billing.legal_address), '') is not null
      and v_billing.billing_email is not null, false),
    'legal_name', v_billing.legal_name,
    'vat_id', v_billing.vat_id,
    'billing_email', v_billing.billing_email
  );
end
$$;

-- As before, plus the period a live Stripe subscription runs on (billing_months, from its price)
-- and the discount it was sold with (discount_percent, from its metadata).
create or replace function public.sync_stripe_subscription(p_customer text, p_shop_id uuid, p_sub jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.subscriptions%rowtype;
  v_id text := p_sub->>'id';
  v_stripe text := p_sub->>'status';
  v_live boolean := (p_sub->>'status') in ('trialing', 'active', 'past_due');
  v_status text;
  v_reason text;
  v_months int;
  v_discount numeric;
begin
  v := public.subscription_for_customer(p_customer, p_shop_id);
  if v.shop_id is null or v_id is null or v_stripe is null then
    return null;
  end if;
  if v_stripe = 'incomplete' then
    return to_jsonb(v);
  end if;
  if not v_live and v.stripe_subscription_id is not null and v.stripe_subscription_id <> v_id
     and v.stripe_status in ('trialing', 'active', 'past_due') then
    return to_jsonb(v);
  end if;

  if v_stripe = 'trialing' then
    v_status := 'trial';
  elsif v_stripe = 'active' then
    v_status := 'active';
  elsif v_stripe = 'past_due' then
    v_status := 'past_due';
  elsif v.status = 'trial' and v.trial_ends_at > now() then
    v_status := 'trial';
  elsif coalesce(p_sub->>'cancellation_reason', '') = 'cancellation_requested'
        or coalesce((p_sub->>'cancel_at_period_end')::boolean, false) then
    v_status := 'cancelled';
    v_reason := 'cancelled';
  else
    v_status := 'inactive';
    v_reason := 'payment_failed';
  end if;

  if v_live and (p_sub->>'billing_months') in ('1', '3', '6', '12') then
    v_months := (p_sub->>'billing_months')::int;
    v_discount := case when v_months = 1 then 0
      else least(greatest(coalesce(nullif(p_sub->>'discount_percent', '')::numeric, 0), 0), 50) end;
  end if;

  update public.subscriptions
    set stripe_customer_id = p_customer,
        stripe_subscription_id = v_id,
        stripe_status = v_stripe,
        cancel_at_period_end = v_live and coalesce((p_sub->>'cancel_at_period_end')::boolean, false),
        current_period_end = coalesce(nullif(p_sub->>'current_period_end', '')::timestamptz, current_period_end),
        payment_failed_at = case when v_stripe in ('active', 'trialing') then null else payment_failed_at end,
        next_payment_attempt = case when v_stripe in ('active', 'trialing') then null else next_payment_attempt end,
        billing_months = coalesce(v_months, billing_months),
        period_discount = coalesce(v_discount, period_discount)
  where shop_id = v.shop_id;
  perform public.set_subscription_status(v.shop_id, v_status, v_reason);

  select * into v from public.subscriptions where shop_id = v.shop_id;
  return to_jsonb(v);
end
$$;

-- The colleagues' item costs the period's price per colleague.
create or replace function public.stripe_seat_info(p_shop_id uuid default null, p_customer text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shop_id', sub.shop_id,
    'seats', sub.seats,
    'seat_price_ron', sub.seat_price_ron,
    'billing_months', sub.billing_months,
    'period_discount', sub.period_discount,
    'billed_seats', sub.billed_seats,
    'stripe_subscription_id', sub.stripe_subscription_id,
    'stripe_status', sub.stripe_status)
  from public.subscriptions sub
  where (p_shop_id is not null and sub.shop_id = p_shop_id)
     or (p_shop_id is null and p_customer is not null and sub.stripe_customer_id = p_customer)
  limit 1
$$;

-- ---------------------------------------------------------------------------------------------
-- Admin lists, the landing page, Setări platformă
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_subscription_rows()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'shop_id', s.id,
      'shop_name', s.name,
      'city', s.city,
      'display_id', o.display_id,
      'owner_name', o.name,
      'email', public.account_email(o.id),
      'state', public.shop_state(s.id),
      'status', sub.status,
      'stripe_status', sub.stripe_status,
      'price_ron', sub.price_ron,
      'seat_price_ron', sub.seat_price_ron,
      'seats', sub.seats,
      'billed_seats', sub.billed_seats,
      'monthly_ron', public.subscription_monthly_ron(sub),
      'billing_months', sub.billing_months,
      'period_discount', sub.period_discount,
      'trial_ends_at', sub.trial_ends_at,
      'current_period_end', sub.current_period_end,
      'cancel_at_period_end', sub.cancel_at_period_end,
      'next_payment_attempt', sub.next_payment_attempt,
      'next_billing', public.subscription_next_billing(sub),
      'payment_failed_at', sub.payment_failed_at,
      'ended_reason', sub.ended_reason,
      'status_changed_at', sub.status_changed_at,
      'stripe_customer_id', sub.stripe_customer_id,
      'stripe_subscription_id', sub.stripe_subscription_id,
      'paid_count', coalesce(i.n, 0),
      'paid_total', coalesce(i.total, 0),
      'created_at', s.created_at
    ) order by s.name, s.id), '[]'::jsonb)
  from public.subscriptions sub
  join public.shops s on s.id = sub.shop_id
  join public.profiles o on o.id = s.owner_id
  left join lateral (
    select count(*) as n, sum(inv.amount) as total from public.invoices inv
    where inv.shop_id = s.id and inv.status in ('paid', 'issued')
  ) i on true
$$;

-- The landing page also shows the discounts for 3, 6 and 12 months.
create or replace function public.public_pricing()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription_price_ron', ps.subscription_price_ron,
    'seat_price_ron', ps.staff_seat_price_ron,
    'free_seats', ps.staff_free_seats,
    'trial_days', ps.trial_days,
    'launch_price_ron', case when ps.launch_price_ron > 0
      and (select count(*) from public.subscriptions sub where sub.launch_offer) < ps.launch_shops
      then ps.launch_price_ron end,
    'launch_shops', ps.launch_shops,
    'period_discounts', jsonb_build_object(
      '3', ps.period_discount_3, '6', ps.period_discount_6, '12', ps.period_discount_12))
  from public.platform_settings ps
  where ps.id = 1;
$$;

-- Setări platformă: the three discounts are settings too (percent, 0–50).
create or replace function public.admin_update_settings(p_settings jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] := array['subscription_price_ron', 'trial_days', 'quote_expiry_days', 'report_price_ron',
    'vat_rate_percent', 'ranking_prior_avg', 'ranking_prior_weight', 'default_daily_capacity', 'default_cars_per_slot',
    'default_slot_minutes', 'default_min_notice_hours', 'default_max_advance_days', 'default_cancel_deadline_hours',
    'staff_seat_price_ron', 'staff_free_seats', 'launch_price_ron', 'launch_shops',
    'period_discount_3', 'period_discount_6', 'period_discount_12'];
  v_seen jsonb;
  v_old public.platform_settings%rowtype;
  v_new public.platform_settings%rowtype;
  v_in jsonb := coalesce(p_settings, '{}'::jsonb);
  v_key text;
  v_value jsonb;
  v_limits jsonb;
  v_n numeric;
  v_diff jsonb;
  v_limits_before jsonb := '{}'::jsonb;
  v_limits_after jsonb := '{}'::jsonb;
  v_constraint text;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_settings');
  if v_seen is not null then
    return v_seen;
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end if;
  select * into v_old from public.platform_settings where id = 1 for update;

  for v_key, v_value in select key, value from jsonb_each(v_in) loop
    if v_key = 'limits' then
      if jsonb_typeof(v_value) <> 'object' then
        perform public.fail('field_invalid', jsonb_build_object('field', 'limits'));
      end if;
    elsif not v_key = any (v_keys) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    elsif jsonb_typeof(v_value) <> 'number' then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;

  -- Limits: known keys only, whole numbers in their range; the others stay.
  v_limits := v_old.limits;
  for v_key, v_value in select key, value from jsonb_each(coalesce(v_in->'limits', '{}'::jsonb)) loop
    if public.limit_range(v_key) is null or jsonb_typeof(v_value) <> 'number' then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
    v_n := (v_value #>> '{}')::numeric;
    if v_n <> trunc(v_n) or not public.limit_range(v_key) @> v_n::int then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
    if v_limits->v_key is distinct from to_jsonb(v_n::int) then
      v_limits_before := v_limits_before || jsonb_build_object(v_key, v_limits->v_key);
      v_limits_after := v_limits_after || jsonb_build_object(v_key, v_n::int);
      v_limits := v_limits || jsonb_build_object(v_key, v_n::int);
    end if;
  end loop;

  -- Whole days, hours and places.
  foreach v_key in array array['trial_days', 'quote_expiry_days', 'staff_free_seats', 'launch_shops', 'default_daily_capacity', 'default_cars_per_slot',
    'default_slot_minutes', 'default_min_notice_hours', 'default_max_advance_days', 'default_cancel_deadline_hours'] loop
    if v_in ? v_key and (v_in->>v_key)::numeric <> trunc((v_in->>v_key)::numeric) then
      perform public.fail('field_invalid', jsonb_build_object('field', v_key));
    end if;
  end loop;

  begin
    v_new := jsonb_populate_record(v_old, v_in - 'limits');
    update public.platform_settings set
      subscription_price_ron = v_new.subscription_price_ron,
      staff_seat_price_ron = v_new.staff_seat_price_ron,
      staff_free_seats = v_new.staff_free_seats,
      launch_price_ron = v_new.launch_price_ron,
      launch_shops = v_new.launch_shops,
      period_discount_3 = v_new.period_discount_3,
      period_discount_6 = v_new.period_discount_6,
      period_discount_12 = v_new.period_discount_12,
      trial_days = v_new.trial_days,
      quote_expiry_days = v_new.quote_expiry_days,
      report_price_ron = v_new.report_price_ron,
      vat_rate_percent = v_new.vat_rate_percent,
      ranking_prior_avg = v_new.ranking_prior_avg,
      ranking_prior_weight = v_new.ranking_prior_weight,
      default_daily_capacity = v_new.default_daily_capacity,
      default_cars_per_slot = v_new.default_cars_per_slot,
      default_slot_minutes = v_new.default_slot_minutes,
      default_min_notice_hours = v_new.default_min_notice_hours,
      default_max_advance_days = v_new.default_max_advance_days,
      default_cancel_deadline_hours = v_new.default_cancel_deadline_hours,
      limits = v_limits,
      updated_by = auth.uid()
    where id = 1
    returning * into v_new;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics v_constraint = constraint_name;
      perform public.fail('field_invalid', jsonb_build_object('field', coalesce(
        nullif(regexp_replace(coalesce(v_constraint, ''), '^platform_settings_(.*)_check$', '\1'), ''), 'unknown')));
    when invalid_text_representation or numeric_value_out_of_range then
      perform public.fail('field_invalid', jsonb_build_object('field', 'unknown'));
  end;
  -- A price must be at least 1 leu (Stripe cannot charge less).
  if v_new.subscription_price_ron < 1 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'subscription_price_ron'));
  end if;
  -- A launch price is 0 (none) or at least 1 leu.
  if v_new.launch_price_ron > 0 and v_new.launch_price_ron < 1 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'launch_price_ron'));
  end if;
  if v_new.report_price_ron < 1 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'report_price_ron'));
  end if;

  v_diff := public.jsonb_changes(to_jsonb(v_old), to_jsonb(v_new), v_keys);
  if v_limits_after <> '{}'::jsonb then
    v_diff := jsonb_build_object(
      'before', (v_diff->'before') || jsonb_build_object('limits', v_limits_before),
      'after', (v_diff->'after') || jsonb_build_object('limits', v_limits_after));
  end if;
  if v_diff->'after' <> '{}'::jsonb then
    perform public.admin_audit_key('update_settings', 'settings', null, v_diff->'before', v_diff->'after');
  end if;
  v_result := to_jsonb(v_new);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

update public.schema_version set version = 31;
