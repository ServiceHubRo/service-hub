-- M2 / T73 — odometer and fuel (Eduard, 6 Nov 2026: approved in docs/FLEET_EXTENSION_PLAN.md §M2).
--
-- One odometer log per company vehicle. The chronological rule: a reading for day D is at least the
-- highest km of the days before D and at most the lowest km of the days after D; values of the same day
-- are not compared. The evidence: the readings (manual, from expenses, from maintenance, imported) and
-- the finished Service-Hub jobs of that vehicle (read from bookings, never copied), minus the jobs the
-- company chose to ignore. An expense with an odometer writes a reading; editing it changes the
-- reading, deleting it removes the reading (soft). A km value against the rule is refused
-- (`odometer_lower`, `odometer_higher_than_later`). More than 2,000 km a day is shown as „Anomalie – de
-- verificat”, never refused.
--
-- Corrections: vehicles.manage, with a reason, before/after in the company log. Fuel statistics:
-- consumption only between two consecutive full-tank fills with km; missing liters → none; electric →
-- not supported; cost per km only with two readings. No estimates.
--
-- Import: every existing receipt with an odometer becomes a reading only if it agrees with all the
-- evidence; otherwise it is listed (fleet_odometer_import_exceptions) and the company fixes the receipt.
-- Receipts are never modified. On the real project (6 Nov 2026) no receipt has an odometer: nothing is
-- imported there. Rollback: supabase/rollback/20261106165521_fleet_odometer.sql.

create table public.fleet_odometer_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  vehicle_id uuid not null references public.company_vehicles (id),
  day date not null,
  km int not null check (km between 0 and 2000000),
  source text not null check (source in ('manual', 'expense', 'maintenance', 'import')),
  ref_id uuid,
  corrected_from int,
  correction_reason text check (char_length(correction_reason) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);
create index fleet_odometer_readings_vehicle_idx on public.fleet_odometer_readings (vehicle_id, day) where deleted_at is null;
-- One live reading per expense (or maintenance record).
create unique index fleet_odometer_readings_ref_idx on public.fleet_odometer_readings (ref_id) where deleted_at is null and ref_id is not null;
alter table public.fleet_odometer_readings enable row level security;

create table public.fleet_odometer_ignored_jobs (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  by_user uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now()
);
alter table public.fleet_odometer_ignored_jobs enable row level security;

create table public.fleet_odometer_import_exceptions (
  expense_id uuid primary key references public.fleet_expenses (id) on delete cascade,
  vehicle_id uuid not null,
  day date not null,
  km int not null,
  reasons text[] not null
);
alter table public.fleet_odometer_import_exceptions enable row level security;
-- RLS on, no grants: read through fleet_overview / fleet_fuel_stats only.
revoke all on public.fleet_odometer_readings, public.fleet_odometer_ignored_jobs, public.fleet_odometer_import_exceptions from anon, authenticated;

-- ------------------------------------------------------------------ the evidence and the rule
-- Every km value known for a vehicle: live readings and finished jobs (not ignored). `id` is the
-- reading's id (null for a job), so a check can leave out the reading being changed.
create function public.fleet_odometer_points(p_vehicle uuid)
returns table (id uuid, day date, km int, source text, ref_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.day, r.km, r.source, r.ref_id
  from public.fleet_odometer_readings r
  where r.vehicle_id = p_vehicle and r.deleted_at is null
  union all
  select null::uuid, coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date), b.odometer, 'job', b.id
  from public.bookings b
  where b.company_vehicle_id = p_vehicle and b.status = 'done' and b.odometer is not null
    and not exists (select 1 from public.fleet_odometer_ignored_jobs i where i.booking_id = b.id)
$$;
revoke execute on function public.fleet_odometer_points(uuid) from public, anon, authenticated;

-- Refuses a km value against the chronological rule. p_skip: the reading being changed.
create function public.fleet_odometer_check(p_vehicle uuid, p_day date, p_km int, p_skip uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_km int;
  v_day date;
begin
  select p.km, p.day into v_km, v_day from public.fleet_odometer_points(p_vehicle) p
  where p.day < p_day and (p_skip is null or p.id is null or p.id <> p_skip)
  order by p.km desc, p.day desc limit 1;
  if v_km is not null and p_km < v_km then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_km, 'previous_day', v_day));
  end if;
  select p.km, p.day into v_km, v_day from public.fleet_odometer_points(p_vehicle) p
  where p.day > p_day and (p_skip is null or p.id is null or p.id <> p_skip)
  order by p.km, p.day limit 1;
  if v_km is not null and p_km > v_km then
    perform public.fail('odometer_higher_than_later', jsonb_build_object('next', v_km, 'next_day', v_day));
  end if;
end
$$;
revoke execute on function public.fleet_odometer_check(uuid, date, int, uuid) from public, anon, authenticated;

-- The reading of an expense follows it: written, changed, or removed with it. Imported readings of a
-- receipt are taken over the same way; an exception of the import is cleared once the receipt is fixed.
create function public.fleet_sync_expense_reading(e public.fleet_expenses)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reading uuid;
begin
  select r.id into v_reading from public.fleet_odometer_readings r
  where r.ref_id = e.id and r.source in ('expense', 'import') and r.deleted_at is null
  for update;
  if e.odometer is null or e.deleted_at is not null then
    if v_reading is not null then
      update public.fleet_odometer_readings set deleted_at = now() where id = v_reading;
    end if;
    delete from public.fleet_odometer_import_exceptions x where x.expense_id = e.id;
    return;
  end if;
  perform public.fleet_odometer_check(e.vehicle_id, e.day, e.odometer, v_reading);
  if v_reading is null then
    insert into public.fleet_odometer_readings (company_id, vehicle_id, day, km, source, ref_id, created_by)
    values (e.company_id, e.vehicle_id, e.day, e.odometer, 'expense', e.id, auth.uid());
  else
    update public.fleet_odometer_readings set vehicle_id = e.vehicle_id, day = e.day, km = e.odometer, source = 'expense', updated_at = now()
    where id = v_reading;
  end if;
  delete from public.fleet_odometer_import_exceptions x where x.expense_id = e.id;
end
$$;
revoke execute on function public.fleet_sync_expense_reading(public.fleet_expenses) from public, anon, authenticated;

create function public.fleet_reading_json(r public.fleet_odometer_readings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id, 'vehicle_id', r.vehicle_id, 'day', r.day, 'km', r.km, 'source', r.source, 'ref_id', r.ref_id,
    'corrected_from', r.corrected_from, 'correction_reason', r.correction_reason,
    'created_by_name', (select p.name from public.profiles p where p.id = r.created_by),
    'created_at', r.created_at, 'updated_at', r.updated_at)
$$;
revoke execute on function public.fleet_reading_json(public.fleet_odometer_readings) from public, anon, authenticated;

-- ------------------------------------------------------------------ a reading typed in
-- vehicles.manage on any active vehicle; a driver on the vehicle assigned to them.
create function public.fleet_add_reading(p_company uuid, p_vehicle uuid, p_day date, p_km int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_cv public.company_vehicles%rowtype;
  v_row public.fleet_odometer_readings%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_add_reading');
  if v_seen is not null then
    return v_seen;
  end if;
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if public.company_read_only(p_company) then
    perform public.fail('fleet_read_only');
  end if;
  select * into v_cv from public.company_vehicles cv where cv.id = p_vehicle and cv.company_id = p_company for update;
  if not found then
    perform public.fail('vehicle_not_found');
  end if;
  if v_cv.archived_at is not null then
    perform public.fail('vehicle_archived');
  end if;
  if not (public.fleet_can(p_company, 'vehicles.manage') or v_cv.driver_member_id = public.my_member_id(p_company)) then
    perform public.fail('not_allowed');
  end if;
  if p_day is null or p_day > public.bucharest_today() or p_day < date '2000-01-01' then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'day'));
  end if;
  if p_km is null or p_km not between 0 and 2000000 then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'km'));
  end if;
  perform public.fleet_odometer_check(p_vehicle, p_day, p_km);
  insert into public.fleet_odometer_readings (company_id, vehicle_id, day, km, source, created_by)
  values (p_company, p_vehicle, p_day, p_km, 'manual', auth.uid())
  returning * into v_row;
  perform public.company_audit(p_company, 'odometer_added', 'odometer', v_row.id, null, public.fleet_reading_json(v_row));
  v_result := public.fleet_reading_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ------------------------------------------------------------------ a correction (vehicles.manage, with a reason)
-- A reading of an expense is corrected on the expense too (one value, two places, both logged).
create function public.fleet_correct_reading(p_reading uuid, p_km int, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.fleet_odometer_readings%rowtype;
  v_row public.fleet_odometer_readings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_expense public.fleet_expenses%rowtype;
  v_expense_after public.fleet_expenses%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_correct_reading');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_before from public.fleet_odometer_readings r where r.id = p_reading and r.deleted_at is null;
  if not found or public.company_role(v_before.company_id) is null then
    perform public.fail('reading_not_found');
  end if;
  -- The vehicle first (as every odometer write), then the reading.
  perform 1 from public.company_vehicles cv where cv.id = v_before.vehicle_id for update;
  select * into v_before from public.fleet_odometer_readings r where r.id = p_reading and r.deleted_at is null for update;
  if not found then
    perform public.fail('reading_not_found');
  end if;
  if not public.fleet_can(v_before.company_id, 'vehicles.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_before.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  if char_length(v_reason) not between 3 and 300 then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'reason'));
  end if;
  if p_km is null or p_km not between 0 and 2000000 or p_km = v_before.km then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'km'));
  end if;
  perform public.fleet_odometer_check(v_before.vehicle_id, v_before.day, p_km, v_before.id);
  update public.fleet_odometer_readings
  set km = p_km, corrected_from = v_before.km, correction_reason = v_reason, updated_at = now()
  where id = p_reading
  returning * into v_row;
  perform public.company_audit(v_row.company_id, 'odometer_corrected', 'odometer', v_row.id,
    public.fleet_reading_json(v_before), public.fleet_reading_json(v_row));
  if v_row.source in ('expense', 'import') then
    select * into v_expense from public.fleet_expenses e where e.id = v_row.ref_id for update;
    if found then
      update public.fleet_expenses set odometer = p_km, updated_at = now() where id = v_expense.id returning * into v_expense_after;
      perform public.company_audit(v_row.company_id, 'expense_updated', 'expense', v_expense.id,
        public.fleet_expense_json(v_expense), public.fleet_expense_json(v_expense_after) || jsonb_build_object('reason', v_reason));
    end if;
  end if;
  v_result := public.fleet_reading_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ------------------------------------------------------------------ a job's km left out (the booking is untouched)
create function public.fleet_ignore_job_odometer(p_booking uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_booking public.bookings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_ignore_job_odometer');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_booking from public.bookings b where b.id = p_booking;
  if not found or v_booking.company_id is null or public.company_role(v_booking.company_id) is null then
    perform public.fail('booking_not_found');
  end if;
  if not public.fleet_can(v_booking.company_id, 'vehicles.manage') then
    perform public.fail('not_allowed');
  end if;
  if public.company_read_only(v_booking.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  if v_booking.status <> 'done' or v_booking.odometer is null or v_booking.company_vehicle_id is null then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'booking'));
  end if;
  if char_length(v_reason) not between 3 and 300 then
    perform public.fail('reading_invalid', jsonb_build_object('field', 'reason'));
  end if;
  perform 1 from public.company_vehicles cv where cv.id = v_booking.company_vehicle_id for update;
  insert into public.fleet_odometer_ignored_jobs (booking_id, company_id, reason, by_user)
  values (v_booking.id, v_booking.company_id, v_reason, auth.uid())
  on conflict (booking_id) do nothing;
  perform public.company_audit(v_booking.company_id, 'odometer_job_ignored', 'booking', v_booking.id,
    jsonb_build_object('odometer', v_booking.odometer), jsonb_build_object('reason', v_reason));
  v_result := jsonb_build_object('booking_id', v_booking.id, 'reason', v_reason);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke execute on function public.fleet_add_reading(uuid, uuid, date, int, uuid), public.fleet_correct_reading(uuid, int, text, uuid),
  public.fleet_ignore_job_odometer(uuid, text, uuid) from public, anon;
grant execute on function public.fleet_add_reading(uuid, uuid, date, int, uuid), public.fleet_correct_reading(uuid, int, text, uuid),
  public.fleet_ignore_job_odometer(uuid, text, uuid) to authenticated;

-- ------------------------------------------------------------------ fuel statistics
-- For one vehicle the member sees. Consumption (l/100 km) only between two consecutive full-tank fills
-- with km; the liters of every fill after the first full tank up to the second (partial fills
-- included); one fill without liters makes that stretch unknown (`missing_liters`). Electric: not
-- supported. Fuel cost per km (costs.view only) only with two readings in the period.
create function public.fleet_fuel_stats(p_company uuid, p_vehicle uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cv public.company_vehicles%rowtype;
  v_money boolean;
  v_prev_km int;
  v_prev_day date;
  v_has_prev boolean := false;
  r record;
  v_liters numeric;
  v_missing boolean;
  v_segments jsonb := '[]'::jsonb;
  v_total_l numeric := 0;
  v_total_km int := 0;
  v_reasons text[] := '{}';
  v_electric boolean;
  v_cost numeric;
  v_km_min int;
  v_km_max int;
  v_points int;
begin
  perform public.require_fleet_client();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  select * into v_cv from public.company_vehicles cv where cv.id = p_vehicle and cv.company_id = p_company;
  if not found or not (public.fleet_can(p_company, 'vehicles.viewAll') or v_cv.driver_member_id = public.my_member_id(p_company)) then
    perform public.fail('vehicle_not_found');
  end if;
  if p_to is null or (p_from is not null and p_from > p_to) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'range'));
  end if;
  v_money := public.fleet_can(p_company, 'costs.view');

  select coalesce(bool_or(e.fuel_type = 'electric'), false) and coalesce(bool_and(e.fuel_type = 'electric' or e.fuel_type is null), false)
    into v_electric
  from public.fleet_expenses e
  where e.vehicle_id = p_vehicle and e.category = 'fuel' and e.deleted_at is null;
  if v_electric then
    return jsonb_build_object('status', 'not_supported', 'reasons', jsonb_build_array('electric'));
  end if;

  -- The fills in order; a stretch ends at each full tank with km after a full tank with km.
  v_liters := 0;
  v_missing := false;
  for r in
    select e.id, e.day, e.odometer, e.liters, coalesce(e.full_tank, false) full_tank
    from public.fleet_expenses e
    where e.vehicle_id = p_vehicle and e.category = 'fuel' and e.deleted_at is null and coalesce(e.fuel_type, '') <> 'electric'
      and e.day <= p_to
    order by e.day, e.odometer nulls last, e.created_at
  loop
    if v_has_prev then
      if r.liters is null then
        v_missing := true;
      else
        v_liters := v_liters + r.liters;
      end if;
    end if;
    if r.full_tank and r.odometer is not null then
      if v_has_prev and r.odometer > v_prev_km and (p_from is null or r.day >= p_from) then
        v_segments := v_segments || jsonb_build_array(jsonb_build_object(
          'from_day', v_prev_day, 'to_day', r.day, 'km', r.odometer - v_prev_km,
          'liters', case when v_missing then null else v_liters end,
          'l_per_100', case when v_missing then null else round(v_liters / (r.odometer - v_prev_km) * 100, 2) end,
          'reason', case when v_missing then 'missing_liters' end));
        if v_missing then
          v_reasons := array_append(v_reasons, 'missing_liters');
        else
          v_total_l := v_total_l + v_liters;
          v_total_km := v_total_km + (r.odometer - v_prev_km);
        end if;
      end if;
      v_prev_km := r.odometer;
      v_prev_day := r.day;
      v_has_prev := true;
      v_liters := 0;
      v_missing := false;
    end if;
  end loop;
  if jsonb_array_length(v_segments) = 0 then
    v_reasons := array_append(v_reasons, 'no_full_tanks');
  end if;

  -- Cost per km: the fuel paid in RON in the period, over the km between the lowest and the highest reading in it.
  select min(p.km), max(p.km), count(*) into v_km_min, v_km_max, v_points
  from public.fleet_odometer_points(p_vehicle) p where (p_from is null or p.day >= p_from) and p.day <= p_to;
  if v_money then
    select sum(e.amount) into v_cost from public.fleet_expenses e
    where e.vehicle_id = p_vehicle and e.category = 'fuel' and e.deleted_at is null and e.currency = 'RON'
      and (p_from is null or e.day >= p_from) and e.day <= p_to;
  end if;

  return jsonb_build_object(
    'status', case when v_total_km > 0 then 'ok' else 'insufficient_data' end,
    'consumption', case when v_total_km > 0 then round(v_total_l / v_total_km * 100, 2) end,
    'segments', v_segments,
    'reasons', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(v_reasons) x)),
    'km_in_range', case when v_points >= 2 and v_km_max > v_km_min then v_km_max - v_km_min end,
    'fuel_cost', case when v_money then v_cost end,
    'cost_per_km', case when v_money and v_points >= 2 and v_km_max > v_km_min and v_cost is not null
                        then round(v_cost / (v_km_max - v_km_min), 2) end);
end
$$;
revoke execute on function public.fleet_fuel_stats(uuid, uuid, date, date) from public, anon;
grant execute on function public.fleet_fuel_stats(uuid, uuid, date, date) to authenticated;

-- ------------------------------------------------------------------ the M1 functions, with the reading kept in step
create or replace function public.fleet_save_expense(p_company uuid, p_expense uuid, p_fields jsonb, p_request_id uuid)
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
    -- M2: its odometer reading (refused against the chronological rule).
    perform public.fleet_sync_expense_reading(v_row);
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
    perform public.fleet_sync_expense_reading(v_row);
  end if;

  v_result := public.fleet_expense_json(v_row);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create or replace function public.fleet_delete_expense(p_expense uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.fleet_expenses%rowtype;
  v_before public.fleet_expenses%rowtype;
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
  v_before := v_row;
  -- M2: the vehicle locked, as every odometer write.
  perform 1 from public.company_vehicles cv where cv.id = v_row.vehicle_id for update;
  update public.fleet_expenses set deleted_at = now() where id = p_expense returning * into v_row;
  -- M2: its reading goes with it (soft).
  perform public.fleet_sync_expense_reading(v_row);
  perform public.company_audit(v_row.company_id, 'expense_deleted', 'expense', v_row.id, public.fleet_expense_json(v_before), null);
  v_result := jsonb_build_object('id', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- ------------------------------------------------------------------ the space's one read: the odometer log added
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
  v_issues boolean;
  v_manage boolean;
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
  v_issues := v_all or public.fleet_can(p_company, 'issues.manage');
  v_manage := public.fleet_can(p_company, 'vehicles.manage');
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
    -- M3: issues and incidents; all for vehicles.viewAll / issues.manage, otherwise the member's own reports
    -- and those of the vehicles assigned to them.
    'issues', coalesce((
      select jsonb_agg(public.fleet_issue_json(i) order by i.created_at desc, i.id)
      from public.fleet_issues i
      where i.company_id = p_company
        and (v_issues or i.reported_by = auth.uid()
             or i.vehicle_id in (select cv.id from public.company_vehicles cv where cv.company_id = p_company and cv.driver_member_id = v_me))
    ), '[]'::jsonb),
    -- M2: the odometer log of the vehicles the member sees; the jobs whose km the company left out; the
    -- receipts the import could not take (vehicles.manage, who fixes them).
    'readings', coalesce((
      select jsonb_agg(public.fleet_reading_json(r) order by r.day desc, r.km desc, r.created_at desc)
      from public.fleet_odometer_readings r
      where r.company_id = p_company and r.deleted_at is null
        and (v_all or r.vehicle_id in (select cv.id from public.company_vehicles cv where cv.company_id = p_company and cv.driver_member_id = v_me))
    ), '[]'::jsonb),
    'ignored_jobs', coalesce((
      select jsonb_agg(jsonb_build_object('booking_id', g.booking_id, 'reason', g.reason, 'at', g.at) order by g.at)
      from public.fleet_odometer_ignored_jobs g where g.company_id = p_company and (v_all or v_bookings)
    ), '[]'::jsonb),
    'odometer_exceptions', case when v_manage then coalesce((
      select jsonb_agg(jsonb_build_object('expense_id', x.expense_id, 'vehicle_id', x.vehicle_id, 'day', x.day, 'km', x.km,
                                          'reasons', to_jsonb(x.reasons)) order by x.day desc)
      from public.fleet_odometer_import_exceptions x
      join public.fleet_expenses e on e.id = x.expense_id and e.deleted_at is null
      where e.company_id = p_company
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end
$$;

-- ------------------------------------------------------------------ the import of existing receipts
-- Each receipt with an odometer is compared with every other known km value of its vehicle (the
-- finished jobs and the other receipts). It becomes a reading only when nothing contradicts it and the
-- step from the value before it is at most 2,000 km a day; otherwise it is listed with the reasons
-- (`below_earlier`, `above_later`, `jump`). Both sides of a contradiction between two receipts are
-- listed. Receipts are never modified.
create function public.fleet_import_expense_readings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_imported int;
  v_listed int;
begin
  with pts as (
    select e.id, e.company_id, e.vehicle_id, e.day, e.odometer km, 'expense'::text kind
    from public.fleet_expenses e where e.odometer is not null and e.deleted_at is null
    union all
    select b.id, b.company_id, b.company_vehicle_id, coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date), b.odometer, 'job'
    from public.bookings b where b.company_vehicle_id is not null and b.status = 'done' and b.odometer is not null
  ),
  judged as (
    select p.*,
      array_remove(array[
        case when exists (select 1 from pts q where q.vehicle_id = p.vehicle_id and q.id <> p.id and q.day < p.day and q.km > p.km) then 'below_earlier' end,
        case when exists (select 1 from pts q where q.vehicle_id = p.vehicle_id and q.id <> p.id and q.day > p.day and q.km < p.km) then 'above_later' end,
        case when exists (
          select 1 from (select q.day, q.km from pts q where q.vehicle_id = p.vehicle_id and q.id <> p.id and q.day < p.day
                         order by q.day desc, q.km desc limit 1) prev
          where (p.km - prev.km)::numeric / (p.day - prev.day) > 2000) then 'jump' end
      ], null) reasons
    from pts p
    where p.kind = 'expense'
      -- Once only: a receipt already read or listed is left alone.
      and not exists (select 1 from public.fleet_odometer_readings r where r.ref_id = p.id)
      and not exists (select 1 from public.fleet_odometer_import_exceptions x where x.expense_id = p.id)
  ),
  ok as (
    insert into public.fleet_odometer_readings (company_id, vehicle_id, day, km, source, ref_id, created_by)
    select j.company_id, j.vehicle_id, j.day, j.km, 'import', j.id, null from judged j where cardinality(j.reasons) = 0
    returning 1
  ),
  bad as (
    insert into public.fleet_odometer_import_exceptions (expense_id, vehicle_id, day, km, reasons)
    select j.id, j.vehicle_id, j.day, j.km, j.reasons from judged j where cardinality(j.reasons) > 0
    returning 1
  )
  select (select count(*) from ok), (select count(*) from bad) into v_imported, v_listed;
  return jsonb_build_object('imported', v_imported, 'listed', v_listed);
end
$$;
revoke execute on function public.fleet_import_expense_readings() from public, anon, authenticated;

do $$
declare
  v jsonb := public.fleet_import_expense_readings();
begin
  raise notice 'M2 import: % receipt(s) became readings, % listed as exceptions', v->>'imported', v->>'listed';
end
$$;

update public.schema_version set version = 103;
