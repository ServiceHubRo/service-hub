-- Rollback of A3c2b1 (supabase/migrations/20261111194435_support_retention.sql), schema 115 → 114.
--
-- Refuses to run (and says how many) once a retention job acted or could act: a job switched on, a run
-- recorded, a statistics row or an anonymised suggestion — none of these can be put back, and dropping
-- them would lose the statistics and the reviews. With none of them nothing real is lost: the new column
-- only held dates computed from the other columns and the audit log.

do $$
declare
  v_on bigint := (select count(*) from public.retention_jobs where enabled);
  v_runs bigint := (select count(*) from public.retention_runs);
  v_stats bigint := (select count(*) from public.support_stats_monthly);
  v_anon bigint := (select count(*) from public.suggestions_anonymous);
begin
  if v_on + v_runs + v_stats + v_anon > 0 then
    raise exception 'Refused: % retention jobs switched on, % runs, % statistics rows and % anonymised suggestions exist. Switch the jobs off; what a job did cannot be undone by a rollback.',
      v_on, v_runs, v_stats, v_anon;
  end if;
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('sh_support_retention', 'sh_suggestion_anonymization')$q$;
  end if;
end
$$;

-- ------------------------------------------------------------------ the A3c2a functions as before
create or replace function public.legal_hold_apply_rules(p_subject uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests int;
  v_files int;
begin
  with gone as (
    delete from public.suggestions s
    where s.author_id is null and s.former_author_id = p_subject
      and not public.legal_hold_covers(s.id, p_subject)
    returning 1
  )
  select count(*)::int into v_requests from gone;

  with gone as (
    delete from public.suggestion_files f
    using public.suggestions s
    where s.id = f.suggestion_id and coalesce(s.author_id, s.former_author_id) = p_subject
      and s.status = 'closed' and s.closed_at <= p_now - interval '90 days'
      and not public.legal_hold_covers(s.id, p_subject)
    returning 1
  )
  select count(*)::int into v_files from gone;

  if not public.legal_hold_has_subject(p_subject) then
    delete from public.legal_hold_subjects where user_id = p_subject;
  end if;
  return jsonb_build_object('deleted_requests', v_requests, 'deleted_files', v_files);
end
$$;

create or replace function public.support_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_counts jsonb;
  v_oldest jsonb;
begin
  v_me := public.require_staff();
  select jsonb_build_object(
      'new', count(*) filter (where s.status = 'new'),
      'in_progress', count(*) filter (where s.status = 'in_progress'),
      'waiting_user', count(*) filter (where s.status = 'waiting_user'),
      'resolved', count(*) filter (where s.status = 'resolved'),
      'closed', count(*) filter (where s.status = 'closed'),
      'escalated', count(*) filter (where s.escalated_at is not null and public.support_request_open(s.status)),
      'unassigned', count(*) filter (where s.assigned_to is null and s.escalated_at is null and public.support_request_open(s.status)),
      'mine', count(*) filter (where s.assigned_to = v_me.id and public.support_request_open(s.status)),
      'over_24', count(*) filter (where public.support_waiting_since(s) <= now() - interval '24 hours'),
      'over_48', count(*) filter (where public.support_waiting_since(s) <= now() - interval '48 hours'))
  into v_counts
  from public.suggestions s
  where (v_me.role = 'admin' or not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)));
  if v_me.role = 'admin' then
    v_counts := v_counts || jsonb_build_object(
      'holds_due', (select count(*) from public.legal_holds where released_at is null and review_due_at <= now()));
  end if;

  select jsonb_build_object(
      'id', s.id, 'title', public.support_request_label(s), 'waiting_since', public.support_waiting_since(s),
      'escalated', s.escalated_at is not null,
      'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end)
  into v_oldest
  from public.suggestions s
  where public.support_waiting_since(s) is not null
    and (v_me.role = 'admin' or not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))
  order by public.support_waiting_since(s), s.id
  limit 1;

  return jsonb_build_object('me', v_me.id, 'now', now(), 'counts', v_counts, 'oldest', v_oldest);
end
$function$;

-- ------------------------------------------------------------------ the new objects
drop function public.admin_support_stats(date, date);
drop function public.support_review_suggestion_text(uuid, text, text, uuid);
drop function public.support_list_suggestion_reviews(text);
drop function public.run_suggestion_anonymization(timestamptz);
drop function public.run_support_retention(timestamptz);
drop function public.retention_run_finish(text, timestamptz, jsonb, int, int);
drop function public.admin_list_retention_jobs();
drop function public.admin_set_retention_job(text, boolean, text, int, jsonb, uuid);
drop function public.admin_retention_preview(text);
drop function public.retention_preview_counts(text, timestamptz);
drop function public.suggestion_anonymize(public.suggestions, timestamptz);
drop function public.support_retention_delete(public.suggestions);
drop function public.support_stats_add(public.suggestions);
drop function public.suggestion_text_findings(text);
drop function public.cnp_ok(text);
drop function public.luhn_ok(text);
drop function public.retention_hold_kind(public.suggestions);
drop function public.retention_due(timestamptz, timestamptz);
drop function public.retention_job_enabled(text);
drop function public.support_initial_activity(public.suggestions);
drop table public.suggestions_anonymous;
drop table public.support_stats_monthly;
drop table public.retention_runs;
drop trigger retention_jobs_guard on public.retention_jobs;
drop function public.retention_jobs_guard();
drop table public.retention_jobs;
drop trigger suggestions_real_activity on public.suggestions;
drop function public.suggestions_real_activity();
drop index public.suggestions_activity_idx;
alter table public.suggestions drop column last_activity_at;

update public.schema_version set version = 114;
