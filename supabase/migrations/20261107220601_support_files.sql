-- A3b — files attached to support requests (Eduard, 7 Nov 2026: plan A3b approved with its five
-- defaults and his conditions: the team's files pass the same checks, photos lose every personal
-- metadata with the orientation kept, every access is in the audit log, files never sent are deleted
-- completely after 24 hours, the real type is checked on the server, a private bucket and links that
-- expire fast).
--
-- · Bucket `support-files`: private, 5 MB, PNG / JPEG / WebP / PDF. No storage policy for it at all:
--   nobody reads or writes it through the API. Only the Edge Function support-files does, with the
--   service role, after checking the file (supabase/functions/_shared/supportFiles.ts).
-- · suggestion_files: one row per file. Uploaded first ("not sent": no request yet), attached when
--   the author or a team member sends the request or the message (create_support_request,
--   reply_my_support_request, support_reply_request take p_file_ids). At most 5 per message, 20 per
--   request; only the uploader's own files, sent within 24 hours.
-- · Opening a file: support_file_open (service role) checks who asks — the request's author or the
--   team — and writes the audit log (open_request_file) for every opening; the Edge Function then
--   answers a signed link valid 60 seconds.
-- · Deleting: a deleted row queues its path (support_file_deletions); the daily cleanup (pg_cron →
--   the Edge Function) deletes the files never sent after 24 hours, the files of requests closed for
--   90 days, the queued paths and any stray object, from Storage and from the tables.
-- · The internal notes take no files.
--
-- No existing row is changed. Rollback: supabase/rollback/20261107220601_support_files.sql — it
-- refuses to run while any file exists.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-files', 'support-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

create table public.suggestion_files (
  id uuid primary key default gen_random_uuid(),
  -- null until the file is sent with a request or a message
  suggestion_id uuid references public.suggestions (id) on delete cascade,
  -- null with a request: the file belongs to the request's description
  message_id uuid references public.suggestion_messages (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  from_staff boolean not null,
  path text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size int not null check (size between 1 and 5242880),
  name text not null check (char_length(name) between 1 and 120),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  attached_at timestamptz,
  check ((suggestion_id is null) = (attached_at is null)),
  check (message_id is null or suggestion_id is not null)
);
create index suggestion_files_request_idx on public.suggestion_files (suggestion_id, created_at) where suggestion_id is not null;
create index suggestion_files_pending_idx on public.suggestion_files (created_at) where suggestion_id is null;
alter table public.suggestion_files enable row level security;
revoke all on public.suggestion_files from public, anon, authenticated;

-- Paths whose file must leave Storage (the row is already gone).
create table public.support_file_deletions (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.support_file_deletions enable row level security;
revoke all on public.support_file_deletions from public, anon, authenticated;

create function public.queue_support_file_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.support_file_deletions (path) values (old.path) on conflict (path) do nothing;
  return old;
end
$$;
revoke execute on function public.queue_support_file_deletion() from public, anon, authenticated;

create trigger suggestion_files_queue_deletion
  after delete on public.suggestion_files
  for each row execute function public.queue_support_file_deletion();

-- ---------------------------------------------------------------------------------------------
-- Who may upload or open (the Edge Function passes the user the Auth server confirmed, the token's
-- assurance level and its session)
-- ---------------------------------------------------------------------------------------------
create function public.support_file_caller(p_user uuid, p_aal text, p_session uuid)
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
  if v.role = 'support' and not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user) then
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$$;
revoke execute on function public.support_file_caller(uuid, text, uuid) from public, anon, authenticated;

-- Before storing: the caller may upload (30 an hour; at most 20 files waiting to be sent).
create function public.support_file_begin(p_user uuid, p_aal text, p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.support_file_caller(p_user, p_aal, p_session);
  if (select count(*) from public.suggestion_files f
      where f.uploaded_by = v.id and f.suggestion_id is null and f.created_at > now() - interval '24 hours') >= 20 then
    perform public.fail('too_many_files', jsonb_build_object('max', 20));
  end if;
  if not public.rate_take('support_upload', v.id, 30, interval '1 hour') then
    perform public.fail('limit_support_uploads', jsonb_build_object('limit', 30));
  end if;
  return jsonb_build_object('staff', v.role in ('support', 'admin'));
end
$$;
revoke execute on function public.support_file_begin(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.support_file_begin(uuid, text, uuid) to service_role;

-- After storing: the file, not sent yet.
create function public.support_file_register(p_user uuid, p_aal text, p_session uuid, p_path text, p_mime text,
  p_size int, p_name text, p_sha256 text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  f public.suggestion_files%rowtype;
begin
  v := public.support_file_caller(p_user, p_aal, p_session);
  if split_part(p_path, '/', 1) <> v.id::text then
    perform public.fail('file_invalid');
  end if;
  insert into public.suggestion_files (uploaded_by, from_staff, path, mime, size, name, sha256)
  values (v.id, v.role in ('support', 'admin'), p_path, p_mime, p_size, p_name, p_sha256)
  returning * into f;
  return jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size', f.size);
end
$$;
revoke execute on function public.support_file_register(uuid, text, uuid, text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.support_file_register(uuid, text, uuid, text, text, int, text, text) to service_role;

-- Opening: the request's author or the team, never a file not sent. Every opening is in the audit log.
create function public.support_file_open(p_user uuid, p_aal text, p_session uuid, p_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (v.id, 'open_request_file', 'suggestion', s.id::text, null,
          jsonb_build_object('file_id', f.id, 'file_name', f.name), clock_timestamp());
  return jsonb_build_object('path', f.path, 'mime', f.mime, 'name', f.name);
end
$$;
revoke execute on function public.support_file_open(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.support_file_open(uuid, text, uuid, uuid) to service_role;

-- Attaches the caller's own files, uploaded in the last 24 hours and not sent, to a request (its
-- description: no message) or a message. At most 5 at once, 20 per request. Sending the same request
-- again (same request id, its stored answer) finds them already there and changes nothing.
create function public.support_attach_files(p_user uuid, p_suggestion uuid, p_message uuid, p_files uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_files, '{}')) x where x is not null);
  f public.suggestion_files%rowtype;
  v_id uuid;
begin
  if cardinality(v_ids) = 0 then
    return;
  end if;
  if cardinality(v_ids) > 5 then
    perform public.fail('too_many_files', jsonb_build_object('max', 5));
  end if;
  foreach v_id in array v_ids loop
    select * into f from public.suggestion_files where id = v_id for update;
    if found and f.suggestion_id = p_suggestion and f.message_id is not distinct from p_message then
      continue; -- already attached here (a retry)
    end if;
    if not found or f.suggestion_id is not null or f.uploaded_by is distinct from p_user
       or f.created_at <= now() - interval '24 hours' then
      perform public.fail('file_invalid');
    end if;
    update public.suggestion_files set suggestion_id = p_suggestion, message_id = p_message, attached_at = now()
    where id = v_id;
  end loop;
  if (select count(*) from public.suggestion_files where suggestion_id = p_suggestion) > 20 then
    perform public.fail('too_many_files', jsonb_build_object('max', 20));
  end if;
end
$$;
revoke execute on function public.support_attach_files(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;

-- A request's files as a screen shows them (no path: a file opens only through support-files).
create function public.support_request_files(p_suggestion uuid, p_with_opens boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'message_id', f.message_id, 'name', f.name, 'mime', f.mime, 'size', f.size,
      'from_staff', f.from_staff, 'created_at', f.attached_at)
      || case when p_with_opens then jsonb_build_object('opens', coalesce((
           select jsonb_agg(jsonb_build_object('at', a.created_at,
                    'by', coalesce(p.display_id, a.actor_display_id), 'name', p.name, 'role', coalesce(a.actor_role, p.role))
                  order by a.created_at desc)
           from public.admin_audit_log a left join public.profiles p on p.id = a.admin_id
           where a.action = 'open_request_file' and a.entity_id = p_suggestion::text and a.after->>'file_id' = f.id::text), '[]'::jsonb))
         else '{}'::jsonb end
    order by f.attached_at, f.id), '[]'::jsonb)
  from public.suggestion_files f
  where f.suggestion_id = p_suggestion
$$;
revoke execute on function public.support_request_files(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The A3a functions, with files (same names: the app's older version keeps working)
-- ---------------------------------------------------------------------------------------------
alter function public.create_support_request(text, text, text, text, uuid) rename to create_support_request_a3a;
revoke execute on function public.create_support_request_a3a(text, text, text, text, uuid) from public, anon, authenticated;
create function public.create_support_request(p_category text, p_title text, p_body text, p_booking_ref text,
  p_request_id uuid, p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.create_support_request_a3a(p_category, p_title, p_body, p_booking_ref, p_request_id);
  perform public.support_attach_files(auth.uid(), (v->>'id')::uuid, null, p_file_ids);
  return v;
end
$$;
revoke execute on function public.create_support_request(text, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.create_support_request(text, text, text, text, uuid, uuid[]) to authenticated;

alter function public.reply_my_support_request(uuid, text, uuid) rename to reply_my_support_request_a3a;
revoke execute on function public.reply_my_support_request_a3a(uuid, text, uuid) from public, anon, authenticated;
create function public.reply_my_support_request(p_id uuid, p_body text, p_request_id uuid, p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.reply_my_support_request_a3a(p_id, p_body, p_request_id);
  perform public.support_attach_files(auth.uid(), p_id, (v->>'id')::uuid, p_file_ids);
  return v;
end
$$;
revoke execute on function public.reply_my_support_request(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.reply_my_support_request(uuid, text, uuid, uuid[]) to authenticated;

alter function public.support_reply_request(uuid, text, text, uuid) rename to support_reply_request_a3a;
revoke execute on function public.support_reply_request_a3a(uuid, text, text, uuid) from public, anon, authenticated;
create function public.support_reply_request(p_id uuid, p_body text, p_status text, p_request_id uuid,
  p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.support_reply_request_a3a(p_id, p_body, p_status, p_request_id);
  perform public.support_attach_files(auth.uid(), p_id, (v->>'id')::uuid, p_file_ids);
  return v;
end
$$;
revoke execute on function public.support_reply_request(uuid, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.support_reply_request(uuid, text, text, uuid, uuid[]) to authenticated;

alter function public.get_my_support_request(uuid) rename to get_my_support_request_a3a;
revoke execute on function public.get_my_support_request_a3a(uuid) from public, anon, authenticated;
create function public.get_my_support_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.get_my_support_request_a3a(p_id);
  return v || jsonb_build_object('files', public.support_request_files(p_id, false));
end
$$;
revoke execute on function public.get_my_support_request(uuid) from public, anon;
grant execute on function public.get_my_support_request(uuid) to authenticated;

-- The team's view; the admin also sees who opened each file and when.
alter function public.support_get_request(uuid) rename to support_get_request_a3a;
revoke execute on function public.support_get_request_a3a(uuid) from public, anon, authenticated;
create function public.support_get_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  v := public.support_get_request_a3a(p_id);
  return v || jsonb_build_object('files',
    public.support_request_files(p_id, exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')));
end
$$;
revoke execute on function public.support_get_request(uuid) from public, anon;
grant execute on function public.support_get_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Cleanup (daily, the Edge Function support-files with the dispatcher's token)
-- ---------------------------------------------------------------------------------------------

-- Deletes the rows due: files not sent for 24 hours, files of requests closed for 90 days. Their
-- paths join the queue (trigger). Answers how many.
create function public.support_files_collect(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.suggestion_files f
    where (f.suggestion_id is null and f.created_at <= p_now - interval '24 hours')
       or exists (select 1 from public.suggestions s
                  where s.id = f.suggestion_id and s.status = 'closed' and s.closed_at <= p_now - interval '90 days')
    returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function public.support_files_collect(timestamptz) from public, anon, authenticated;
grant execute on function public.support_files_collect(timestamptz) to service_role;

create function public.support_file_deletions_next(p_limit int default 500)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(path order by queued_at), '{}')
  from (select path, queued_at from public.support_file_deletions order by queued_at limit least(greatest(p_limit, 1), 1000)) x
$$;
revoke execute on function public.support_file_deletions_next(int) from public, anon, authenticated;
grant execute on function public.support_file_deletions_next(int) to service_role;

create function public.support_file_deletions_done(p_paths text[])
returns int
language sql
security definer
set search_path = ''
as $$
  with done as (delete from public.support_file_deletions where path = any (p_paths) returning 1)
  select count(*)::int from done
$$;
revoke execute on function public.support_file_deletions_done(text[]) from public, anon, authenticated;
grant execute on function public.support_file_deletions_done(text[]) to service_role;

-- Objects in the bucket older than 24 hours that no row knows (an upload whose row was never
-- written, e.g. the function stopped half-way).
create function public.support_files_stray(p_limit int default 500, p_now timestamptz default now())
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name), '{}')
  from (select name from storage.objects
        where bucket_id = 'support-files' and created_at <= p_now - interval '24 hours'
          and not exists (select 1 from public.suggestion_files f where f.path = storage.objects.name)
        order by created_at
        limit least(greatest(p_limit, 1), 1000)) o
$$;
revoke execute on function public.support_files_stray(int, timestamptz) from public, anon, authenticated;
grant execute on function public.support_files_stray(int, timestamptz) to service_role;

create function public.kick_support_files_cleanup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if to_regnamespace('net') is null then
    return false;
  end if;
  select dispatch_url, dispatch_token into v_url, v_token from public.push_config where id = 1;
  if v_url is null or v_url not like '%/dispatch-notifications%' then
    return false;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    using replace(v_url, '/dispatch-notifications', '/support-files'), '{"action":"cleanup"}'::jsonb,
          jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-token', v_token);
  return true;
end
$$;
revoke execute on function public.kick_support_files_cleanup() from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_support_files_cleanup', '37 3 * * *', 'select public.kick_support_files_cleanup()');
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- "Datele mele": the files of the author's requests (name, type, size, date, who sent it), never the
-- team member's name; the files themselves open in the request.
-- ---------------------------------------------------------------------------------------------
alter function public.export_my_data() rename to export_my_data_a3b;
revoke execute on function public.export_my_data_a3b() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_a3b() || jsonb_build_object(
    'support_files', coalesce((
      select jsonb_agg(jsonb_build_object(
          'request', s.title, 'name', f.name, 'type', f.mime, 'size', f.size,
          'from', case when f.from_staff then 'Service-Hub' else 'me' end, 'created_at', f.created_at)
        order by f.created_at, f.id)
      from public.suggestion_files f
      join public.suggestions s on s.id = f.suggestion_id
      where s.author_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

update public.schema_version set version = 111;
