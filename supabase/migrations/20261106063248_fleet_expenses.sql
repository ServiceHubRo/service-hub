-- M1 / T70 — the company's own expenses (T63e; Eduard, 6 Nov 2026: approved in docs/FLEET_EXTENSION_PLAN.md).
--
-- An expense: vehicle, day (never in the future, Bucharest), amount (RON by default; another currency is
-- listed and never summed), category (fuel, parts, external repairs, labor, tolls and parking,
-- consumables, insurance, other), supplier, description, odometer, for fuel the liters, the fuel and
-- whether the tank was filled, and a photo or PDF of the receipt in the private bucket `fleet-files`.
--
-- No double counting: a job finished through Service-Hub is already in the company's costs; an
-- expense that documents it (`booking_id`) is kept and shown, never added again. An expense with the
-- same vehicle, day, amount and supplier as another is refused as a possible duplicate unless the
-- member confirms it.
--
-- Rights (fleet_can): `costs.manage` (admin, manager, accountant) adds, edits, deletes (recoverable:
-- `deleted_at`) and marks expenses checked; a driver adds fuel for the vehicle assigned to them, which
-- arrives „de verificat”, and sees only what they added. Every change in company_audit_log
-- (before/after). Nothing existing is touched; rollback: drop the new table, functions, policies and the
-- bucket, and restore the previous fleet_ledger, fleet_report and fleet_overview.

create table public.fleet_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.company_vehicles (id),
  category text not null check (category in ('fuel', 'parts', 'repairs', 'labor', 'tolls', 'consumables', 'insurance', 'other')),
  day date not null,
  amount numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  currency text not null default 'RON' check (currency ~ '^[A-Z]{3}$'),
  supplier text check (char_length(supplier) <= 120),
  description text check (char_length(description) <= 500),
  odometer int check (odometer between 0 and 2000000),
  liters numeric(8, 2) check (liters > 0 and liters <= 2000),
  fuel_type text check (fuel_type in ('diesel', 'petrol', 'lpg', 'electric', 'other')),
  full_tank boolean,
  booking_id uuid references public.bookings (id) on delete set null,
  receipt_path text check (char_length(receipt_path) <= 300),
  status text not null default 'ok' check (status in ('ok', 'to_check')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz,
  check (category = 'fuel' or (liters is null and fuel_type is null and full_tank is null))
);
create index fleet_expenses_company_idx on public.fleet_expenses (company_id, day desc) where deleted_at is null;
create index fleet_expenses_vehicle_idx on public.fleet_expenses (vehicle_id, day desc) where deleted_at is null;
create index fleet_expenses_booking_idx on public.fleet_expenses (booking_id) where booking_id is not null;
alter table public.fleet_expenses enable row level security;
-- Read through fleet_overview / fleet_report only; no grants, no policies for the browser.

-- ------------------------------------------------------------------ the receipts
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-files', 'fleet-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- Path `<company>/<vehicle>/<file>`. Written by costs.manage, or by a driver for the vehicle assigned to them.
create function public.fleet_file_can_write(p_company uuid, p_vehicle uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_company is not null and p_vehicle is not null
    and exists (select 1 from public.company_vehicles cv where cv.id = p_vehicle and cv.company_id = p_company)
    and (public.fleet_can(p_company, 'costs.manage')
         or (public.company_role(p_company) = 'driver'
             and exists (select 1 from public.company_vehicles cv where cv.id = p_vehicle and cv.archived_at is null
                           and cv.driver_member_id = public.my_member_id(p_company))))
$$;
revoke execute on function public.fleet_file_can_write(uuid, uuid) from public, anon;
grant execute on function public.fleet_file_can_write(uuid, uuid) to authenticated;

create policy fleet_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-files'
    and public.fleet_file_can_write(public.try_uuid((storage.foldername(name))[1]), public.try_uuid((storage.foldername(name))[2])));
create policy fleet_files_select on storage.objects for select to authenticated
  using (bucket_id = 'fleet-files'
    and (public.fleet_can(public.try_uuid((storage.foldername(name))[1]), 'costs.view') or owner = auth.uid()));
create policy fleet_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fleet-files'
    and (public.fleet_can(public.try_uuid((storage.foldername(name))[1]), 'costs.manage') or owner = auth.uid()));

-- ------------------------------------------------------------------ the record as the app reads it
create function public.fleet_expense_json(e public.fleet_expenses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'vehicle_id', e.vehicle_id, 'category', e.category, 'day', e.day, 'amount', e.amount,
    'currency', e.currency, 'supplier', e.supplier, 'description', e.description, 'odometer', e.odometer,
    'liters', e.liters, 'fuel_type', e.fuel_type, 'full_tank', e.full_tank, 'booking_id', e.booking_id,
    'receipt_path', e.receipt_path, 'status', e.status, 'created_by', e.created_by,
    'created_by_name', (select p.name from public.profiles p where p.id = e.created_by),
    'created_at', e.created_at, 'updated_at', e.updated_at, 'deleted_at', e.deleted_at,
    -- Already in the costs as a Service-Hub job: listed, never added again.
    'counted_elsewhere', exists (select 1 from public.bookings b where b.id = e.booking_id and b.company_id = e.company_id
                                   and b.status in ('done', 'quote_refused') and b.cost > 0))
$$;
revoke execute on function public.fleet_expense_json(public.fleet_expenses) from public, anon, authenticated;

-- ------------------------------------------------------------------ add or change
create function public.fleet_save_expense(p_company uuid, p_expense uuid, p_fields jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_manage boolean;
  v_before public.fleet_expenses%rowtype;
  v_row public.fleet_expenses%rowtype;
  v_vehicle uuid := public.try_uuid(f->>'vehicle_id');
  v_category text := f->>'category';
  v_day date;
  v_amount numeric;
  v_currency text := upper(coalesce(nullif(btrim(f->>'currency'), ''), 'RON'));
  v_odometer int;
  v_liters numeric;
  v_booking uuid := public.try_uuid(nullif(f->>'booking_id', ''));
  v_receipt text := nullif(btrim(coalesce(f->>'receipt_path', '')), '');
  v_supplier text := nullif(btrim(coalesce(f->>'supplier', '')), '');
  v_other uuid;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_save_expense');
  if v_seen is not null then
    return v_seen;
  end if;
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if public.company_read_only(p_company) then
    perform public.fail('fleet_read_only');
  end if;
  v_manage := public.fleet_can(p_company, 'costs.manage');

  -- The fields, checked here whatever the browser checked.
  if v_category is null or v_category not in ('fuel', 'parts', 'repairs', 'labor', 'tolls', 'consumables', 'insurance', 'other') then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'category'));
  end if;
  begin
    v_day := (f->>'day')::date;
    v_amount := round((f->>'amount')::numeric, 2);
    v_odometer := nullif(f->>'odometer', '')::int;
    v_liters := nullif(f->>'liters', '')::numeric;
  exception when others then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'number'));
  end;
  if v_day is null or v_day > public.bucharest_today() or v_day < date '2000-01-01' then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'day'));
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 10000000 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'amount'));
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'currency'));
  end if;
  if v_odometer is not null and v_odometer not between 0 and 2000000 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'odometer'));
  end if;
  if v_category = 'fuel' then
    if v_liters is not null and (v_liters <= 0 or v_liters > 2000) then
      perform public.fail('expense_invalid', jsonb_build_object('field', 'liters'));
    end if;
    if nullif(f->>'fuel_type', '') is not null and f->>'fuel_type' not in ('diesel', 'petrol', 'lpg', 'electric', 'other') then
      perform public.fail('expense_invalid', jsonb_build_object('field', 'fuel_type'));
    end if;
  end if;
  if char_length(v_supplier) > 120 or char_length(f->>'description') > 500 then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'text'));
  end if;
  if v_receipt is not null and v_receipt !~ ('^' || p_company::text || '/' || coalesce(v_vehicle::text, '-') || '/[A-Za-z0-9._-]{1,120}$') then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'receipt'));
  end if;

  -- One request at a time per vehicle: two identical expenses cannot both pass the duplicate check.
  perform 1 from public.company_vehicles cv where cv.id = v_vehicle and cv.company_id = p_company for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;

  -- Who may write it: costs.manage; a driver only fuel, only for the vehicle assigned to them, only new.
  if not v_manage then
    if public.company_role(p_company) <> 'driver' or p_expense is not null or v_category <> 'fuel'
       or not exists (select 1 from public.company_vehicles cv where cv.id = v_vehicle and cv.archived_at is null
                        and cv.driver_member_id = public.my_member_id(p_company)) then
      perform public.fail('not_allowed');
    end if;
  end if;

  if v_booking is not null and not exists (
    select 1 from public.bookings b where b.id = v_booking and b.company_id = p_company and b.company_vehicle_id = v_vehicle) then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'booking'));
  end if;

  if p_expense is not null then
    select * into v_before from public.fleet_expenses e where e.id = p_expense and e.company_id = p_company and e.deleted_at is null for update;
    if not found then
      perform public.fail('expense_not_found');
    end if;
  end if;

  if not coalesce((f->>'confirm_duplicate')::boolean, false) then
    select e.id into v_other from public.fleet_expenses e
    where e.company_id = p_company and e.vehicle_id = v_vehicle and e.day = v_day and e.amount = v_amount
      and e.deleted_at is null and e.id is distinct from p_expense
      and lower(coalesce(e.supplier, '')) = lower(coalesce(v_supplier, ''))
    limit 1;
    if v_other is not null then
      perform public.fail('expense_possible_duplicate', jsonb_build_object('expense_id', v_other));
    end if;
  end if;

  if p_expense is null then
    insert into public.fleet_expenses (company_id, vehicle_id, category, day, amount, currency, supplier, description, odometer,
      liters, fuel_type, full_tank, booking_id, receipt_path, status, created_by)
    values (p_company, v_vehicle, v_category, v_day, v_amount, v_currency, v_supplier, nullif(btrim(coalesce(f->>'description', '')), ''),
      v_odometer,
      case when v_category = 'fuel' then v_liters end,
      case when v_category = 'fuel' then nullif(f->>'fuel_type', '') end,
      case when v_category = 'fuel' then (f->>'full_tank')::boolean end,
      v_booking, v_receipt, case when v_manage then 'ok' else 'to_check' end, auth.uid())
    returning * into v_row;
    perform public.company_audit(p_company, 'expense_created', 'expense', v_row.id, null, public.fleet_expense_json(v_row));
  else
    update public.fleet_expenses set
      vehicle_id = v_vehicle, category = v_category, day = v_day, amount = v_amount, currency = v_currency, supplier = v_supplier,
      description = nullif(btrim(coalesce(f->>'description', '')), ''), odometer = v_odometer,
      liters = case when v_category = 'fuel' then v_liters end,
      fuel_type = case when v_category = 'fuel' then nullif(f->>'fuel_type', '') end,
      full_tank = case when v_category = 'fuel' then (f->>'full_tank')::boolean end,
      booking_id = v_booking, receipt_path = v_receipt, updated_at = now()
    where id = p_expense
    returning * into v_row;
    perform public.company_audit(p_company, 'expense_updated', 'expense', v_row.id, public.fleet_expense_json(v_before), public.fleet_expense_json(v_row));
  end if;

  v_result := public.fleet_expense_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- Delete (recoverable: the row stays with deleted_at, and the log keeps it as it was).
create function public.fleet_delete_expense(p_expense uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.fleet_expenses%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_delete_expense');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.fleet_expenses e where e.id = p_expense and e.deleted_at is null for update;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('expense_not_found');
  end if;
  if not public.fleet_can(v_row.company_id, 'costs.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_row.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  update public.fleet_expenses set deleted_at = now() where id = p_expense;
  perform public.company_audit(v_row.company_id, 'expense_deleted', 'expense', v_row.id, public.fleet_expense_json(v_row), null);
  v_result := jsonb_build_object('id', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- „Verificată” / „De verificat”.
create function public.fleet_mark_expense(p_expense uuid, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.fleet_expenses%rowtype;
  v_row public.fleet_expenses%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_mark_expense');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_status not in ('ok', 'to_check') then
    perform public.fail('expense_invalid', jsonb_build_object('field', 'status'));
  end if;
  select * into v_before from public.fleet_expenses e where e.id = p_expense and e.deleted_at is null for update;
  if not found or public.company_role(v_before.company_id) is null then
    perform public.fail('expense_not_found');
  end if;
  if not public.fleet_can(v_before.company_id, 'costs.manage') then
    perform public.fail('not_allowed');
  end if;
  update public.fleet_expenses set status = p_status, updated_at = now() where id = p_expense returning * into v_row;
  perform public.company_audit(v_row.company_id, 'expense_checked', 'expense', v_row.id, public.fleet_expense_json(v_before), public.fleet_expense_json(v_row));
  v_result := public.fleet_expense_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke execute on function public.fleet_save_expense(uuid, uuid, jsonb, uuid) from public, anon;
revoke execute on function public.fleet_delete_expense(uuid, uuid) from public, anon;
revoke execute on function public.fleet_mark_expense(uuid, text, uuid) from public, anon;
grant execute on function public.fleet_save_expense(uuid, uuid, jsonb, uuid), public.fleet_delete_expense(uuid, uuid),
  public.fleet_mark_expense(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------------ one ledger: jobs and expenses
-- The manual expenses join the jobs; one that documents a counted job, or is in another currency, stays
-- out of the totals. `done` stays true for Service-Hub jobs only (the repairs list and cost per km).
create or replace function public.fleet_ledger(p_company uuid)
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
  union all
  select e.id, e.vehicle_id, null::uuid, e.supplier, e.day, e.amount, e.category, e.odometer, false
  from public.fleet_expenses e
  where e.company_id = p_company and e.deleted_at is null and e.currency = 'RON'
    and not exists (select 1 from public.bookings b where b.id = e.booking_id and b.company_id = p_company
                      and b.status in ('done', 'quote_refused') and b.cost > 0)
$$;

-- The report: the same as before, „Service-uri folosite” counting shops only.
create or replace function public.fleet_report(p_company uuid, p_from date, p_to date, p_prev_from date default null,
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
            where e.shop_id is not null and (p_from is null or e.day >= p_from) and e.day <= p_to group by e.shop_id) g), '[]'::jsonb),
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

-- The space's one read: the expenses now filled in.
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
    -- M1: the company's own expenses; a member without costs.view (a driver) sees only the ones they added.
    'expenses', coalesce((
      select jsonb_agg(public.fleet_expense_json(e) order by e.day desc, e.created_at desc)
      from public.fleet_expenses e
      where e.company_id = p_company and e.deleted_at is null and (v_money or e.created_by = auth.uid())), '[]'::jsonb),
    'issues', '[]'::jsonb
  );
end
$$;

update public.schema_version set version = 101;
