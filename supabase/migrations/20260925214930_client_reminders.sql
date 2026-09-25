-- Reminders for clients (T19d, ARCHITECTURE §9, §10):
-- · Review request: the day after a car is ready, around 10:00 Bucharest, one push "Cum a fost la
--   Atelier X? Lasă o recenzie" — once per booking (bookings.review_requested_at), only when no
--   review was left and the review window is still open. A tap opens the booking with the form.
-- · Service reminder: a catalog service may carry an interval in months (services.interval_months,
--   set by the admin; oil 12, brake fluid 24 …). About two weeks before the due date — the last
--   finished job of that service on that car + the interval — one push "Se apropie …" that leads to
--   booking the same service at the same shop. Once per job (bookings.service_reminded_at).
-- · Both can be turned off in Cont (profiles.review_requests, profiles.service_reminders).
-- Push only, no email. Both run from the hourly job at 10:xx Bucharest.

-- ---------------------------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------------------------
alter table public.services
  add column interval_months int check (interval_months between 1 and 120);

alter table public.bookings
  add column review_requested_at timestamptz,
  add column service_reminded_at timestamptz;

alter table public.profiles
  add column review_requests boolean not null default true,
  add column service_reminders boolean not null default true;

-- The client turns them on or off in Cont (own row, RLS as before).
grant update (review_requests, service_reminders) on public.profiles to authenticated;

-- Finished jobs still waiting for their review request.
create index bookings_review_request_idx on public.bookings (done_at)
  where status = 'done' and review_requested_at is null;
-- The last job of a service on a car.
create index bookings_car_service_idx on public.bookings (car_id, service_id, done_at desc)
  where car_id is not null;

-- The usual intervals; the admin changes them in Catalog. A full service includes the oil change,
-- so both get 12 months.
update public.services s set interval_months = v.months
from (values
  ('ulei', 12), ('revizie', 12), ('filtru_polen', 12), ('clima_ig', 12), ('pregatire_iarna', 12),
  ('revizie_gpl', 12), ('mobil_ulei', 12),
  ('filtru_aer', 24), ('filtru_comb', 24), ('lichid_frana', 24), ('clima', 24),
  ('bujii', 48), ('antigel', 48),
  ('distributie', 60)
) as v(id, months)
where s.id = v.id;

-- ---------------------------------------------------------------------------------------------
-- review_request: bookings finished on one of the last three days (Bucharest calendar, not
-- today), so a missed run is caught the next day; once per booking; not when a review exists,
-- the window is closed, or the client turned them off, is suspended or deleted the account.
-- ---------------------------------------------------------------------------------------------
create function public.send_review_requests(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_window int := public.app_limit('review_window_days', 60);
  v public.bookings%rowtype;
  v_n int := 0;
begin
  for v in
    select b.* from public.bookings b
    join public.profiles p on p.id = b.client_id
    where b.status = 'done' and b.review_requested_at is null
      and b.done_at >= (v_today - 3)::timestamp at time zone 'Europe/Bucharest'
      and b.done_at < v_today::timestamp at time zone 'Europe/Bucharest'
      and b.done_at > p_now - make_interval(days => v_window)
      and p.review_requests and not p.suspended and p.deleted_at is null
      and not exists (select 1 from public.reviews r where r.booking_id = b.id)
    order by b.done_at
    for no key update of b skip locked
  loop
    update public.bookings set review_requested_at = now() where id = v.id;
    perform public.notify_user(v.client_id, 'review_request', public.booking_event_params(v), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_review_requests(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- service_due: for each car in a garage and each service with an interval, the last finished job
-- of that service on that car. When its due date (job day + interval) is between today and 14
-- days from now, one reminder, recorded on that job; a newer job starts over. Not when the car
-- already has an active booking for that service, the service is switched off, or the client
-- turned them off. The car's current garage details are used (the reminder is about the car now).
-- ---------------------------------------------------------------------------------------------
create function public.send_service_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v public.bookings%rowtype;
  v_n int := 0;
begin
  for r in
    with last_jobs as (
      select distinct on (b.car_id, b.service_id)
             b.id, b.car_id, b.service_id, b.client_id,
             (b.done_at at time zone 'Europe/Bucharest')::date as done_day
      from public.bookings b
      where b.status = 'done' and b.car_id is not null and b.done_at is not null
        and b.done_at > (p_today - interval '121 months')::timestamp at time zone 'Europe/Bucharest'
      order by b.car_id, b.service_id, b.done_at desc
    )
    select j.id, j.car_id, j.client_id, j.done_day, s.interval_months,
           (j.done_day + make_interval(months => s.interval_months))::date as due_day,
           c.make, c.model, c.plate
    from last_jobs j
    join public.bookings b on b.id = j.id
    join public.services s on s.id = j.service_id and s.enabled and s.interval_months is not null
    join public.cars c on c.id = j.car_id and c.owner_id = j.client_id
    join public.profiles p on p.id = j.client_id
    where b.service_reminded_at is null
      and p.service_reminders and not p.suspended and p.deleted_at is null
      and (j.done_day + make_interval(months => s.interval_months))::date between p_today and p_today + 14
      and not exists (select 1 from public.bookings a
                      where a.car_id = j.car_id and a.service_id = j.service_id
                        and public.is_active_status(a.status))
  loop
    update public.bookings set service_reminded_at = now()
    where id = r.id and service_reminded_at is null
    returning * into v;
    continue when not found;
    perform public.notify_user(r.client_id, 'service_due', public.booking_event_params(v) || jsonb_build_object(
      'car_id', r.car_id, 'make', r.make, 'model', r.model, 'plate', r.plate,
      'last_date', r.done_day, 'due_date', r.due_day, 'months', r.interval_months), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_service_reminders(date) from public, anon, authenticated;

-- Every hour (as in 20260925044007_subscription.sql), plus at 10:xx Bucharest the review requests
-- and the service reminders.
create or replace function public.run_hourly_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_result jsonb;
begin
  v_result := jsonb_build_object(
    'appointment_reminders', public.send_appointment_reminders(p_now),
    'digests', public.send_daily_digests(p_now),
    'trials_ended', public.end_expired_trials(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date));
  end if;
  return v_result;
end
$$;
revoke execute on function public.run_hourly_jobs(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Admin: the catalog (as in 20260925120213_admin_tools.sql) with each service's interval, and the
-- interval set on its own (p_months null or left out = no reminder).
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'key', c.key,
        'name_ro', c.name_ro,
        'name_en', c.name_en,
        'position', c.position,
        'enabled', c.enabled,
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', sv.id,
              'category_key', sv.category_key,
              'icon', sv.icon,
              'name_ro', sv.name_ro,
              'name_en', sv.name_en,
              'position', sv.position,
              'enabled', sv.enabled,
              'interval_months', sv.interval_months,
              'shops', (select count(*) from public.shop_services ss where ss.service_id = sv.id),
              'bookings', (select count(*) from public.bookings b where b.service_id = sv.id)
            ) order by sv.position, sv.id)
          from public.services sv where sv.category_key = c.key), '[]'::jsonb)
      ) order by c.position, c.key)
    from public.service_categories c
  ), '[]'::jsonb);
end
$$;

create function public.admin_set_service_interval(p_id text, p_request_id uuid, p_months int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old public.services%rowtype;
  v public.services%rowtype;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_service_interval');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_months is not null and p_months not between 1 and 120 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'interval_months'));
  end if;
  select * into v_old from public.services where id = p_id for update;
  if not found then
    perform public.fail('service_not_found');
  end if;
  update public.services set interval_months = p_months where id = p_id returning * into v;
  if v.interval_months is distinct from v_old.interval_months then
    perform public.admin_audit_key('update_service', 'service', v.id,
      jsonb_build_object('interval_months', v_old.interval_months),
      jsonb_build_object('interval_months', v.interval_months));
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v));
  return to_jsonb(v);
end
$$;
revoke execute on function public.admin_set_service_interval(text, uuid, int) from public, anon;
grant execute on function public.admin_set_service_interval(text, uuid, int) to authenticated;

update public.schema_version set version = 29;
