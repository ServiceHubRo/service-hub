-- Rollback of A3c2b2 (supabase/migrations/20261111204858_audit_log_retention.sql), schema 116 → 115.
--
-- Refuses to run (and says how many) once a log job was switched on or ran, or a log row records removed
-- paths (`redacted`): what was removed cannot come back and the record of it would be lost. With none of
-- them nothing is lost: the classes are a lookup table and no existing row was written.

do $$
declare
  v_on bigint := (select count(*) from public.retention_jobs where key in ('support_log', 'admin_log') and enabled);
  v_runs bigint := (select count(*) from public.retention_runs where job in ('support_log', 'admin_log'));
  v_redacted bigint := (select count(*) from public.admin_audit_log where redacted is not null);
begin
  if v_on + v_runs + v_redacted > 0 then
    raise exception 'Refused: % log jobs switched on, % log runs and % log rows with removed values exist. What was removed cannot be put back by a rollback.',
      v_on, v_runs, v_redacted;
  end if;
end
$$;

do $$
begin
  if to_regnamespace('cron') is not null then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname in ('sh_support_log_retention', 'sh_admin_log_retention')$q$;
  end if;
end
$$;

-- ------------------------------------------------------------------ the A3c2b1 functions as before
create or replace function public.retention_jobs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled
     and (tg_op = 'INSERT' or not old.enabled or new.batch_size is distinct from old.batch_size)
     and coalesce(current_setting('sh.retention_switch', true), '') <> 'on' then
    perform public.fail('not_allowed');
  end if;
  return new;
end
$$;

create or replace function public.admin_retention_preview(p_job text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_admin();
  return jsonb_build_object('job', p_job, 'now', now(), 'enabled', public.retention_job_enabled(p_job),
    'counts', public.retention_preview_counts(p_job, now()));
end
$$;

create or replace function public.admin_set_retention_job(p_job text, p_enabled boolean, p_reason text, p_batch_size int,
  p_expected jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  j public.retention_jobs%rowtype;
  v_reason text;
  v_counts jsonb;
  v_batch int;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_retention_job');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into j from public.retention_jobs where key = p_job for update;
  if not found or p_job not in ('support_requests', 'suggestions') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'job'));
  end if;
  if p_enabled is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'enabled'));
  end if;
  v_reason := public.legal_hold_check_text('reason', p_reason, 10, 500);
  v_batch := coalesce(p_batch_size, j.batch_size);

  if p_enabled then
    if v_batch not between 1 and 500 then
      perform public.fail('field_invalid', jsonb_build_object('field', 'batch_size', 'min', 1, 'max', 500));
    end if;
    v_counts := public.retention_preview_counts(p_job, now());
    if p_expected is null or p_expected is distinct from v_counts then
      perform public.fail('preview_changed', jsonb_build_object('counts', v_counts));
    end if;
  elsif not j.enabled then
    perform public.fail('job_disabled');
  end if;

  perform set_config('sh.retention_switch', 'on', true);
  update public.retention_jobs
  set enabled = p_enabled, batch_size = v_batch, changed_by = v_me.id, changed_by_display_id = v_me.display_id,
      changed_at = now(), reason = v_reason, enabled_counts = case when p_enabled then v_counts end
  where key = p_job;
  perform set_config('sh.retention_switch', '', true);

  perform public.staff_audit('set_retention_job', 'retention_job', p_job,
    jsonb_build_object('enabled', j.enabled, 'batch_size', j.batch_size),
    jsonb_build_object('enabled', p_enabled, 'batch_size', v_batch) ||
      case when p_enabled then jsonb_build_object('counts', v_counts) else '{}'::jsonb end,
    v_reason);
  v_result := jsonb_build_object('job', p_job, 'enabled', p_enabled, 'batch_size', v_batch);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create or replace function public.admin_list_retention_jobs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_admin();
  return jsonb_build_object('now', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', j.key, 'enabled', j.enabled, 'batch_size', j.batch_size,
      'changed_at', j.changed_at, 'reason', j.reason,
      'changed_by', case when j.changed_by_display_id is not null then jsonb_build_object(
        'id', j.changed_by, 'display_id', j.changed_by_display_id,
        'name', (select p.name from public.profiles p where p.id = j.changed_by)) end,
      'enabled_counts', j.enabled_counts,
      'runs', coalesce((
        select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'finished_at', r.finished_at, 'counts', r.counts,
                                            'failed', r.failed, 'remaining', r.remaining) order by r.started_at desc)
        from (select * from public.retention_runs r where r.job = j.key order by r.started_at desc limit 10) r), '[]'::jsonb))
      order by case j.key when 'support_requests' then 1 else 2 end)
    from public.retention_jobs j where j.key in ('support_requests', 'suggestions')), '[]'::jsonb));
end
$$;

-- ------------------------------------------------------------------ the new objects
drop function public.admin_audit_privacy_report();
drop function public.audit_privacy_report();
drop function public.jsonb_string_leaves(jsonb, text);
drop function public.run_audit_retention(text, timestamptz);
drop function public.retention_counts(text, timestamptz);
drop function public.audit_preview_counts(text, timestamptz);
drop function public.audit_due_at(text, text, text, timestamptz);
drop function public.audit_row_held(text, text);
delete from public.retention_jobs where key in ('support_log', 'admin_log');
alter table public.retention_jobs drop column locked_reason;
drop trigger profiles_audit_forget_delete on public.profiles;
drop trigger profiles_audit_forget_anonymise on public.profiles;
drop function public.profiles_audit_forget();
drop function public.audit_forget_account(uuid, text, text, text);
drop trigger admin_audit_log_scrub on public.admin_audit_log;
drop function public.admin_audit_log_scrub();
drop function public.audit_scrub(jsonb, text, text[], text[]);
drop function public.audit_secret_key(text);
alter table public.admin_audit_log drop column redacted;
drop function public.audit_class(text);
drop table public.audit_action_classes;
drop function public.audit_retention_cutoff();

update public.schema_version set version = 115;
