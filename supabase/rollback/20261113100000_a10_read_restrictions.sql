-- Rollback of A10 (supabase/migrations/20261113100000_a10_read_restrictions.sql), schema 121 → 120.
--
-- A10 wrote no data. The grants and company_json() go back to what they were at schema 120, which
-- reopens the reads A10 closed (a driver reads the company's budgets; any signed-in user reads a
-- public review's moderation note). The app must go back with it (git revert of the A10 pull
-- request): it expects schema 121 and reads a company through get_company().

drop function public.get_company(uuid);

create or replace function public.company_json(c public.companies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c) || jsonb_build_object('my_role', public.company_role(c.id))
$$;
revoke execute on function public.company_json(public.companies) from public, anon, authenticated;

drop function public.company_money_visible(uuid);

revoke select (id, name, vat_id, reg_com, address, created_by, created_at, updated_at, archived_at)
  on public.companies from authenticated;
grant select on public.companies to authenticated;

revoke select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at,
               report_reason, reported_at, report_status, removed_at, created_at, updated_at)
  on public.reviews from authenticated;
grant select on public.reviews to authenticated;

update public.schema_version set version = 120;
