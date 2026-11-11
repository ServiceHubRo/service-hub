-- A3c2b2: classes and retention of the audit log, secrets kept out of it, and the log corrected when an
-- account is deleted (plan A3c2b approved by Eduard on 11 Nov 2026, docs/A3C2B_PLAN.md §4).
--
-- · audit_action_classes: every action the database writes, in one of four classes — support (12
--   months; the words an agent searched for, 90 days), admin and security (3 years, waiting for the legal
--   validation), legal (while its hold is active, then 3 years). The class is read by joining on the
--   action: no existing log row is written. An action missing from the table counts as admin (the longer
--   period); a unit test fails until it is classified.
-- · Two retention jobs, created DISABLED with the A3c2b1 switch, preview and run log: support_log and
--   admin_log. admin_log is also LOCKED (locked_reason 'legal_validation', Eduard's point 3): nobody can
--   switch it on, not even through the switch, until a later migration removes the lock after the
--   3 years are validated. Both act only on rows written at or after this migration
--   (audit_retention_cutoff(), a constant written here): older rows wait for A3c2b3 and Eduard's separate
--   approval. Rows about a request or an account under an active legal hold, and the rows of an active
--   hold, are never touched.
-- · Secrets: a BEFORE INSERT trigger removes from every new row the keys named like a secret (password,
--   token, key, OTP, cookie…) and the values text_has_secret flags, the reason included, and the keys an
--   action must not keep (delete_account: name, email, shop name; open_request_file: the file name). It
--   never refuses: the paths go to the new column `redacted`.
-- · Account deletion (any path: DELETE of the profile, or the anonymisation of a shop with records): the
--   log rows written after this migration about that account (its id or its shop's as entity, or its
--   email or phone as a value) lose its name, email and phone; the support searches for its email or
--   phone lose their words. Not while the account is under an active legal hold (its identifiers are kept
--   in legal_hold_subjects, A3c2a). The account code that stays is pseudonymised data, seen by the admin
--   only.
-- · admin_audit_privacy_report(): counts, for every row (older ones included), what may be personal
--   data or a secret — names, emails, phones, search words, file names, secrets, rows of deleted
--   accounts —, per action; numbers only, never a value. `stable`: it cannot write.
--
-- No existing row is changed. Rollback: supabase/rollback/20261111204858_audit_log_retention.sql
-- (refuses once a log job acted or a row was redacted).

-- ------------------------------------------------------------------ the cutoff

do $$
begin
  execute format($f$
    create function public.audit_retention_cutoff()
    returns timestamptz
    language sql
    immutable
    set search_path = ''
    as $b$ select %L::timestamptz $b$
  $f$, clock_timestamp());
end
$$;
comment on function public.audit_retention_cutoff() is
  'A3c2b2: log rows written before this moment are never touched by a log job; only a later migration (A3c2b3, Eduard''s separate approval) changes it.';
revoke execute on function public.audit_retention_cutoff() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ classes

create table public.audit_action_classes (
  action text primary key check (action ~ '^[a-z_]{2,60}$'),
  class text not null check (class in ('support', 'admin', 'security', 'legal')),
  -- Keys this action never keeps in a new row (removed at insert).
  strip_keys text[] not null default '{}'
);
alter table public.audit_action_classes enable row level security;
revoke all on public.audit_action_classes from public, anon, authenticated, service_role;

insert into public.audit_action_classes (action, class, strip_keys) values
  -- support: 12 months (search words 90 days)
  ('support_search', 'support', '{}'),
  ('support_view_account', 'support', '{}'),
  ('support_view_request', 'support', '{}'),
  ('open_request_file', 'support', '{file_name}'),
  ('take_request', 'support', '{}'),
  ('assign_request', 'support', '{}'),
  ('reply_request', 'support', '{}'),
  ('add_request_note', 'support', '{}'),
  ('set_request_status', 'support', '{}'),
  ('escalate_request', 'support', '{}'),
  ('return_request', 'support', '{}'),
  ('update_suggestion', 'support', '{}'),
  ('review_suggestion_text', 'support', '{}'),
  -- legal: while the hold is active, then 3 years
  ('place_legal_hold', 'legal', '{}'),
  ('review_legal_hold', 'legal', '{}'),
  ('release_legal_hold', 'legal', '{}'),
  ('view_legal_hold', 'legal', '{}'),
  -- security: 3 years (to validate)
  ('auto_suspend_account', 'security', '{}'),
  ('auto_no_trial', 'security', '{}'),
  ('verify_phone', 'security', '{}'),
  ('verify_phone_manually', 'security', '{}'),
  ('promote_to_admin', 'security', '{}'),
  ('suspend_account', 'security', '{}'),
  ('unsuspend_account', 'security', '{}'),
  ('suspend_shop', 'security', '{}'),
  ('unsuspend_shop', 'security', '{}'),
  ('grant_support', 'security', '{}'),
  ('revoke_support', 'security', '{}'),
  ('delete_account', 'security', '{name,email,shop_name}'),
  -- admin: 3 years (to validate)
  ('admin_force_cancel', 'admin', '{}'),
  ('clear_review_signals', 'admin', '{}'),
  ('remove_review', 'admin', '{}'),
  ('keep_review', 'admin', '{}'),
  ('create_category', 'admin', '{}'),
  ('create_service', 'admin', '{}'),
  ('update_category', 'admin', '{}'),
  ('update_service', 'admin', '{}'),
  ('move_category', 'admin', '{}'),
  ('move_service', 'admin', '{}'),
  ('update_area', 'admin', '{}'),
  ('update_settings', 'admin', '{}'),
  ('set_notification_text', 'admin', '{}'),
  ('send_notice', 'admin', '{}'),
  ('withdraw_notice', 'admin', '{}'),
  ('update_shop', 'admin', '{}'),
  ('extend_trial', 'admin', '{}'),
  ('extend_company_trial', 'admin', '{}'),
  ('set_company_plan', 'admin', '{}'),
  ('update_fleet_plan', 'admin', '{}'),
  ('retry_fleet_event', 'admin', '{}'),
  ('set_subscription_price', 'admin', '{}'),
  ('set_subscription_status', 'admin', '{}'),
  ('grant_report_credit', 'admin', '{}'),
  ('void_report', 'admin', '{}'),
  ('export', 'admin', '{}'),
  ('set_retention_job', 'admin', '{}'),
  ('retention_run', 'admin', '{}');

create function public.audit_class(p_action text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.class from public.audit_action_classes c where c.action = p_action), 'admin')
$$;
revoke execute on function public.audit_class(text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ secrets out of new rows

alter table public.admin_audit_log add column redacted text[];

-- A key named like a secret.
create function public.audit_secret_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key ~* '(^|_)(password|passwd|parol[aă]|pwd|token|access_token|refresh_token|secret|api_?key|apikey|private_?key|otp|totp|recovery(_code)?|authorization|cookie|cvv|cvc)($|_)'
$$;
revoke execute on function public.audit_secret_key(text) from public, anon, authenticated, service_role;

-- The value without the keys to strip (named like a secret, or in p_strip) and without the strings
-- text_has_secret flags, nested objects and arrays included; the removed paths are appended to p_paths.
create function public.audit_scrub(p_value jsonb, p_path text, p_strip text[], inout p_paths text[], out p_result jsonb)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  i int;
  r jsonb;
  acc jsonb;
begin
  if p_value is null then
    p_result := null;
  elsif jsonb_typeof(p_value) = 'object' then
    acc := '{}'::jsonb;
    for k, v in select * from jsonb_each(p_value) loop
      if public.audit_secret_key(k) or k = any (p_strip) then
        p_paths := p_paths || (p_path || '.' || k);
      else
        select s.p_paths, s.p_result into p_paths, r from public.audit_scrub(v, p_path || '.' || k, p_strip, p_paths) s;
        acc := acc || jsonb_build_object(k, r);
      end if;
    end loop;
    p_result := acc;
  elsif jsonb_typeof(p_value) = 'array' then
    acc := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(p_value) - 1 loop
      select s.p_paths, s.p_result into p_paths, r from public.audit_scrub(p_value->i, p_path || '[' || i || ']', p_strip, p_paths) s;
      acc := acc || jsonb_build_array(r);
    end loop;
    p_result := acc;
  elsif jsonb_typeof(p_value) = 'string' and public.text_has_secret(p_value #>> '{}') then
    p_paths := p_paths || p_path;
    p_result := to_jsonb('[eliminat]'::text);
  else
    p_result := p_value;
  end if;
end
$$;
revoke execute on function public.audit_scrub(jsonb, text, text[], text[]) from public, anon, authenticated, service_role;

create function public.admin_audit_log_scrub()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_strip text[] := coalesce((select c.strip_keys from public.audit_action_classes c where c.action = new.action), '{}');
  v_paths text[] := coalesce(new.redacted, '{}');
begin
  select s.p_paths, s.p_result into v_paths, new.before from public.audit_scrub(new.before, 'before', v_strip, v_paths) s;
  select s.p_paths, s.p_result into v_paths, new.after from public.audit_scrub(new.after, 'after', v_strip, v_paths) s;
  if new.reason is not null and public.text_has_secret(new.reason) then
    new.reason := '[eliminat]';
    v_paths := v_paths || 'reason'::text;
  end if;
  new.redacted := nullif(v_paths, '{}');
  return new;
end
$$;
revoke execute on function public.admin_audit_log_scrub() from public, anon, authenticated, service_role;
create trigger admin_audit_log_scrub before insert on public.admin_audit_log
  for each row execute function public.admin_audit_log_scrub();

-- ------------------------------------------------------------------ the log when an account goes

-- Name, email and phone out of the rows written after the cutoff about one account; the support
-- searches for its email or phone lose their words. Not while a legal hold names the account.
create function public.audit_forget_account(p_user uuid, p_name text, p_email text, p_phone text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entities text[];
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  v_values text[];
  a record;
  v_paths text[];
  v_before jsonb;
  v_after jsonb;
  n int := 0;
begin
  if public.legal_hold_has_subject(p_user) then
    return 0;
  end if;
  v_entities := array[p_user::text] || coalesce((select array_agg(s.id::text) from public.shops s where s.owner_id = p_user), '{}');
  v_values := array_remove(array[lower(nullif(btrim(p_name), '')), lower(nullif(btrim(p_email), '')), nullif(p_phone, '')], null);

  for a in
    select l.id, l.before, l.after, l.action, l.entity_id from public.admin_audit_log l
    where l.created_at >= public.audit_retention_cutoff()
      and (l.entity_id = any (v_entities)
           or (l.action = 'support_search' and l.after ? 'q'
               and (lower(l.after->>'q') = any (v_values)
                    or (length(v_digits) = 9 and regexp_replace(l.after->>'q', '\D', '', 'g') like '%' || v_digits))))
    for update
  loop
    v_paths := '{}';
    if a.action = 'support_search' then
      v_after := a.after - 'q';
      v_paths := array['after.q'];
      v_before := a.before;
    else
      select s.p_paths, s.p_result into v_paths, v_before
        from public.audit_scrub(a.before, 'before', array['name', 'email', 'phone', 'shop_name', 'admin_name', 'owner_name'], v_paths) s;
      select s.p_paths, s.p_result into v_paths, v_after
        from public.audit_scrub(a.after, 'after', array['name', 'email', 'phone', 'shop_name', 'admin_name', 'owner_name'], v_paths) s;
    end if;
    if cardinality(v_paths) > 0 then
      update public.admin_audit_log
      set before = v_before, after = v_after, redacted = coalesce(redacted, '{}') || v_paths
      where id = a.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;
revoke execute on function public.audit_forget_account(uuid, text, text, text) from public, anon, authenticated, service_role;

create function public.profiles_audit_forget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.profiles%rowtype := case when tg_op = 'DELETE' then old else new end;
begin
  perform public.audit_forget_account(v_row.id, old.name,
    (select u.email from auth.users u where u.id = v_row.id and u.email not like 'deleted-%@deleted.invalid'),
    old.phone);
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
revoke execute on function public.profiles_audit_forget() from public, anon, authenticated, service_role;
create trigger profiles_audit_forget_delete before delete on public.profiles
  for each row execute function public.profiles_audit_forget();
create trigger profiles_audit_forget_anonymise after update of deleted_at on public.profiles
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.profiles_audit_forget();

-- ------------------------------------------------------------------ the two log jobs

alter table public.retention_jobs add column locked_reason text check (locked_reason is null or locked_reason ~ '^[a-z_]{3,40}$');

-- As in A3c2b1, and a locked job is never switched on, whatever sets the switch.
create or replace function public.retention_jobs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled and new.locked_reason is not null then
    perform public.fail('job_locked', jsonb_build_object('reason', new.locked_reason));
  end if;
  if new.enabled
     and (tg_op = 'INSERT' or not old.enabled or new.batch_size is distinct from old.batch_size)
     and coalesce(current_setting('sh.retention_switch', true), '') <> 'on' then
    perform public.fail('not_allowed');
  end if;
  return new;
end
$$;

insert into public.retention_jobs (key, locked_reason) values ('support_log', null), ('admin_log', 'legal_validation');

-- A log row about a request or an account under an active legal hold, or of an active hold.
create function public.audit_row_held(p_entity_type text, p_entity_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_entity_id is null or p_entity_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return case p_entity_type
    when 'suggestion' then public.legal_hold_covers_request(p_entity_id::uuid)
    when 'profile' then exists (select 1 from public.legal_holds h where h.released_at is null and h.suggestion_id is null
                                and h.subject_id = p_entity_id::uuid)
    when 'legal_hold' then exists (select 1 from public.legal_holds h where h.id = p_entity_id::uuid and h.released_at is null)
    else false
  end;
end
$$;
revoke execute on function public.audit_row_held(text, text) from public, anon, authenticated, service_role;

-- When a row becomes due, by its class: support 12 months; admin and security 3 years; legal 3 years
-- after its hold was released (never while active).
create function public.audit_due_at(p_action text, p_entity_type text, p_entity_id text, p_created timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class text := public.audit_class(p_action);
  v_released timestamptz;
begin
  if v_class = 'support' then
    return p_created + interval '12 months';
  elsif v_class = 'legal' then
    if p_entity_type = 'legal_hold' and p_entity_id ~ '^[0-9a-f-]{36}$' then
      select h.released_at into v_released from public.legal_holds h where h.id = p_entity_id::uuid;
      return case when v_released is null then null else greatest(p_created, v_released) + interval '3 years' end;
    end if;
    return p_created + interval '3 years';
  end if;
  return p_created + interval '3 years';
end
$$;
revoke execute on function public.audit_due_at(text, text, text, timestamptz) from public, anon, authenticated, service_role;

-- The preview of a log job (stable: it cannot write).
create function public.audit_preview_counts(p_job text, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_job not in ('support_log', 'admin_log') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'job'));
  end if;
  with rows as (
    select l.id, l.action, l.created_at, l.after ? 'q' as has_q,
           public.audit_class(l.action) as class,
           public.audit_due_at(l.action, l.entity_type, l.entity_id, l.created_at) as due_at,
           public.audit_row_held(l.entity_type, l.entity_id) as held,
           l.created_at < public.audit_retention_cutoff() as legacy
    from public.admin_audit_log l
  ), mine as (
    select * from rows where (class = 'support') = (p_job = 'support_log')
  ), due as (
    select * from mine where due_at is not null and due_at <= p_now
  ), words as (
    select * from mine where action = 'support_search' and has_q and created_at + interval '90 days' <= p_now
  )
  select jsonb_build_object(
    'eligible', jsonb_build_object(
      'total', (select count(*) from due where not held and not legacy),
      'search_terms', case when p_job = 'support_log' then (select count(*) from words where not held and not legacy) else 0 end,
      'by_class', coalesce((select jsonb_object_agg(class, n) from (select class, count(*) n from due where not held and not legacy group by class) x), '{}'::jsonb)),
    'exempt', jsonb_build_object(
      'legal_hold', (select count(*) from due where held and not legacy),
      'before_cutoff', (select count(*) from mine m where m.legacy
                          and ((m.due_at is not null and m.due_at <= p_now)
                               or (p_job = 'support_log' and m.action = 'support_search' and m.has_q
                                   and m.created_at + interval '90 days' <= p_now))),
      'legal_active', (select count(*) from mine where class = 'legal' and due_at is null)),
    'next_due_at', (select min(due_at) from mine where due_at > p_now and not legacy))
  into v;
  return v;
end
$$;
revoke execute on function public.audit_preview_counts(text, timestamptz) from public, anon, authenticated, service_role;

-- Every job's numbers, the A3c2b1 jobs and the log jobs.
create function public.retention_counts(p_job text, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_job in ('support_log', 'admin_log') then
    return public.audit_preview_counts(p_job, p_now);
  end if;
  return public.retention_preview_counts(p_job, p_now);
end
$$;
revoke execute on function public.retention_counts(text, timestamptz) from public, anon, authenticated, service_role;

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
    'counts', public.retention_counts(p_job, now()));
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
  if not found or p_job not in ('support_requests', 'suggestions', 'support_log', 'admin_log') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'job'));
  end if;
  if p_enabled is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'enabled'));
  end if;
  if p_enabled and j.locked_reason is not null then
    perform public.fail('job_locked', jsonb_build_object('reason', j.locked_reason));
  end if;
  v_reason := public.legal_hold_check_text('reason', p_reason, 10, 500);
  v_batch := coalesce(p_batch_size, j.batch_size);

  if p_enabled then
    if v_batch not between 1 and 500 then
      perform public.fail('field_invalid', jsonb_build_object('field', 'batch_size', 'min', 1, 'max', 500));
    end if;
    v_counts := public.retention_counts(p_job, now());
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
  return jsonb_build_object('now', now(), 'cutoff', public.audit_retention_cutoff(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', j.key, 'enabled', j.enabled, 'batch_size', j.batch_size, 'locked_reason', j.locked_reason,
      'changed_at', j.changed_at, 'reason', j.reason,
      'changed_by', case when j.changed_by_display_id is not null then jsonb_build_object(
        'id', j.changed_by, 'display_id', j.changed_by_display_id,
        'name', (select p.name from public.profiles p where p.id = j.changed_by)) end,
      'enabled_counts', j.enabled_counts,
      'runs', coalesce((
        select jsonb_agg(jsonb_build_object('started_at', r.started_at, 'finished_at', r.finished_at, 'counts', r.counts,
                                            'failed', r.failed, 'remaining', r.remaining) order by r.started_at desc)
        from (select * from public.retention_runs r where r.job = j.key order by r.started_at desc limit 10) r), '[]'::jsonb))
      order by case j.key when 'support_requests' then 1 when 'suggestions' then 2 when 'support_log' then 3 else 4 end)
    from public.retention_jobs j
    where j.key in ('support_requests', 'suggestions', 'support_log', 'admin_log')), '[]'::jsonb));
end
$$;

-- The runs (pg_cron only; nothing while off or locked; never ahead of the clock; only rows written
-- after the cutoff; never a held row).
create function public.run_audit_retention(p_job text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.retention_jobs%rowtype;
  v_started timestamptz := clock_timestamp();
  v_words int := 0;
  v_deleted int := 0;
  v_remaining int;
  v_counts jsonb;
begin
  p_now := least(p_now, now());
  select * into j from public.retention_jobs where key = p_job and p_job in ('support_log', 'admin_log');
  if not found or not j.enabled or j.locked_reason is not null then
    return null;
  end if;

  if p_job = 'support_log' then
    with picked as (
      select l.id from public.admin_audit_log l
      where l.action = 'support_search' and l.after ? 'q'
        and l.created_at >= public.audit_retention_cutoff() and l.created_at + interval '90 days' <= p_now
        and not public.audit_row_held(l.entity_type, l.entity_id)
      order by l.created_at, l.id
      limit j.batch_size
      for update skip locked
    ), done as (
      update public.admin_audit_log l
      set after = l.after - 'q', redacted = coalesce(l.redacted, '{}') || 'after.q'::text
      from picked where l.id = picked.id
      returning 1
    )
    select count(*)::int into v_words from done;
  end if;

  with picked as (
    select l.id from public.admin_audit_log l
    where l.created_at >= public.audit_retention_cutoff()
      and (public.audit_class(l.action) = 'support') = (p_job = 'support_log')
      and public.audit_due_at(l.action, l.entity_type, l.entity_id, l.created_at) <= p_now
      and not public.audit_row_held(l.entity_type, l.entity_id)
    order by l.created_at, l.id
    limit j.batch_size
    for update skip locked
  ), done as (
    delete from public.admin_audit_log l using picked where l.id = picked.id returning 1
  )
  select count(*)::int into v_deleted from done;

  select ((public.audit_preview_counts(p_job, p_now))->'eligible'->>'total')::int
       + ((public.audit_preview_counts(p_job, p_now))->'eligible'->>'search_terms')::int
    into v_remaining;
  v_counts := jsonb_build_object('deleted_log_rows', v_deleted, 'removed_search_terms', v_words);
  perform public.retention_run_finish(p_job, v_started, v_counts, 0, v_remaining);
  return v_counts || jsonb_build_object('remaining', v_remaining);
end
$$;
revoke execute on function public.run_audit_retention(text, timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_support_log_retention', '13 4 * * *', $q$select public.run_audit_retention('support_log')$q$);
    perform cron.schedule('sh_admin_log_retention', '19 4 * * *', $q$select public.run_audit_retention('admin_log')$q$);
  end if;
end
$$;

-- ------------------------------------------------------------------ the report (numbers only)

-- Every string of a value with its key (nested objects and arrays included).
create function public.jsonb_string_leaves(p jsonb, p_key text default null)
returns table (key text, value text)
language sql
immutable
set search_path = ''
as $$
  with recursive walk(k, v) as (
    select p_key, p
    union all
    select coalesce(e.key, w.k), e.value
    from walk w
    cross join lateral (
      select o.key, o.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) o
      union all
      select null, a.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) e
  )
  select k, v #>> '{}' from walk where jsonb_typeof(v) = 'string'
$$;
revoke execute on function public.jsonb_string_leaves(jsonb, text) from public, anon, authenticated, service_role;

-- What the log holds that may be personal data or a secret, counted per action and kind, for every row
-- (older ones included). Never a value. Run by the admin screen, or by Eduard in the SQL Editor:
--   select public.audit_privacy_report();
create function public.audit_privacy_report()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select l.id, l.action, l.entity_type, l.entity_id, l.created_at, l.reason,
           l.created_at < public.audit_retention_cutoff() as legacy,
           coalesce(l.before, '{}'::jsonb) as b, coalesce(l.after, '{}'::jsonb) as a
    from public.admin_audit_log l
  ), leaves as (
    select r.id, x.key, x.value from rows r, lateral (
      select * from public.jsonb_string_leaves(r.b) union all select * from public.jsonb_string_leaves(r.a)
      union all select 'reason', r.reason where r.reason is not null) x
  ), kinds as (
    select r.id, r.action, r.legacy,
      exists (select 1 from leaves f where f.id = r.id and f.key in ('name', 'admin_name', 'shop_name', 'owner_name', 'client_name')) as names,
      exists (select 1 from leaves f where f.id = r.id and f.value ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}') as emails,
      exists (select 1 from leaves f where f.id = r.id
              and (f.key in ('phone', 'phone_e164') or f.value ~ '(\+?40|\m0)[ .-]?7[0-9]{2}[ .-]?[0-9]{3}[ .-]?[0-9]{3}')) as phones,
      (r.action = 'support_search' and r.a ? 'q') as search_terms,
      (r.a ? 'file_name' or r.b ? 'file_name') as file_names,
      exists (select 1 from leaves f where f.id = r.id and public.text_has_secret(f.value)) as secrets,
      exists (select 1 from jsonb_object_keys(r.a || r.b) k where public.audit_secret_key(k)) as secret_keys,
      (r.entity_type in ('profile', 'shop') and r.entity_id ~ '^[0-9a-f-]{36}$'
       and not exists (select 1 from public.profiles p where p.id::text = r.entity_id and p.deleted_at is null)
       and not exists (select 1 from public.shops s join public.profiles p on p.id = s.owner_id
                       where s.id::text = r.entity_id and p.deleted_at is null)) as deleted_accounts
    from rows r
  ), per_action as (
    select k.action, public.audit_class(k.action) as class,
      count(*) as rows, count(*) filter (where k.legacy) as legacy_rows,
      count(*) filter (where k.names) as names, count(*) filter (where k.emails) as emails,
      count(*) filter (where k.phones) as phones, count(*) filter (where k.search_terms) as search_terms,
      count(*) filter (where k.file_names) as file_names,
      count(*) filter (where k.secrets or k.secret_keys) as secrets,
      count(*) filter (where k.deleted_accounts) as deleted_accounts
    from kinds k group by k.action
  )
  select jsonb_build_object(
    'generated_at', now(),
    'cutoff', public.audit_retention_cutoff(),
    'rows', (select count(*) from rows),
    'legacy_rows', (select count(*) from rows where legacy),
    'oldest', (select min(created_at) from rows),
    'newest', (select max(created_at) from rows),
    'totals', jsonb_build_object(
      'names', (select count(*) from kinds where names),
      'emails', (select count(*) from kinds where emails),
      'phones', (select count(*) from kinds where phones),
      'search_terms', (select count(*) from kinds where search_terms),
      'file_names', (select count(*) from kinds where file_names),
      'secrets', (select count(*) from kinds where secrets or secret_keys),
      'deleted_accounts', (select count(*) from kinds where deleted_accounts)),
    'by_action', coalesce((select jsonb_agg(to_jsonb(p) order by p.rows desc, p.action) from per_action p
                           where p.names + p.emails + p.phones + p.search_terms + p.file_names + p.secrets + p.deleted_accounts > 0), '[]'::jsonb))
$$;
revoke execute on function public.audit_privacy_report() from public, anon, authenticated, service_role;

create function public.admin_audit_privacy_report()
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
  return public.audit_privacy_report();
end
$$;
revoke execute on function public.admin_audit_privacy_report() from public, anon;
grant execute on function public.admin_audit_privacy_report() to authenticated;

update public.schema_version set version = 116;
