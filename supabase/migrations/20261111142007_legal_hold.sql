-- A3c2a: legal hold of support data (plan A3c2 approved by Eduard on 8 Nov 2026, split A3c2a / A3c2b
-- and the conditions of 11 Nov 2026; the request ↔ author link change approved on 11 Nov 2026).
--
-- What a legal hold is: an admin keeps one support request, or every support request of one account
-- (also the ones it writes later, while the hold is active), from being deleted, for a concrete reason,
-- one basis from a closed list and a reference (case number, authority letter), with a responsible
-- admin and a review every 90 days. Never released by itself. Only the support data: requests,
-- their messages, internal notes, files and the author's identifiers — never bookings, cars,
-- invoices, companies, notifications or anything else of the account.
--
-- · legal_holds, legal_hold_reviews, legal_hold_subjects: RLS on, no policy, no grant to anybody (not
--   even service_role, not in Realtime). Only the admin functions below read them.
-- · suggestions.author_id: ON DELETE CASCADE → SET NULL, plus former_author_id. Before a profile goes
--   (by any path: the app, the admin, an Edge Function, a direct DELETE of auth.users or profiles), the
--   trigger profiles_support_on_delete deletes its requests that no hold covers — exactly what the
--   cascade did — and the held ones stay, closed, with former_author_id. Everything else of the account
--   is deleted as before, in the same statement.
-- · Guards: a held request, message, note or file cannot be deleted, nor its text changed, by any
--   role (BEFORE DELETE / UPDATE triggers → error legal_hold, so the whole statement — an account
--   deletion included — is undone); TRUNCATE is refused by a statement trigger while a hold is active
--   and TRUNCATE is revoked from anon, authenticated and service_role.
-- · Agents: a held request disappears for them everywhere (lists, counters, page, actions, files,
--   account card, Realtime signals); asking for it answers request_not_found / file_not_found, like a
--   request that does not exist. The admin keeps everything.
-- · Release: the rules apply at once — the requests of an account already deleted are deleted with
--   messages, notes and files (Storage objects queued in support_file_deletions, removed by the
--   support-files function after the commit, kicked at once); files of requests closed 90 days ago go.
-- · The A3b daily cleanup skips held files and still deletes the others.
--
-- No existing row is changed: the new column is empty, the new check passes on every row (all have an
-- author), the foreign key only changes what a future deletion does. Rollback:
-- supabase/rollback/20261111142007_legal_hold.sql (refuses while a hold or a request it kept exists).

-- ------------------------------------------------------------------ the holds

create table public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  -- A request hold names the request; an account hold has none and covers every request of subject_id.
  suggestion_id uuid,
  -- The account the data belongs to (the request's author). No foreign key: the account may be gone.
  subject_id uuid not null,
  subject_display_id text not null,
  basis text not null check (basis in ('litigation', 'authority_request', 'official_complaint', 'fraud_investigation')),
  reason text not null check (char_length(btrim(reason)) between 30 and 1000),
  reference text not null check (char_length(btrim(reference)) between 3 and 200),
  responsible_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  review_due_at timestamptz not null,
  reviewed_at timestamptz,
  reviewed_by uuid,
  released_at timestamptz,
  released_by uuid,
  release_reason text check (release_reason is null or char_length(btrim(release_reason)) between 30 and 1000),
  check ((released_at is null) = (released_by is null) and (released_at is null) = (release_reason is null))
);
create index legal_holds_request_idx on public.legal_holds (suggestion_id) where released_at is null and suggestion_id is not null;
create index legal_holds_account_idx on public.legal_holds (subject_id) where released_at is null and suggestion_id is null;
create unique index legal_holds_one_per_request on public.legal_holds (suggestion_id) where released_at is null and suggestion_id is not null;
create unique index legal_holds_one_per_account on public.legal_holds (subject_id) where released_at is null and suggestion_id is null;
alter table public.legal_holds enable row level security;
revoke all on public.legal_holds from public, anon, authenticated, service_role;

-- Each review: who confirmed the hold is still needed, why, and until when.
create table public.legal_hold_reviews (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references public.legal_holds (id) on delete restrict,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  note text not null check (char_length(btrim(note)) between 30 and 1000),
  next_due_at timestamptz not null
);
create index legal_hold_reviews_hold_idx on public.legal_hold_reviews (hold_id, reviewed_at);
alter table public.legal_hold_reviews enable row level security;
revoke all on public.legal_hold_reviews from public, anon, authenticated, service_role;

-- The identifiers of an account with held data, so the requests stay attributable after the account
-- is deleted: taken when the hold is placed and again just before the account is deleted; gone once no
-- active hold names the account.
create table public.legal_hold_subjects (
  user_id uuid primary key,
  display_id text not null,
  role text,
  name text,
  email text,
  phone text,
  account_deleted_at timestamptz,
  captured_at timestamptz not null default now()
);
alter table public.legal_hold_subjects enable row level security;
revoke all on public.legal_hold_subjects from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ requests survive their author

alter table public.suggestions add column former_author_id uuid;
alter table public.suggestions alter column author_id drop not null;
alter table public.suggestions drop constraint suggestions_author_id_fkey;
alter table public.suggestions
  add constraint suggestions_author_id_fkey foreign key (author_id) references public.profiles (id) on delete set null;
alter table public.suggestions add constraint suggestions_has_author check (author_id is not null or former_author_id is not null);
create index suggestions_former_author_idx on public.suggestions (former_author_id) where former_author_id is not null;

-- ------------------------------------------------------------------ is it held?

-- A request is held when an active hold names it, or names its author's account (also a former author).
create function public.legal_hold_covers(p_suggestion uuid, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.legal_holds h
    where h.released_at is null
      and (h.suggestion_id = p_suggestion or (h.suggestion_id is null and h.subject_id = p_subject)))
$$;
revoke execute on function public.legal_hold_covers(uuid, uuid) from public, anon, authenticated;

create function public.legal_hold_covers_request(p_suggestion uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.suggestions s
    where s.id = p_suggestion and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))
$$;
revoke execute on function public.legal_hold_covers_request(uuid) from public, anon, authenticated;

-- Text that looks like a password, a key, a token or a card number. The new free texts of a hold
-- (reason, reference, review note, release reason) are refused with secret_in_text when they match,
-- so no secret is kept with them (Eduard, 11 Nov 2026, point 9: only these fields in A3c2a).
create function public.text_has_secret(p_text text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_text, '');
  m text[];
  d text;
  n int;
  s int;
  x int;
begin
  if v ~* '\m(sk|rk)_(live|test)_[0-9a-z]{8,}'
     or v ~ 'whsec_[0-9A-Za-z]{8,}'
     or v ~ 'sb_secret_[0-9A-Za-z_-]{8,}'
     or v ~ '\mre_[0-9A-Za-z_]{20,}'
     or v ~ '\mgh[pousr]_[0-9A-Za-z]{20,}'
     or v ~ 'github_pat_[0-9A-Za-z_]{20,}'
     or v ~ '\mxox[abprs]-[0-9A-Za-z-]{10,}'
     or v ~ '\mAKIA[0-9A-Z]{16}\M'
     or v ~ '\mAIza[0-9A-Za-z_-]{35}'
     or v ~ 'eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}'
     or v ~* '-----BEGIN [A-Z ]*PRIVATE KEY-----'
     or v ~* '\m(parol[aăe]|password|passwd|pwd|pin|token|secret|cheie|api[ _-]?key|cod de acces)\s*[:=]\s*\S{4,}'
  then
    return true;
  end if;
  -- A long random string (letters and digits mixed, 32 characters or more); identifiers in the
  -- 8-4-4-4-12 form are not secrets and are left out first.
  v := regexp_replace(v, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', ' ', 'g');
  for m in select regexp_matches(v, '[A-Za-z0-9_+/=-]{32,}', 'g') loop
    if m[1] ~ '[A-Za-z]' and m[1] ~ '[0-9]' then
      return true;
    end if;
  end loop;
  -- A card number: 13 to 19 digits (spaces or dashes between them) passing the Luhn check.
  for m in select regexp_matches(v, '(\d(?:[ -]?\d){12,18})', 'g') loop
    d := regexp_replace(m[1], '\D', '', 'g');
    n := length(d);
    s := 0;
    for i in 0 .. n - 1 loop
      x := substr(d, n - i, 1)::int;
      if i % 2 = 1 then
        x := x * 2;
        if x > 9 then
          x := x - 9;
        end if;
      end if;
      s := s + x;
    end loop;
    if s % 10 = 0 then
      return true;
    end if;
  end loop;
  return false;
end
$$;
revoke execute on function public.text_has_secret(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ guards on every path

-- A held row cannot be deleted by anybody: the error undoes the whole statement, so a deletion that
-- reaches held data (an account deleted directly, a cascade, a cleanup) leaves nothing half done.
create function public.legal_hold_block_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'suggestions' then
    if public.legal_hold_covers(old.id, coalesce(old.author_id, old.former_author_id)) then
      perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
    end if;
  elsif old.suggestion_id is not null and public.legal_hold_covers_request(old.suggestion_id) then
    perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
  end if;
  return old;
end
$$;
revoke execute on function public.legal_hold_block_delete() from public, anon, authenticated;

-- Nor its text changed (the content the hold keeps), nor a file moved away or replaced.
create function public.legal_hold_block_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'suggestions' then
    if (new.body is distinct from old.body or new.title is distinct from old.title
        or (old.former_author_id is not null and new.former_author_id is distinct from old.former_author_id))
       and public.legal_hold_covers(old.id, coalesce(old.author_id, old.former_author_id)) then
      perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
    end if;
  elsif tg_table_name = 'suggestion_files' then
    if (new.suggestion_id is distinct from old.suggestion_id or new.message_id is distinct from old.message_id
        or new.path is distinct from old.path or new.sha256 is distinct from old.sha256
        or new.name is distinct from old.name or new.size is distinct from old.size or new.mime is distinct from old.mime)
       and old.suggestion_id is not null and public.legal_hold_covers_request(old.suggestion_id) then
      perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
    end if;
  elsif (new.body is distinct from old.body or new.suggestion_id is distinct from old.suggestion_id)
        and public.legal_hold_covers_request(old.suggestion_id) then
    perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
  end if;
  return new;
end
$$;
revoke execute on function public.legal_hold_block_update() from public, anon, authenticated;

-- TRUNCATE runs no row trigger: refused for the support tables while any hold is active (also when it
-- reaches them through TRUNCATE … CASCADE of profiles, shops or bookings), and for the hold tables
-- while they hold anything.
create function public.legal_hold_block_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name in ('legal_holds', 'legal_hold_reviews', 'legal_hold_subjects') then
    if exists (select 1 from public.legal_holds) or exists (select 1 from public.legal_hold_subjects) then
      perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
    end if;
  elsif exists (select 1 from public.legal_holds where released_at is null) then
    perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
  end if;
  return null;
end
$$;
revoke execute on function public.legal_hold_block_truncate() from public, anon, authenticated;

create trigger suggestions_legal_hold_delete before delete on public.suggestions
  for each row execute function public.legal_hold_block_delete();
create trigger suggestion_messages_legal_hold_delete before delete on public.suggestion_messages
  for each row execute function public.legal_hold_block_delete();
create trigger suggestion_notes_legal_hold_delete before delete on public.suggestion_notes
  for each row execute function public.legal_hold_block_delete();
create trigger suggestion_files_legal_hold_delete before delete on public.suggestion_files
  for each row execute function public.legal_hold_block_delete();

create trigger suggestions_legal_hold_update before update of body, title, former_author_id on public.suggestions
  for each row execute function public.legal_hold_block_update();
create trigger suggestion_messages_legal_hold_update before update of body, suggestion_id on public.suggestion_messages
  for each row execute function public.legal_hold_block_update();
create trigger suggestion_notes_legal_hold_update before update of body, suggestion_id on public.suggestion_notes
  for each row execute function public.legal_hold_block_update();
create trigger suggestion_files_legal_hold_update
  before update of suggestion_id, message_id, path, sha256, name, size, mime on public.suggestion_files
  for each row execute function public.legal_hold_block_update();

create trigger suggestions_legal_hold_truncate before truncate on public.suggestions
  for each statement execute function public.legal_hold_block_truncate();
create trigger suggestion_messages_legal_hold_truncate before truncate on public.suggestion_messages
  for each statement execute function public.legal_hold_block_truncate();
create trigger suggestion_notes_legal_hold_truncate before truncate on public.suggestion_notes
  for each statement execute function public.legal_hold_block_truncate();
create trigger suggestion_files_legal_hold_truncate before truncate on public.suggestion_files
  for each statement execute function public.legal_hold_block_truncate();
create trigger legal_holds_truncate before truncate on public.legal_holds
  for each statement execute function public.legal_hold_block_truncate();
create trigger legal_hold_reviews_truncate before truncate on public.legal_hold_reviews
  for each statement execute function public.legal_hold_block_truncate();
create trigger legal_hold_subjects_truncate before truncate on public.legal_hold_subjects
  for each statement execute function public.legal_hold_block_truncate();

-- The hold history is kept: a hold is released, never deleted; its reviews stay with it.
create function public.legal_hold_history_kept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fail('legal_hold', jsonb_build_object('table', tg_table_name));
  return null;
end
$$;
revoke execute on function public.legal_hold_history_kept() from public, anon, authenticated;
create trigger legal_holds_kept before delete on public.legal_holds
  for each row execute function public.legal_hold_history_kept();
create trigger legal_hold_reviews_kept before delete or update on public.legal_hold_reviews
  for each row execute function public.legal_hold_history_kept();

-- Nobody but the database's owner may TRUNCATE the support tables (the triggers above still guard
-- the owner).
revoke truncate on public.suggestions, public.suggestion_messages, public.suggestion_notes, public.suggestion_files,
  public.support_signals, public.support_file_deletions
  from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ the author's identifiers

create function public.legal_hold_capture_subject(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  v_email text;
begin
  select * into p from public.profiles where id = p_user;
  if not found then
    return;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user and u.email not like 'deleted-%@deleted.invalid';
  insert into public.legal_hold_subjects as x (user_id, display_id, role, name, email, phone, captured_at)
  values (p.id, p.display_id, p.role, p.name, v_email, p.phone, now())
  on conflict (user_id) do update
    set display_id = excluded.display_id, role = excluded.role,
        name = coalesce(excluded.name, x.name), email = coalesce(excluded.email, x.email),
        phone = coalesce(excluded.phone, x.phone), captured_at = now();
end
$$;
revoke execute on function public.legal_hold_capture_subject(uuid) from public, anon, authenticated;

-- An account with held data (an account hold, or a hold on one of its requests).
create function public.legal_hold_has_subject(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.legal_holds h
    where h.released_at is null and h.subject_id = p_user)
$$;
revoke execute on function public.legal_hold_has_subject(uuid) from public, anon, authenticated;

-- Before a profile is deleted, whatever the path: its requests that no hold covers are deleted with
-- their messages, notes and files (the files' Storage objects queued, as before), the held ones stay,
-- closed, with former_author_id; the foreign key then clears author_id. All in the deleting statement.
create function public.profiles_support_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.suggestions where author_id = old.id) then
    return old;
  end if;
  if public.legal_hold_has_subject(old.id) then
    -- The identifiers as they are now (name and phone are still on the row being deleted).
    insert into public.legal_hold_subjects as x (user_id, display_id, role, name, email, phone, account_deleted_at)
    values (old.id, old.display_id, old.role, old.name,
            (select u.email from auth.users u where u.id = old.id and u.email not like 'deleted-%@deleted.invalid'),
            old.phone, now())
    on conflict (user_id) do update
      set name = coalesce(excluded.name, x.name), email = coalesce(excluded.email, x.email),
          phone = coalesce(excluded.phone, x.phone), account_deleted_at = now();
  end if;
  delete from public.suggestions s
  where s.author_id = old.id and not public.legal_hold_covers(s.id, old.id);
  update public.suggestions s
  set former_author_id = old.id,
      status = case when public.support_request_open(s.status) or s.status = 'resolved' then 'closed' else s.status end,
      closed_at = case when public.support_request_open(s.status) or s.status = 'resolved' then now() else s.closed_at end,
      updated_at = now()
  where s.author_id = old.id;
  delete from public.support_signals where audience = 'author' and author_id = old.id;
  return old;
end
$$;
revoke execute on function public.profiles_support_on_delete() from public, anon, authenticated;
create trigger profiles_support_on_delete before delete on public.profiles
  for each row execute function public.profiles_support_on_delete();

-- ------------------------------------------------------------------ applying the rules

-- What the rules say for the requests of one account that no active hold covers any more: the
-- requests of an account already deleted go (messages, notes, files; the files' Storage objects are
-- queued), the files of requests closed 90 days ago go (A3b). The identifiers go once no active hold
-- names the account. Returns what was deleted.
create function public.legal_hold_apply_rules(p_subject uuid, p_now timestamptz default now())
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
revoke execute on function public.legal_hold_apply_rules(uuid, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------ the admin's functions

create function public.legal_hold_check_text(p_field text, p_value text, p_min int, p_max int)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if char_length(v) < p_min or char_length(v) > p_max then
    perform public.fail('field_invalid', jsonb_build_object('field', p_field, 'min', p_min, 'max', p_max));
  end if;
  if public.text_has_secret(v) then
    perform public.fail('secret_in_text', jsonb_build_object('field', p_field));
  end if;
  return v;
end
$$;
revoke execute on function public.legal_hold_check_text(text, text, int, int) from public, anon, authenticated;

create function public.legal_hold_responsible(p_id uuid, p_default uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_id is null then
    return p_default;
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_id and p.role = 'admin' and not p.suspended and p.deleted_at is null) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'responsible'));
  end if;
  return p_id;
end
$$;
revoke execute on function public.legal_hold_responsible(uuid, uuid) from public, anon, authenticated;

-- Places a hold on one request (p_suggestion) or on one account (p_account: its ID, e.g. C-00012).
create function public.admin_place_legal_hold(p_suggestion uuid, p_account text, p_basis text, p_reason text,
  p_reference text, p_responsible uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_reason text;
  v_reference text;
  v_responsible uuid;
  v_subject uuid;
  v_display text;
  v_existing uuid;
  h public.legal_holds%rowtype;
  s public.suggestions%rowtype;
  p public.profiles%rowtype;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_place_legal_hold');
  if v_seen is not null then
    return v_seen;
  end if;
  if (p_suggestion is null) = (nullif(btrim(coalesce(p_account, '')), '') is null) then
    perform public.fail('field_invalid', jsonb_build_object('field', 'target'));
  end if;
  if p_basis is null or p_basis not in ('litigation', 'authority_request', 'official_complaint', 'fraud_investigation') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'basis'));
  end if;
  v_reason := public.legal_hold_check_text('reason', p_reason, 30, 1000);
  v_reference := public.legal_hold_check_text('reference', p_reference, 3, 200);
  v_responsible := public.legal_hold_responsible(p_responsible, v_me.id);

  if p_suggestion is not null then
    select * into s from public.suggestions where id = p_suggestion for update;
    if not found then
      perform public.fail('request_not_found');
    end if;
    v_subject := coalesce(s.author_id, s.former_author_id);
    select h2.id into v_existing from public.legal_holds h2 where h2.released_at is null and h2.suggestion_id = s.id;
  else
    select * into p from public.profiles
    where (upper(display_id) = upper(btrim(p_account))
           or (btrim(p_account) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and id = btrim(p_account)::uuid))
      and role in ('client', 'shop')
    for update;
    if not found then
      perform public.fail('account_not_found');
    end if;
    v_subject := p.id;
    select h2.id into v_existing from public.legal_holds h2
    where h2.released_at is null and h2.suggestion_id is null and h2.subject_id = p.id;
  end if;
  if v_existing is not null then
    perform public.fail('hold_exists', jsonb_build_object('id', v_existing));
  end if;

  perform public.legal_hold_capture_subject(v_subject);
  select coalesce((select display_id from public.profiles where id = v_subject),
                  (select display_id from public.legal_hold_subjects where user_id = v_subject))
    into v_display;
  v_display := coalesce(v_display, '—');

  insert into public.legal_holds (suggestion_id, subject_id, subject_display_id, basis, reason, reference,
                                  responsible_id, created_by, review_due_at)
  values (p_suggestion, v_subject, v_display, p_basis, v_reason, v_reference, v_responsible, v_me.id,
          now() + interval '90 days')
  returning * into h;

  -- The audit names the hold, never its texts (they stay in the hold, admin only).
  perform public.staff_audit('place_legal_hold', 'legal_hold', h.id::text, null,
    jsonb_build_object('scope', case when h.suggestion_id is null then 'account' else 'request' end,
                       'request_id', h.suggestion_id, 'account', h.subject_display_id, 'basis', h.basis,
                       'responsible', (select display_id from public.profiles where id = h.responsible_id),
                       'review_due_at', h.review_due_at));
  v_result := jsonb_build_object('id', h.id, 'review_due_at', h.review_due_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_place_legal_hold(uuid, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.admin_place_legal_hold(uuid, text, text, text, text, uuid, uuid) to authenticated;

-- A review: the admin writes why the hold is still needed; the next review is 90 days later. The
-- responsible admin may change at the same time.
create function public.admin_review_legal_hold(p_id uuid, p_note text, p_responsible uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_note text;
  v_responsible uuid;
  h public.legal_holds%rowtype;
  v_next timestamptz := now() + interval '90 days';
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_review_legal_hold');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into h from public.legal_holds where id = p_id for update;
  if not found then
    perform public.fail('hold_not_found');
  end if;
  if h.released_at is not null then
    perform public.fail('hold_released');
  end if;
  v_note := public.legal_hold_check_text('note', p_note, 30, 1000);
  v_responsible := public.legal_hold_responsible(p_responsible, h.responsible_id);
  insert into public.legal_hold_reviews (hold_id, reviewed_by, note, next_due_at)
  values (h.id, v_me.id, v_note, v_next);
  update public.legal_holds
  set reviewed_at = now(), reviewed_by = v_me.id, review_due_at = v_next, responsible_id = v_responsible
  where id = h.id;
  perform public.staff_audit('review_legal_hold', 'legal_hold', h.id::text,
    jsonb_build_object('review_due_at', h.review_due_at,
                       'responsible', (select display_id from public.profiles where id = h.responsible_id)),
    jsonb_build_object('review_due_at', v_next,
                       'responsible', (select display_id from public.profiles where id = v_responsible)));
  v_result := jsonb_build_object('id', h.id, 'review_due_at', v_next);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_review_legal_hold(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.admin_review_legal_hold(uuid, text, uuid, uuid) to authenticated;

-- Release: never automatic. The rules apply in the same transaction; the Storage objects of the
-- deleted files are removed by the support-files function after the commit (kicked at once; the
-- daily run is the fallback). A transaction that fails queues nothing and removes nothing.
create function public.admin_release_legal_hold(p_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_seen jsonb;
  v_reason text;
  h public.legal_holds%rowtype;
  v_applied jsonb;
  v_result jsonb;
begin
  v_me := public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_release_legal_hold');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into h from public.legal_holds where id = p_id for update;
  if not found then
    perform public.fail('hold_not_found');
  end if;
  if h.released_at is not null then
    perform public.fail('hold_released');
  end if;
  v_reason := public.legal_hold_check_text('reason', p_reason, 30, 1000);
  update public.legal_holds set released_at = now(), released_by = v_me.id, release_reason = v_reason where id = h.id;
  -- (legal_holds_signal tells the team's screens; the agents now hear these requests again.)
  v_applied := public.legal_hold_apply_rules(h.subject_id);

  perform public.staff_audit('release_legal_hold', 'legal_hold', h.id::text,
    jsonb_build_object('scope', case when h.suggestion_id is null then 'account' else 'request' end,
                       'request_id', h.suggestion_id, 'account', h.subject_display_id),
    jsonb_build_object('released', true) || v_applied);
  if (v_applied->>'deleted_requests')::int > 0 or (v_applied->>'deleted_files')::int > 0 then
    perform public.kick_support_files_cleanup();
  end if;
  v_result := jsonb_build_object('id', h.id, 'released_at', now()) || v_applied;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_release_legal_hold(uuid, text, uuid) from public, anon;
grant execute on function public.admin_release_legal_hold(uuid, text, uuid) to authenticated;

create function public.legal_hold_item(h public.legal_holds)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', h.id, 'scope', case when h.suggestion_id is null then 'account' else 'request' end,
    'request', case when h.suggestion_id is not null then (
        select jsonb_build_object('id', s.id, 'title', public.support_request_label(s), 'status', s.status)
        from public.suggestions s where s.id = h.suggestion_id) end,
    'account', jsonb_build_object(
        'id', h.subject_id, 'display_id', h.subject_display_id,
        'deleted', not exists (select 1 from public.profiles p where p.id = h.subject_id and p.deleted_at is null)),
    'basis', h.basis, 'reason', h.reason, 'reference', h.reference,
    'responsible', public.support_staff_ref(h.responsible_id),
    'created_by', public.support_staff_ref(h.created_by), 'created_at', h.created_at,
    'review_due_at', h.review_due_at, 'reviewed_at', h.reviewed_at,
    'released_at', h.released_at, 'released_by', public.support_staff_ref(h.released_by),
    'release_reason', h.release_reason,
    'requests', (select count(*) from public.suggestions s
                 where s.id = h.suggestion_id
                    or (h.suggestion_id is null and coalesce(s.author_id, s.former_author_id) = h.subject_id)))
$$;
revoke execute on function public.legal_hold_item(public.legal_holds) from public, anon, authenticated;

-- The list: active (reviews due first) or released (newest first).
create function public.admin_list_legal_holds(p_state text default 'active')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_state is null or p_state not in ('active', 'released') then
    perform public.fail('field_invalid', jsonb_build_object('field', 'state'));
  end if;
  return jsonb_build_object(
    'now', now(),
    'due', (select count(*) from public.legal_holds where released_at is null and review_due_at <= now()),
    'items', coalesce((
      select jsonb_agg(public.legal_hold_item(h)
                       order by case when p_state = 'active' then h.review_due_at end,
                                case when p_state = 'released' then h.released_at end desc, h.id)
      from (select * from public.legal_holds
            where (p_state = 'active') = (released_at is null)
            order by case when p_state = 'active' then review_due_at end,
                     case when p_state = 'released' then released_at end desc
            limit 500) h), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_list_legal_holds(text) from public, anon;
grant execute on function public.admin_list_legal_holds(text) to authenticated;

-- One hold: its reviews, the requests it covers and the account's identifiers (each opening logged).
create function public.admin_get_legal_hold(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.legal_holds%rowtype;
begin
  perform public.require_admin();
  select * into h from public.legal_holds where id = p_id;
  if not found then
    perform public.fail('hold_not_found');
  end if;
  perform public.staff_audit('view_legal_hold', 'legal_hold', h.id::text, null, null);
  return public.legal_hold_item(h) || jsonb_build_object(
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('at', r.reviewed_at, 'by', public.support_staff_ref(r.reviewed_by),
                                          'note', r.note, 'next_due_at', r.next_due_at) order by r.reviewed_at desc)
      from public.legal_hold_reviews r where r.hold_id = h.id), '[]'::jsonb),
    'subject', case when h.released_at is null then (
        select jsonb_build_object('display_id', x.display_id, 'role', x.role, 'name', x.name, 'email', x.email,
                                  'phone', x.phone, 'account_deleted_at', x.account_deleted_at, 'captured_at', x.captured_at)
        from public.legal_hold_subjects x where x.user_id = h.subject_id) end,
    'covered', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', public.support_request_label(s), 'status', s.status,
                                          'created_at', s.created_at, 'author_deleted', s.author_id is null)
                       order by s.created_at desc)
      from public.suggestions s
      where s.id = h.suggestion_id
         or (h.suggestion_id is null and coalesce(s.author_id, s.former_author_id) = h.subject_id)), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_get_legal_hold(uuid) from public, anon;
grant execute on function public.admin_get_legal_hold(uuid) to authenticated;

-- Who may be responsible: the active admins.
create function public.admin_list_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'role', p.role)
                     order by p.display_id)
    from public.profiles p where p.role = 'admin' and not p.suspended and p.deleted_at is null), '[]'::jsonb);
end
$$;
revoke execute on function public.admin_list_admins() from public, anon;
grant execute on function public.admin_list_admins() to authenticated;

-- The holds on one request, for the admin's request page.
create function public.legal_holds_for_request(p_suggestion uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'scope', case when h.suggestion_id is null then 'account' else 'request' end,
      'basis', h.basis, 'review_due_at', h.review_due_at) order by h.created_at), '[]'::jsonb)
  from public.suggestions s
  join public.legal_holds h on h.released_at is null
    and (h.suggestion_id = s.id or (h.suggestion_id is null and h.subject_id = coalesce(s.author_id, s.former_author_id)))
  where s.id = p_suggestion
$$;
revoke execute on function public.legal_holds_for_request(uuid) from public, anon, authenticated;

-- Realtime: an agent never hears a held request's signal (the admin does).
create function public.support_signal_team_visible(p_suggestion uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.support_signal_reader()
     and (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
          or not public.legal_hold_covers_request(p_suggestion))
$$;
revoke execute on function public.support_signal_team_visible(uuid) from public, anon;
grant execute on function public.support_signal_team_visible(uuid) to authenticated;

drop policy support_signals_team on public.support_signals;
create policy support_signals_team on public.support_signals for select to authenticated
  using (audience = 'team' and public.support_signal_team_visible(suggestion_id));

-- A hold placed, reviewed or released is a change on the request for the admin's screens.
create function public.legal_holds_signal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select s.id from public.suggestions s
    where s.id = new.suggestion_id
       or (new.suggestion_id is null and coalesce(s.author_id, s.former_author_id) = new.subject_id)
  loop
    perform public.support_signal(v_id, false);
  end loop;
  return null;
end
$$;
revoke execute on function public.legal_holds_signal() from public, anon, authenticated;
create trigger legal_holds_signal after insert or update on public.legal_holds
  for each row execute function public.legal_holds_signal();

-- ------------------------------------------------------------------ the existing support functions
-- (each as it was, with only the marked A3c2a change)

-- A3c2a: take, assign, answer, state, escalate — a held request answers request_not_found to an agent.
create or replace function public.support_guard(p_me profiles, s suggestions)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  -- A3c2a: a held request does not exist for an agent.
  if p_me.role <> 'admin' and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)) then
    perform public.fail('request_not_found');
  end if;
  if s.escalated_at is not null and p_me.role <> 'admin' then
    perform public.fail('request_escalated');
  end if;
  if s.status = 'closed' then
    perform public.fail('request_closed');
  end if;
end
$function$;

-- A3c2a: notes on a held request: admin only.
create or replace function public.support_add_note(p_id uuid, p_body text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  s public.suggestions%rowtype;
  n public.suggestion_notes%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_add_note');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  if v_me.role <> 'admin' and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)) then
    perform public.fail('request_not_found');
  end if;
  -- An escalated request stays read-only for an agent; a closed one keeps taking notes (follow-up).
  if s.escalated_at is not null and v_me.role <> 'admin' then
    perform public.fail('request_escalated');
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'body'));
  end if;
  insert into public.suggestion_notes (suggestion_id, author_id, author_display_id, body)
  values (s.id, v_me.id, v_me.display_id, v_body)
  returning * into n;
  update public.suggestions set updated_at = now() where id = s.id;
  perform public.staff_audit('add_request_note', 'suggestion', s.id::text, null, jsonb_build_object('note_id', n.id));
  v_result := jsonb_build_object('id', n.id, 'created_at', n.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$function$;

-- A3c2a: the request page — refused to an agent when held; the admin also sees its holds.
create or replace function public.support_get_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
begin
  v_me := public.require_staff();
  select * into s from public.suggestions where id = p_id;
  -- A3c2a: a held request does not exist for an agent (nothing logged, nothing read).
  if found and v_me.role <> 'admin' and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)) then
    perform public.fail('request_not_found');
  end if;
  v := public.support_get_request_a3a(p_id);
  v := v || jsonb_build_object('files', public.support_request_files(p_id, v_me.role = 'admin'));
  if v_me.role = 'admin' then
    -- The holds on it, and who wrote it when the account is gone.
    v := v || jsonb_build_object(
      'legal_holds', public.legal_holds_for_request(p_id),
      'former_author', case when s.author_id is null and s.former_author_id is not null then (
          select jsonb_build_object('display_id', x.display_id, 'role', x.role)
          from public.legal_hold_subjects x where x.user_id = s.former_author_id) end);
  end if;
  return v;
end
$function$;

-- A3c2a: the list leaves out held requests for an agent; the admin sees which are held.
create or replace function public.support_inbox(p_owner text DEFAULT 'all'::text, p_status text DEFAULT 'open'::text, p_category text DEFAULT 'all'::text, p_age integer DEFAULT NULL::integer, p_after_open boolean DEFAULT NULL::boolean, p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_owner uuid;
  v_limit int := coalesce(p_limit, 30);
  v_items jsonb;
  v_next jsonb;
begin
  v_me := public.require_staff();
  if p_owner is null or (p_owner not in ('all', 'mine', 'none', 'escalated')
                         and p_owner !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    perform public.fail('request_invalid', jsonb_build_object('field', 'owner'));
  end if;
  if p_status is null or p_status not in ('open', 'all', 'new', 'in_progress', 'waiting_user', 'resolved', 'closed',
                                          'planned', 'done', 'declined') then
    perform public.fail('request_invalid', jsonb_build_object('field', 'status'));
  end if;
  if p_category is null or (p_category <> 'all' and not exists (select 1 from public.support_categories c where c.key = p_category)) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'category'));
  end if;
  if p_age is not null and p_age not in (24, 48) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'age'));
  end if;
  if v_limit < 1 or v_limit > 100 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'limit'));
  end if;
  if (p_after_open is null) <> (p_after_at is null) or (p_after_at is null) <> (p_after_id is null) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'after'));
  end if;
  v_owner := case when p_owner ~ '^[0-9a-fA-F-]{36}$' then p_owner::uuid end;

  with page as (
    select s, public.support_request_open(s.status) as open, coalesce(s.last_user_message_at, s.created_at) as at
    from public.suggestions s
    where (p_owner = 'all'
           or (p_owner = 'mine' and s.assigned_to = v_me.id)
           or (p_owner = 'none' and s.assigned_to is null and s.escalated_at is null)
           or (p_owner = 'escalated' and s.escalated_at is not null)
           or (v_owner is not null and s.assigned_to = v_owner))
      and (p_status = 'all' or (p_status = 'open' and public.support_request_open(s.status)) or s.status = p_status)
      and (p_category = 'all' or s.category = p_category)
      and (p_age is null or public.support_waiting_since(s) <= now() - make_interval(hours => p_age))
      and (v_me.role = 'admin' or not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))
      and (p_after_id is null
           or (public.support_request_open(s.status), coalesce(s.last_user_message_at, s.created_at), s.id)
              < (p_after_open, p_after_at, p_after_id))
    order by public.support_request_open(s.status) desc, coalesce(s.last_user_message_at, s.created_at) desc, s.id desc
    limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.open desc, p.at desc, (p.s).id desc) as n from page p
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
        'id', (x.s).id, 'title', public.support_request_label(x.s), 'category', (x.s).category, 'status', (x.s).status,
        'created_at', (x.s).created_at, 'updated_at', (x.s).updated_at,
        'author', jsonb_build_object('id', (x.s).author_id, 'display_id', pr.display_id, 'name', pr.name, 'role', (x.s).author_role),
        'shop_name', sh.name,
        'assigned', case when (x.s).assigned_to is not null then public.support_staff_ref((x.s).assigned_to) end,
        'escalated', (x.s).escalated_at is not null, 'escalated_at', (x.s).escalated_at,
        'first_response_at', (x.s).first_response_at,
        'last_user_message_at', x.at,
        'last_staff_message_at', (x.s).last_staff_message_at,
        'waiting_since', public.support_waiting_since(x.s))
        || case when v_me.role = 'admin' then jsonb_build_object(
             'held', public.legal_hold_covers((x.s).id, coalesce((x.s).author_id, (x.s).former_author_id)),
             'former_author', case when (x.s).author_id is null then
               (select display_id from public.legal_hold_subjects where user_id = (x.s).former_author_id) end)
           else '{}'::jsonb end order by x.n) filter (where x.n <= v_limit), '[]'::jsonb),
    (select jsonb_build_object('open', y.open, 'at', y.at, 'id', (y.s).id)
       from numbered y where y.n = v_limit and exists (select 1 from numbered z where z.n = v_limit + 1))
  into v_items, v_next
  from numbered x
  left join public.profiles pr on pr.id = (x.s).author_id
  left join public.shops sh on sh.id = (x.s).shop_id;

  return jsonb_build_object('me', v_me.id, 'items', coalesce(v_items, '[]'::jsonb), 'next', v_next);
end
$function$;

-- A3c2a: counters and the oldest request without held requests for an agent; the admin also counts holds due for review.
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

-- A3c2a: the A3a list (no longer on screen) leaves out held requests for an agent.
create or replace function public.support_list_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  return jsonb_build_object(
    'me', v_me.id,
    'items', coalesce((
      select jsonb_agg(x.item order by x.open desc, x.at desc)
      from (
        select public.support_request_open(s.status) as open, coalesce(s.last_user_message_at, s.created_at) as at,
          jsonb_build_object(
            'id', s.id, 'title', public.support_request_label(s), 'category', s.category, 'status', s.status,
            'created_at', s.created_at, 'updated_at', s.updated_at,
            'author', jsonb_build_object('id', s.author_id, 'display_id', p.display_id, 'name', p.name, 'role', s.author_role),
            'shop_name', sh.name,
            'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end,
            'escalated', s.escalated_at is not null, 'escalated_at', s.escalated_at,
            'first_response_at', s.first_response_at,
            'last_user_message_at', coalesce(s.last_user_message_at, s.created_at),
            'last_staff_message_at', s.last_staff_message_at,
            -- The author waits: its last message is newer than the team's last answer.
            'waiting_since', case when public.support_request_open(s.status) and s.status <> 'waiting_user'
                                   and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity'::timestamptz)
                                  then coalesce(s.last_user_message_at, s.created_at) end) as item
        from public.suggestions s
        left join public.profiles p on p.id = s.author_id
        left join public.shops sh on sh.id = s.shop_id
        where (v_me.role = 'admin' or not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))
        order by public.support_request_open(s.status) desc, coalesce(s.last_user_message_at, s.created_at) desc
        limit 1000
      ) x), '[]'::jsonb));
end
$function$;

-- A3c2a: the suggestions board without held ones for an agent; a request kept after its author left still lists (left join).
create or replace function public.support_list_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  return jsonb_build_object(
    'new', (select count(*) from public.suggestions s where s.status = 'new' and (v_me.role = 'admin' or not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'body', g.body, 'status', g.status, 'role', g.author_role,
        'created_at', g.created_at, 'updated_at', g.updated_at,
        'author_id', g.author_id, 'display_id', p.display_id, 'author_name', p.name,
        'shop_id', g.shop_id, 'shop_name', s.name
      ) order by g.created_at desc)
      from public.suggestions g
      left join public.profiles p on p.id = g.author_id
      left join public.shops s on s.id = g.shop_id
      where (v_me.role = 'admin' or not public.legal_hold_covers(g.id, coalesce(g.author_id, g.former_author_id)))), '[]'::jsonb));
end
$function$;

-- A3c2a: a suggestion kept after its author left still lists.
create or replace function public.admin_list_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'new', (select count(*) from public.suggestions where status = 'new'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'body', g.body, 'status', g.status, 'role', g.author_role,
        'created_at', g.created_at, 'updated_at', g.updated_at,
        'author_id', g.author_id, 'display_id', p.display_id, 'author_name', p.name,
        'shop_id', g.shop_id, 'shop_name', s.name
      ) order by g.created_at desc)
      from public.suggestions g
      left join public.profiles p on p.id = g.author_id
      left join public.shops s on s.id = g.shop_id), '[]'::jsonb));
end
$function$;

-- A3c2a: a held suggestion does not exist for an agent.
create or replace function public.support_set_suggestion_status(p_id uuid, p_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seen jsonb;
  v_old public.suggestions%rowtype;
  v public.suggestions%rowtype;
  v_result jsonb;
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_set_suggestion_status');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_status is null or p_status not in ('new', 'planned', 'done', 'declined') then
    perform public.fail('status_invalid');
  end if;
  select * into v_old from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('suggestion_not_found');
  end if;
  if v_me.role <> 'admin' and public.legal_hold_covers(v_old.id, coalesce(v_old.author_id, v_old.former_author_id)) then
    perform public.fail('suggestion_not_found');
  end if;
  update public.suggestions set status = p_status, updated_at = now() where id = p_id returning * into v;
  if v.status is distinct from v_old.status then
    perform public.staff_audit('update_suggestion', 'suggestion', v.id::text,
      jsonb_build_object('suggestion_status', v_old.status), jsonb_build_object('suggestion_status', v.status));
  end if;
  v_result := jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$function$;

-- A3c2a: the account card lists no held request to an agent.
create or replace function public.support_get_account(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_card jsonb;
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  if not exists (select 1 from public.profiles p where p.id = p_id and p.role in ('client', 'shop')) then
    perform public.fail('not_found');
  end if;
  v_card := public.support_account_card(p_id);
  perform public.staff_audit('support_view_account', 'profile', p_id::text, null, null);
  return v_card || jsonb_build_object(
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'body', g.body, 'status', g.status, 'created_at', g.created_at)
             order by g.created_at desc)
      from public.suggestions g where g.author_id = p_id
        and (v_me.role = 'admin' or not public.legal_hold_covers(g.id, g.author_id))), '[]'::jsonb));
end
$function$;

-- A3c2a: a held request's file does not exist for an agent (support-files function).
create or replace function public.support_file_open(p_user uuid, p_aal text, p_session uuid, p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.profiles%rowtype;
  f public.suggestion_files%rowtype;
  s public.suggestions%rowtype;
begin
  v := public.support_file_caller(p_user, p_aal, p_session);
  select * into f from public.suggestion_files where id = p_file;
  if not found or f.suggestion_id is null then
    perform public.fail('file_not_found');
  end if;
  select * into s from public.suggestions where id = f.suggestion_id;
  if v.role in ('client', 'shop') and s.author_id is distinct from v.id then
    perform public.fail('file_not_found');
  end if;
  if v.role = 'support' and public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)) then
    perform public.fail('file_not_found');
  end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (v.id, 'open_request_file', 'suggestion', s.id::text, null,
          jsonb_build_object('file_id', f.id, 'file_name', f.name), clock_timestamp());
  return jsonb_build_object('path', f.path, 'mime', f.mime, 'name', f.name);
end
$function$;

-- A3c2a: a held request stays with the admin.
create or replace function public.admin_return_request(p_id uuid, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seen jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  s public.suggestions%rowtype;
  v_to uuid;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_return_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  -- A3c2a: an agent cannot see a held request, so it is not given back to one.
  if public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)) then
    perform public.fail('legal_hold');
  end if;
  if s.escalated_at is null then
    perform public.fail('wrong_status', jsonb_build_object('escalated', false));
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  select p.id into v_to from public.profiles p
  where p.id = s.escalated_by and p.role = 'support' and not p.suspended and p.deleted_at is null;
  update public.suggestions
  set escalated_at = null, escalated_by = null, escalation_reason = null, assigned_to = v_to,
      assigned_at = case when v_to is not null then now() end, updated_at = now()
  where id = s.id;
  perform public.staff_audit('return_request', 'suggestion', s.id::text,
    jsonb_build_object('escalated', true, 'escalation_reason', s.escalation_reason),
    jsonb_build_object('escalated', false, 'assigned_to', (select display_id from public.profiles where id = v_to)), v_reason);
  v_result := jsonb_build_object('id', s.id, 'escalated', false, 'assigned_to', v_to);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$function$;

-- A3c2a: no author signal for a request whose author is gone.
create or replace function public.support_signal(p_suggestion uuid, p_author boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.support_signals (suggestion_id, audience, author_id)
  select s.id, a.audience, case when a.audience = 'author' then s.author_id end
  from public.suggestions s
  cross join (values ('team'), ('author')) a (audience)
  where s.id = p_suggestion and (a.audience = 'team' or (p_author and s.author_id is not null))
    and auth.uid() is not null
  on conflict (suggestion_id, audience) do update set changed_at = clock_timestamp()
$function$;

-- A3c2a: the daily cleanup (A3b) skips held files and deletes the others as before.
create or replace function public.support_files_collect(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gone as (
    delete from public.suggestion_files f
    where (f.suggestion_id is null and f.created_at <= p_now - interval '24 hours')
       or exists (select 1 from public.suggestions s
                  where s.id = f.suggestion_id and s.status = 'closed' and s.closed_at <= p_now - interval '90 days'
                    and not public.legal_hold_covers(s.id, coalesce(s.author_id, s.former_author_id)))
    returning 1
  )
  select count(*)::int from gone
$function$;

-- A3c2a: the identifiers of an account with held data are taken before its deletion.
create or replace function public.prepare_account_deletion(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_keep_shop boolean := false;
begin
  select * into v_me from public.profiles where id = p_user_id for update;
  if not found then
    return 'delete';
  end if;
  if v_me.role in ('admin', 'support') then
    perform public.fail('not_allowed');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.client_id = p_user_id and public.is_active_status(b.status)
  ) then
    perform public.fail('account_has_active_bookings');
  end if;

  select * into v_shop from public.shops where owner_id = p_user_id for update;
  if found then
    if exists (
      select 1 from public.bookings b
      where b.shop_id = v_shop.id and public.is_active_status(b.status)
    ) then
      perform public.fail('shop_has_active_bookings');
    end if;
    v_keep_shop := exists (select 1 from public.bookings b where b.shop_id = v_shop.id)
                or exists (select 1 from public.invoices i where i.shop_id = v_shop.id);
  end if;

  -- A3c2a: an account with held support data — its identifiers as they are now, email included,
  -- before the login goes (the deletion itself then keeps the held requests: profiles_support_on_delete).
  if public.legal_hold_has_subject(p_user_id) then
    perform public.legal_hold_capture_subject(p_user_id);
    update public.legal_hold_subjects set account_deleted_at = coalesce(account_deleted_at, now()) where user_id = p_user_id;
  end if;

  -- What other people keep about this person loses the name and the phone number.
  update public.bookings set client_name = null, client_phone = null where client_id = p_user_id;
  update public.threads set client_name = null where client_id = p_user_id;
  update public.reviews set client_display_name = '' where client_id = p_user_id;

  -- Their own data goes now, whatever happens to the login.
  delete from public.cars where owner_id = p_user_id;
  delete from public.favorites where client_id = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.phone_verifications where user_id = p_user_id;
  delete from public.notice_reads where user_id = p_user_id;
  delete from public.notification_events where user_id = p_user_id and processed_at is null;

  if v_keep_shop then
    update public.shops set active = false where id = v_shop.id;
    update public.subscriptions set status = 'inactive', cancel_at_period_end = false
    where shop_id = v_shop.id;
    delete from public.shop_staff where shop_id = v_shop.id and role = 'staff';
    update public.shop_staff set invited_email = null where shop_id = v_shop.id and role = 'owner';
    update public.profiles
    set name = null, phone = null, push_prompt_dismissed_at = null, location_prompt_dismissed_at = null,
        deleted_at = coalesce(deleted_at, now())
    where id = p_user_id;
    return 'anonymize';
  end if;

  update public.profiles set deleted_at = coalesce(deleted_at, now()) where id = p_user_id;
  return 'delete';
end
$function$;

update public.schema_version set version = 114;
