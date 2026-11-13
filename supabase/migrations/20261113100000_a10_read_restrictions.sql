-- A10 — read restrictions found by the master audit of 13 Nov 2026 (on 6188b86, schema 120).
-- Nothing is deleted or rewritten: two tables lose column read grants, one helper hides three
-- amounts from members without the right, one read function is added.
--
-- 1. A company's money rules (P1-1). `companies_select` lets every accepted member read the whole
--    row, and every column was granted to `authenticated`, so a driver could read
--    `budget_monthly`, `budget_yearly` and `manager_approval_limit` straight from the table, while
--    `fleet_overview()` already hid them (costs.view). `accept_company_invite()` answered them too,
--    through `company_json()`. Now:
--      · the three columns are no longer granted to `authenticated` (the table grant becomes a
--        column list, as on `company_members`);
--      · `company_json()` answers them only to a member with `costs.view` or `budget.manage`
--        (null otherwise), so every function built on it follows the same rule;
--      · `get_company(company)` is how the app reads one company (it read the row with `*`).
-- 2. A review's moderation fields (P2-1). A public review's row was readable whole by every
--    signed-in user: the admin's internal note (`report_note`, "Internă: nu se trimite nimănui"),
--    the time of the decision, the fraud-check mark and the author's account id. Those four
--    columns are no longer granted; the admin reads them through `admin_list_reviews()` and the
--    other admin functions, as before. The shop's Recenzii screen and the admin's badge read
--    `report_reason`, `reported_at` and `report_status`, which stay.

-- ---------------------------------------------------------------------------------------------
-- 1. Companies
-- ---------------------------------------------------------------------------------------------
revoke select on public.companies from authenticated;
grant select (id, name, vat_id, reg_com, address, created_by, created_at, updated_at, archived_at)
  on public.companies to authenticated;

-- Who sees a company's budgets and the manager's approval limit: whoever sees its costs, and
-- whoever the admin let manage the budget (they send the limit back unchanged when they save).
create function public.company_money_visible(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.fleet_can(p_company, 'costs.view') or public.fleet_can(p_company, 'budget.manage')
$$;
revoke execute on function public.company_money_visible(uuid) from public, anon, authenticated;

create or replace function public.company_json(c public.companies)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(c)
         || case when public.company_money_visible(c.id) then '{}'::jsonb
                 else jsonb_build_object('manager_approval_limit', null, 'budget_monthly', null, 'budget_yearly', null) end
         || jsonb_build_object('my_role', public.company_role(c.id))
$$;
revoke execute on function public.company_json(public.companies) from public, anon, authenticated;

-- One company of the caller's (an accepted member), as company_json answers it; null otherwise,
-- as the direct read answered no row.
create function public.get_company(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.company_json(c)
  from public.companies c
  where c.id = p_company and public.company_role(c.id) is not null
$$;
revoke execute on function public.get_company(uuid) from public, anon;
grant execute on function public.get_company(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Reviews
-- ---------------------------------------------------------------------------------------------
revoke select on public.reviews from authenticated;
grant select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at,
              report_reason, reported_at, report_status, removed_at, created_at, updated_at)
  on public.reviews to authenticated;

update public.schema_version set version = 121;
