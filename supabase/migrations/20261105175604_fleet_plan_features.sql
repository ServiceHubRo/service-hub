-- T65 — three real plans (approved by Eduard on 5 Nov 2026: "Fleet Start, Business și Pro trebuie să
-- fie trei niveluri reale de produs, nu doar trei prețuri diferite"; the table of features he accepted).
--
-- · fleet_plans.features, the one configuration (src/lib/fleet/plans.ts mirrors the keys):
--     Start     dashboard, vehicles, history, doc_alerts, costs_basic, members
--     Business  + dashboard_finance, reports, export_csv, budget, cost_per_km, approval_flow, member_rights
--     Pro, Enterprise  + reports_advanced, budget_forecast, approval_custom, export_excel
-- · The plan and the role are separate: what a member may do = the plan's features ∩ the role's
--   rights ∪ the rights given (those only with member_rights) — never more because of the plan.
-- · Checked on the server: rights beyond the role (member_rights), a member's own approval limit
--   (approval_custom), the managers' approval limit (approval_flow), budgets (budget, since T64a),
--   the reports (fleet_report computes them here, per plan), the exports (fleet_log_export).
-- · A downgrade makes nothing more permissive and deletes nothing: rights stay stored but stop
--   applying; a member's own limit keeps applying only where it is lower than the company's.

-- ---------------------------------------------------------------------------------------------
-- The plans' features
-- ---------------------------------------------------------------------------------------------
update public.fleet_plans set features = array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members']
where key = 'fleet_start';
update public.fleet_plans set features = array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members',
  'dashboard_finance', 'reports', 'export_csv', 'budget', 'cost_per_km', 'approval_flow', 'member_rights']
where key = 'fleet_business';
update public.fleet_plans set features = array['dashboard', 'vehicles', 'history', 'doc_alerts', 'costs_basic', 'members',
  'dashboard_finance', 'reports', 'export_csv', 'budget', 'cost_per_km', 'approval_flow', 'member_rights',
  'reports_advanced', 'budget_forecast', 'approval_custom', 'export_excel']
where key in ('fleet_pro', 'enterprise');

-- ---------------------------------------------------------------------------------------------
-- Rights follow the plan
-- ---------------------------------------------------------------------------------------------
create or replace function public.fleet_can(p_company uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.fleet_member_can(m.role,
      case when public.fleet_has_feature(p_company, 'member_rights') then m.extra_caps else '{}'::text[] end,
      p_capability)
    from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
  ), false)
$$;

-- The caller's approval limit: their own, else the company's, with Fleet Pro; on a plan without own
-- limits the lower of the two applies (a limit set earlier never lets anyone approve more).
create or replace function public.my_approval_limit(p_company uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.fleet_has_feature(p_company, 'approval_custom') then coalesce(m.approval_limit, c.manager_approval_limit)
    when m.approval_limit is null then c.manager_approval_limit
    when c.manager_approval_limit is null then m.approval_limit
    else least(m.approval_limit, c.manager_approval_limit)
  end
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
$$;

-- Budgets need Fleet Business (T64a); so does the managers' approval limit now.
create or replace function public.companies_budget_feature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.budget_monthly is distinct from old.budget_monthly and new.budget_monthly is not null)
     or (new.budget_yearly is distinct from old.budget_yearly and new.budget_yearly is not null) then
    if not public.fleet_has_feature(new.id, 'budget') then
      perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'budget'));
    end if;
  end if;
  if new.manager_approval_limit is distinct from old.manager_approval_limit and new.manager_approval_limit is not null
     and not public.fleet_has_feature(new.id, 'approval_flow') then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'approval_flow'));
  end if;
  return new;
end
$$;

-- set_company_member_rights: rights need Fleet Business, a member's own limit Fleet Pro.
create or replace function public.set_company_member_rights(p_member uuid, p_caps text[], p_approval_limit numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_caps text[];
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_member_rights');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company_admin(v_row.company_id);
  select coalesce(array_agg(distinct c order by c), '{}') into v_caps from unnest(coalesce(p_caps, '{}')) c;
  if v_row.role = 'admin'
     or not (v_caps <@ array['quotes.approve', 'budget.manage', 'bookings.create', 'vehicles.manage', 'costs.view', 'reports.view', 'members.manage'])
     or p_approval_limit < 0 or p_approval_limit > 10000000
     or (p_approval_limit is not null and not public.fleet_member_can(v_row.role, v_caps, 'quotes.approve')) then
    perform public.fail('company_rights_invalid');
  end if;
  -- Rights beyond the role need Fleet Business; a member's own limit needs Fleet Pro (T65).
  if cardinality(v_caps) > 0 and not public.fleet_has_feature(v_row.company_id, 'member_rights') then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'member_rights'));
  end if;
  if p_approval_limit is not null and not public.fleet_has_feature(v_row.company_id, 'approval_custom') then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'approval_custom'));
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  update public.company_members set extra_caps = v_caps, approval_limit = round(p_approval_limit, 2)
  where id = p_member;
  perform public.company_audit(v_row.company_id, 'set_member_rights', 'member', v_row.id,
    jsonb_build_object('extra_caps', v_row.extra_caps, 'approval_limit', v_row.approval_limit),
    jsonb_build_object('extra_caps', v_caps, 'approval_limit', round(p_approval_limit, 2)));
  v_result := jsonb_build_object('id', v_row.id, 'extra_caps', v_caps, 'approval_limit', round(p_approval_limit, 2));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- fleet_overview: the rights that apply on the company's plan.
create or replace function public.fleet_overview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_role text;
  v_me uuid;
  v_all boolean;
  v_team boolean;
  v_money boolean;
  v_bookings boolean;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  v_role := public.company_role(p_company);
  if v_company.id is null or v_role is null then
    perform public.fail('company_not_found');
  end if;
  v_me := public.my_member_id(p_company);
  v_all := public.fleet_can(p_company, 'vehicles.viewAll');
  v_team := public.fleet_can(p_company, 'members.manage') or public.fleet_can(p_company, 'vehicles.manage');
  v_money := public.fleet_can(p_company, 'costs.view');
  v_bookings := public.fleet_can(p_company, 'bookings.viewAll');
  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'vat_id', v_company.vat_id, 'plan_key', 'none',
      -- Money rules only for those who see money.
      'manager_approval_limit', case when v_money then v_company.manager_approval_limit end,
      'budget', jsonb_build_object(
        'monthly', case when v_money then v_company.budget_monthly end,
        'yearly', case when v_money then v_company.budget_yearly end)),
    'me', jsonb_build_object('member_id', v_me, 'role', v_role,
      -- The rights that apply: none on a plan without them (kept, they apply again after an upgrade).
      'extra_caps', to_jsonb(case when public.fleet_has_feature(p_company, 'member_rights')
                                  then (select m.extra_caps from public.company_members m where m.id = v_me) else '{}'::text[] end),
      'approval_limit', case when v_money then public.my_approval_limit(p_company) end),
    'vehicles', coalesce((
      select jsonb_agg(public.vehicle_json(cv) order by cv.created_at, cv.id)
      from public.company_vehicles cv
      where cv.company_id = p_company
        and (v_all or (cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'user_id', m.user_id, 'name', coalesce(p.name, ''),
               'email', lower(coalesce(u.email, m.invited_email)), 'role', m.role, 'accepted_at', m.accepted_at,
               'extra_caps', to_jsonb(m.extra_caps), 'approval_limit', case when v_money then m.approval_limit end)
             order by m.accepted_at nulls last, m.invited_at)
      from public.company_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.company_id = p_company and (v_team or m.user_id = auth.uid())
    ), '[]'::jsonb),
    -- The company's bookings (T63d): all for those who see all; a driver those of the vehicles
    -- assigned to them and their own, without amounts.
    'jobs', coalesce((
      select jsonb_agg(public.fleet_job_json(b, v_money) order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      where b.company_id = p_company
        and (v_bookings
             or b.client_id = auth.uid()
             or b.company_vehicle_id in (
               select cv.id from public.company_vehicles cv
               where cv.company_id = p_company and cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    -- Expenses and issues arrive with T63i / T63f.
    'expenses', '[]'::jsonb,
    'issues', '[]'::jsonb
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Reports, computed here per plan (T65). The same ledger as src/lib/fleet/costs.ts: a done job
-- counts its final cost on the day it was finished (Bucharest), a refused quote its inspection fee
-- on its day; categories from the first service's catalog category. Expenses join it with T63e.
-- ---------------------------------------------------------------------------------------------
create function public.fleet_ledger(p_company uuid)
returns table (id uuid, vehicle_id uuid, shop_id uuid, shop_name text, day date, amount numeric, category text,
               odometer int, done boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.company_vehicle_id, b.shop_id, s.name,
         case when b.done_at is not null then (b.done_at at time zone 'Europe/Bucharest')::date else b.date end,
         b.cost,
         case when b.status = 'done' then
           case sv.category_key when 'cat_rev' then 'maintenance' when 'cat_anv' then 'tires' when 'cat_itp' then 'itp'
                                when 'cat_det' then 'consumables' else 'repairs' end
           else 'repairs' end,
         case when b.status = 'done' then b.odometer end,
         b.status = 'done'
  from public.bookings b
  join public.shops s on s.id = b.shop_id
  join public.services sv on sv.id = b.service_id
  where b.company_id = p_company and b.company_vehicle_id is not null
    and b.status in ('done', 'quote_refused') and b.cost > 0
$$;
revoke execute on function public.fleet_ledger(uuid) from public, anon, authenticated;

-- The ledger narrowed to the vehicles, categories and shops of a report.
create function public.fleet_report_entries(p_company uuid, p_vehicles uuid[], p_categories text[], p_shops uuid[])
returns table (id uuid, vehicle_id uuid, shop_id uuid, shop_name text, day date, amount numeric, category text,
               odometer int, done boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from public.fleet_ledger(p_company) l
  where l.vehicle_id = any (p_vehicles)
    and (p_categories is null or l.category = any (p_categories))
    and (p_shops is null or l.shop_id = any (p_shops))
$$;
revoke execute on function public.fleet_report_entries(uuid, uuid[], text[], uuid[]) from public, anon, authenticated;

-- Cost per km of one vehicle over a range (src/lib/fleet/costPerKm.ts, the same rule): baseline =
-- the last reading before the range, else the first inside; end = the last inside; the costs after
-- the baseline's day, from the range's start, up to the end's day; no figure when the readings go
-- down, there are none or one, or no distance.
create function public.fleet_vehicle_cost_per_km(p_company uuid, p_vehicle uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days date[];
  v_kms int[];
  v_n int;
  v_first_inside int;
  v_last_inside int;
  v_before int;
  v_from_i int;
  v_km int;
  v_cost numeric;
begin
  select array_agg(l.day order by l.day, l.odometer), array_agg(l.odometer order by l.day, l.odometer)
    into v_days, v_kms
  from public.fleet_ledger(p_company) l
  where l.vehicle_id = p_vehicle and l.done and l.odometer is not null;
  v_n := coalesce(cardinality(v_days), 0);
  for i in 2..v_n loop
    if v_kms[i] < v_kms[i - 1] then
      return jsonb_build_object('vehicle_id', p_vehicle, 'status', 'inconsistent');
    end if;
  end loop;
  for i in 1..v_n loop
    if (p_from is null or v_days[i] >= p_from) and v_days[i] <= p_to then
      v_first_inside := coalesce(v_first_inside, i);
      v_last_inside := i;
    elsif p_from is not null and v_days[i] < p_from then
      v_before := i;
    end if;
  end loop;
  if v_last_inside is null then
    return jsonb_build_object('vehicle_id', p_vehicle, 'status', 'no_readings');
  end if;
  v_from_i := coalesce(v_before, v_first_inside);
  if v_from_i = v_last_inside then
    return jsonb_build_object('vehicle_id', p_vehicle, 'status', 'one_reading');
  end if;
  v_km := v_kms[v_last_inside] - v_kms[v_from_i];
  if v_km <= 0 then
    return jsonb_build_object('vehicle_id', p_vehicle, 'status', 'no_distance');
  end if;
  select coalesce(sum(l.amount), 0) into v_cost
  from public.fleet_ledger(p_company) l
  where l.vehicle_id = p_vehicle and l.day > v_days[v_from_i] and (p_from is null or l.day >= p_from) and l.day <= v_days[v_last_inside];
  return jsonb_build_object('vehicle_id', p_vehicle, 'status', 'ok', 'km', v_km, 'cost', v_cost,
    'per_km', round(v_cost / v_km, 2));
end
$$;
revoke execute on function public.fleet_vehicle_cost_per_km(uuid, uuid, date, date) from public, anon, authenticated;

-- fleet_report(company, from, to, previous from, previous to, filters) — Rapoarte and the financial
-- part of Panou. Who sees costs and reports (role or right), on a plan with `reports`; the filters
-- (vehicles, departments, vehicle types, categories, shops) and the advanced part need
-- `reports_advanced`; cost per km `cost_per_km`; the budgets `budget`; the forecast `budget_forecast`.
create function public.fleet_report(p_company uuid, p_from date, p_to date, p_prev_from date default null,
  p_prev_to date default null, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_vehicles uuid[];
  v_categories text[];
  v_shops uuid[];
  v_advanced boolean;
  v_today date := public.bucharest_today();
  v_months text[];
  v_total numeric;
  v_count int;
  v_cars int;
  v_result jsonb;
  v_avg numeric;
  v_month_spent numeric;
  v_year_spent numeric;
  v_per_km jsonb := '[]'::jsonb;
  v_km int := 0;
  v_km_cost numeric := 0;
  r record;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  if not found or public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if not public.fleet_can(p_company, 'reports.view') or not public.fleet_can(p_company, 'costs.view') then
    perform public.fail('not_allowed');
  end if;
  if not public.fleet_has_feature(p_company, 'reports') then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'reports'));
  end if;
  if p_to is null or (p_from is not null and p_from > p_to) or (p_prev_from is not null and p_prev_to is null) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'range'));
  end if;
  v_advanced := public.fleet_has_feature(p_company, 'reports_advanced');
  if v_filters <> '{}'::jsonb and not v_advanced then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', 'reports_advanced'));
  end if;

  -- The vehicles in scope: the company's, narrowed by the filters (Pro).
  select array_agg(cv.id) into v_vehicles
  from public.company_vehicles cv
  where cv.company_id = p_company
    and (not (v_filters ? 'vehicle_ids') or cv.id::text in (select jsonb_array_elements_text(v_filters->'vehicle_ids')))
    and (not (v_filters ? 'departments') or cv.department in (select jsonb_array_elements_text(v_filters->'departments')))
    and (not (v_filters ? 'vehicle_types') or cv.vehicle_type in (select jsonb_array_elements_text(v_filters->'vehicle_types')));
  v_vehicles := coalesce(v_vehicles, '{}');
  select array_agg(x) into v_categories from jsonb_array_elements_text(v_filters->'categories') x;
  select array_agg(x::uuid) into v_shops from jsonb_array_elements_text(v_filters->'shop_ids') x;

  select coalesce(sum(e.amount), 0), count(*) into v_total, v_count
  from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e where (p_from is null or e.day >= p_from) and e.day <= p_to;

  -- Cars in the fleet during the range (added by its end, not archived before its start).
  select count(*) into v_cars
  from public.company_vehicles cv
  where cv.id = any (v_vehicles)
    and (cv.created_at at time zone 'Europe/Bucharest')::date <= p_to
    and (cv.archived_at is null or p_from is null or (cv.archived_at at time zone 'Europe/Bucharest')::date >= p_from);

  select array_agg(to_char(date_trunc('month', v_today) - make_interval(months => 11 - i), 'YYYY-MM') order by i)
    into v_months from generate_series(0, 11) i;

  v_result := jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'total', v_total,
    'count', v_count,
    'vehicles_in_range', v_cars,
    'avg_per_vehicle', case when v_cars > 0 then round(v_total / v_cars, 2) end,
    'previous', case when p_prev_to is null then null else jsonb_build_object(
      'from', p_prev_from, 'to', p_prev_to,
      'total', (select coalesce(sum(e.amount), 0) from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
                where (p_prev_from is null or e.day >= p_prev_from) and e.day <= p_prev_to)) end,
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('key', g.category, 'total', g.total, 'count', g.n) order by g.total desc, g.category)
      from (select e.category, sum(e.amount) total, count(*) n from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
            where (p_from is null or e.day >= p_from) and e.day <= p_to group by e.category) g), '[]'::jsonb),
    'by_vehicle', coalesce((
      select jsonb_agg(jsonb_build_object('key', g.vehicle_id, 'total', g.total, 'count', g.n, 'top_category', (
               select e2.category from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e2
               where e2.vehicle_id = g.vehicle_id and (p_from is null or e2.day >= p_from) and e2.day <= p_to
               group by e2.category order by sum(e2.amount) desc, e2.category limit 1))
             order by g.total desc, g.vehicle_id::text)
      from (select e.vehicle_id, sum(e.amount) total, count(*) n from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
            where (p_from is null or e.day >= p_from) and e.day <= p_to group by e.vehicle_id) g), '[]'::jsonb),
    'by_shop', coalesce((
      select jsonb_agg(jsonb_build_object('key', g.shop_id, 'name', g.shop_name, 'total', g.total, 'count', g.n)
             order by g.total desc, g.shop_id::text)
      from (select e.shop_id, min(e.shop_name) shop_name, sum(e.amount) total, count(*) n from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
            where (p_from is null or e.day >= p_from) and e.day <= p_to group by e.shop_id) g), '[]'::jsonb),
    'repairs', coalesce((
      select jsonb_agg(jsonb_build_object('vehicle_id', g.vehicle_id, 'count', g.n, 'last_day', g.last_day, 'total', g.total)
             order by g.n desc, g.vehicle_id::text)
      from (select e.vehicle_id, count(*) n, max(e.day) last_day, sum(e.amount) total from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
            where e.done and (p_from is null or e.day >= p_from) and e.day <= p_to group by e.vehicle_id) g), '[]'::jsonb),
    'monthly', (
      select jsonb_agg(jsonb_build_object('month', m, 'total',
               (select coalesce(sum(e.amount), 0) from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e where to_char(e.day, 'YYYY-MM') = m))
             order by m)
      from unnest(v_months) m),
    'features', to_jsonb((select p.features from public.company_subscriptions s join public.fleet_plans p on p.key = s.plan_key
                          where s.company_id = p_company)));

  -- Budgets (Business): this month and this year, the whole fleet.
  if public.fleet_has_feature(p_company, 'budget') then
    select coalesce(sum(l.amount) filter (where l.day >= date_trunc('month', v_today)::date and l.day <= v_today), 0),
           coalesce(sum(l.amount) filter (where l.day >= date_trunc('year', v_today)::date and l.day <= v_today), 0)
      into v_month_spent, v_year_spent
    from public.fleet_ledger(p_company) l;
    v_result := v_result || jsonb_build_object('budget', jsonb_build_object(
      'monthly', case when v_company.budget_monthly is null then null else jsonb_build_object('budget', v_company.budget_monthly, 'spent', v_month_spent) end,
      'yearly', case when v_company.budget_yearly is null then null else jsonb_build_object('budget', v_company.budget_yearly, 'spent', v_year_spent) end));
    -- Forecast (Pro): where this month and this year end at the pace so far.
    if public.fleet_has_feature(p_company, 'budget_forecast') then
      v_result := v_result || jsonb_build_object('forecast', jsonb_build_object(
        'month_spent', v_month_spent,
        'month_end', round(v_month_spent / extract(day from v_today) * extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day')), 2),
        'year_spent', v_year_spent,
        'year_end', round(v_year_spent / extract(doy from v_today) * extract(doy from (date_trunc('year', v_today) + interval '1 year - 1 day')), 2)));
    end if;
  end if;

  -- Cost per km (Business): each active vehicle in scope, and the fleet over those with a figure.
  if public.fleet_has_feature(p_company, 'cost_per_km') then
    for r in select cv.id from public.company_vehicles cv where cv.id = any (v_vehicles) and cv.archived_at is null order by cv.created_at, cv.id loop
      v_per_km := v_per_km || jsonb_build_array(public.fleet_vehicle_cost_per_km(p_company, r.id, p_from, p_to));
    end loop;
    select coalesce(sum((x->>'km')::int), 0), coalesce(sum((x->>'cost')::numeric), 0) into v_km, v_km_cost
    from jsonb_array_elements(v_per_km) x where x->>'status' = 'ok';
    v_result := v_result || jsonb_build_object('per_km', jsonb_build_object(
      'total', case when v_km > 0 then jsonb_build_object('km', v_km, 'cost', v_km_cost, 'per_km', round(v_km_cost / v_km, 2)) end,
      'per_vehicle', v_per_km));
  end if;

  -- The advanced part (Pro): high-cost vehicles, each vehicle against the period before, each
  -- vehicle's last 12 months.
  if v_advanced then
    select avg(g.total) into v_avg
    from (select sum(e.amount) total from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
          where (p_from is null or e.day >= p_from) and e.day <= p_to group by e.vehicle_id) g;
    v_result := v_result || jsonb_build_object('advanced', jsonb_build_object(
      'high_cost', coalesce((
        select jsonb_agg(g.vehicle_id order by g.total desc)
        from (select e.vehicle_id, sum(e.amount) total from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
              where (p_from is null or e.day >= p_from) and e.day <= p_to group by e.vehicle_id) g
        where (select count(distinct e.vehicle_id) from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
               where (p_from is null or e.day >= p_from) and e.day <= p_to) > 1
          and g.total > v_avg * 1.5), '[]'::jsonb),
      'previous_by_vehicle', case when p_prev_to is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('key', g.vehicle_id, 'total', g.total) order by g.vehicle_id::text)
        from (select e.vehicle_id, sum(e.amount) total from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
              where (p_prev_from is null or e.day >= p_prev_from) and e.day <= p_prev_to group by e.vehicle_id) g), '[]'::jsonb) end,
      'vehicle_monthly', coalesce((
        select jsonb_agg(jsonb_build_object('vehicle_id', v.vehicle_id, 'months', (
                 select jsonb_agg(jsonb_build_object('month', m, 'total',
                          (select coalesce(sum(e.amount), 0) from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e
                           where e.vehicle_id = v.vehicle_id and to_char(e.day, 'YYYY-MM') = m)) order by m)
                 from unnest(v_months) m)) order by v.vehicle_id::text)
        from (select distinct e.vehicle_id from public.fleet_report_entries(p_company, v_vehicles, v_categories, v_shops) e) v), '[]'::jsonb)));
  end if;
  return v_result;
end
$$;
revoke execute on function public.fleet_report(uuid, date, date, date, date, jsonb) from public, anon;
grant execute on function public.fleet_report(uuid, date, date, date, date, jsonb) to authenticated;

-- An export (T65): the plan includes it and the member may see what it holds; logged in the
-- company's journal (who exported what, how many rows). The browser writes the file afterwards.
create function public.fleet_log_export(p_company uuid, p_kind text, p_rows int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_fleet_client();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if p_kind not in ('vehicles_csv', 'costs_csv', 'report_csv', 'report_xlsx') or p_rows < 0 or p_rows > 1000000 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'export'));
  end if;
  if not public.fleet_can(p_company, case when p_kind = 'vehicles_csv' then 'vehicles.viewAll' else 'costs.view' end) then
    perform public.fail('not_allowed');
  end if;
  if not public.fleet_has_feature(p_company, case when p_kind = 'report_xlsx' then 'export_excel' else 'export_csv' end) then
    perform public.fail('plan_feature_missing', jsonb_build_object('feature', case when p_kind = 'report_xlsx' then 'export_excel' else 'export_csv' end));
  end if;
  perform public.company_audit(p_company, 'export', 'company', p_company, null, jsonb_build_object('kind', p_kind, 'rows', p_rows));
end
$$;
revoke execute on function public.fleet_log_export(uuid, text, int) from public, anon;
grant execute on function public.fleet_log_export(uuid, text, int) to authenticated;

update public.schema_version set version = 97;
