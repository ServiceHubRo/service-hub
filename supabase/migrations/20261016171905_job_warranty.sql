-- T37a — The warranty on a job (Eduard, 16 Oct 2026). ARCHITECTURE §5, §12.
--
-- · At "Finalizare" the shop may give the work a warranty of 1–60 months (complete_job
--   p_warranty_months). The booking keeps the months and the last day it covers (Bucharest).
-- · The client sees it on the finished booking, in the car's history and in the history report;
--   the shop in Istoric.
-- · 30 days before it ends the client is told once (push, `warranty_ending`, quiet hours), when
--   the service reminders are on in Cont.

alter table public.bookings
  add column warranty_months smallint check (warranty_months between 1 and 60),
  add column warranty_until date,
  add constraint bookings_warranty_both check ((warranty_months is null) = (warranty_until is null));

-- The warranty reminder is kept like the review and service ones: once per booking.
alter table public.client_reminders drop constraint client_reminders_kind_check;
alter table public.client_reminders
  add constraint client_reminders_kind_check check (kind in ('review', 'service', 'warranty'));

-- ---------------------------------------------------------------------------------------------
-- complete_job takes the warranty (p_warranty_months).
-- ---------------------------------------------------------------------------------------------
drop function public.complete_job(uuid, int, uuid, text, numeric, boolean);

create function public.complete_job(
  p_booking_id uuid,
  p_odometer int,
  p_request_id uuid,
  p_work text default null,
  p_cost numeric default null,
  p_confirm_jump boolean default false,
  p_warranty_months int default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_last int;
  v_work text := nullif(btrim(p_work), '');
  v_cost numeric := p_cost;
  v_quote public.quotes%rowtype;
  v_until date;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'complete_job');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'in_progress');

  if p_odometer is null then
    perform public.fail('odometer_required');
  end if;
  if p_odometer < 100 or p_odometer > 2000000 then
    perform public.fail('odometer_invalid');
  end if;
  v_last := public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
  if v_last is not null and p_odometer < v_last then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_last));
  end if;
  if v_last is not null and p_odometer - v_last > 50000 and not coalesce(p_confirm_jump, false) then
    perform public.fail('odometer_jump', jsonb_build_object('previous', v_last, 'diff', p_odometer - v_last));
  end if;
  -- The same reading as a job on another day: the car was driven in between, so it is probably
  -- the old number typed again. The shop reads the dashboard again and confirms (p_confirm_jump).
  if v_last is not null and p_odometer = v_last and not coalesce(p_confirm_jump, false) and exists (
    select 1 from public.bookings b
    where b.car_snapshot->>'plate_norm' = v.car_snapshot->>'plate_norm'
      and b.status = 'done' and b.odometer = v_last
      and (b.done_at at time zone 'Europe/Bucharest')::date <> (now() at time zone 'Europe/Bucharest')::date
  ) then
    perform public.fail('odometer_same', jsonb_build_object('previous', v_last));
  end if;

  if char_length(v_work) > 4000 then
    perform public.fail('work_too_long');
  end if;
  if v_cost is not null and (v_cost < 0 or v_cost > 1000000 or v_cost <> round(v_cost, 2)) then
    perform public.fail('cost_invalid');
  end if;
  -- The warranty the shop gives on the work: 1–60 months from today (Bucharest), or none.
  if p_warranty_months is not null then
    if p_warranty_months < 1 or p_warranty_months > 60 then
      perform public.fail('warranty_invalid');
    end if;
    v_until := ((now() at time zone 'Europe/Bucharest')::date + make_interval(months => p_warranty_months))::date;
  end if;

  select * into v_quote from public.quotes
  where booking_id = v.id and status in ('accepted', 'partially_accepted')
  order by version desc limit 1;
  if v_work is null and v_quote.id is not null then
    select string_agg(qi.name, ', ' order by qi.position) into v_work
    from public.quote_items qi where qi.quote_id = v_quote.id and qi.approved;
  end if;
  if v_cost is null then
    v_cost := v_quote.total_approved;
  end if;

  update public.bookings
    set status = 'done', done_at = now(), odometer = p_odometer, work = left(v_work, 4000), cost = v_cost,
        warranty_months = p_warranty_months, warranty_until = v_until
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'job_done', 'shop', jsonb_build_object('odometer', v.odometer, 'cost', v.cost, 'warranty_months', v.warranty_months));
  perform public.notify_user(v.client_id, 'job_done',
    public.booking_event_params(v) || jsonb_build_object('odometer', v.odometer, 'cost', v.cost), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;
revoke execute on function public.complete_job(uuid, int, uuid, text, numeric, boolean, int) from public, anon;
grant execute on function public.complete_job(uuid, int, uuid, text, numeric, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The reminder: 30 days before the warranty ends, once, to a client who keeps the reminders on.
-- ---------------------------------------------------------------------------------------------
create function public.send_warranty_reminders(p_today date default public.bucharest_today())
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
    select b.id, b.client_id, b.car_id, b.shop_id, b.car_snapshot, b.warranty_months, b.warranty_until,
           b.service_id, b.extra_service_ids, s.name as shop_name
    from public.bookings b
    join public.shops s on s.id = b.shop_id
    join public.profiles p on p.id = b.client_id and p.deleted_at is null and p.service_reminders and not p.suspended
    where b.status = 'done' and b.warranty_until is not null
      and b.warranty_until >= p_today and b.warranty_until - 30 <= p_today
  loop
    insert into public.client_reminders (booking_id, kind, service_id) values (r.id, 'warranty', '')
      on conflict do nothing;
    continue when not found;
    perform public.notify_user(r.client_id, 'warranty_ending', jsonb_build_object(
      'booking_id', r.id, 'shop_id', r.shop_id, 'shop_name', r.shop_name, 'car_id', r.car_id,
      'make', r.car_snapshot->>'make', 'model', r.car_snapshot->>'model', 'plate', r.car_snapshot->>'plate',
      'service_ro', public.services_label(r.service_id, r.extra_service_ids, 'ro'),
      'service_en', public.services_label(r.service_id, r.extra_service_ids, 'en'),
      'months', r.warranty_months, 'until', r.warranty_until), r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_warranty_reminders(date) from public, anon, authenticated;

-- Every morning at 10 (Bucharest), with the other client reminders.
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
    'trials_ended', public.end_expired_trials(p_now),
    'area_launches', public.notify_area_launches(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  -- The month's ANAF checks and the companies due again (verify-company, in the background), then
  -- an hour later the shops whose company stayed unconfirmed past the deadline leave the search.
  if extract(hour from v_local) = 6 then
    v_result := v_result || jsonb_build_object('company_checks', public.kick_company_checks());
  end if;
  if extract(hour from v_local) = 8 then
    v_result := v_result || jsonb_build_object(
      'company_hidden', public.enforce_company_deadlines(p_now),
      'admin_digest', public.send_admin_digest(p_now));
  end if;
  -- Every morning, the requests still waiting for an answer (Eduard, 3 oct).
  if extract(hour from v_local) = 9 then
    v_result := v_result || jsonb_build_object('requests_daily', public.send_request_daily_reminders(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date),
      'warranty_reminders', public.send_warranty_reminders(v_local::date),
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now),
      'booking_followups', public.send_booking_followups(p_now),
      'bookings_closed', public.close_stale_bookings(p_now));
  end if;
  return v_result;
end
$$;

create or replace function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report', 'company_problem', 'company_name_mismatch', 'company_hidden', 'company_ok',
    'request_expired', 'booking_followup', 'booking_auto_closed', 'booking_request_last_call', 'area_launched',
    'report_credit', 'warranty_ending')
$$;

-- The history report and the shop's Istoric carry the warranty.
create or replace function public.report_jobs(p_client_id uuid, p_vehicle_key text)
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
             'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
             'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
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
             'cost', b.cost,
             'warranty_months', b.warranty_months,
             'warranty_until', b.warranty_until
           ) as job
    from public.bookings b
    left join public.shops s on s.id = b.shop_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = p_client_id
      and b.status = 'done'
      and public.vehicle_key(b.car_snapshot) = p_vehicle_key
  ) j
$$;

create or replace function public.list_shop_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
begin
  perform public.require_reader();
  select * into v_shop from public.shops where id = public.require_my_shop();

  return jsonb_build_object(
    'shop', jsonb_build_object('id', v_shop.id, 'name', v_shop.name),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'date', b.date,
          'slot', to_char(b.slot, 'HH24:MI'),
          'note', b.note,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'service_icon', s.icon,
          'extra_services', public.service_names(b.extra_service_ids),
          'client_name', b.client_name,
          'client_phone', b.client_phone,
          'has_client', b.client_id is not null,
          'car_snapshot', b.car_snapshot,
          'odometer', b.odometer,
          'work', b.work,
          'warranty_months', b.warranty_months,
          'warranty_until', b.warranty_until,
          'cost', b.cost,
          'done_at', b.done_at,
          'cancelled_by', b.cancelled_by,
          'cancel_reason', b.cancel_reason,
          'closed_reason', b.closed_reason,
          'ended_at', e.ended_at,
          'quote', q.quote
        ) order by e.ended_at desc, b.id)
      from public.bookings b
      cross join lateral (select coalesce(b.done_at, b.cancelled_at, b.status_changed_at) as ended_at) e
      left join public.services s on s.id = b.service_id
      left join lateral (
        select jsonb_build_object(
            'id', qq.id,
            'version', qq.version,
            'status', qq.status,
            'note', qq.note,
            'inspection_fee', qq.inspection_fee,
            'total_sent', qq.total_sent,
            'total_approved', qq.total_approved,
            'sent_at', qq.sent_at,
            'decided_at', qq.decided_at,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', qi.id, 'position', qi.position, 'name', qi.name, 'price', qi.price, 'approved', qi.approved)
                order by qi.position)
              from public.quote_items qi where qi.quote_id = qq.id), '[]'::jsonb)
          ) as quote
        from public.quotes qq
        where qq.booking_id = b.id
          and case b.status
                when 'done' then qq.status in ('accepted', 'partially_accepted')
                when 'quote_refused' then qq.status = 'refused'
                when 'expired' then qq.status = 'expired'
                else false
              end
        order by qq.version desc
        limit 1
      ) q on true
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused', 'expired', 'cancelled', 'no_show')
        and b.closed_reason is distinct from 'unanswered'
    ), '[]'::jsonb),
    -- T31a: the newest imported jobs (a long history comes in pages: list_imported_jobs).
    'imported', coalesce((
      select jsonb_agg(public.imported_job_json(j) order by j.day desc, j.id desc)
      from (
        select * from public.imported_jobs ij
        where ij.shop_id = v_shop.id
        order by ij.day desc, ij.id desc
        limit 100
      ) j
    ), '[]'::jsonb),
    'imported_total', (select count(*) from public.imported_jobs ij where ij.shop_id = v_shop.id)
  );
end
$$;

update public.schema_version set version = 75;
