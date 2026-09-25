-- T18: the public landing page shows the current prices for shops (subscription, each colleague,
-- free trial days) as set in Setări platformă, so the page never promises an old price.
-- Only these three public numbers; the rest of platform_settings stays admin-only.

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
    'trial_days', ps.trial_days)
  from public.platform_settings ps
  where ps.id = 1;
$$;

revoke all on function public.public_pricing() from public, anon, authenticated;
grant execute on function public.public_pricing() to anon, authenticated;

update public.schema_version set version = 25;
