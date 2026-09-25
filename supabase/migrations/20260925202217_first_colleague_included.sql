-- Pricing after T19b (Eduard, 25 Sep 2026):
-- 1. The first colleague with an account is included in the subscription; only the ones after it
--    cost the price per colleague, now 19 lei (shops signed up before keep theirs).
-- 2. The subscription is 149 lei a month; a launch price of 99 lei goes to the first 50 shops that
--    sign up, which keep it (the price is fixed at sign-up, as before). After the 50th the price
--    of a new shop is simply the subscription price — no manual step.
-- Prices are without VAT (the landing page and the Terms say so).
--
-- Colleagues:
-- · platform_settings.staff_free_seats (1, changed from Setări platformă) is copied onto each
--   subscription when the shop signs up (subscriptions.free_seats), like the prices: a change
--   applies to shops signing up afterwards.
-- · subscriptions.seats stays "the colleagues who pay" (now: those beyond free_seats), so Stripe's
--   quantity, the monthly total, the admin lists and the free period warning follow by themselves.
-- · Existing subscriptions get 1 included colleague too (a lower price, never a higher one); a
--   shop whose subscription Stripe runs gets its quantity set again (prorated), as for any change.

alter table public.platform_settings
  add column staff_free_seats int not null default 1 check (staff_free_seats between 0 and 10);

alter table public.subscriptions
  add column free_seats int not null default 1 check (free_seats between 0 and 10);

-- Launch price: launch_price_ron (0 = no launch offer) for the first launch_shops shops.
-- subscriptions.launch_offer marks the ones that got it (shops signed up before do not count).
alter table public.platform_settings
  add column launch_price_ron numeric(10,2) not null default 0 check (launch_price_ron >= 0),
  add column launch_shops int not null default 50 check (launch_shops between 0 and 100000);

alter table public.subscriptions
  add column launch_offer boolean not null default false;

-- Only while the prices are still the first ones (100 and 20): a price set by hand stays.
update public.platform_settings set subscription_price_ron = 149, launch_price_ron = 99
where id = 1 and subscription_price_ron = 100;
update public.platform_settings set staff_seat_price_ron = 19
where id = 1 and staff_seat_price_ron = 20;

-- Every colleague with an account in the shop (staff, not the owner).
create function public.shop_colleague_count(p_shop_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.shop_staff st
  where st.shop_id = p_shop_id and st.role = 'staff' and st.user_id is not null and st.accepted_at is not null
$$;
revoke execute on function public.shop_colleague_count(uuid) from public, anon, authenticated;

-- Colleagues who pay: the ones beyond those included in the subscription.
create or replace function public.shop_seat_count(p_shop_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(public.shop_colleague_count(p_shop_id)
    - coalesce((select sub.free_seats from public.subscriptions sub where sub.shop_id = p_shop_id), 0), 0)
$$;

-- A new subscription (a shop signing up) takes today's price per colleague and included colleagues,
-- and the launch price while places are left. The settings row is locked, so two sign-ups at the
-- same moment cannot both take the last launch place.
create or replace function public.subscriptions_seat_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.platform_settings%rowtype;
begin
  select * into v_ps from public.platform_settings where id = 1 for update;
  new.seat_price_ron := coalesce(v_ps.staff_seat_price_ron, 20);
  new.free_seats := coalesce(v_ps.staff_free_seats, 1);
  new.seats := greatest(coalesce(public.shop_colleague_count(new.shop_id), 0) - new.free_seats, 0);
  if coalesce(v_ps.launch_price_ron, 0) > 0
     and (select count(*) from public.subscriptions sub where sub.launch_offer) < v_ps.launch_shops then
    new.price_ron := v_ps.launch_price_ron;
    new.launch_offer := true;
  end if;
  return new;
end
$$;

-- Shops that already have colleagues: the first one is now included.
update public.subscriptions sub set seats = public.shop_seat_count(sub.shop_id)
where sub.seats is distinct from public.shop_seat_count(sub.shop_id);

-- The landing page shows how many colleagues are included, and the launch price while places are
-- left (for how many shops in all — never how many signed up).
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
    'launch_shops', ps.launch_shops)
  from public.platform_settings ps
  where ps.id = 1;
$$;

-- Setări platformă: the included colleagues (a whole number, 0–10), the launch price (0 = none)
-- and the number of launch places are settings too.
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
    'staff_seat_price_ron', 'staff_free_seats', 'launch_price_ron', 'launch_shops'];
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

update public.schema_version set version = 26;
