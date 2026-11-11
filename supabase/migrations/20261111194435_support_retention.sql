-- A3c2b1: retention of support requests and anonymisation of suggestions (plan A3c2b approved by Eduard
-- on 11 Nov 2026 with his three confirmations; docs/A3C2B_PLAN.md §3).
--
-- · Real activity: suggestions.last_activity_at. It moves only for an action of a signed-in person
--   that changes what the author sees: a message of either side (files go with a message) or a change
--   of state that is not a take (taking „Nouă” to „În lucru” is an assignment). Internal notes,
--   assigning, escalating, returning, openings, reads, the daily closing after 14 days, a legal hold,
--   an account deletion, jobs and migrations never move it. For the rows written before this migration
--   the value is computed and saved here (Eduard, 11 Nov, point 2) from the latest of: created,
--   either side's last message, resolved, the latest message or sent file, and the latest status change
--   or reply a person made (audit log). closed_at and updated_at are never used.
-- · Two jobs, both DISABLED: support_requests (every request outside the suggestions, in any state,
--   12 months after its last real activity, deleted whole: messages, notes, files — Storage queued —,
--   signals, notification events; its numbers kept first in support_stats_monthly) and suggestions
--   (12 months after the last real activity: the text moves to suggestions_anonymous under a new id,
--   with no link to the account, and the suggestion is deleted whole; a support agent or an admin
--   confirms, edits or removes the text within 30 days, else it is deleted). A request covered by an
--   active legal hold (A3c2a) is never touched; the A3c2a guards would refuse it anyway.
-- · Only an admin (second step) switches a job on, with a reason and the exact numbers of the preview it
--   saw (admin_retention_preview, a stable function: PostgreSQL refuses any write in it); when the
--   numbers changed meanwhile the switch answers preview_changed and changes nothing. Switching off
--   needs a reason only. Every switch and every run is in the audit log (numbers only). A direct
--   UPDATE can only switch a job off (the emergency stop).
-- · Each run takes at most batch_size rows (1–500, 50 by default), oldest first, each locked with
--   SKIP LOCKED and checked again after the lock, each in its own sub-transaction: a failing row is
--   counted, never undoes the others.
-- · A review that reaches its 30 days loses its text even when the suggestions job was switched off
--   afterwards (the text exists only because an admin enabled the job once).
-- · Releasing a legal hold applies these rules at once to the released requests only when the matching
--   job is on.
--
-- Existing rows: only the new column last_activity_at is filled; no other value changes. Rollback:
-- supabase/rollback/20261111194435_support_retention.sql (refuses once a job acted).

-- ------------------------------------------------------------------ real activity

alter table public.suggestions add column last_activity_at timestamptz;

-- The real activity of a request written before this migration, from what it already holds.
create function public.support_initial_activity(s public.suggestions)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    s.created_at,
    s.last_user_message_at,
    s.last_staff_message_at,
    s.resolved_at,
    (select max(m.created_at) from public.suggestion_messages m where m.suggestion_id = s.id),
    (select max(f.attached_at) from public.suggestion_files f where f.suggestion_id = s.id),
    (select max(a.created_at) from public.admin_audit_log a
     where a.entity_type = 'suggestion' and a.entity_id = s.id::text and a.admin_id is not null
       and a.action in ('set_request_status', 'update_suggestion', 'reply_request')))
$$;
revoke execute on function public.support_initial_activity(public.suggestions) from public, anon, authenticated;

update public.suggestions s set last_activity_at = public.support_initial_activity(s);

alter table public.suggestions alter column last_activity_at set default now();
alter table public.suggestions alter column last_activity_at set not null;
create index suggestions_activity_idx on public.suggestions (last_activity_at, id);

create function public.suggestions_real_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Not a person (a job, a migration, the service key), or the author's account being deleted.
  if auth.uid() is null or new.former_author_id is distinct from old.former_author_id then
    new.last_activity_at := old.last_activity_at;
    return new;
  end if;
  if new.last_user_message_at is distinct from old.last_user_message_at
     or new.last_staff_message_at is distinct from old.last_staff_message_at
     or (new.status is distinct from old.status and new.assigned_at is not distinct from old.assigned_at) then
    new.last_activity_at := greatest(old.last_activity_at, clock_timestamp());
  else
    new.last_activity_at := old.last_activity_at;
  end if;
  return new;
end
$$;
revoke execute on function public.suggestions_real_activity() from public, anon, authenticated;

create trigger suggestions_real_activity before update on public.suggestions
  for each row execute function public.suggestions_real_activity();

-- ------------------------------------------------------------------ jobs, runs, statistics

create table public.retention_jobs (
  key text primary key check (key ~ '^[a-z_]{3,40}$'),
  enabled boolean not null default false,
  batch_size int not null default 50 check (batch_size between 1 and 500),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_display_id text,
  changed_at timestamptz,
  reason text check (reason is null or char_length(reason) between 10 and 500),
  -- The preview's numbers the admin confirmed when switching the job on.
  enabled_counts jsonb,
  last_run_at timestamptz
);
alter table public.retention_jobs enable row level security;
revoke all on public.retention_jobs from public, anon, authenticated, service_role;
insert into public.retention_jobs (key) values ('support_requests'), ('suggestions');

-- Only admin_set_retention_job switches a job on (or changes the batch while on); anything else may only
-- switch it off.
create function public.retention_jobs_guard()
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
revoke execute on function public.retention_jobs_guard() from public, anon, authenticated;
create trigger retention_jobs_guard before insert or update on public.retention_jobs
  for each row execute function public.retention_jobs_guard();

-- One row per run that found the job on: numbers only.
create table public.retention_runs (
  id bigint generated always as identity primary key,
  job text not null references public.retention_jobs (key),
  started_at timestamptz not null,
  finished_at timestamptz not null default clock_timestamp(),
  counts jsonb not null,
  failed int not null default 0,
  remaining int not null default 0
);
create index retention_runs_job_idx on public.retention_runs (job, started_at desc);
alter table public.retention_runs enable row level security;
revoke all on public.retention_runs from public, anon, authenticated, service_role;

-- The anonymous statistics of the requests deleted by retention (decisions 1 and 3): no id, no text,
-- no person; by the month the request was written (Europe/Bucharest), its category and the author's
-- role.
create table public.support_stats_monthly (
  month date not null check (extract(day from month) = 1),
  category text not null,
  author_role text not null check (author_role in ('client', 'shop', 'unknown')),
  requests int not null default 0,
  resolved int not null default 0,
  escalated int not null default 0,
  first_response_count int not null default 0,
  first_response_minutes bigint not null default 0,
  resolution_count int not null default 0,
  resolution_minutes bigint not null default 0,
  primary key (month, category, author_role)
);
alter table public.support_stats_monthly enable row level security;
revoke all on public.support_stats_monthly from public, anon, authenticated, service_role;

-- A suggestion past its 12 months: a new id, the month it was written, the author's role and its last
-- state; the original text only while the review lasts (30 days), then the checked text or nothing.
create table public.suggestions_anonymous (
  id uuid primary key default gen_random_uuid(),
  created_month date not null check (extract(day from created_month) = 1),
  author_role text not null check (author_role in ('client', 'shop', 'unknown')),
  final_status text not null,
  text_state text not null default 'pending' check (text_state in ('pending', 'confirmed', 'edited', 'removed', 'expired')),
  text text check (text is null or char_length(text) between 1 and 4000),
  pending_text text,
  -- The text with every finding masked; null when something could not be masked (a review must edit).
  proposed_text text,
  findings jsonb not null default '{}'::jsonb,
  review_due_at timestamptz,
  check ((text_state = 'pending') = (pending_text is not null)),
  check ((text_state = 'pending') = (review_due_at is not null)),
  check (text_state = 'pending' or proposed_text is null),
  check ((text_state in ('confirmed', 'edited')) = (text is not null))
);
create index suggestions_anonymous_pending_idx on public.suggestions_anonymous (review_due_at) where text_state = 'pending';
alter table public.suggestions_anonymous enable row level security;
revoke all on public.suggestions_anonymous from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ helpers

create function public.retention_job_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select j.enabled from public.retention_jobs j where j.key = p_key), false)
$$;
revoke execute on function public.retention_job_enabled(text) from public, anon, authenticated;

-- Eligible: 12 calendar months after the last real activity.
create function public.retention_due(p_last_activity timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_last_activity + interval '12 months' <= p_now
$$;
revoke execute on function public.retention_due(timestamptz, timestamptz) from public, anon, authenticated;

-- Which hold keeps a request: 'request' (a hold on it), 'account' (a hold on its author's account) or
-- null.
create function public.retention_hold_kind(s public.suggestions)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.legal_holds h where h.released_at is null and h.suggestion_id = s.id) then 'request'
    when exists (select 1 from public.legal_holds h where h.released_at is null and h.suggestion_id is null
                 and h.subject_id = coalesce(s.author_id, s.former_author_id)) then 'account'
  end
$$;
revoke execute on function public.retention_hold_kind(public.suggestions) from public, anon, authenticated;

-- Luhn check of a string of digits.
create function public.luhn_ok(p_digits text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := length(p_digits);
  s int := 0;
  x int;
begin
  for i in 0 .. n - 1 loop
    x := substr(p_digits, n - i, 1)::int;
    if i % 2 = 1 then
      x := x * 2;
      if x > 9 then
        x := x - 9;
      end if;
    end if;
    s := s + x;
  end loop;
  return n > 0 and s % 10 = 0;
end
$$;
revoke execute on function public.luhn_ok(text) from public, anon, authenticated;

-- A Romanian personal numeric code (CNP) with a valid control digit.
create function public.cnp_ok(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  w int[] := array[2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  s int := 0;
  c int;
begin
  if p !~ '^[1-9][0-9]{12}$' then
    return false;
  end if;
  for i in 1 .. 12 loop
    s := s + substr(p, i, 1)::int * w[i];
  end loop;
  c := s % 11;
  if c = 10 then
    c := 1;
  end if;
  return c = substr(p, 13, 1)::int;
end
$$;
revoke execute on function public.cnp_ok(text) from public, anon, authenticated;

-- What in a suggestion's text could identify somebody, masked: {masked, findings: {kind: n}, total,
-- unmasked}. `unmasked` is true when text_has_secret still finds something after masking (the review
-- must then edit or remove the text). Names cannot be found reliably: the reviewer reads the text.
create function public.suggestion_text_findings(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_text, '');
  f jsonb := '{}'::jsonb;
  m text[];
  n int;
  d text;
  k text;
  rx text;
  tok text;
  total int := 0;
  -- kind, pattern, mask; applied in this order (longer numbers before shorter ones)
  rules text[][] := array[
    array['email', '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]'],
    array['link', '(https?://|www\.)[^[:space:]]*[^[:space:].,;:!?)]', '[link]'],
    array['iban', '\m[A-Za-z]{2}[0-9]{2}(?:[ ]?[A-Za-z0-9]{4}){3,7}(?:[ ]?[A-Za-z0-9]{1,3})?\M', '[IBAN]'],
    array['report_code', '\mSH-[0-9]{4}-[0-9]{4,6}\M', '[cod]'],
    array['booking_code', '\m[Pp]-[0-9]{6,}\M', '[cod]'],
    array['account_code', '\m[ACESacese]-[0-9]{5,}\M', '[cod]'],
    array['vin', '\m(?=[A-HJ-NPR-Za-hj-npr-z0-9]*[0-9])(?=[A-HJ-NPR-Za-hj-npr-z0-9]*[A-HJ-NPR-Za-hj-npr-z])[A-HJ-NPR-Za-hj-npr-z0-9]{17}\M', '[serie șasiu]'],
    array['plate', '\m(B|AB|AG|AR|BC|BH|BN|BR|BT|BV|BZ|CJ|CL|CS|CT|CV|DB|DJ|GJ|GL|GR|HD|HR|IF|IL|IS|MH|MM|MS|NT|OT|PH|SB|SJ|SM|SV|TL|TM|TR|VL|VN|VS)[ -]?[0-9]{2,3}[ -]?[A-Za-z]{3}\M', '[nr. înmatriculare]'],
    array['phone', '(?:\+|\m00)40[ .-]?[0-9]{2,3}[ .-]?[0-9]{3}[ .-]?[0-9]{3,4}\M|\m0[2378][0-9]{1,2}[ .-]?[0-9]{3}[ .-]?[0-9]{3,4}\M', '[telefon]']
  ];
begin
  -- Numbers first: a card (13–19 digits passing Luhn) and a CNP (13 digits, control digit).
  for m in select regexp_matches(v, '(\m[0-9](?:[ -]?[0-9]){12,18}\M)', 'g') loop
    d := regexp_replace(m[1], '[^0-9]', '', 'g');
    if length(d) = 13 and public.cnp_ok(d) then
      k := 'cnp';
    elsif public.luhn_ok(d) then
      k := 'card';
    else
      continue;
    end if;
    v := replace(v, m[1], case k when 'cnp' then '[CNP]' else '[card]' end);
    f := jsonb_set(f, array[k], to_jsonb(coalesce((f->>k)::int, 0) + 1));
    total := total + 1;
  end loop;

  for i in 1 .. array_length(rules, 1) loop
    k := rules[i][1];
    rx := rules[i][2];
    if k = 'plate' then
      n := (select count(*) from regexp_matches(v, rx, 'gi'));
      v := regexp_replace(v, rx, rules[i][3], 'gi');
    else
      n := (select count(*) from regexp_matches(v, rx, 'g'));
      v := regexp_replace(v, rx, rules[i][3], 'g');
    end if;
    if n > 0 then
      f := jsonb_set(f, array[k], to_jsonb(coalesce((f->>k)::int, 0) + n));
      total := total + n;
    end if;
  end loop;

  -- Secrets: a „parolă: …” pair goes whole; a word that is a key or a token on its own goes.
  rx := '\m(?:parol[aăe]|password|passwd|pwd|pin|token|secret|cheie|api[ _-]?key|cod de acces)\s*[:=]\s*[^[:space:]]{3,}[^[:space:].,;:!?)]';
  n := (select count(*) from regexp_matches(v, rx, 'gi'));
  v := regexp_replace(v, rx, '[secret]', 'gi');
  for tok in select t from regexp_split_to_table(v, '\s+') t loop
    if tok <> '' and public.text_has_secret(tok) then
      v := replace(v, tok, '[secret]');
      n := n + 1;
    end if;
  end loop;
  if n > 0 then
    f := jsonb_set(f, '{secret}', to_jsonb(n));
    total := total + n;
  end if;

  return jsonb_build_object('masked', v, 'findings', f, 'total', total, 'unmasked', public.text_has_secret(v));
end
$$;
revoke execute on function public.suggestion_text_findings(text) from public, anon, authenticated;

-- One request's contribution to the anonymous statistics.
create function public.support_stats_add(s public.suggestions)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.support_stats_monthly as x (month, category, author_role, requests, resolved, escalated,
    first_response_count, first_response_minutes, resolution_count, resolution_minutes)
  values (
    date_trunc('month', s.created_at at time zone 'Europe/Bucharest')::date,
    s.category,
    case when s.author_role in ('client', 'shop') then s.author_role else 'unknown' end,
    1,
    (s.resolved_at is not null)::int,
    (s.escalated_at is not null)::int,
    (s.first_response_at is not null)::int,
    coalesce(greatest(0, floor(extract(epoch from s.first_response_at - s.created_at) / 60))::bigint, 0),
    (s.resolved_at is not null)::int,
    coalesce(greatest(0, floor(extract(epoch from s.resolved_at - s.created_at) / 60))::bigint, 0))
  on conflict (month, category, author_role) do update set
    requests = x.requests + excluded.requests,
    resolved = x.resolved + excluded.resolved,
    escalated = x.escalated + excluded.escalated,
    first_response_count = x.first_response_count + excluded.first_response_count,
    first_response_minutes = x.first_response_minutes + excluded.first_response_minutes,
    resolution_count = x.resolution_count + excluded.resolution_count,
    resolution_minutes = x.resolution_minutes + excluded.resolution_minutes
$$;
revoke execute on function public.support_stats_add(public.suggestions) from public, anon, authenticated;

-- Deletes one request whole (its numbers kept first): messages, notes and files go with it (foreign
-- keys; the files' Storage objects queued by the A3b trigger), its signals too, and every notification
-- event that names it. Returns how many files it had.
create function public.support_retention_delete(s public.suggestions)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_files int;
begin
  perform public.support_stats_add(s);
  select count(*)::int into v_files from public.suggestion_files f where f.suggestion_id = s.id;
  delete from public.notification_events e where e.params->>'request_id' = s.id::text;
  delete from public.suggestions where id = s.id;
  return v_files;
end
$$;
revoke execute on function public.support_retention_delete(public.suggestions) from public, anon, authenticated;

-- Moves one suggestion to the anonymous table (review for 30 days) and deletes it whole.
create function public.suggestion_anonymize(s public.suggestions, p_now timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.suggestion_text_findings(s.body);
begin
  insert into public.suggestions_anonymous (created_month, author_role, final_status, pending_text, proposed_text,
    findings, review_due_at)
  values (date_trunc('month', s.created_at at time zone 'Europe/Bucharest')::date,
          case when s.author_role in ('client', 'shop') then s.author_role else 'unknown' end,
          s.status, s.body,
          case when (v_check->>'unmasked')::boolean then null else v_check->>'masked' end,
          v_check->'findings', p_now + interval '30 days');
  return public.support_retention_delete(s);
end
$$;
revoke execute on function public.suggestion_anonymize(public.suggestions, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------ preview (no effect on data)

-- The numbers the next run of a job would act on, the exceptions apart. `stable`: PostgreSQL refuses
-- any INSERT, UPDATE or DELETE inside, so a preview cannot change data.
create function public.retention_preview_counts(p_job text, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_suggestions boolean := p_job = 'suggestions';
  v jsonb;
  v_findings jsonb := '{}'::jsonb;
  v_without int := 0;
  r record;
  k text;
begin
  if p_job not in ('support_requests', 'suggestions') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'job'));
  end if;

  with due as (
    select s.*, public.retention_hold_kind(s) as hold
    from public.suggestions s
    where (s.category = 'suggestions') = v_suggestions
      and public.retention_due(s.last_activity_at, p_now)
  ), eligible as (
    select * from due where hold is null
  )
  select jsonb_build_object(
    'eligible', jsonb_build_object(
      'total', (select count(*) from eligible),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from eligible group by status) x), '{}'::jsonb),
      'messages', (select count(*) from public.suggestion_messages m join eligible e on e.id = m.suggestion_id),
      'notes', (select count(*) from public.suggestion_notes n join eligible e on e.id = n.suggestion_id),
      'files', (select count(*) from public.suggestion_files f join eligible e on e.id = f.suggestion_id),
      'notifications', (select count(*) from public.notification_events ne join eligible e on ne.params->>'request_id' = e.id::text)),
    'exempt', jsonb_build_object(
      'legal_hold', (select count(*) from due where hold is not null),
      'legal_hold_request', (select count(*) from due where hold = 'request'),
      'legal_hold_account', (select count(*) from due where hold = 'account'),
      'author_deleted', (select count(*) from due where hold is not null and author_id is null)),
    'next_due_at', (select min(s.last_activity_at) + interval '12 months' from public.suggestions s
                    where (s.category = 'suggestions') = v_suggestions
                      and not public.retention_due(s.last_activity_at, p_now)))
  into v;

  if v_suggestions then
    for r in
      select public.suggestion_text_findings(s.body) as c
      from public.suggestions s
      where s.category = 'suggestions' and public.retention_due(s.last_activity_at, p_now)
        and public.retention_hold_kind(s) is null
    loop
      for k in select jsonb_object_keys(r.c->'findings') loop
        v_findings := jsonb_set(v_findings, array[k], to_jsonb(coalesce((v_findings->>k)::int, 0) + (r.c->'findings'->>k)::int));
      end loop;
      if (r.c->>'unmasked')::boolean then
        v_without := v_without + 1;
      end if;
    end loop;
    v := v || jsonb_build_object(
      'findings', v_findings,
      'without_proposal', v_without,
      'reviews', jsonb_build_object(
        'pending', (select count(*) from public.suggestions_anonymous where text_state = 'pending'),
        'expiring', (select count(*) from public.suggestions_anonymous where text_state = 'pending' and review_due_at <= p_now),
        'due_7_days', (select count(*) from public.suggestions_anonymous where text_state = 'pending'
                         and review_due_at > p_now and review_due_at <= p_now + interval '7 days')));
  end if;
  return v;
end
$$;
revoke execute on function public.retention_preview_counts(text, timestamptz) from public, anon, authenticated;

create function public.admin_retention_preview(p_job text)
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
revoke execute on function public.admin_retention_preview(text) from public, anon;
grant execute on function public.admin_retention_preview(text) to authenticated;

-- ------------------------------------------------------------------ switching a job

create function public.admin_set_retention_job(p_job text, p_enabled boolean, p_reason text, p_batch_size int,
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
revoke execute on function public.admin_set_retention_job(text, boolean, text, int, jsonb, uuid) from public, anon;
grant execute on function public.admin_set_retention_job(text, boolean, text, int, jsonb, uuid) to authenticated;

create function public.admin_list_retention_jobs()
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
revoke execute on function public.admin_list_retention_jobs() from public, anon;
grant execute on function public.admin_list_retention_jobs() to authenticated;

-- ------------------------------------------------------------------ the runs (pg_cron only)

create function public.retention_run_finish(p_job text, p_started timestamptz, p_counts jsonb, p_failed int, p_remaining int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.retention_runs (job, started_at, counts, failed, remaining)
  values (p_job, p_started, p_counts, p_failed, p_remaining);
  update public.retention_jobs set last_run_at = clock_timestamp() where key = p_job;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (null, 'retention_run', 'retention_job', p_job, null,
          p_counts || jsonb_build_object('failed', p_failed, 'remaining', p_remaining), clock_timestamp());
end
$$;
revoke execute on function public.retention_run_finish(text, timestamptz, jsonb, int, int) from public, anon, authenticated;

create function public.run_support_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.retention_jobs%rowtype;
  s public.suggestions%rowtype;
  v_started timestamptz := clock_timestamp();
  v_deleted int := 0;
  v_files int := 0;
  v_failed int := 0;
  v_remaining int;
  v_counts jsonb;
begin
  select * into j from public.retention_jobs where key = 'support_requests';
  if not found or not j.enabled then
    return null;
  end if;
  for s in
    select * from public.suggestions x
    where x.category <> 'suggestions' and public.retention_due(x.last_activity_at, p_now)
      and public.retention_hold_kind(x) is null
    order by x.last_activity_at, x.id
    limit j.batch_size
    for update skip locked
  loop
    begin
      -- Checked again with the row locked: a reply or a hold may have come meanwhile.
      select * into s from public.suggestions where id = s.id;
      if not found or not public.retention_due(s.last_activity_at, p_now) or public.retention_hold_kind(s) is not null then
        continue;
      end if;
      v_files := v_files + public.support_retention_delete(s);
      v_deleted := v_deleted + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  select count(*)::int into v_remaining from public.suggestions x
  where x.category <> 'suggestions' and public.retention_due(x.last_activity_at, p_now)
    and public.retention_hold_kind(x) is null;
  v_counts := jsonb_build_object('deleted_requests', v_deleted, 'deleted_files', v_files);
  perform public.retention_run_finish('support_requests', v_started, v_counts, v_failed, v_remaining);
  if v_files > 0 then
    perform public.kick_support_files_cleanup();
  end if;
  return v_counts || jsonb_build_object('failed', v_failed, 'remaining', v_remaining);
end
$$;
revoke execute on function public.run_support_retention(timestamptz) from public, anon, authenticated;

create function public.run_suggestion_anonymization(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.retention_jobs%rowtype;
  s public.suggestions%rowtype;
  v_started timestamptz := clock_timestamp();
  v_expired int;
  v_moved int := 0;
  v_files int := 0;
  v_failed int := 0;
  v_remaining int;
  v_counts jsonb;
begin
  -- The 30 days are a promise: a review past its term loses its text whatever the switch says now.
  with gone as (
    update public.suggestions_anonymous
    set text_state = 'expired', pending_text = null, proposed_text = null, review_due_at = null, findings = '{}'::jsonb
    where text_state = 'pending' and review_due_at <= p_now
    returning 1
  )
  select count(*)::int into v_expired from gone;

  select * into j from public.retention_jobs where key = 'suggestions';
  if not found or not j.enabled then
    if v_expired > 0 then
      perform public.retention_run_finish('suggestions', v_started,
        jsonb_build_object('to_review', 0, 'expired_texts', v_expired, 'deleted_files', 0), 0, 0);
      return jsonb_build_object('expired_texts', v_expired);
    end if;
    return null;
  end if;

  for s in
    select * from public.suggestions x
    where x.category = 'suggestions' and public.retention_due(x.last_activity_at, p_now)
      and public.retention_hold_kind(x) is null
    order by x.last_activity_at, x.id
    limit j.batch_size
    for update skip locked
  loop
    begin
      select * into s from public.suggestions where id = s.id;
      if not found or not public.retention_due(s.last_activity_at, p_now) or public.retention_hold_kind(s) is not null then
        continue;
      end if;
      v_files := v_files + public.suggestion_anonymize(s, p_now);
      v_moved := v_moved + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  select count(*)::int into v_remaining from public.suggestions x
  where x.category = 'suggestions' and public.retention_due(x.last_activity_at, p_now)
    and public.retention_hold_kind(x) is null;
  v_counts := jsonb_build_object('to_review', v_moved, 'expired_texts', v_expired, 'deleted_files', v_files);
  perform public.retention_run_finish('suggestions', v_started, v_counts, v_failed, v_remaining);
  if v_files > 0 then
    perform public.kick_support_files_cleanup();
  end if;
  return v_counts || jsonb_build_object('failed', v_failed, 'remaining', v_remaining);
end
$$;
revoke execute on function public.run_suggestion_anonymization(timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_support_retention', '47 3 * * *', 'select public.run_support_retention()');
    perform cron.schedule('sh_suggestion_anonymization', '53 3 * * *', 'select public.run_suggestion_anonymization()');
  end if;
end
$$;

-- ------------------------------------------------------------------ the review (agent or admin)

create function public.support_list_suggestion_reviews(p_state text default 'pending')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  if p_state not in ('pending', 'kept') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'state'));
  end if;
  return jsonb_build_object('now', now(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'created_month', a.created_month, 'author_role', a.author_role, 'final_status', a.final_status,
      'text_state', a.text_state, 'text', a.text, 'original', a.pending_text, 'proposed', a.proposed_text,
      'findings', a.findings, 'review_due_at', a.review_due_at)
      order by case when p_state = 'pending' then a.review_due_at end, a.created_month desc, a.id)
    from (select * from public.suggestions_anonymous x
          where (p_state = 'pending' and x.text_state = 'pending')
             or (p_state = 'kept' and x.text_state in ('confirmed', 'edited'))
          order by case when p_state = 'pending' then x.review_due_at end, x.created_month desc, x.id
          limit 200) a), '[]'::jsonb));
end
$$;
revoke execute on function public.support_list_suggestion_reviews(text) from public, anon;
grant execute on function public.support_list_suggestion_reviews(text) to authenticated;

-- confirm: keeps the proposed text; edit: keeps the reviewer's text when nothing identifying is left in
-- it; remove: keeps no text. The original goes in every case. The audit row names who, when, the action
-- and how many findings there were, never the text or the row.
create function public.support_review_suggestion_text(p_id uuid, p_action text, p_text text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  a public.suggestions_anonymous%rowtype;
  v_text text;
  v_check jsonb;
  v_state text;
  v_findings int;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_review_suggestion_text');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_action is null or p_action not in ('confirm', 'edit', 'remove') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'action'));
  end if;
  select * into a from public.suggestions_anonymous where id = p_id for update;
  if not found then
    perform public.fail('text_review_not_found');
  end if;
  if a.text_state <> 'pending' then
    perform public.fail('text_review_done');
  end if;
  if a.review_due_at <= now() then
    perform public.fail('text_review_expired');
  end if;
  v_findings := coalesce((select sum(value::int) from jsonb_each_text(a.findings)), 0);

  if p_action = 'confirm' then
    if a.proposed_text is null then
      perform public.fail('text_review_needs_edit');
    end if;
    v_text := a.proposed_text;
    v_state := 'confirmed';
  elsif p_action = 'edit' then
    v_text := btrim(coalesce(p_text, ''));
    if char_length(v_text) < 1 or char_length(v_text) > greatest(char_length(a.pending_text), char_length(coalesce(a.proposed_text, '')), 1) then
      perform public.fail('field_invalid', jsonb_build_object('field', 'text', 'min', 1,
        'max', greatest(char_length(a.pending_text), char_length(coalesce(a.proposed_text, '')), 1)));
    end if;
    v_check := public.suggestion_text_findings(v_text);
    if (v_check->>'total')::int > 0 or (v_check->>'unmasked')::boolean then
      perform public.fail('text_identifies', jsonb_build_object('kinds', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_check->'findings') k)));
    end if;
    v_state := 'edited';
  else
    v_text := null;
    v_state := 'removed';
  end if;

  update public.suggestions_anonymous
  set text_state = v_state, text = v_text, pending_text = null, proposed_text = null, review_due_at = null,
      findings = '{}'::jsonb
  where id = a.id;
  perform public.staff_audit('review_suggestion_text', 'suggestion_review', null, null,
    jsonb_build_object('action', p_action, 'findings', v_findings));
  v_result := jsonb_build_object('state', v_state);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_review_suggestion_text(uuid, text, text, uuid) from public, anon;
grant execute on function public.support_review_suggestion_text(uuid, text, text, uuid) to authenticated;

-- ------------------------------------------------------------------ the anonymous statistics (admin)

create function public.admin_support_stats(p_from date, p_to date)
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
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.month, x.category, x.author_role)
    from public.support_stats_monthly x
    where (p_from is null or x.month >= p_from) and (p_to is null or x.month <= p_to)), '[]'::jsonb);
end
$$;
revoke execute on function public.admin_support_stats(date, date) from public, anon;
grant execute on function public.admin_support_stats(date, date) to authenticated;

-- ------------------------------------------------------------------ a legal hold released (A3c2a)

-- As in A3c2a, plus retention: the released requests past their 12 months are deleted (or, suggestions,
-- moved to the review) at once, only when the matching job is on.
create or replace function public.legal_hold_apply_rules(p_subject uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requests int;
  v_files int;
  v_retention int := 0;
  v_req public.suggestions%rowtype;
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

  for v_req in
    select * from public.suggestions x
    where coalesce(x.author_id, x.former_author_id) = p_subject
      and public.retention_due(x.last_activity_at, p_now)
      and not public.legal_hold_covers(x.id, p_subject)
      and public.retention_job_enabled(case when x.category = 'suggestions' then 'suggestions' else 'support_requests' end)
    order by x.last_activity_at, x.id
    for update
  loop
    if v_req.category = 'suggestions' then
      v_files := v_files + public.suggestion_anonymize(v_req, p_now);
    else
      v_files := v_files + public.support_retention_delete(v_req);
    end if;
    v_retention := v_retention + 1;
  end loop;

  if not public.legal_hold_has_subject(p_subject) then
    delete from public.legal_hold_subjects where user_id = p_subject;
  end if;
  return jsonb_build_object('deleted_requests', v_requests + v_retention, 'deleted_files', v_files);
end
$$;

-- ------------------------------------------------------------------ the support dashboard

-- As in A3c2a, plus the suggestions waiting for their text check (agent and admin).
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
  v_counts := v_counts || jsonb_build_object(
    'reviews', (select count(*) from public.suggestions_anonymous where text_state = 'pending'),
    'reviews_soon', (select count(*) from public.suggestions_anonymous where text_state = 'pending'
                       and review_due_at <= now() + interval '7 days'));

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

update public.schema_version set version = 115;
