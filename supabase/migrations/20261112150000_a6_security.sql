-- A6 — Security and control of the team (audit of 12 Nov 2026 on d7cd6c0, schema 118).
--
--   §1  security_events + security_log(): refusals that matter, with who and which session.
--   §2  H1 / L1 / L4: an admin's token only works while its session lives (and, for the team, for
--       8 hours from the sign-in); a deleted or suspended admin is refused everywhere (require_admin,
--       is_admin, support_file_caller); refusals are logged (M3).
--   §3  M1: a suspended account (or a suspended shop) cannot write through the tables or Storage.
--   §4  M3: the session of every audit entry; the reason of an action (A6 §M5) set at insert.
--   §5  M2: the audit log is append-only; only the retention job and the GDPR erasure may change or
--       remove rows, through an unlock row only those two functions can write.
--   §6  H2: an admin opening a client, shop or booking card, a list with personal data or a search
--       leaves an audit entry (at most one per 10 minutes for the same thing).
--   §7  M5: a reason for the sensitive admin actions; exports capped (100 rows, 5 an hour) and
--       without phone numbers or VINs; the owner told when an admin changes the IBAN or billing email.
--   §8  M6: admins can see the other admins, end their sessions, suspend and reactivate them (never
--       the last active one, never themselves) and end their own other sessions.
--   §9  L3: ending a team member's sessions never fails silently.
--   §10 M4: fleet files only through the fleet-files Edge Function (checked, cleaned, limited).
--   §10a L2: generated PDFs limited per person (job documents 30 an hour, reports made again 10).
--   §10b M3: the security log for the admins (Platformă → Securitate).
--   §11 Classes of the new audit actions; schema 119.
--
-- Nothing existing is deleted or rewritten: policies only gain a condition, functions keep their
-- inner code (renamed *_a5 and wrapped), the audit log gains a column.
--
-- Reversible: supabase/rollback/20261112150000_a6_security.sql.

-- ================================================================================================
-- §1 Security events
-- ================================================================================================

-- Events written in a transaction that commits (a cleanup that failed, an admin's sessions ended, a
-- file refused by an Edge Function). A refusal raised inside a database function rolls its
-- transaction back, so it is written to the Postgres log instead (security_log, `sh_security {json}`),
-- which survives the rollback: read in Supabase → Logs (Postgres), filter `sh_security`. The admin
-- screen Platformă → Securitate shows security_events (admin_security_events).
create table public.security_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]{2,60}$'),
  severity text not null check (severity in ('info', 'warning', 'high')),
  actor_id uuid,
  actor_role text,
  actor_display_id text,
  session_id uuid,
  subject_type text check (subject_type is null or char_length(subject_type) <= 40),
  subject_id text check (subject_id is null or char_length(subject_id) <= 80),
  detail jsonb not null default '{}'::jsonb,
  -- Repeats of the same event by the same person on the same thing within one hour are one row.
  bucket timestamptz not null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  occurrences int not null default 1 check (occurrences >= 1)
);
create unique index security_events_group_idx
  on public.security_events (kind, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(subject_id, ''), bucket);
create index security_events_last_idx on public.security_events (last_at desc);
alter table public.security_events enable row level security;
revoke all on public.security_events from public, anon, authenticated, service_role;

-- Who is calling, without anything personal: id, role, ID, session, second step, API path.
create function public.security_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'user', auth.uid(),
    'role', p.role,
    'display_id', p.display_id,
    'session', case when (auth.jwt()->>'session_id') ~ '^[0-9a-fA-F-]{36}$' then auth.jwt()->>'session_id' end,
    'aal', coalesce(auth.jwt()->>'aal', 'aal1'),
    'path', nullif(current_setting('request.path', true), '')))
  from (select 1) x
  left join public.profiles p on p.id = auth.uid()
$$;
revoke all on function public.security_context() from public, anon, authenticated, service_role;

-- A refusal, to the Postgres log (kept even when the transaction is rolled back). Only codes,
-- ids and roles: never a name, an email, a phone number, a token or what was typed.
create function public.security_log(p_kind text, p_severity text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  raise log 'sh_security %', (public.security_context()
    || jsonb_build_object('kind', p_kind, 'severity', p_severity, 'detail', coalesce(p_detail, '{}'::jsonb)))::text;
end
$$;
revoke all on function public.security_log(text, text, jsonb) from public, anon, authenticated, service_role;

-- An event of a transaction that commits: logged as above and kept in security_events, grouped.
create function public.security_record(p_kind text, p_severity text, p_subject_type text, p_subject_id text,
                                       p_detail jsonb default '{}'::jsonb, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_ctx jsonb := public.security_context();
  v_session uuid := case when p_actor is null then public.try_uuid(v_ctx->>'session') end;
  p public.profiles%rowtype;
begin
  perform public.security_log(p_kind, p_severity,
    coalesce(p_detail, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id,
                                                                           'actor', p_actor)));
  select * into p from public.profiles where id = v_actor;
  insert into public.security_events as e (kind, severity, actor_id, actor_role, actor_display_id, session_id,
                                           subject_type, subject_id, detail, bucket)
  values (p_kind, p_severity, v_actor, p.role, p.display_id, v_session, p_subject_type, p_subject_id,
          coalesce(p_detail, '{}'::jsonb), date_trunc('hour', now()))
  on conflict (kind, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(subject_id, ''), bucket)
  do update set occurrences = e.occurrences + 1, last_at = now(), detail = excluded.detail;
  -- Kept 12 months.
  delete from public.security_events where last_at < now() - interval '12 months';
end
$$;
revoke all on function public.security_record(text, text, text, text, jsonb, uuid) from public, anon, authenticated, service_role;

-- The Edge Functions report what they refused (a file, a limit) for the person they checked.
create function public.security_report(p_user uuid, p_kind text, p_severity text, p_detail jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('file_rejected', 'limit_documents', 'limit_fleet_uploads', 'admin_session_invalid', 'admin_denied',
                    'access_denied')
     or p_severity not in ('info', 'warning', 'high') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'kind'));
  end if;
  perform public.security_record(p_kind, p_severity, 'account', p_user::text, p_detail, p_user);
end
$$;
revoke all on function public.security_report(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.security_report(uuid, text, text, jsonb) to service_role;

-- ================================================================================================
-- §2 Sessions (H1, L1)
-- ================================================================================================

-- How long a team member's sign-in lasts (A6 L4): 8 hours from the sign-in, then the second step
-- again. Supabase's own session time-box would apply to every client and shop too; this one applies
-- only where caller_session_alive is asked, which is only for the team (admins and agents).
create function public.staff_session_hours()
returns integer
language sql
immutable
set search_path = ''
as $$ select 8 $$;

-- The session of the token still exists, has not reached its end (`not_after`, set by Supabase Auth
-- when a session time-box is configured) and is younger than staff_session_hours(). Read from
-- auth.sessions, never from the browser. Asked only by the team's checks.
create or replace function public.caller_session_alive()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sid text := auth.jwt()->>'session_id';
begin
  if v_sid is null or v_sid !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = v_sid::uuid and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
      and s.created_at > now() - make_interval(hours => public.staff_session_hours()));
end
$$;

-- Signed in and not suspended. A suspended account trying to act is logged (M3).
create or replace function public.require_caller()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  select * into v from public.profiles where id = auth.uid();
  if not found then
    perform public.fail('not_signed_in');
  end if;
  if v.suspended then
    perform public.security_log('suspended_action', 'warning');
    perform public.fail('account_suspended');
  end if;
  return v;
end
$$;

-- An admin: role admin, not deleted, second step of sign-in, and its session still exists (A6 H1:
-- signing out or ending the session stops the token at once, as for an agent since A2).
create or replace function public.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role <> 'admin' then
    perform public.security_log('admin_denied', 'high', jsonb_build_object('role', v.role));
    perform public.fail('not_allowed');
  end if;
  if v.deleted_at is not null then
    perform public.security_log('deleted_account_access', 'high');
    perform public.fail('not_allowed');
  end if;
  if public.caller_aal() <> 'aal2' then
    perform public.security_log('mfa_missing', 'warning');
    perform public.fail('mfa_required');
  end if;
  if not public.caller_session_alive() then
    perform public.security_log('session_revoked', 'warning');
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$$;

-- The team (agent or admin): the same checks; an agent's session was already checked since A2,
-- an admin's is now too.
create or replace function public.require_staff()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role not in ('support', 'admin') then
    perform public.security_log('staff_denied', 'high', jsonb_build_object('role', v.role));
    perform public.fail('not_allowed');
  end if;
  if v.deleted_at is not null then
    perform public.security_log('deleted_account_access', 'high');
    perform public.fail('not_allowed');
  end if;
  if public.caller_aal() <> 'aal2' then
    perform public.security_log('mfa_missing', 'warning');
    perform public.fail('mfa_required');
  end if;
  if not public.caller_session_alive() then
    perform public.security_log('session_revoked', 'warning');
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$$;

-- The support files' Edge Function (A3b) checks its caller with the session id of the token: an
-- agent's session was checked since A3b, an admin's now too, with the same end and 8-hour limit as
-- caller_session_alive (found while doing H1: the same gap on another path).
create or replace function public.support_file_caller(p_user uuid, p_aal text, p_session uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  select * into v from public.profiles where id = p_user;
  if not found or v.deleted_at is not null then
    perform public.fail('not_signed_in');
  end if;
  if v.role in ('client', 'shop') then
    -- An author, suspended included (it may still write to support).
    return v;
  end if;
  if v.role not in ('support', 'admin') then
    perform public.fail('not_allowed');
  end if;
  if v.suspended then
    perform public.fail('account_suspended');
  end if;
  if p_aal is distinct from 'aal2' then
    perform public.fail('mfa_required');
  end if;
  if p_session is null or not exists (
       select 1 from auth.sessions s
       where s.id = p_session and s.user_id = p_user
         and (s.not_after is null or s.not_after > now())
         and s.created_at > now() - make_interval(hours => public.staff_session_hours())) then
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$$;

-- The admin check of the access rules (RLS) and of the can_read_* helpers: the same as
-- require_admin, answering false instead of refusing. Only an admin's dead session is logged
-- (every other account passes here on every read).
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin' and not p.suspended and p.deleted_at is null) then
    return false;
  end if;
  if public.caller_aal() <> 'aal2' then
    return false;
  end if;
  if not public.caller_session_alive() then
    perform public.security_log('session_revoked', 'warning', jsonb_build_object('via', 'is_admin'));
    return false;
  end if;
  return true;
end
$$;

-- admin_force_cancel checked is_admin() itself and answered `not_allowed` for a dead session; the
-- full admin check first gives the same answers as every other admin function (not_signed_in).
alter function public.admin_force_cancel(uuid, text, uuid) rename to admin_force_cancel_a5;
revoke all on function public.admin_force_cancel_a5(uuid, text, uuid) from public, anon, authenticated, service_role;
create function public.admin_force_cancel(p_booking_id uuid, p_reason text, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.admin_force_cancel_a5(p_booking_id, p_reason, p_request_id);
end
$$;
revoke all on function public.admin_force_cancel(uuid, text, uuid) from public, anon;
grant execute on function public.admin_force_cancel(uuid, text, uuid) to authenticated, service_role;

-- ================================================================================================
-- §3 Suspended accounts and shops cannot write directly (M1)
-- ================================================================================================

-- The caller may write its own rows: signed in, not suspended, not deleted.
create function public.caller_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and not p.suspended and p.deleted_at is null)
$$;
revoke all on function public.caller_can_write() from public, anon;
grant execute on function public.caller_can_write() to authenticated, service_role;

-- A shop's data may be written by its people: the caller may write, the shop is not suspended and
-- its owner is not suspended either (a suspended owner's shop is suspended in effect).
create function public.shop_writable(p_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.caller_can_write() and exists (
    select 1 from public.shops s join public.profiles o on o.id = s.owner_id
    where s.id = p_shop_id and not s.suspended and not o.suspended)
$$;
revoke all on function public.shop_writable(uuid) from public, anon;
grant execute on function public.shop_writable(uuid) to authenticated, service_role;

alter policy cars_insert_own on public.cars
  with check (owner_id = auth.uid() and public.caller_can_write()
              and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client'));
alter policy cars_update_own on public.cars
  using (owner_id = auth.uid() and public.caller_can_write()) with check (owner_id = auth.uid() and public.caller_can_write());
alter policy cars_delete_own on public.cars
  using (owner_id = auth.uid() and public.caller_can_write());

alter policy shops_update_owner on public.shops
  using (public.is_shop_owner(id) and public.shop_writable(id)) with check (public.is_shop_owner(id) and public.shop_writable(id));
alter policy shop_billing_update_owner on public.shop_billing
  using (public.is_shop_owner(shop_id) and public.shop_writable(shop_id))
  with check (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_hours_update_owner on public.shop_hours
  using (public.is_shop_owner(shop_id) and public.shop_writable(shop_id))
  with check (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_closures_insert_owner on public.shop_closures
  with check (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_closures_update_owner on public.shop_closures
  using (public.is_shop_owner(shop_id) and public.shop_writable(shop_id))
  with check (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_closures_delete_owner on public.shop_closures
  using (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_photos_add on public.shop_photos
  with check (public.is_shop_member(shop_id) and public.shop_writable(shop_id)
              and path like shop_id::text || '/%'
              and url like '%/storage/v1/object/public/shop-photos/' || shop_id::text || '/%');
alter policy shop_photos_order on public.shop_photos
  using (public.is_shop_member(shop_id) and public.shop_writable(shop_id))
  with check (public.is_shop_member(shop_id) and public.shop_writable(shop_id));
alter policy shop_photos_remove on public.shop_photos
  using (public.is_shop_member(shop_id) and public.shop_writable(shop_id));
alter policy shop_services_insert_owner on public.shop_services
  with check (public.is_shop_owner(shop_id) and public.shop_writable(shop_id)
              and exists (select 1 from public.services sv where sv.id = shop_services.service_id and sv.enabled));
alter policy shop_services_delete_owner on public.shop_services
  using (public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
alter policy shop_staff_delete_owner on public.shop_staff
  using (role = 'staff' and public.is_shop_owner(shop_id) and public.shop_writable(shop_id));
-- Kept on purpose: removing one's own push device (push_subscriptions_delete_own) and marking a
-- notice as read (notice_reads_insert_own) — privacy and reading, not data.

-- Storage: the same rule for every file a person writes. Reading is unchanged.
alter policy logos_insert_owner on storage.objects
  with check (bucket_id = 'logos' and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
              and public.shop_writable(public.try_uuid((storage.foldername(name))[1])));
alter policy logos_update_owner on storage.objects
  using (bucket_id = 'logos' and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
         and public.shop_writable(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'logos' and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
              and public.shop_writable(public.try_uuid((storage.foldername(name))[1])));
alter policy logos_delete_owner on storage.objects
  using (bucket_id = 'logos' and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
         and public.shop_writable(public.try_uuid((storage.foldername(name))[1])));
alter policy shop_photos_files_insert on storage.objects
  with check (bucket_id = 'shop-photos' and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
              and public.shop_writable(public.try_uuid((storage.foldername(name))[1])));
alter policy shop_photos_files_delete on storage.objects
  using (bucket_id = 'shop-photos' and public.is_shop_member(public.try_uuid((storage.foldername(name))[1]))
         and public.shop_writable(public.try_uuid((storage.foldername(name))[1])));
alter policy intake_photos_insert on storage.objects
  with check (bucket_id = 'intake-photos' and public.is_booking_shop_member(public.try_uuid((storage.foldername(name))[1]))
              and public.shop_writable((select b.shop_id from public.bookings b
                                        where b.id = public.try_uuid((storage.foldername(name))[1]))));
alter policy intake_photos_delete on storage.objects
  using (bucket_id = 'intake-photos' and public.is_booking_shop_member(public.try_uuid((storage.foldername(name))[1]))
         and public.shop_writable((select b.shop_id from public.bookings b
                                   where b.id = public.try_uuid((storage.foldername(name))[1]))));
alter policy fleet_files_delete on storage.objects
  using (bucket_id = 'fleet-files' and public.caller_can_write() and
         case when public.fleet_issue_path(name) then public.fleet_issue_photo_can_delete(name, owner)
              else (public.fleet_can(public.try_uuid((storage.foldername(name))[1]), 'costs.manage') or owner = auth.uid()) end);
-- §10: a fleet file is written only by the fleet-files Edge Function, which checks and cleans it.
drop policy fleet_files_insert on storage.objects;

-- The profile: a suspended person may still switch the language and hide the hints it reads, and
-- nothing else. Only writes through the API as the person (the role `authenticated`) are checked:
-- the database functions (admin, Auth, jobs) run as their owner and are not concerned.
create function public.profiles_suspended_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (old.suspended or old.deleted_at is not null)
     and (to_jsonb(new) - array['lang', 'tour_seen_at', 'guide_hidden_at', 'push_prompt_dismissed_at',
                                'location_prompt_dismissed_at', 'updated_at'])
         is distinct from
         (to_jsonb(old) - array['lang', 'tour_seen_at', 'guide_hidden_at', 'push_prompt_dismissed_at',
                                'location_prompt_dismissed_at', 'updated_at']) then
    -- Runs as the person (current_user is checked above), who may not call security_log or fail: the
    -- same log line and the same error, written here.
    raise log 'sh_security %', jsonb_build_object('kind', 'suspended_write', 'severity', 'warning',
      'user', auth.uid(), 'detail', jsonb_build_object('table', 'profiles'))::text;
    raise exception using errcode = 'P0001', message = 'account_suspended', detail = '{}';
  end if;
  return new;
end
$$;
create trigger profiles_suspended_guard before update on public.profiles
  for each row execute function public.profiles_suspended_guard();

-- ================================================================================================
-- §4 The session and the reason of each audit entry (M3, M5)
-- ================================================================================================

alter table public.admin_audit_log add column session_id uuid;
create index admin_audit_log_actor_idx on public.admin_audit_log (admin_id, action, created_at desc);

-- At insert: the author's role and ID (A2), the session of the token that made the change (none
-- for jobs and Edge Functions, which act without a person's token: never guessed), and the reason
-- an A6 wrapper collected for this action (sh.audit_reason, transaction-local).
create or replace function public.admin_audit_log_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid text := auth.jwt()->>'session_id';
  v_reason text := nullif(current_setting('sh.audit_reason', true), '');
begin
  if new.admin_id is not null and (new.actor_role is null or new.actor_display_id is null) then
    select coalesce(new.actor_role, p.role), coalesce(new.actor_display_id, p.display_id)
      into new.actor_role, new.actor_display_id
    from public.profiles p where p.id = new.admin_id;
  end if;
  if new.session_id is null and new.admin_id is not null and new.admin_id = auth.uid()
     and v_sid ~ '^[0-9a-fA-F-]{36}$' then
    new.session_id := v_sid::uuid;
  end if;
  if new.reason is null and v_reason is not null then
    new.reason := v_reason;
  end if;
  return new;
end
$$;

-- A reason for an action: required, trimmed, at most 500 characters.
create function public.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v) > 500 then
    perform public.fail('reason_too_long');
  end if;
  return v;
end
$$;
revoke all on function public.require_reason(text) from public, anon, authenticated;

-- ================================================================================================
-- §5 The audit log is append-only (M2)
-- ================================================================================================

-- Only the retention job (run_audit_retention) and the erasure of an account's data
-- (audit_forget_account) change or remove rows. Each writes, for its own transaction, a row here
-- and deletes it at its end; the guard below lets a change through only while that row exists.
-- Nobody but the owner can write this table (no grant, no other function), so neither a person
-- nor the service role can unlock the log. The owner of the database (SQL Editor) is outside any
-- protection a table can give; the launch reset (docs/sql/reset_before_launch.sql) unlocks it the
-- same way, in writing.
create table public.audit_log_unlocks (
  txid bigint primary key,
  purpose text not null check (purpose in ('retention', 'erasure', 'launch_reset')),
  created_at timestamptz not null default now()
);
alter table public.audit_log_unlocks enable row level security;
revoke all on public.audit_log_unlocks from public, anon, authenticated, service_role;

create function public.audit_log_unlock(p_purpose text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log_unlocks (txid, purpose) values (txid_current(), p_purpose)
  on conflict (txid) do nothing;
  return found;
end
$$;
revoke all on function public.audit_log_unlock(text) from public, anon, authenticated, service_role;

create function public.audit_log_relock()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.audit_log_unlocks where txid = txid_current()
$$;
revoke all on function public.audit_log_relock() from public, anon, authenticated, service_role;

create function public.admin_audit_log_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.audit_log_unlocks u where u.txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform public.security_log('audit_log_tamper', 'high', jsonb_build_object('op', tg_op, 'role', current_user));
  raise exception 'audit_log_append_only' using errcode = '42501';
end
$$;
create trigger admin_audit_log_guard before update or delete on public.admin_audit_log
  for each row execute function public.admin_audit_log_guard();

create function public.admin_audit_log_guard_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.audit_log_unlocks u where u.txid = txid_current() and u.purpose = 'launch_reset') then
    return null;
  end if;
  perform public.security_log('audit_log_tamper', 'high', jsonb_build_object('op', 'TRUNCATE', 'role', current_user));
  raise exception 'audit_log_append_only' using errcode = '42501';
end
$$;
create trigger admin_audit_log_guard_truncate before truncate on public.admin_audit_log
  for each statement execute function public.admin_audit_log_guard_truncate();

-- Nobody changes the log through the API, the service role included (it keeps adding and reading).
revoke update, delete, truncate, references, trigger on public.admin_audit_log from public, anon, authenticated, service_role;

-- The two mechanisms allowed to change the log: unchanged inside (A3c2b2), each now unlocking the
-- log for its own transaction only and locking it again when done.
alter function public.run_audit_retention(text, timestamptz) rename to run_audit_retention_a5;
revoke all on function public.run_audit_retention_a5(text, timestamptz) from public, anon, authenticated, service_role;
create function public.run_audit_retention(p_job text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_mine boolean;
begin
  v_mine := public.audit_log_unlock('retention');
  v := public.run_audit_retention_a5(p_job, p_now);
  if v_mine then
    perform public.audit_log_relock();
  end if;
  return v;
end
$$;
revoke all on function public.run_audit_retention(text, timestamptz) from public, anon, authenticated;
grant execute on function public.run_audit_retention(text, timestamptz) to service_role;

alter function public.audit_forget_account(uuid, text, text, text) rename to audit_forget_account_a5;
revoke all on function public.audit_forget_account_a5(uuid, text, text, text) from public, anon, authenticated, service_role;
create function public.audit_forget_account(p_user uuid, p_name text, p_email text, p_phone text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  v_mine boolean;
begin
  v_mine := public.audit_log_unlock('erasure');
  n := public.audit_forget_account_a5(p_user, p_name, p_email, p_phone);
  if v_mine then
    perform public.audit_log_relock();
  end if;
  return n;
end
$$;
revoke all on function public.audit_forget_account(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ================================================================================================
-- §6 What an admin opens is in the audit log (H2)
-- ================================================================================================

-- One entry for a view, written by the database function that answers it (never by the browser):
-- the admin, the action, the object, when; details without personal data (never the words of a
-- search, only whether there were any). The same view of the same thing within 10 minutes (a
-- refresh, a live update) is the same entry.
create function public.audit_view(p_action text, p_entity_type text, p_entity_id text, p_after jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('audit_view:' || auth.uid()::text || ':' || p_action || ':' || coalesce(p_entity_id, ''), 0));
  if exists (
    select 1 from public.admin_audit_log l
    where l.admin_id = auth.uid() and l.action = p_action
      and l.entity_id is not distinct from p_entity_id
      and l.after is not distinct from p_after
      and l.created_at > clock_timestamp() - interval '10 minutes') then
    return;
  end if;
  perform public.staff_audit(p_action, p_entity_type, p_entity_id, null, p_after);
end
$$;
revoke all on function public.audit_view(text, text, text, jsonb) from public, anon, authenticated, service_role;

alter function public.admin_get_client(uuid) rename to admin_get_client_a5;
alter function public.admin_get_shop(uuid) rename to admin_get_shop_a5;
alter function public.admin_get_booking(uuid) rename to admin_get_booking_a5;
alter function public.admin_list_clients() rename to admin_list_clients_a5;
alter function public.admin_list_shops() rename to admin_list_shops_a5;
alter function public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer) rename to admin_list_bookings_a5;
alter function public.admin_list_reviews(text) rename to admin_list_reviews_a5;
alter function public.admin_list_fleet_companies() rename to admin_list_fleet_companies_a5;
alter function public.admin_vehicle_duplicates() rename to admin_vehicle_duplicates_a5;
revoke all on function public.admin_get_client_a5(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_shop_a5(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_booking_a5(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_clients_a5() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_shops_a5() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_bookings_a5(text[], uuid, uuid, date, date, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_reviews_a5(text) from public, anon, authenticated, service_role;
revoke all on function public.admin_list_fleet_companies_a5() from public, anon, authenticated, service_role;
revoke all on function public.admin_vehicle_duplicates_a5() from public, anon, authenticated, service_role;

create function public.admin_get_client(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_get_client_a5(p_user_id);
  perform public.audit_view('view_client', 'profile', p_user_id::text);
  return v;
end
$$;

create function public.admin_get_shop(p_shop_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_get_shop_a5(p_shop_id);
  perform public.audit_view('view_shop', 'shop', p_shop_id::text);
  return v;
end
$$;

create function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_get_booking_a5(p_booking_id);
  perform public.audit_view('view_booking', 'booking', p_booking_id::text);
  return v;
end
$$;

create function public.admin_list_clients()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_list_clients_a5();
  perform public.audit_view('view_client_list', 'list', 'clients', jsonb_build_object('rows', jsonb_array_length(v)));
  return v;
end
$$;

create function public.admin_list_shops()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_list_shops_a5();
  perform public.audit_view('view_shop_list', 'list', 'shops', jsonb_build_object('rows', jsonb_array_length(v)));
  return v;
end
$$;

create function public.admin_list_bookings(p_statuses text[] default null, p_shop_id uuid default null,
                                           p_client_id uuid default null, p_from date default null,
                                           p_to date default null, p_q text default null, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_list_bookings_a5(p_statuses, p_shop_id, p_client_id, p_from, p_to, p_q, p_limit);
  perform public.audit_view('search_bookings', 'list', 'bookings', jsonb_strip_nulls(jsonb_build_object(
    'search', nullif(btrim(coalesce(p_q, '')), '') is not null,
    'statuses', p_statuses, 'shop_id', p_shop_id, 'client_id', p_client_id, 'from', p_from, 'to', p_to)));
  return v;
end
$$;

create function public.admin_list_reviews(p_q text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_list_reviews_a5(p_q);
  perform public.audit_view('search_reviews', 'list', 'reviews',
    jsonb_build_object('search', nullif(btrim(coalesce(p_q, '')), '') is not null));
  return v;
end
$$;

create function public.admin_list_fleet_companies()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_list_fleet_companies_a5();
  perform public.audit_view('view_company_list', 'list', 'companies', null);
  return v;
end
$$;

create function public.admin_vehicle_duplicates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_admin();
  v := public.admin_vehicle_duplicates_a5();
  perform public.audit_view('view_vehicle_duplicates', 'list', 'vehicles', null);
  return v;
end
$$;

revoke all on function public.admin_get_client(uuid), public.admin_get_shop(uuid), public.admin_get_booking(uuid),
  public.admin_list_clients(), public.admin_list_shops(),
  public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer), public.admin_list_reviews(text),
  public.admin_list_fleet_companies(), public.admin_vehicle_duplicates() from public, anon;
grant execute on function public.admin_get_client(uuid), public.admin_get_shop(uuid), public.admin_get_booking(uuid),
  public.admin_list_clients(), public.admin_list_shops(),
  public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer), public.admin_list_reviews(text),
  public.admin_list_fleet_companies(), public.admin_vehicle_duplicates() to authenticated, service_role;

-- ================================================================================================
-- §7 Sensitive admin actions: a reason, limits, the owner told (M5)
-- ================================================================================================

-- The reason travels to the audit entry the action writes (admin_audit_log_actor reads it), so the
-- actions themselves stay as they are. Validated here, before anything changes; a retry with the
-- same request id answers the first result as before.
alter function public.admin_verify_phone(uuid, uuid) rename to admin_verify_phone_a5;
alter function public.admin_grant_report_credit(uuid, uuid) rename to admin_grant_report_credit_a5;
alter function public.admin_set_subscription_price(uuid, numeric, uuid) rename to admin_set_subscription_price_a5;
alter function public.admin_extend_trial(uuid, integer, uuid) rename to admin_extend_trial_a5;
alter function public.admin_extend_company_trial(uuid, integer, uuid) rename to admin_extend_company_trial_a5;
alter function public.admin_set_company_plan(uuid, text, uuid) rename to admin_set_company_plan_a5;
alter function public.admin_update_settings(jsonb, uuid) rename to admin_update_settings_a5;
alter function public.admin_update_shop(uuid, jsonb, jsonb, uuid) rename to admin_update_shop_a5;
alter function public.admin_set_account_suspended(uuid, boolean, text, uuid) rename to admin_set_account_suspended_a5;
alter function public.admin_set_shop_suspended(uuid, boolean, text, uuid) rename to admin_set_shop_suspended_a5;
revoke all on function public.admin_verify_phone_a5(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_report_credit_a5(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_subscription_price_a5(uuid, numeric, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_extend_trial_a5(uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_extend_company_trial_a5(uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_company_plan_a5(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_settings_a5(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_update_shop_a5(uuid, jsonb, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_account_suspended_a5(uuid, boolean, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_set_shop_suspended_a5(uuid, boolean, text, uuid) from public, anon, authenticated, service_role;

create function public.with_audit_reason(p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v text;
begin
  perform public.require_admin();
  v := public.require_reason(p_reason);
  perform set_config('sh.audit_reason', v, true);
  return v;
end
$$;
revoke all on function public.with_audit_reason(text) from public, anon, authenticated, service_role;

create function public.admin_verify_phone(p_user_id uuid, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_verify_phone_a5(p_user_id, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_grant_report_credit(p_user_id uuid, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_grant_report_credit_a5(p_user_id, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_set_subscription_price(p_shop_id uuid, p_price numeric, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_set_subscription_price_a5(p_shop_id, p_price, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_extend_trial(p_shop_id uuid, p_days integer, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_extend_trial_a5(p_shop_id, p_days, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_extend_company_trial(p_company uuid, p_days integer, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_extend_company_trial_a5(p_company, p_days, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_set_company_plan(p_company uuid, p_plan_key text, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_set_company_plan_a5(p_company, p_plan_key, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_update_settings(p_settings jsonb, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform public.with_audit_reason(p_reason);
  v := public.admin_update_settings_a5(p_settings, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

-- Reactivating needs a reason too now, like suspending (A6).
create function public.admin_set_account_suspended(p_user_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_reason text;
begin
  v_reason := public.with_audit_reason(p_reason);
  v := public.admin_set_account_suspended_a5(p_user_id, p_suspended, v_reason, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

create function public.admin_set_shop_suspended(p_shop_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_reason text;
begin
  v_reason := public.with_audit_reason(p_reason);
  v := public.admin_set_shop_suspended_a5(p_shop_id, p_suspended, v_reason, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  return v;
end $$;

-- Editing a shop: a reason; when the IBAN or the billing email really changed, its owner is told
-- (push and email), with only which fields changed and the last 4 characters of the new IBAN. A
-- retry of the same request does not tell again; a failed change tells nothing (same transaction).
create function public.admin_update_shop(p_shop_id uuid, p_shop jsonb, p_billing jsonb, p_request_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  v_retry boolean;
  b_old public.shop_billing%rowtype;
  b_new public.shop_billing%rowtype;
  v_fields text[] := '{}';
begin
  perform public.with_audit_reason(p_reason);
  v_retry := exists (select 1 from public.request_log r where r.request_id = p_request_id);
  select * into b_old from public.shop_billing where shop_id = p_shop_id;
  v := public.admin_update_shop_a5(p_shop_id, p_shop, p_billing, p_request_id);
  perform set_config('sh.audit_reason', '', true);
  if not v_retry and b_old.shop_id is not null then
    select * into b_new from public.shop_billing where shop_id = p_shop_id;
    if b_new.iban is distinct from b_old.iban then v_fields := v_fields || 'iban'::text; end if;
    if b_new.billing_email is distinct from b_old.billing_email then v_fields := v_fields || 'billing_email'::text; end if;
    if cardinality(v_fields) > 0 then
      perform public.notify_shop_owner(p_shop_id, 'billing_changed', jsonb_strip_nulls(jsonb_build_object(
        'fields', to_jsonb(v_fields),
        'iban_end', case when 'iban' = any (v_fields) and b_new.iban is not null then right(b_new.iban, 4) end)));
    end if;
  end if;
  return v;
end $$;

revoke all on function public.admin_verify_phone(uuid, uuid, text), public.admin_grant_report_credit(uuid, uuid, text),
  public.admin_set_subscription_price(uuid, numeric, uuid, text), public.admin_extend_trial(uuid, integer, uuid, text),
  public.admin_extend_company_trial(uuid, integer, uuid, text), public.admin_set_company_plan(uuid, text, uuid, text),
  public.admin_update_settings(jsonb, uuid, text), public.admin_set_account_suspended(uuid, boolean, text, uuid),
  public.admin_set_shop_suspended(uuid, boolean, text, uuid), public.admin_update_shop(uuid, jsonb, jsonb, uuid, text)
  from public, anon;
grant execute on function public.admin_verify_phone(uuid, uuid, text), public.admin_grant_report_credit(uuid, uuid, text),
  public.admin_set_subscription_price(uuid, numeric, uuid, text), public.admin_extend_trial(uuid, integer, uuid, text),
  public.admin_extend_company_trial(uuid, integer, uuid, text), public.admin_set_company_plan(uuid, text, uuid, text),
  public.admin_update_settings(jsonb, uuid, text), public.admin_set_account_suspended(uuid, boolean, text, uuid),
  public.admin_set_shop_suspended(uuid, boolean, text, uuid), public.admin_update_shop(uuid, jsonb, jsonb, uuid, text)
  to authenticated, service_role;

-- Exports: a reason, at most 5 an hour per admin and 100 rows each, no phone numbers or VINs, the
-- words of a search never in the log. Its lists are read directly (not through the audited views).
drop function public.admin_export(text, jsonb);
CREATE FUNCTION public.admin_export(p_kind text, p_filters jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_statuses text[];
  v_q text;
  v_fold text;
  v_plate text;
  v_rows jsonb;
  v_reason text;
  v_total int;
begin
  perform public.require_admin();
  v_reason := public.require_reason(p_reason);
  -- At most 5 exports an hour per admin (A6 M5), whatever the kind or the filters.
  if not public.rate_take('admin_export', auth.uid(), 5, interval '1 hour') then
    perform public.security_log('export_limited', 'warning', jsonb_build_object('kind', p_kind));
    perform public.fail('limit_exports');
  end if;
  if p_kind = 'shops' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'street', s.street, 'county', s.county, 'postal_code', s.postal_code,
          'rating', r.average, 'review_count', coalesce(r.review_count, 0),
          'bookings', (select count(*) from public.bookings b where b.shop_id = s.id),
          'price_ron', sub.price_ron)
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_shops_a5()) with ordinality l
      join public.shops s on s.id = (l.value->>'id')::uuid
      left join public.shop_ratings r on r.shop_id = s.id
      left join public.subscriptions sub on sub.shop_id = s.id), '[]'::jsonb);
  elsif p_kind = 'clients' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'lang', p.lang,
          'cars', (select count(*) from public.cars c where c.owner_id = p.id))
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_clients_a5()) with ordinality l
      join public.profiles p on p.id = (l.value->>'id')::uuid), '[]'::jsonb);
  elsif p_kind = 'subscriptions' then
    v_rows := public.admin_subscription_rows();
  elsif p_kind = 'bookings' then
    v_statuses := case when jsonb_typeof(f->'statuses') = 'array'
                       then array(select jsonb_array_elements_text(f->'statuses')) end;
    v_q := public.clean_text(f->>'q');
    v_fold := public.fold_text(v_q);
    v_plate := nullif(regexp_replace(upper(coalesce(v_q, '')), '[^A-Z0-9]', '', 'g'), '');
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'ref', b.ref, 'status', b.status, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
          'created_at', b.created_at, 'shop_name', s.name, 'shop_city', s.city,
          'client_display_id', cp.display_id, 'client_name', b.client_name, 'client_phone', b.client_phone,
          'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
          'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
          'make', b.car_snapshot->>'make', 'model', b.car_snapshot->>'model', 'year', b.car_snapshot->>'year',
          'plate', b.car_snapshot->>'plate', 'vin', b.car_snapshot->>'vin',
          'odometer', b.odometer, 'cost', b.cost, 'cancelled_by', b.cancelled_by,
          'reason', coalesce(b.cancel_reason, b.decline_reason))
        order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.profiles cp on cp.id = b.client_id
      left join public.services sv on sv.id = b.service_id
      where (v_statuses is null or cardinality(v_statuses) = 0 or b.status = any (v_statuses))
        and (public.try_uuid(f->>'shop_id') is null or b.shop_id = public.try_uuid(f->>'shop_id'))
        and (public.try_uuid(f->>'client_id') is null or b.client_id = public.try_uuid(f->>'client_id'))
        and (f->>'from' is null or b.date >= (f->>'from')::date)
        and (f->>'to' is null or b.date <= (f->>'to')::date)
        and (v_q is null
             or b.ref ilike '%' || v_q || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_fold || '%'
             or public.fold_text(s.name) like '%' || v_fold || '%')), '[]'::jsonb);
  elsif p_kind = 'company_checks' then
    v_rows := public.admin_list_company_checks();
  elsif p_kind = 'reviews' then
    v_q := public.fold_text(public.clean_text(f->>'q'));
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'created_at', r.created_at, 'shop_name', s.name, 'shop_city', s.city, 'ref', b.ref,
          'client_display_id', cp.display_id, 'client_display_name', r.client_display_name,
          'rating', r.rating, 'text', r.text, 'reply', r.reply,
          'report_reason', r.report_reason, 'reported_at', r.reported_at, 'report_status', r.report_status,
          'removed_at', r.removed_at)
        order by r.created_at desc, r.id)
      from public.reviews r
      join public.shops s on s.id = r.shop_id
      left join public.bookings b on b.id = r.booking_id
      left join public.profiles cp on cp.id = r.client_id
      where v_q is null
         or public.fold_text(coalesce(r.text, '')) like '%' || v_q || '%'
         or public.fold_text(coalesce(r.reply, '')) like '%' || v_q || '%'
         or public.fold_text(s.name) like '%' || v_q || '%'
         or public.fold_text(r.client_display_name) like '%' || v_q || '%'), '[]'::jsonb);
  else
    perform public.fail('kind_invalid');
  end if;

  -- The rows a screen shows after its own filters (shops, clients, subscriptions, ANAF checks are
  -- filtered in the browser): their ids, so the file holds what the admin sees, still within the
  -- cap below. An id the list does not hold adds nothing.
  if jsonb_typeof(f->'ids') = 'array' then
    v_rows := coalesce((
      select jsonb_agg(e.value order by e.n)
      from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) with ordinality e(value, n)
      where coalesce(e.value->>'id', e.value->>'shop_id') in (select jsonb_array_elements_text(f->'ids'))), '[]'::jsonb);
  end if;

  -- Only what an export is for: no phone numbers and no VINs; at most 100 rows (the first, in the
  -- order of the list), with no way around it (no page, no offset).
  v_total := jsonb_array_length(coalesce(v_rows, '[]'::jsonb));
  v_rows := coalesce((
    select jsonb_agg(e.value - array['phone', 'phone2', 'owner_phone', 'client_phone', 'vin'] order by e.n)
    from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) with ordinality e(value, n)
    where e.n <= 100), '[]'::jsonb);

  perform public.staff_audit('export', 'export', p_kind, null,
    jsonb_build_object('kind', p_kind,
                       'filters', (f - 'q' - 'ids')
                                  || case when nullif(btrim(coalesce(f->>'q', '')), '') is not null
                                          then jsonb_build_object('search', true) else '{}'::jsonb end
                                  || case when jsonb_typeof(f->'ids') = 'array'
                                          then jsonb_build_object('selected', jsonb_array_length(f->'ids')) else '{}'::jsonb end,
                       'rows', jsonb_array_length(v_rows), 'total', v_total, 'truncated', v_total > 100),
    v_reason);
  return v_rows;
end
$function$
;
revoke all on function public.admin_export(text, jsonb, text) from public, anon;
grant execute on function public.admin_export(text, jsonb, text) to authenticated, service_role;

-- Deleting an account from the admin screens (Edge Function admin-delete-account, service role): a
-- reason, and the admin's session must still exist, as for every other admin action.
drop function public.admin_account_deletion(uuid, uuid);
create function public.admin_account_deletion(p_admin_id uuid, p_user_id uuid, p_reason text, p_session uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_mode text;
  v_reason text;
begin
  -- The same answers as require_admin (H1): not an active admin → not_allowed; its session gone or
  -- past its end → not_signed_in. The Edge Function records either in the security log (a refusal
  -- raised here is rolled back with everything else).
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin' and not suspended and deleted_at is null) then
    perform public.fail('not_allowed');
  end if;
  if p_session is null
     or not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_admin_id
                      and (s.not_after is null or s.not_after > now())
                      and s.created_at > now() - make_interval(hours => public.staff_session_hours())) then
    perform public.fail('not_signed_in');
  end if;
  v_reason := public.require_reason(p_reason);
  select * into v from public.profiles where id = p_user_id;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.role = 'admin' then
    perform public.fail('not_allowed');
  end if;
  select * into v_shop from public.shops where owner_id = v.id;

  v_mode := public.prepare_account_deletion(p_user_id);

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, reason, session_id)
  values (p_admin_id, 'delete_account', case when v_shop.id is null then 'profile' else 'shop' end,
          coalesce(v_shop.id, v.id)::text,
          jsonb_build_object('display_id', v.display_id, 'role', v.role, 'name', v.name,
                             'email', public.account_email(v.id))
            || case when v_shop.id is null then '{}'::jsonb
                    else jsonb_build_object('shop_name', v_shop.name, 'city', v_shop.city) end,
          jsonb_build_object('mode', v_mode), v_reason, p_session);
  return v_mode;
end
$$;
revoke all on function public.admin_account_deletion(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_account_deletion(uuid, uuid, text, uuid) to service_role;

-- ================================================================================================
-- §8 Control of the admin accounts (M6)
-- ================================================================================================

-- The admins, for the admin screen Platformă → Administratori: never a deleted one.
create function public.admin_team_admins()
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
    select jsonb_agg(jsonb_build_object(
        'id', p.id, 'display_id', p.display_id, 'name', p.name, 'suspended', p.suspended, 'me', p.id = v_me.id,
        'mfa_ready', exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
        'sessions', (select count(*) from auth.sessions s where s.user_id = p.id and (s.not_after is null or s.not_after > now())),
        'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p.id))
      order by p.display_id)
    from public.profiles p where p.role = 'admin' and p.deleted_at is null), '[]'::jsonb);
end
$$;

-- Ends every session of an account (or every one but the current one) and checks it did: a
-- session that remains is a failure, never a success.
create function public.end_sessions_of(p_user uuid, p_keep uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from auth.sessions s where s.user_id = p_user and (p_keep is null or s.id <> p_keep);
  get diagnostics n = row_count;
  if exists (select 1 from auth.sessions s where s.user_id = p_user and (p_keep is null or s.id <> p_keep)) then
    perform public.fail('sessions_not_ended');
  end if;
  return n;
exception
  when insufficient_privilege or undefined_table then
    perform public.fail('sessions_not_ended');
end
$$;
revoke all on function public.end_sessions_of(uuid, uuid) from public, anon, authenticated, service_role;

-- Locks every admin row (always in the same order) and checks the caller is still an active admin
-- after any change committed meanwhile: two admins acting on each other at the same moment cannot
-- both succeed and leave nobody.
create function public.lock_admins()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where role = 'admin' order by id for update;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not suspended and deleted_at is null) then
    perform public.fail('account_suspended');
  end if;
end
$$;
revoke all on function public.lock_admins() from public, anon, authenticated, service_role;

-- Suspend or reactivate another admin. Never oneself, never the last active admin. Suspending ends
-- its sessions at once (profiles_end_staff_sessions); its old tokens are refused from that moment.
create function public.admin_set_admin_suspended(p_user_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_reason text;
  v_seen jsonb;
  v public.profiles%rowtype;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_reason := public.require_reason(p_reason);
  v_seen := public.request_begin(p_request_id, 'admin_set_admin_suspended');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_user_id = v_me.id then
    perform public.fail('cannot_target_self');
  end if;
  perform public.lock_admins();
  select * into v from public.profiles where id = p_user_id;
  if not found or v.role <> 'admin' or v.deleted_at is not null then
    perform public.fail('not_found');
  end if;
  if p_suspended is null or v.suspended = p_suspended then
    perform public.fail('wrong_status', jsonb_build_object('suspended', v.suspended));
  end if;
  if p_suspended and not exists (select 1 from public.profiles o where o.role = 'admin' and not o.suspended
                                   and o.deleted_at is null and o.id <> p_user_id) then
    perform public.fail('last_platform_admin');
  end if;
  update public.profiles set suspended = p_suspended where id = v.id;
  perform public.staff_audit(case when p_suspended then 'suspend_admin' else 'unsuspend_admin' end, 'profile', v.id::text,
    jsonb_build_object('suspended', v.suspended, 'display_id', v.display_id),
    jsonb_build_object('suspended', p_suspended), v_reason);
  perform public.security_record(case when p_suspended then 'admin_suspended' else 'admin_reactivated' end,
    case when p_suspended then 'high' else 'info' end, 'account', v.id::text, jsonb_build_object('display_id', v.display_id));
  v_result := jsonb_build_object('id', v.id, 'suspended', p_suspended);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- End every session of another admin (a lost phone, a doubt): it must sign in again, with its
-- second step. Its tokens are refused at once.
create function public.admin_end_admin_sessions(p_user_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_reason text;
  v_seen jsonb;
  v public.profiles%rowtype;
  n int;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_reason := public.require_reason(p_reason);
  v_seen := public.request_begin(p_request_id, 'admin_end_admin_sessions');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_user_id = v_me.id then
    perform public.fail('cannot_target_self');
  end if;
  select * into v from public.profiles where id = p_user_id;
  if not found or v.role <> 'admin' or v.deleted_at is not null then
    perform public.fail('not_found');
  end if;
  n := public.end_sessions_of(v.id);
  perform public.staff_audit('end_admin_sessions', 'profile', v.id::text, jsonb_build_object('display_id', v.display_id),
    jsonb_build_object('sessions', n), v_reason);
  perform public.security_record('admin_sessions_ended', 'warning', 'account', v.id::text,
    jsonb_build_object('display_id', v.display_id, 'sessions', n));
  v_result := jsonb_build_object('id', v.id, 'sessions_ended', n);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- An admin ends its own sessions on the other devices; the one in use stays.
create function public.admin_end_my_other_sessions(p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_reason text;
  v_seen jsonb;
  n int;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_reason := public.require_reason(p_reason);
  v_seen := public.request_begin(p_request_id, 'admin_end_my_other_sessions');
  if v_seen is not null then
    return v_seen;
  end if;
  n := public.end_sessions_of(v_me.id, (auth.jwt()->>'session_id')::uuid);
  perform public.staff_audit('end_own_sessions', 'profile', v_me.id::text, null, jsonb_build_object('sessions', n), v_reason);
  v_result := jsonb_build_object('sessions_ended', n);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke all on function public.admin_team_admins(), public.admin_set_admin_suspended(uuid, boolean, text, uuid),
  public.admin_end_admin_sessions(uuid, text, uuid), public.admin_end_my_other_sessions(text, uuid) from public, anon;
grant execute on function public.admin_team_admins(), public.admin_set_admin_suspended(uuid, boolean, text, uuid),
  public.admin_end_admin_sessions(uuid, text, uuid), public.admin_end_my_other_sessions(text, uuid) to authenticated, service_role;

-- ================================================================================================
-- §9 Ending a team member's sessions (L3; and admins since M6)
-- ================================================================================================

-- When an agent loses its role or an agent or admin is suspended or deleted, its sessions end.
-- Its access is refused anyway (the role and the suspension are read at every call); if the
-- sessions cannot be deleted, that is recorded as a high security event and a warning, never
-- passed over in silence, and the change itself is kept.
create or replace function public.end_staff_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  begin
    delete from auth.sessions where user_id = new.id;
    get diagnostics n = row_count;
  exception when insufficient_privilege or undefined_table then
    raise warning 'end_staff_sessions: the sessions of % could not be ended (%)', new.id, sqlerrm;
    perform public.security_record('session_cleanup_failed', 'high', 'account', new.id::text,
      jsonb_build_object('role', old.role, 'error', sqlstate));
  end;
  return new;
end
$$;

drop trigger profiles_end_staff_sessions on public.profiles;
create trigger profiles_end_staff_sessions after update of role, suspended, deleted_at on public.profiles
  for each row
  when ((old.role = 'support' and (new.role <> 'support' or new.suspended or new.deleted_at is not null))
        or (old.role = 'admin' and ((new.suspended and not old.suspended) or (new.deleted_at is not null and old.deleted_at is null)
                                    or new.role <> 'admin')))
  execute function public.end_staff_sessions();

-- ================================================================================================
-- §10 Fleet files through the fleet-files Edge Function only (M4)
-- ================================================================================================

-- 1. fleet_file_begin (as the person, from the Edge Function, after it checked and cleaned the
--    bytes): who may write there, not suspended, at most 60 files an hour per person, 6 photos per
--    report, 500 MB per company. Answers the path to use.
-- 2. fleet_file_ticket (service role): the right to store that one path, for that person, 2 minutes.
-- 3. The Edge Function stores the clean copy with the person's own token (the file is theirs, as
--    before); the Storage rule lets it in only with a live ticket. Then the ticket goes.
create table public.fleet_file_tickets (
  path text primary key check (char_length(path) <= 300),
  user_id uuid not null,
  expires_at timestamptz not null
);
alter table public.fleet_file_tickets enable row level security;
revoke all on public.fleet_file_tickets from public, anon, authenticated, service_role;

create function public.fleet_file_begin(p_company uuid, p_vehicle uuid, p_issue uuid, p_mime text, p_size integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_ext text;
  v_path text;
  v_used bigint;
begin
  v_me := public.require_caller();
  if p_company is null or p_vehicle is null or p_size is null or p_size < 1 or p_size > 5 * 1024 * 1024 then
    perform public.fail('file_invalid');
  end if;
  v_ext := case p_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                       when 'application/pdf' then 'pdf' end;
  if v_ext is null or (p_issue is not null and v_ext = 'pdf') then
    perform public.fail('file_invalid');
  end if;
  if p_issue is null then
    v_path := p_company || '/' || p_vehicle || '/' || gen_random_uuid() || '.' || v_ext;
    if not public.fleet_file_can_write(p_company, p_vehicle) then
      perform public.fail('not_allowed');
    end if;
  else
    v_path := p_company || '/' || p_vehicle || '/issues/' || p_issue || '/' || gen_random_uuid() || '.' || v_ext;
    if not public.fleet_issue_photo_can_upload(v_path) then
      perform public.fail('not_allowed');
    end if;
    if (select count(*) from storage.objects o
        where o.bucket_id = 'fleet-files' and o.name like p_company || '/' || p_vehicle || '/issues/' || p_issue || '/%') >= 6 then
      perform public.fail('too_many_photos', jsonb_build_object('limit', 6));
    end if;
  end if;
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) into v_used
  from storage.objects o where o.bucket_id = 'fleet-files' and o.name like p_company || '/%';
  if v_used + p_size > 500::bigint * 1024 * 1024 then
    perform public.fail('limit_fleet_storage');
  end if;
  if not public.rate_take('fleet_upload', v_me.id, 60, interval '1 hour') then
    perform public.fail('limit_fleet_uploads');
  end if;
  return jsonb_build_object('path', v_path);
end
$$;
revoke all on function public.fleet_file_begin(uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.fleet_file_begin(uuid, uuid, uuid, text, integer) to authenticated, service_role;

create function public.fleet_file_ticket(p_user uuid, p_path text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.fleet_file_tickets where expires_at < now();
  insert into public.fleet_file_tickets (path, user_id, expires_at) values (p_path, p_user, now() + interval '2 minutes');
$$;
revoke all on function public.fleet_file_ticket(uuid, text) from public, anon, authenticated;
grant execute on function public.fleet_file_ticket(uuid, text) to service_role;

create function public.fleet_file_ticket_done(p_path text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.fleet_file_tickets where path = p_path
$$;
revoke all on function public.fleet_file_ticket_done(text) from public, anon, authenticated;
grant execute on function public.fleet_file_ticket_done(text) to service_role;

create function public.fleet_file_ticket_ok(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.fleet_file_tickets t
                 where t.path = p_name and t.user_id = auth.uid() and t.expires_at > now())
$$;
revoke all on function public.fleet_file_ticket_ok(text) from public, anon;
grant execute on function public.fleet_file_ticket_ok(text) to authenticated, service_role;

create policy fleet_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fleet-files' and public.fleet_file_ticket_ok(name) and public.caller_can_write() and
              case when public.fleet_issue_path(name) then public.fleet_issue_photo_can_upload(name)
                   else public.fleet_file_can_write(public.try_uuid((storage.foldername(name))[1]),
                                                    public.try_uuid((storage.foldername(name))[2])) end);

-- ================================================================================================
-- §10a Generated PDF documents are limited (L2)
-- ================================================================================================

-- Each PDF made on request costs (Edge Function time): per person and kind, a job's documents
-- (job-document: quote, intake sheet, invoice-like summaries) at most 30 an hour — a shop printing
-- for a busy morning stays well under —, a paid report made again (generate-report) at most 10 an
-- hour. Asked by the Edge Function before it makes anything (service role, the person's id it
-- checked); concurrent calls queue on the rate lock, so the limit holds under parallel requests.
create function public.document_limit(p_user uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int := case p_kind when 'job_document' then 30 when 'report_generate' then 10 end;
begin
  if p_user is null or v_max is null then
    perform public.fail('field_invalid', jsonb_build_object('field', 'kind'));
  end if;
  if not public.rate_take(p_kind, p_user, v_max, interval '1 hour') then
    perform public.fail('limit_documents', jsonb_build_object('limit', v_max));
  end if;
end
$$;
revoke all on function public.document_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.document_limit(uuid, text) to service_role;

-- ================================================================================================
-- §10b The security log for the admins (M3): Platformă → Securitate
-- ================================================================================================

-- The grouped events, newest first: what happened, how serious, who (role and ID only), on what,
-- how many times in the hour. Only admins; nothing personal is stored in an event (§1). Refusals
-- raised inside a database function are rolled back with it: those are in the Postgres log
-- (`sh_security`), not here (docs/SECURITATE.md).
create function public.admin_security_events(p_severity text default null, p_before timestamptz default null,
                                             p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_severity is not null and p_severity not in ('info', 'warning', 'high') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'severity'));
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'severity', e.severity,
        'actor_role', e.actor_role, 'actor_display_id', e.actor_display_id,
        'subject_type', e.subject_type,
        'subject_display_id', case when e.subject_type = 'account'
                                   then (select p.display_id from public.profiles p where p.id = public.try_uuid(e.subject_id)) end,
        'occurrences', e.occurrences, 'first_at', e.first_at, 'last_at', e.last_at,
        'detail', e.detail)
      order by e.last_at desc, e.id desc)
    from (select * from public.security_events x
          where (p_severity is null or x.severity = p_severity)
            and (p_before is null or x.last_at < p_before)
          order by x.last_at desc, x.id desc
          limit least(greatest(coalesce(p_limit, 50), 1), 200)) e), '[]'::jsonb);
end
$$;
revoke all on function public.admin_security_events(text, timestamptz, integer) from public, anon;
grant execute on function public.admin_security_events(text, timestamptz, integer) to authenticated, service_role;

-- ================================================================================================
-- §11 Classes of the new audit actions, schema version
-- ================================================================================================

insert into public.audit_action_classes (action, class, strip_keys) values
  ('view_client', 'security', '{}'),
  ('view_shop', 'security', '{}'),
  ('view_booking', 'security', '{}'),
  ('view_client_list', 'security', '{}'),
  ('view_shop_list', 'security', '{}'),
  ('search_bookings', 'security', '{}'),
  ('search_reviews', 'security', '{}'),
  ('view_company_list', 'security', '{}'),
  ('view_vehicle_duplicates', 'security', '{}'),
  ('suspend_admin', 'security', '{}'),
  ('unsuspend_admin', 'security', '{}'),
  ('end_admin_sessions', 'security', '{}'),
  ('end_own_sessions', 'security', '{}');

update public.schema_version set version = 119;
