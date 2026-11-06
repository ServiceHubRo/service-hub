-- Rollback of M6 (supabase/migrations/20261106172443_fleet_notifications.sql), schema 106 → 105.
-- Run only in reverse order. Lost: the outbox, the dedupe log, the rights versions. Kept: every
-- notification already queued or sent (notification_events), every business row.
do $$
begin
  if to_regnamespace('cron') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'sh_fleet_events'$q$;
  end if;
end
$$;
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_rights_versions') then
    alter publication supabase_realtime drop table public.member_rights_versions;
  end if;
end
$$;

-- The previous versions, verbatim: run_hourly_jobs (20261016175030), admin_digest_counts and
-- send_admin_digest (20261030090000), fleet_can (20261105175604).
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

create or replace function public.admin_digest_counts(p_now timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.reviews r where r.report_status = 'pending'),
    'suspect', (select count(*) from public.reviews r
                where r.removed_at is null and r.signals_cleared_at is null
                  and r.created_at > p_now - interval '180 days'
                  and public.is_suspect_review(public.review_signals(r))),
    'past_due', (select count(*) from public.subscriptions s where s.status = 'past_due'),
    'company_waiting', (select count(*) from public.shop_billing b
                        where b.anaf_problem_since is not null and b.anaf_hidden_at is null),
    'company_hidden', (select count(*) from public.shop_billing b where b.anaf_hidden_at is not null),
    'unanswered', (select count(*) from public.bookings b
                   where b.closed_reason = 'unanswered' and b.status_changed_at > p_now - interval '24 hours'),
    'no_show_disputes', (select count(*) from public.no_show_disputes d where d.status = 'pending'),
    'new_shops', (select count(*) from public.shops s where s.created_at > p_now - interval '24 hours'),
    'new_clients', (select count(*) from public.profiles p
                    where p.role = 'client' and p.created_at > p_now - interval '24 hours'),
    'new_bookings', (select count(*) from public.bookings b where b.created_at > p_now - interval '24 hours'),
    'done', (select count(*) from public.bookings b where b.status = 'done' and b.done_at > p_now - interval '24 hours'))
$$;

create or replace function public.send_admin_digest(p_now timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb := public.admin_digest_counts(p_now);
begin
  if (v->>'reports')::int + (v->>'suspect')::int + (v->>'past_due')::int + (v->>'company_waiting')::int
     + (v->>'company_hidden')::int + (v->>'unanswered')::int + (v->>'no_show_disputes')::int = 0 then
    return false;
  end if;
  if exists (select 1 from public.notification_events e
             where e.event = 'admin_digest' and e.created_at > p_now - interval '20 hours') then
    return false;
  end if;
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  values (null, 'admin_digest', v || jsonb_build_object('date', (p_now at time zone 'Europe/Bucharest')::date), null, array['email']);
  return true;
end
$$;

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

drop trigger company_subscriptions_rights_version on public.company_subscriptions;
drop trigger company_members_rights_version on public.company_members;
drop trigger fleet_expenses_fleet_events on public.fleet_expenses;
drop trigger fleet_issues_fleet_events on public.fleet_issues;
drop trigger bookings_fleet_events on public.bookings;
drop trigger company_quote_decisions_fleet_events on public.company_quote_decisions;
drop trigger quotes_fleet_events on public.quotes;
drop function public.plan_rights_changed();
drop function public.member_rights_changed();
drop function public.bump_rights_version(uuid, uuid);
drop table public.member_rights_versions;
drop function public.admin_retry_fleet_event(bigint, uuid);
drop function public.admin_list_failed_fleet_events();
drop function public.fleet_daily(date);
drop procedure public.process_fleet_events(int);
drop function public.fleet_process_event(bigint);
drop function public.fleet_event_failed(bigint, text, text);
drop function public.fleet_claim_event();
drop function public.fleet_events_from_expense();
drop function public.fleet_events_from_issue();
drop function public.fleet_events_from_booking();
drop function public.fleet_events_from_decision();
drop function public.fleet_events_from_quote();
drop function public.fleet_enqueue(uuid, text, uuid, uuid, jsonb, text);
drop function public.fleet_user_can(uuid, uuid, text);
drop table public.fleet_notices;
drop table public.fleet_events;

update public.schema_version set version = 105;
