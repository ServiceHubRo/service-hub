-- T37a — No warranty reminder (Eduard, 16 Oct 2026). The warranty stays on the job, in the
-- history and in the report; the client is no longer told before it ends.
-- Undoes the reminder parts of 20261016171905_job_warranty.sql.

drop function public.send_warranty_reminders(date);

delete from public.client_reminders where kind = 'warranty';
alter table public.client_reminders drop constraint client_reminders_kind_check;
alter table public.client_reminders
  add constraint client_reminders_kind_check check (kind in ('review', 'service'));

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
    'report_credit')
$$;

update public.schema_version set version = 76;
