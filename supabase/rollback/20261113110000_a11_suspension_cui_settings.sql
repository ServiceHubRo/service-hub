-- Rollback of A11 (supabase/migrations/20261113110000_a11_suspension_cui_settings.sql), schema 122 → 121.
--
-- Nothing A11 wrote needs undoing: bookings it cancelled at a suspension stay cancelled (their
-- clients were told), and companies keep their details. The wrapped functions go back to their
-- names and grants at schema 121, and `authenticated` reads the whole settings row again.
-- The app must go back with it (git revert of the A11 pull request): it expects schema 122, calls
-- review_window_days() and admin_get_settings(), and knows the code company_vat_taken.

drop function public.admin_get_settings();
drop function public.review_window_days();
revoke select (id, report_price_ron, vat_rate, fleet_enabled, ranking_prior_avg, ranking_prior_weight)
  on public.platform_settings from authenticated;
grant select on public.platform_settings to authenticated;

drop function public.update_company(uuid, text, text, text, text, uuid);
alter function public.update_company_a10(uuid, text, text, text, text, uuid) rename to update_company;
revoke execute on function public.update_company(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.update_company(uuid, text, text, text, text, uuid) to authenticated;

drop function public.create_company(text, text, text, text, uuid);
alter function public.create_company_a10(text, text, text, text, uuid) rename to create_company;
revoke execute on function public.create_company(text, text, text, text, uuid) from public, anon;
grant execute on function public.create_company(text, text, text, text, uuid) to authenticated;

drop function public.require_company_vat_free(uuid);
drop function public.company_vat_key(text);

drop function public.admin_set_shop_suspended(uuid, boolean, text, uuid);
alter function public.admin_set_shop_suspended_a10(uuid, boolean, text, uuid) rename to admin_set_shop_suspended;
revoke execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) to authenticated;

drop function public.cancel_unstarted_bookings_of_suspended_shop(uuid);

update public.schema_version set version = 121;
