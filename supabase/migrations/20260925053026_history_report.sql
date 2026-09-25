-- T15 — The paid vehicle history report. ARCHITECTURE §7, §11, §12, §13; FR §3.6b; P16e.
--
-- · A report is about one car of one client: the client's own finished (`done`) jobs on that car,
--   matched like the vehicle history screen does (vehicle_key: the plate without spaces or case;
--   without a plate, make + model + year — src/lib/history.ts vehicleKey).
-- · history_report_preview (browser): what the report will hold, before paying.
-- · begin_history_report (report-checkout, service role): a `pending_payment` row with the car,
--   the jobs as they are now and the price from platform_settings; the Edge Function opens a
--   Stripe Checkout for it.
-- · mark_history_report_paid (stripe-webhook, service role): only the verified webhook marks a
--   report paid; the jobs are taken again at that moment and kept in the row (`jobs`), so the PDF
--   is a fixed snapshot and generating it again gives the same document.
-- · finish_history_report (after the PDF is stored): `generated`, and the client is told
--   (report_ready, push + email).
-- · verify_report (anyone, signed out too): only the car, the job count, the period, the date
--   and whether it is void — never shops, amounts, work or people.
-- · Reports outlive the account (client_id set null), so a buyer can still verify one after the
--   seller deleted the account. The PDF holds no personal data of the client.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.history_reports
  add column vehicle_key text,
  add column lang text not null default 'ro' check (lang in ('ro', 'en')),
  add column price numeric(10,2) not null default 0 check (price >= 0),
  -- The jobs printed in the PDF: taken when the checkout starts, then again at payment.
  add column jobs jsonb not null default '[]'::jsonb,
  -- The tap that started the checkout: the same request id gives the same report.
  add column request_id uuid unique;

alter table public.history_reports drop constraint history_reports_client_id_fkey;
alter table public.history_reports
  add constraint history_reports_client_id_fkey
  foreign key (client_id) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Which car, which jobs
-- ---------------------------------------------------------------------------------------------

-- The car a booking or a garage row describes (mirror of vehicleKey in src/lib/history.ts):
-- `plate:BV12ABC`, or for a car without a plate `car:dacia|logan|2015`.
create function public.vehicle_key(p_car jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(upper(coalesce(p_car->>'plate', '')), '[^A-Z0-9]', '', 'g') <> ''
      then 'plate:' || regexp_replace(upper(coalesce(p_car->>'plate', '')), '[^A-Z0-9]', '', 'g')
    else 'car:' || lower(regexp_replace(btrim(coalesce(p_car->>'make', '')), '\s+', ' ', 'g'))
      || '|' || lower(regexp_replace(btrim(coalesce(p_car->>'model', '')), '\s+', ' ', 'g'))
      || '|' || coalesce(p_car->>'year', '')
  end
$$;

-- The client's finished jobs on one car, newest first: the day it was finished (Bucharest), the
-- shop, the service, the accepted quote lines, the work, the odometer and the amount.
create function public.report_jobs(p_client_id uuid, p_vehicle_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(j.job order by j.sort_at desc, j.id), '[]'::jsonb)
  from (
    select b.id,
           coalesce(b.done_at, (b.date + b.slot) at time zone 'Europe/Bucharest') as sort_at,
           jsonb_build_object(
             'id', b.id,
             'ref', b.ref,
             'date', coalesce((b.done_at at time zone 'Europe/Bucharest')::date, b.date),
             'shop_name', s.name,
             'shop_city', s.city,
             'service_id', b.service_id,
             'service_ro', sv.name_ro,
             'service_en', sv.name_en,
             'items', coalesce((
               select jsonb_agg(qi.name order by qi.position)
               from public.quote_items qi
               where qi.quote_id = (
                 select q.id from public.quotes q
                 where q.booking_id = b.id and q.status in ('accepted', 'partially_accepted')
                 order by q.version desc limit 1)
                 and qi.approved), '[]'::jsonb),
             'work', nullif(btrim(b.work), ''),
             'odometer', b.odometer,
             'cost', b.cost
           ) as job
    from public.bookings b
    left join public.shops s on s.id = b.shop_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = p_client_id
      and b.status = 'done'
      and public.vehicle_key(b.car_snapshot) = p_vehicle_key
  ) j
$$;

-- What the report says about a list of jobs (newest first): how many, the total, the first and
-- last day, the odometer of the newest job that has one, and whether the readings go down at
-- some point when read oldest to newest (the report then says so; nothing is re-sorted).
create function public.report_facts(p_jobs jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_job jsonb;
  v_km int;
  v_max int;
  v_out boolean := false;
  v_latest int;
  v_total numeric := 0;
  v_count int := coalesce(jsonb_array_length(p_jobs), 0);
begin
  for v_job in select value from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) with ordinality e(value, n) order by n desc
  loop
    v_total := v_total + coalesce((v_job->>'cost')::numeric, 0);
    v_km := (v_job->>'odometer')::int;
    if v_km is not null then
      if v_max is not null and v_km < v_max then
        v_out := true;
      end if;
      v_max := greatest(coalesce(v_max, v_km), v_km);
      v_latest := v_km;
    end if;
  end loop;
  return jsonb_build_object(
    'job_count', v_count,
    'total', round(v_total, 2),
    'period_from', (select min((j->>'date')::date) from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j),
    'period_to', (select max((j->>'date')::date) from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) j),
    'latest_odometer', v_latest,
    'odometer_out_of_order', v_out);
end
$$;

-- The car a report is for: a garage car of the client, or the car of one of the client's
-- bookings (also a car no longer in the garage; the garage row wins when there is one, since it
-- may know the VIN). Answers { key, car_id, car: {make, model, year, plate, vin} }.
create function public.report_vehicle(p_client_id uuid, p_car_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_car public.cars%rowtype;
  v_snapshot jsonb;
  v_key text;
begin
  if p_car_id is not null then
    select * into v_car from public.cars where id = p_car_id and owner_id = p_client_id;
    if not found then
      perform public.fail('car_not_found');
    end if;
    v_key := public.vehicle_key(to_jsonb(v_car));
  elsif p_booking_id is not null then
    select car_snapshot into v_snapshot from public.bookings where id = p_booking_id and client_id = p_client_id;
    if not found then
      perform public.fail('booking_not_found');
    end if;
    v_key := public.vehicle_key(v_snapshot);
    select * into v_car from public.cars c
    where c.owner_id = p_client_id and public.vehicle_key(to_jsonb(c)) = v_key
    order by c.created_at, c.id limit 1;
  else
    perform public.fail('car_not_found');
  end if;

  if v_car.id is not null then
    v_snapshot := jsonb_build_object('make', v_car.make, 'model', v_car.model, 'year', v_car.year,
                                     'plate', v_car.plate, 'vin', v_car.vin);
  else
    v_snapshot := jsonb_build_object('make', v_snapshot->>'make', 'model', v_snapshot->>'model',
                                     'year', (v_snapshot->>'year')::int, 'plate', v_snapshot->>'plate',
                                     'vin', v_snapshot->>'vin');
  end if;
  return jsonb_build_object('key', v_key, 'car_id', v_car.id, 'car', v_snapshot);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Browser: the preview before paying (clients only, their own cars)
-- ---------------------------------------------------------------------------------------------
create function public.history_report_preview(p_car_id uuid default null, p_booking_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_vehicle jsonb;
  v_jobs jsonb;
begin
  v_me := public.require_caller();
  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  v_vehicle := public.report_vehicle(v_me.id, p_car_id, p_booking_id);
  v_jobs := public.report_jobs(v_me.id, v_vehicle->>'key');
  return jsonb_build_object(
    'car_id', v_vehicle->'car_id',
    'car', v_vehicle->'car',
    'jobs', v_jobs,
    'facts', public.report_facts(v_jobs),
    'price', (select report_price_ron from public.platform_settings where id = 1));
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Edge Functions (service role only)
-- ---------------------------------------------------------------------------------------------

-- report-checkout: the report a checkout is for. The same request id answers the same report.
-- Refuses not_allowed (not a client), account_suspended, car_not_found / booking_not_found,
-- no_jobs (never a report for a car without finished jobs), nothing_to_pay (price 0).
create function public.begin_history_report(p_user_id uuid, p_car_id uuid, p_booking_id uuid, p_lang text,
                                            p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_row public.history_reports%rowtype;
  v_vehicle jsonb;
  v_jobs jsonb;
  v_facts jsonb;
  v_price numeric;
begin
  select * into v_me from public.profiles where id = p_user_id;
  if not found or v_me.role <> 'client' or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  if v_me.suspended then
    perform public.fail('account_suspended');
  end if;
  if p_request_id is null then
    perform public.fail('request_id_required');
  end if;

  select * into v_row from public.history_reports where request_id = p_request_id;
  if found then
    if v_row.client_id is distinct from p_user_id then
      perform public.fail('request_id_reused');
    end if;
  else
    v_vehicle := public.report_vehicle(p_user_id, p_car_id, p_booking_id);
    v_jobs := public.report_jobs(p_user_id, v_vehicle->>'key');
    if jsonb_array_length(v_jobs) = 0 then
      perform public.fail('no_jobs');
    end if;
    select report_price_ron into v_price from public.platform_settings where id = 1;
    if coalesce(v_price, 0) <= 0 then
      perform public.fail('nothing_to_pay');
    end if;
    v_facts := public.report_facts(v_jobs);
    insert into public.history_reports (client_id, car_id, car_snapshot, vehicle_key, lang, price, jobs,
                                        job_count, total_amount, period_from, period_to, latest_odometer,
                                        odometer_out_of_order, request_id)
    values (p_user_id, (v_vehicle->>'car_id')::uuid, v_vehicle->'car', v_vehicle->>'key',
            case when p_lang in ('ro', 'en') then p_lang else coalesce(v_me.lang, 'ro') end,
            v_price, v_jobs, (v_facts->>'job_count')::int, (v_facts->>'total')::numeric,
            (v_facts->>'period_from')::date, (v_facts->>'period_to')::date,
            (v_facts->>'latest_odometer')::int, (v_facts->>'odometer_out_of_order')::boolean, p_request_id)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'code', v_row.code,
    'status', v_row.status,
    'price', v_row.price,
    'lang', v_row.lang,
    'car', v_row.car_snapshot,
    'car_id', v_row.car_id,
    'stripe_session_id', v_row.stripe_session_id,
    'display_id', v_me.display_id,
    'email', (select u.email from auth.users u where u.id = p_user_id));
end
$$;

-- The Checkout session made for a report (the first one stays).
create function public.set_history_report_session(p_report_id uuid, p_session_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.history_reports set stripe_session_id = p_session_id
  where id = p_report_id and stripe_session_id is null
$$;

-- stripe-webhook, on a paid Checkout for a report: `paid`, with what Stripe says was paid, and
-- the jobs taken again now (a job finished since the preview is included). A report already
-- paid, generated or void is answered as it is. Answers the row, or null for an unknown report.
create function public.mark_history_report_paid(p_report_id uuid, p_session_id text, p_amount numeric,
                                                p_paid_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.history_reports%rowtype;
  v_jobs jsonb;
  v_facts jsonb;
begin
  select * into v from public.history_reports where id = p_report_id for update;
  if not found then
    return null;
  end if;
  if v.status <> 'pending_payment' then
    return to_jsonb(v);
  end if;

  v_jobs := v.jobs;
  if v.client_id is not null then
    v_jobs := public.report_jobs(v.client_id, v.vehicle_key);
    if jsonb_array_length(v_jobs) = 0 then
      v_jobs := v.jobs;
    end if;
  end if;
  v_facts := public.report_facts(v_jobs);

  update public.history_reports
    set status = 'paid',
        paid_at = coalesce(p_paid_at, now()),
        amount_paid = round(greatest(coalesce(p_amount, price), 0), 2),
        stripe_session_id = coalesce(stripe_session_id, p_session_id),
        jobs = v_jobs,
        job_count = (v_facts->>'job_count')::int,
        total_amount = (v_facts->>'total')::numeric,
        period_from = (v_facts->>'period_from')::date,
        period_to = (v_facts->>'period_to')::date,
        latest_odometer = (v_facts->>'latest_odometer')::int,
        odometer_out_of_order = (v_facts->>'odometer_out_of_order')::boolean
  where id = p_report_id
  returning * into v;
  return to_jsonb(v);
end
$$;

-- The PDF is stored: `generated` at the time printed in it, and the client is told once (push +
-- email).
create function public.finish_history_report(p_report_id uuid, p_path text, p_generated_at timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.history_reports%rowtype;
begin
  update public.history_reports
    set status = 'generated', pdf_url = p_path, generated_at = coalesce(p_generated_at, now())
  where id = p_report_id and status = 'paid'
  returning * into v;
  if not found then
    return false;
  end if;
  perform public.notify_user(v.client_id, 'report_ready', jsonb_build_object(
    'report_id', v.id,
    'code', v.code,
    'make', v.car_snapshot->>'make',
    'model', v.car_snapshot->>'model',
    'plate', v.car_snapshot->>'plate'), null, array['push', 'email']);
  return true;
end
$$;

-- report-download / generate-report: the caller's own report (admin: any). Refuses not_found,
-- report_void (the client no longer gets a void report; admin still does).
create function public.history_report_for(p_user_id uuid, p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.history_reports%rowtype;
  v_admin boolean := exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin');
begin
  select * into v from public.history_reports
  where id = p_report_id and (client_id = p_user_id or v_admin);
  if not found then
    perform public.fail('not_found');
  end if;
  if v.status = 'void' and not v_admin then
    perform public.fail('report_void');
  end if;
  return to_jsonb(v);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- /verifica (anyone): is this code a real report? Accepts `sh-2026-000147`, `SH 2026 000147`,
-- `SH2026000147`. Only reports that were generated exist here.
-- ---------------------------------------------------------------------------------------------
create function public.verify_report(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  v_code text;
  v public.history_reports%rowtype;
begin
  if v_digits !~ '^SH[0-9]{10}$' then
    return jsonb_build_object('found', false);
  end if;
  v_code := 'SH-' || substr(v_digits, 3, 4) || '-' || substr(v_digits, 7, 6);
  select * into v from public.history_reports
  where code = v_code and status in ('generated', 'void');
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'code', v.code,
    'make', v.car_snapshot->>'make',
    'model', v.car_snapshot->>'model',
    'plate', v.car_snapshot->>'plate',
    'job_count', v.job_count,
    'period_from', v.period_from,
    'period_to', v.period_to,
    'generated_at', v.generated_at,
    'void', v.status = 'void');
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Realtime: "Rapoartele mele" turns to "Descarcă" by itself (RLS: the client's own rows).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'history_reports'
  ) then
    alter publication supabase_realtime add table public.history_reports;
  end if;
end
$$;

revoke execute on function
  public.vehicle_key(jsonb),
  public.report_jobs(uuid, text),
  public.report_facts(jsonb),
  public.report_vehicle(uuid, uuid, uuid),
  public.history_report_preview(uuid, uuid),
  public.begin_history_report(uuid, uuid, uuid, text, uuid),
  public.set_history_report_session(uuid, text),
  public.mark_history_report_paid(uuid, text, numeric, timestamptz),
  public.finish_history_report(uuid, text, timestamptz),
  public.history_report_for(uuid, uuid),
  public.verify_report(text)
from public, anon, authenticated;
grant execute on function public.history_report_preview(uuid, uuid) to authenticated;
grant execute on function public.verify_report(text) to anon, authenticated;
grant execute on function
  public.begin_history_report(uuid, uuid, uuid, text, uuid),
  public.set_history_report_session(uuid, text),
  public.mark_history_report_paid(uuid, text, numeric, timestamptz),
  public.finish_history_report(uuid, text, timestamptz),
  public.history_report_for(uuid, uuid),
  public.verify_report(text)
to service_role;

update public.schema_version set version = 20;
