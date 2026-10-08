-- Launch price per city (Eduard, 8 Oct). The launch price went to the first launch_shops shops of
-- the whole country; now it goes to the first launch_slots_per_city shops of each city (10 by
-- default, set by the admin in Setări platformă; it replaces launch_shops, which stays unused).
-- The city is the shop's at sign-up, compared without case, diacritics, spaces or dashes
-- (city_key: "Brașov" = "brasov", "Cluj-Napoca" = "Cluj Napoca"). The shops that already have it
-- count in their city and keep their price, never a higher one.
--
-- A shop with the launch price is a "Partener fondator" (subscriptions.launch_offer, mirrored to
-- the public shops.founder by a trigger; neither is writable from the browser). The badge shows on
-- the search card and the shop page; it never enters the ranking.
--
-- The landing page and the sign-up form never say how many places are left or taken:
-- public_pricing(city) answers only whether the launch price is still open (in that city).

alter table public.platform_settings
  add column launch_slots_per_city int not null default 10 check (launch_slots_per_city between 0 and 100000);

-- A city as typed, reduced to letters and digits.
create function public.city_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(public.fold_text(btrim(coalesce(p, ''))), '[^a-z0-9]', '', 'g'), '')
$$;

-- Launch places still open in a city (never callable from the API: only "open or not" goes out).
create function public.launch_slots_left(p_city text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.city_key(p_city) is null then 0 else greatest(ps.launch_slots_per_city - (
    select count(*) from public.subscriptions sub
    join public.shops s on s.id = sub.shop_id
    where sub.launch_offer and public.city_key(s.city) = public.city_key(p_city))::int, 0) end
  from public.platform_settings ps where ps.id = 1
$$;
revoke execute on function public.city_key(text), public.launch_slots_left(text) from public, anon, authenticated;

-- A new subscription: today's colleague prices, and the launch price while its city has places.
-- The settings row is locked, so two sign-ups at the same moment cannot both take the last place.
create or replace function public.subscriptions_seat_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ps public.platform_settings%rowtype;
  v_city text;
begin
  select * into v_ps from public.platform_settings where id = 1 for update;
  new.seat_price_ron := coalesce(v_ps.staff_seat_price_ron, 20);
  new.free_seats := coalesce(v_ps.staff_free_seats, 1);
  new.seats := greatest(coalesce(public.shop_colleague_count(new.shop_id), 0) - new.free_seats, 0);
  select s.city into v_city from public.shops s where s.id = new.shop_id;
  if coalesce(v_ps.launch_price_ron, 0) > 0 and public.launch_slots_left(v_city) > 0 then
    new.price_ron := v_ps.launch_price_ron;
    new.launch_offer := true;
  end if;
  return new;
end
$$;

-- Partener fondator: public on the shop, kept from the subscription.
alter table public.shops add column founder boolean not null default false;

create function public.subscriptions_founder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shops set founder = new.launch_offer where id = new.shop_id and founder is distinct from new.launch_offer;
  return new;
end
$$;
create trigger subscriptions_founder after insert or update of launch_offer on public.subscriptions
  for each row execute function public.subscriptions_founder();

alter table public.shops disable trigger shops_updated_at;
update public.shops s set founder = true
from public.subscriptions sub where sub.shop_id = s.id and sub.launch_offer;
alter table public.shops enable trigger shops_updated_at;

-- What a visitor may know: the prices, and whether the launch price is open — anywhere (no city)
-- or in the city typed. Never a count.
drop function public.public_pricing();
create function public.public_pricing(p_city text default null)
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
    'launch_price_ron', case
      when ps.launch_price_ron > 0 and ps.launch_slots_per_city > 0
        and (public.city_key(p_city) is null or public.launch_slots_left(p_city) > 0)
      then ps.launch_price_ron end,
    'period_discounts', jsonb_build_object(
      '3', ps.period_discount_3, '6', ps.period_discount_6, '12', ps.period_discount_12))
  from public.platform_settings ps
  where ps.id = 1;
$$;
revoke all on function public.public_pricing(text) from public, anon, authenticated;
grant execute on function public.public_pricing(text) to anon, authenticated;

-- Setări platformă: the places per city instead of the places in the country.
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
    'staff_seat_price_ron', 'staff_free_seats', 'launch_price_ron', 'launch_slots_per_city',
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
  foreach v_key in array array['trial_days', 'quote_expiry_days', 'staff_free_seats', 'launch_slots_per_city', 'default_daily_capacity', 'default_cars_per_slot',
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
      launch_slots_per_city = v_new.launch_slots_per_city,
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


update public.schema_version set version = 66;
