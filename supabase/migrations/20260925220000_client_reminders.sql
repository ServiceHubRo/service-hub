-- T19d — reminders for clients, both push only:
-- 1. Review request: the day after a job is finished (in the morning, 10:00 in Bucharest), once per
--    booking, only when the client has not reviewed it and can still review it.
-- 2. Service reminder: a catalog service may have an interval in months (services.reminder_months,
--    set by the admin). About two weeks before the interval ends since the last finished job of
--    that service on a car, the client is told, once per job; a tap opens the booking at the same
--    shop with the service chosen. Only for a car still in the client's garage, without an active
--    booking for that service already, and when the client has not turned them off in Cont
--    (profiles.service_reminders).
-- client_reminders keeps what was sent (server only), so nothing goes out twice.

alter table public.services
  add column reminder_months int check (reminder_months between 1 and 120);

-- The catalog's usual intervals (the admin changes them in Catalog).
update public.services set reminder_months = v.months
from (values ('ulei', 12), ('revizie', 12), ('filtru_aer', 12), ('filtru_polen', 12), ('filtru_comb', 24),
             ('bujii', 36), ('lichid_frana', 24), ('antigel', 36), ('distributie', 60), ('clima', 24),
             ('clima_ig', 12), ('anvelope', 6), ('revizie_gpl', 12), ('pregatire_iarna', 12)) v(id, months)
where services.id = v.id;

alter table public.profiles
  add column service_reminders boolean not null default true;
grant update (service_reminders) on public.profiles to authenticated;

create table public.client_reminders (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  kind text not null check (kind in ('review', 'service')),
  sent_at timestamptz not null default now(),
  primary key (booking_id, kind)
);
alter table public.client_reminders enable row level security;
-- No policies and no grants: written and read only by the jobs below.

-- ---------------------------------------------------------------------------------------------
-- 1. Review request
-- ---------------------------------------------------------------------------------------------
-- Jobs finished on one of the last three days before today (Bucharest; three, so a missed run
-- catches up), not reviewed, inside the review window, not asked yet.
create function public.send_review_requests(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_window int := coalesce((select (ps.limits->>'review_window_days')::int from public.platform_settings ps where ps.id = 1), 60);
  b public.bookings%rowtype;
  v_n int := 0;
begin
  for b in
    select bk.* from public.bookings bk
    join public.profiles p on p.id = bk.client_id
    where bk.status = 'done'
      and bk.done_at is not null
      and (bk.done_at at time zone 'Europe/Bucharest')::date between v_today - 3 and v_today - 1
      and bk.done_at > p_now - make_interval(days => v_window)
      and p.deleted_at is null
      and not exists (select 1 from public.reviews r where r.booking_id = bk.id)
      and not exists (select 1 from public.client_reminders cr where cr.booking_id = bk.id and cr.kind = 'review')
    order by bk.done_at
  loop
    insert into public.client_reminders (booking_id, kind) values (b.id, 'review') on conflict do nothing;
    if found then
      perform public.notify_user(b.client_id, 'review_request', public.booking_event_params(b), b.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_review_requests(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Service reminder
-- ---------------------------------------------------------------------------------------------
-- For every car in a garage, the newest finished job of each service with an interval; due when
-- that job's day plus the interval is at most 14 days away (and not more than 30 days past, so
-- old history does not wake up at once).
create function public.send_service_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct on (bk.client_id, bk.car_id, bk.service_id)
           bk.*, sv.reminder_months,
           (bk.done_at at time zone 'Europe/Bucharest')::date as done_day
    from public.bookings bk
    join public.services sv on sv.id = bk.service_id and sv.reminder_months is not null
    join public.cars c on c.id = bk.car_id and c.owner_id = bk.client_id
    join public.profiles p on p.id = bk.client_id and p.deleted_at is null and p.service_reminders
    where bk.status = 'done' and bk.done_at is not null
    order by bk.client_id, bk.car_id, bk.service_id, bk.done_at desc
  loop
    continue when (r.done_day + make_interval(months => r.reminder_months))::date - 14 > p_today;
    continue when (r.done_day + make_interval(months => r.reminder_months))::date + 30 < p_today;
    -- Already booked for it: nothing to remind.
    continue when exists (
      select 1 from public.bookings a
      where a.client_id = r.client_id and a.car_id = r.car_id and a.service_id = r.service_id
        and a.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress'));
    insert into public.client_reminders (booking_id, kind) values (r.id, 'service') on conflict do nothing;
    continue when not found;
    perform public.notify_user(r.client_id, 'service_due', jsonb_build_object(
      'booking_id', r.id, 'shop_id', r.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = r.shop_id),
      'service_id', r.service_id, 'car_id', r.car_id,
      'make', r.car_snapshot->>'make', 'model', r.car_snapshot->>'model', 'plate', r.car_snapshot->>'plate',
      'last_done', r.done_day,
      'due', (r.done_day + make_interval(months => r.reminder_months))::date), r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_service_reminders(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The hourly job (as in 20260925044007_subscription.sql): both reminders at 10:00 in Bucharest.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- Catalog (admin): the interval of a service.
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
              'reminder_months', sv.reminder_months,
              'shops', (select count(*) from public.shop_services ss where ss.service_id = sv.id),
              'bookings', (select count(*) from public.bookings b where b.service_id = sv.id)
            ) order by sv.position, sv.id)
          from public.services sv where sv.category_key = c.key), '[]'::jsonb)
      ) order by c.position, c.key)
    from public.service_categories c
  ), '[]'::jsonb);
end
$$;

-- 1–120 months, or null for no reminder. Audited.
create function public.admin_set_service_reminder(p_id text, p_months int, p_request_id uuid)
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
  v_seen := public.request_begin(p_request_id, 'admin_set_service_reminder');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_months is not null and (p_months < 1 or p_months > 120) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'reminder_months'));
  end if;
  select * into v_old from public.services where id = p_id for update;
  if not found then
    perform public.fail('service_not_found');
  end if;
  update public.services set reminder_months = p_months where id = p_id returning * into v;
  if v.reminder_months is distinct from v_old.reminder_months then
    perform public.admin_audit_key('update_service', 'service', v.id,
      jsonb_build_object('reminder_months', v_old.reminder_months), jsonb_build_object('reminder_months', v.reminder_months));
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v));
  return to_jsonb(v);
end
$$;
revoke execute on function public.admin_set_service_reminder(text, int, uuid) from public, anon;
grant execute on function public.admin_set_service_reminder(text, int, uuid) to authenticated;

update public.schema_version set version = 29;
