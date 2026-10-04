-- A request the shop has not answered is not forgotten until its time (Eduard, 3 oct). Besides the
-- first reminder (request_reminder_hours after it came, T24):
--   * every morning at 09:xx Bucharest, while its time has not come: booking_request_waiting again,
--     once a day (not for a request younger than 12 hours: the first reminder covers it);
--   * a last call (booking_request_last_call, push to every member, email to the owner) once,
--     3 hours before its time — or, for a time before 12:00, at 18:xx the evening before, so it
--     never waits out the night — telling the shop that the request closes at that time.

alter table public.engagement_log drop constraint engagement_log_kind_check;
alter table public.engagement_log add constraint engagement_log_kind_check
  check (kind in ('tire_season', 'welcome', 'favorite_offer', 'request_waiting', 'monthly_report',
                  'request_daily', 'request_last_call'));

create function public.send_request_daily_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  b public.bookings%rowtype;
  v_n int := 0;
begin
  for b in
    select bk.* from public.bookings bk
    where bk.status = 'pending'
      and bk.created_at <= p_now - interval '12 hours'
      and public.slot_starts_at(bk.date, bk.slot) > p_now
    order by bk.date, bk.slot
  loop
    insert into public.engagement_log (kind, key, sent_at) values ('request_daily', b.id::text || ':' || v_today, p_now)
    on conflict do nothing;
    continue when not found;
    perform public.notify_shop(b.shop_id, 'booking_request_waiting', public.booking_event_params(b), b.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_request_daily_reminders(timestamptz) from public, anon, authenticated;

create function public.send_request_last_calls(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  b public.bookings%rowtype;
  v_n int := 0;
begin
  for b in
    select bk.* from public.bookings bk
    where bk.status = 'pending'
      and bk.created_at <= p_now - interval '1 hour'
      and public.slot_starts_at(bk.date, bk.slot) > p_now
      and (public.slot_starts_at(bk.date, bk.slot) <= p_now + interval '3 hours'
           or (bk.slot < time '12:00' and bk.date = v_local::date + 1 and extract(hour from v_local) >= 18))
    order by bk.date, bk.slot
  loop
    insert into public.engagement_log (kind, key, sent_at) values ('request_last_call', b.id::text, p_now)
    on conflict do nothing;
    continue when not found;
    perform public.notify_shop(b.shop_id, 'booking_request_last_call', public.booking_event_params(b), b.id,
                               array['push', 'email']);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_request_last_calls(timestamptz) from public, anon, authenticated;

create or replace function public.run_quote_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'expired', public.expire_quotes(),
    'reminded', public.remind_expiring_quotes(p_now),
    'requests_waiting', public.send_request_waiting_reminders(p_now),
    'requests_last_call', public.send_request_last_calls(p_now),
    'requests_expired', public.expire_unanswered_requests(p_now));
end
$$;

revoke execute on function public.run_quote_jobs(timestamptz) from public, anon, authenticated;

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
    'request_expired', 'booking_followup', 'booking_auto_closed', 'booking_request_last_call')
$$;


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
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now),
      'booking_followups', public.send_booking_followups(p_now),
      'bookings_closed', public.close_stale_bookings(p_now));
  end if;
  return v_result;
end
$$;


update public.schema_version set version = 50;
