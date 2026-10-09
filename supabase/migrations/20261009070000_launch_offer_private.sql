-- The launch places stay the admin's business (Eduard, 9 Oct 2026). public_pricing(city) answered
-- whether a given city still had launch places, so anyone could try city after city and learn
-- where the places were gone. Now it takes no city and answers the same for everyone: the launch
-- price while the offer is on (launch_price_ron > 0 and launch_slots_per_city > 0). Whether a new
-- shop gets it is still decided only at sign-up, by its city's places (subscriptions_seat_price);
-- the shop sees its own price in Abonament, before its first payment (90 free days).
drop function public.public_pricing(text);

create function public.public_pricing()
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
    'launch_price_ron', case when ps.launch_price_ron > 0 and ps.launch_slots_per_city > 0 then ps.launch_price_ron end,
    'period_discounts', jsonb_build_object(
      '3', ps.period_discount_3, '6', ps.period_discount_6, '12', ps.period_discount_12))
  from public.platform_settings ps
  where ps.id = 1;
$$;
revoke all on function public.public_pricing() from public, anon, authenticated;
grant execute on function public.public_pricing() to anon, authenticated;

update public.schema_version set version = 69;
