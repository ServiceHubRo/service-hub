-- A3c1 — the support dashboard and live updates (plan A3c approved by Eduard on 8 Nov 2026, split in
-- A3c1: dashboard + realtime, and A3c2: legal hold + retention). Nothing here deletes or changes an
-- existing row.
--
-- · support_signals: one row per request and audience ('team', 'author') holding only the request's
--   id, its author (author rows only) and when it last changed. Realtime streams this table, never
--   the requests, messages, notes or files: a screen that hears a change reads again through the
--   functions that already check who may see what. A note or an assignment touches only the team's
--   row, so the author never learns when the team writes internally. The primary key is a plain
--   number, so a deleted row (Realtime sends deletions without checking RLS) names no request.
-- · support_dashboard(): the counters of Solicitări (per state, escalated, without anyone
--   responsible, mine, waiting over 24 and 48 calendar hours) and the oldest request without answer.
-- · support_inbox(...): the list, filtered and ordered in the database, one page at a time (keyset:
--   open first, then the author's latest message, newest first). Replaces the screen's single read of
--   at most 1,000 rows (support_list_requests stays, unchanged).

-- ---------------------------------------------------------------------------------------------
-- Who may hear the team's signals: an agent or an admin, active, after the second step; an agent's
-- session must still exist (the same rule as require_staff, as a yes/no for RLS).
-- ---------------------------------------------------------------------------------------------
create function public.support_signal_reader()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('support', 'admin') and not p.suspended and p.deleted_at is null
      and public.caller_aal() = 'aal2'
      and (p.role = 'admin' or public.caller_session_alive()))
$$;
revoke execute on function public.support_signal_reader() from public, anon;
grant execute on function public.support_signal_reader() to authenticated;

create table public.support_signals (
  id bigint generated always as identity primary key,
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  audience text not null check (audience in ('team', 'author')),
  -- The request's author, on the author's row only (the filter of its subscription).
  author_id uuid,
  changed_at timestamptz not null default clock_timestamp(),
  unique (suggestion_id, audience),
  check ((audience = 'author') = (author_id is not null))
);
create index support_signals_author_idx on public.support_signals (author_id) where author_id is not null;
alter table public.support_signals enable row level security;
revoke all on public.support_signals from public, anon, authenticated;
grant select on public.support_signals to authenticated;
create policy support_signals_author on public.support_signals for select to authenticated
  using (audience = 'author' and author_id = auth.uid());
create policy support_signals_team on public.support_signals for select to authenticated
  using (audience = 'team' and public.support_signal_reader());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.support_signals;
  end if;
end
$$;

-- Marks a request changed for the team and, when the author can see the change, for the author.
-- Nothing when the request is gone (a cascade deleting it).
create function public.support_signal(p_suggestion uuid, p_author boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.support_signals (suggestion_id, audience, author_id)
  select s.id, a.audience, case when a.audience = 'author' then s.author_id end
  from public.suggestions s
  cross join (values ('team'), ('author')) a (audience)
  where s.id = p_suggestion and (a.audience = 'team' or p_author)
  on conflict (suggestion_id, audience) do update set changed_at = clock_timestamp()
$$;
revoke execute on function public.support_signal(uuid, boolean) from public, anon, authenticated;

create function public.support_signal_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The author hears what it sees: the state, the title, the category, the text and the
  -- conversation (both sides' last message). Not who is responsible, the escalation or its own
  -- reading (author_read_at, written each time it opens the request).
  perform public.support_signal(new.id,
    tg_op = 'INSERT'
    or new.status is distinct from old.status
    or new.title is distinct from old.title
    or new.category is distinct from old.category
    or new.body is distinct from old.body
    or new.last_staff_message_at is distinct from old.last_staff_message_at
    or new.last_user_message_at is distinct from old.last_user_message_at);
  return null;
end
$$;
revoke execute on function public.support_signal_request() from public, anon, authenticated;
create trigger suggestions_signal after insert or update on public.suggestions
  for each row execute function public.support_signal_request();

-- A message, a file or a note changed: its request changed. The trigger's argument says who hears
-- it: 'all' (the team and the author) or 'team' (the internal notes). A file moved from one request
-- to another (never done today) signals both.
create function public.support_signal_part()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author boolean := tg_argv[0] = 'all';
begin
  if tg_op <> 'DELETE' and new.suggestion_id is not null then
    perform public.support_signal(new.suggestion_id, v_author);
  end if;
  if tg_op <> 'INSERT' and old.suggestion_id is not null
     and (tg_op = 'DELETE' or old.suggestion_id is distinct from new.suggestion_id) then
    perform public.support_signal(old.suggestion_id, v_author);
  end if;
  return null;
end
$$;
revoke execute on function public.support_signal_part() from public, anon, authenticated;
create trigger suggestion_messages_signal after insert or update or delete on public.suggestion_messages
  for each row execute function public.support_signal_part('all');
create trigger suggestion_files_signal after insert or update of suggestion_id, message_id or delete on public.suggestion_files
  for each row execute function public.support_signal_part('all');
-- Internal: the team only.
create trigger suggestion_notes_signal after insert or update or delete on public.suggestion_notes
  for each row execute function public.support_signal_part('team');

-- ---------------------------------------------------------------------------------------------
-- The list, one page at a time
-- ---------------------------------------------------------------------------------------------
-- The order of the list (open first, then the author's latest message, newest first), indexed.
create index suggestions_inbox_idx on public.suggestions
  (public.support_request_open(status) desc, (coalesce(last_user_message_at, created_at)) desc, id desc);

-- The author waits for an answer since then (null: nobody waits). The same rule as the A3a list.
create function public.support_waiting_since(s public.suggestions)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case when public.support_request_open(s.status) and s.status <> 'waiting_user'
               and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity'::timestamptz)
              then coalesce(s.last_user_message_at, s.created_at) end
$$;
revoke execute on function public.support_waiting_since(public.suggestions) from public, anon, authenticated;

-- p_owner: all | mine | none (nobody, not escalated) | escalated | a team member's id;
-- p_status: open | all | one state; p_category: all | a category key; p_age: null | 24 | 48 (the
-- author waits at least so many hours). p_after_*: the last row of the previous page (its `next`).
-- p_limit: 1–100. Answers {me, items, next}; `next` is null on the last page.
create function public.support_inbox(
  p_owner text default 'all',
  p_status text default 'open',
  p_category text default 'all',
  p_age int default null,
  p_after_open boolean default null,
  p_after_at timestamptz default null,
  p_after_id uuid default null,
  p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        'waiting_since', public.support_waiting_since(x.s)) order by x.n) filter (where x.n <= v_limit), '[]'::jsonb),
    (select jsonb_build_object('open', y.open, 'at', y.at, 'id', (y.s).id)
       from numbered y where y.n = v_limit and exists (select 1 from numbered z where z.n = v_limit + 1))
  into v_items, v_next
  from numbered x
  left join public.profiles pr on pr.id = (x.s).author_id
  left join public.shops sh on sh.id = (x.s).shop_id;

  return jsonb_build_object('me', v_me.id, 'items', coalesce(v_items, '[]'::jsonb), 'next', v_next);
end
$$;
revoke execute on function public.support_inbox(text, text, text, int, boolean, timestamptz, uuid, int) from public, anon;
grant execute on function public.support_inbox(text, text, text, int, boolean, timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The dashboard
-- ---------------------------------------------------------------------------------------------
-- Counters over every request (not only a page), the oldest one whose author waits for an answer,
-- and the database's clock (the screen measures waiting from it, not from the device's).
create function public.support_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  from public.suggestions s;

  select jsonb_build_object(
      'id', s.id, 'title', public.support_request_label(s), 'waiting_since', public.support_waiting_since(s),
      'escalated', s.escalated_at is not null,
      'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end)
  into v_oldest
  from public.suggestions s
  where public.support_waiting_since(s) is not null
  order by public.support_waiting_since(s), s.id
  limit 1;

  return jsonb_build_object('me', v_me.id, 'now', now(), 'counts', v_counts, 'oldest', v_oldest);
end
$$;
revoke execute on function public.support_dashboard() from public, anon;
grant execute on function public.support_dashboard() to authenticated;

update public.schema_version set version = 112;
