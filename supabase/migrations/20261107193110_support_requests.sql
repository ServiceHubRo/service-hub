-- A3a — support requests (Eduard, 7 Nov 2026: plan A3 approved in three parts; this is the first).
--
-- The suggestions (T26) become the one support system: the table `suggestions` is kept and extended,
-- no second system next to it. Every row written so far keeps its text, author, state and dates; it
-- is in the category „Sugestii și îmbunătățiri” and has no title.
--
-- · support_categories: the nine categories (RO / EN names, who may choose each, order, on/off).
-- · suggestions: title, category, the booking it is about, the person responsible, escalation (when,
--   by whom, why), the first answer, resolved, closed, the last message of each side, read by the
--   author. States: new, in_progress, waiting_user, resolved, closed; the old planned, done and declined
--   stay for the suggestions only. The author reads only its own rows and only the columns meant for
--   it (never who handles it or why it was escalated).
-- · suggestion_messages: the conversation with the author. Staff messages are signed „Echipa
--   Service-Hub” for the author (its own column grant leaves out author_id).
-- · suggestion_notes: the team's internal notes. RLS on, no policy, no grant, not in Realtime: only
--   the support_* functions read or write them, and none of the author's functions, the data export,
--   the Edge Functions or the notifications touch this table.
-- · The author: my_support_requests, get_my_support_request, create_support_request,
--   reply_my_support_request (a message within 14 days of „Rezolvată” reopens it; after that it is
--   closed, by close_resolved_support_requests every day as well). submit_suggestion keeps working
--   (the old Android app) and writes a suggestion as before.
-- · The team (agent or admin, require_staff): support_list_requests, support_get_request (logged),
--   support_list_staff, support_take_request, support_assign_request, support_reply_request,
--   support_add_note, support_set_request_status, support_escalate_request (agent, reason required).
--   An escalated request is the admin's: an agent reads it and cannot change it
--   (request_escalated). admin_return_request gives it back (reason required). Every change is in the
--   audit log, with who did it.
-- · Notifications: support_reply / support_resolved to the author (push + email), support_escalated to
--   the platform's admin address.
--
-- No existing row is rewritten. Rollback: supabase/rollback/20261107193110_support_requests.sql — it
-- refuses to run while a request, message or note written after A3a exists (they would be lost).

-- ---------------------------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------------------------
create table public.support_categories (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  name_ro text not null check (char_length(btrim(name_ro)) between 2 and 80),
  name_en text not null check (char_length(btrim(name_en)) between 2 and 80),
  -- Who may choose it when writing a request.
  roles text[] not null default array['client', 'shop'] check (roles <@ array['client', 'shop'] and cardinality(roles) > 0),
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.support_categories enable row level security;
revoke all on public.support_categories from public, anon, authenticated;

insert into public.support_categories (key, name_ro, name_en, roles, position) values
  ('technical', 'Probleme tehnice', 'Technical problems', array['client', 'shop'], 1),
  ('account', 'Cont și autentificare', 'Account and sign-in', array['client', 'shop'], 2),
  ('bookings', 'Programări', 'Bookings', array['client', 'shop'], 3),
  ('vehicles', 'Vehicule și istoric', 'Vehicles and history', array['client', 'shop'], 4),
  ('shops', 'Service-uri', 'Shops', array['client', 'shop'], 5),
  ('companies', 'Firme și flote', 'Companies and fleets', array['client'], 6),
  ('subscriptions', 'Abonamente', 'Subscriptions', array['client', 'shop'], 7),
  ('notifications', 'Notificări', 'Notifications', array['client', 'shop'], 8),
  ('suggestions', 'Sugestii și îmbunătățiri', 'Suggestions and improvements', array['client', 'shop'], 9);

-- ---------------------------------------------------------------------------------------------
-- suggestions → requests
-- ---------------------------------------------------------------------------------------------
alter table public.suggestions
  add column title text check (title is null or char_length(btrim(title)) between 3 and 120),
  add column category text not null default 'suggestions' references public.support_categories (key),
  add column booking_id uuid references public.bookings (id) on delete set null,
  add column assigned_to uuid references public.profiles (id) on delete set null,
  add column assigned_at timestamptz,
  add column escalated_at timestamptz,
  add column escalated_by uuid references public.profiles (id) on delete set null,
  add column escalation_reason text check (escalation_reason is null or char_length(escalation_reason) <= 500),
  add column first_response_at timestamptz,
  add column resolved_at timestamptz,
  add column closed_at timestamptz,
  add column last_user_message_at timestamptz,
  add column last_staff_message_at timestamptz,
  add column author_read_at timestamptz;
-- New rows (the old submit_suggestion included) start with their author's message; the rows written
-- before A3a keep null and are read with created_at instead.
alter table public.suggestions alter column last_user_message_at set default now();

alter table public.suggestions drop constraint suggestions_status_check;
alter table public.suggestions add constraint suggestions_status_check
  check (status in ('new', 'in_progress', 'waiting_user', 'resolved', 'closed', 'planned', 'done', 'declined'));
-- planned / done / declined belong to the suggestions only.
alter table public.suggestions add constraint suggestions_legacy_status
  check (category = 'suggestions' or status not in ('planned', 'done', 'declined'));
alter table public.suggestions drop constraint suggestions_body_check;
alter table public.suggestions add constraint suggestions_body_check check (char_length(body) between 1 and 4000);

create index suggestions_category_idx on public.suggestions (category, created_at desc);
create index suggestions_assigned_idx on public.suggestions (assigned_to) where assigned_to is not null;
create index suggestions_open_idx on public.suggestions (updated_at desc) where status not in ('closed', 'done', 'declined');

-- The author reads its own rows (policy suggestions_own), only these columns: never who handles it,
-- the escalation or the booking's id (the app reads the booking through get_my_support_request).
revoke select on public.suggestions from authenticated;
grant select (id, body, status, created_at, updated_at, title, category) on public.suggestions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The conversation and the internal notes
-- ---------------------------------------------------------------------------------------------
create table public.suggestion_messages (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  -- The person who wrote it; null once that account is deleted (the author sees "Echipa Service-Hub"
  -- for every staff message anyway).
  author_id uuid references public.profiles (id) on delete set null,
  from_staff boolean not null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index suggestion_messages_idx on public.suggestion_messages (suggestion_id, created_at);
alter table public.suggestion_messages enable row level security;
revoke all on public.suggestion_messages from public, anon, authenticated;
grant select (id, suggestion_id, from_staff, body, created_at) on public.suggestion_messages to authenticated;
-- The author of the request (the author cannot read suggestions.author_id itself: column grants).
create function public.is_support_request_author(p_suggestion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.suggestions s where s.id = p_suggestion_id and s.author_id = auth.uid())
$$;
revoke execute on function public.is_support_request_author(uuid) from public, anon;
grant execute on function public.is_support_request_author(uuid) to authenticated;
create policy suggestion_messages_own on public.suggestion_messages for select to authenticated
  using (public.is_support_request_author(suggestion_id));

create table public.suggestion_notes (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  -- The author's ID at the time, kept after the account is deleted.
  author_display_id text,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index suggestion_notes_idx on public.suggestion_notes (suggestion_id, created_at);
-- No policy and no grant: nobody reads this table through the API. Only security definer functions
-- of the team (support_get_request, support_add_note) touch it.
alter table public.suggestion_notes enable row level security;
revoke all on public.suggestion_notes from public, anon, authenticated;

-- An escalation goes by email to the platform's admin address (no user).
alter table public.notification_events drop constraint notification_events_recipient;
alter table public.notification_events add constraint notification_events_recipient
  check (user_id is not null or event in ('review_reported', 'admin_digest', 'walk_in_invite', 'support_escalated'));

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- A request's title for a list or a notification: its own, or the start of its text (the suggestions
-- written before A3a have none).
create function public.support_request_label(s public.suggestions)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(btrim(s.title), ''),
                  case when char_length(btrim(s.body)) > 60 then left(btrim(regexp_replace(s.body, '\s+', ' ', 'g')), 59) || '…'
                       else btrim(regexp_replace(s.body, '\s+', ' ', 'g')) end)
$$;
revoke execute on function public.support_request_label(public.suggestions) from public, anon, authenticated;

-- The states a request may take, by category: the suggestions keep their four.
create function public.support_status_allowed(p_category text, p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_category = 'suggestions' then p_status in ('new', 'planned', 'done', 'declined', 'closed')
              else p_status in ('in_progress', 'waiting_user', 'resolved', 'closed') end
$$;
revoke execute on function public.support_status_allowed(text, text) from public, anon, authenticated;

-- Open: the author may still write and the team still has to answer.
create function public.support_request_open(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_status in ('new', 'in_progress', 'waiting_user', 'planned')
$$;
revoke execute on function public.support_request_open(text) from public, anon, authenticated;

-- How long a request answered „Rezolvată” can still be reopened by its author.
create function public.support_reopen_until(s public.suggestions)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case when s.status = 'resolved' and s.resolved_at is not null then s.resolved_at + interval '14 days' end
$$;
revoke execute on function public.support_reopen_until(public.suggestions) from public, anon, authenticated;

-- The booking a request is about, as little as the person needs (A3, decision 1): code, day, shop,
-- state. Never the quote, the price, the car or the other party.
create function public.support_booking_ref(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ref', b.ref, 'date', b.date, 'status', b.status, 'shop_name', s.name)
  from public.bookings b join public.shops s on s.id = b.shop_id
  where b.id = p_booking_id
$$;
revoke execute on function public.support_booking_ref(uuid) from public, anon, authenticated;

-- An agent may not change an escalated request (it is the admin's); nobody changes a closed one.
create function public.support_guard(p_me public.profiles, s public.suggestions)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if s.escalated_at is not null and p_me.role <> 'admin' then
    perform public.fail('request_escalated');
  end if;
  if s.status = 'closed' then
    perform public.fail('request_closed');
  end if;
end
$$;
revoke execute on function public.support_guard(public.profiles, public.suggestions) from public, anon, authenticated;

-- The author's own account, able to write (a suspended account may still write to support).
create function public.require_support_author()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_reader();
  if v.role not in ('client', 'shop') or v.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;
revoke execute on function public.require_support_author() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The author: Cont → Ajutor și contact → Solicitările mele
-- ---------------------------------------------------------------------------------------------

-- The categories the caller may choose, in its language's order.
create function public.support_categories_for_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_reader();
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', c.key, 'name_ro', c.name_ro, 'name_en', c.name_en) order by c.position, c.key)
    from public.support_categories c
    where c.active and (v_me.role not in ('client', 'shop') or v_me.role = any (c.roles))), '[]'::jsonb);
end
$$;
revoke execute on function public.support_categories_for_me() from public, anon;
grant execute on function public.support_categories_for_me() to authenticated;

create function public.my_support_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_support_author();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', public.support_request_label(s), 'category', s.category, 'status', s.status,
        'created_at', s.created_at, 'updated_at', s.updated_at, 'last_staff_message_at', s.last_staff_message_at,
        'unread', s.last_staff_message_at is not null and s.last_staff_message_at > coalesce(s.author_read_at, '-infinity'::timestamptz))
      order by coalesce(s.last_staff_message_at, s.last_user_message_at, s.created_at) desc, s.id)
    from public.suggestions s
    where s.author_id = v_me.id), '[]'::jsonb);
end
$$;
revoke execute on function public.my_support_requests() from public, anon;
grant execute on function public.my_support_requests() to authenticated;

-- One request with its conversation (marks the team's answers read). Only the author's own request;
-- the internal notes are not read here.
create function public.get_my_support_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
  v_until timestamptz;
begin
  v_me := public.require_support_author();
  select * into s from public.suggestions where id = p_id and author_id = v_me.id;
  if not found then
    perform public.fail('request_not_found');
  end if;
  update public.suggestions set author_read_at = now() where id = s.id;
  v_until := public.support_reopen_until(s);
  return jsonb_build_object(
    'id', s.id, 'title', public.support_request_label(s), 'has_title', s.title is not null, 'body', s.body,
    'category', s.category, 'status', s.status, 'created_at', s.created_at,
    'booking', case when s.booking_id is not null then public.support_booking_ref(s.booking_id) end,
    'reopen_until', v_until,
    'can_reply', public.support_request_open(s.status) or (s.status = 'resolved' and v_until > now()),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'body', m.body, 'created_at', m.created_at)
             order by m.created_at, m.id)
      from public.suggestion_messages m where m.suggestion_id = s.id), '[]'::jsonb));
end
$$;
revoke execute on function public.get_my_support_request(uuid) from public, anon;
grant execute on function public.get_my_support_request(uuid) to authenticated;

-- A new request: a category the caller may choose, a title (3–120), a description (1–4,000) and,
-- optionally, the code of a booking of its own (client) or of its shop. At most 5 a day, together with
-- the suggestions written the old way.
create function public.create_support_request(p_category text, p_title text, p_body text, p_booking_ref text,
  p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_ref text := upper(btrim(coalesce(p_booking_ref, '')));
  v_booking uuid;
  v public.suggestions%rowtype;
  v_result jsonb;
begin
  v_me := public.require_support_author();
  v_seen := public.request_begin(p_request_id, 'create_support_request');
  if v_seen is not null then
    return v_seen;
  end if;
  if not exists (select 1 from public.support_categories c where c.key = p_category and c.active and v_me.role = any (c.roles)) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'category'));
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'title'));
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'body'));
  end if;
  if v_ref <> '' then
    select b.id into v_booking from public.bookings b
    where upper(b.ref) = v_ref
      and (b.client_id = v_me.id
        or exists (select 1 from public.shop_staff st where st.shop_id = b.shop_id and st.user_id = v_me.id and st.accepted_at is not null));
    if v_booking is null then
      perform public.fail('booking_not_found');
    end if;
  end if;
  if not public.rate_take('suggestion', v_me.id, 5, interval '24 hours') then
    perform public.fail('limit_suggestions', jsonb_build_object('limit', 5));
  end if;

  insert into public.suggestions (author_id, author_role, shop_id, body, title, category, booking_id, last_user_message_at)
  values (v_me.id, v_me.role, case when v_me.role = 'shop' then public.my_shop_id() end, v_body, v_title, p_category,
          v_booking, now())
  returning * into v;

  v_result := jsonb_build_object('id', v.id, 'status', v.status, 'created_at', v.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.create_support_request(text, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_request(text, text, text, text, uuid) to authenticated;

-- The author writes in its request. Waiting for it → back to the team; „Rezolvată” less than 14 days
-- ago → reopened (A3, decision 3); later, or closed → request_closed. 30 messages an hour.
create function public.reply_my_support_request(p_id uuid, p_body text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  s public.suggestions%rowtype;
  v_status text;
  m public.suggestion_messages%rowtype;
  v_result jsonb;
begin
  v_me := public.require_support_author();
  v_seen := public.request_begin(p_request_id, 'reply_my_support_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id and author_id = v_me.id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  if not (public.support_request_open(s.status) or (s.status = 'resolved' and public.support_reopen_until(s) > now())) then
    perform public.fail('request_closed');
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'body'));
  end if;
  if not public.rate_take('support_message', v_me.id, 30, interval '1 hour') then
    perform public.fail('limit_support_messages', jsonb_build_object('limit', 30));
  end if;

  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body)
  values (s.id, v_me.id, false, v_body)
  returning * into m;
  v_status := case when s.status in ('waiting_user', 'resolved') then 'in_progress' else s.status end;
  update public.suggestions
  set status = v_status, last_user_message_at = m.created_at, author_read_at = m.created_at, updated_at = now(),
      resolved_at = case when v_status = 'resolved' then resolved_at end
  where id = s.id;

  v_result := jsonb_build_object('id', m.id, 'status', v_status, 'created_at', m.created_at, 'reopened', s.status = 'resolved');
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.reply_my_support_request(uuid, text, uuid) from public, anon;
grant execute on function public.reply_my_support_request(uuid, text, uuid) to authenticated;

-- „Rezolvată” for 14 days with no message from the author → closed (daily, pg_cron). Answers how many.
create function public.close_resolved_support_requests(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update public.suggestions
    set status = 'closed', closed_at = p_now, updated_at = p_now
    where status = 'resolved' and resolved_at is not null and resolved_at + interval '14 days' <= p_now
    returning 1
  )
  select count(*)::int from closed
$$;
revoke execute on function public.close_resolved_support_requests(timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_close_support_requests', '17 3 * * *', 'select public.close_resolved_support_requests()');
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- The team: Solicitări (agent, /suport/solicitari; admin, /admin/suport/solicitari)
-- ---------------------------------------------------------------------------------------------

-- A person of the team as the other members see it.
create function public.support_staff_ref(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'role', p.role)
  from public.profiles p where p.id = p_id
$$;
revoke execute on function public.support_staff_ref(uuid) from public, anon, authenticated;

-- Every request, the open ones first: what the list and its filters need (who wrote it, who handles
-- it, escalated or not, since when the author waits for an answer).
create function public.support_list_requests()
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
        order by public.support_request_open(s.status) desc, coalesce(s.last_user_message_at, s.created_at) desc
        limit 1000
      ) x), '[]'::jsonb));
end
$$;
revoke execute on function public.support_list_requests() from public, anon;
grant execute on function public.support_list_requests() to authenticated;

-- The team members a request can be given to: active agents and admins.
create function public.support_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_staff();
  return coalesce((
    select jsonb_agg(public.support_staff_ref(p.id) order by p.role desc, p.display_id)
    from public.profiles p
    where p.role in ('support', 'admin') and not p.suspended and p.deleted_at is null), '[]'::jsonb);
end
$$;
revoke execute on function public.support_list_staff() from public, anon;
grant execute on function public.support_list_staff() to authenticated;

-- One request for the team: the author as an agent may see it (support_account_card), the booking's
-- minimal reference, the conversation (with which member wrote each answer), the internal notes and
-- the escalation. Each opening is in the audit log.
create function public.support_get_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
begin
  v_me := public.require_staff();
  select * into s from public.suggestions where id = p_id;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.staff_audit('support_view_request', 'suggestion', s.id::text, null, null);
  return jsonb_build_object(
    'id', s.id, 'title', public.support_request_label(s), 'body', s.body, 'category', s.category,
    'status', s.status, 'created_at', s.created_at, 'updated_at', s.updated_at,
    'author', case when s.author_id is not null then public.support_account_card(s.author_id) end,
    'author_role', s.author_role,
    'booking', case when s.booking_id is not null then public.support_booking_ref(s.booking_id) end,
    'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end,
    'assigned_at', s.assigned_at,
    'escalated_at', s.escalated_at, 'escalation_reason', s.escalation_reason,
    'escalated_by', case when s.escalated_by is not null then public.support_staff_ref(s.escalated_by) end,
    'first_response_at', s.first_response_at, 'resolved_at', s.resolved_at, 'closed_at', s.closed_at,
    'reopen_until', public.support_reopen_until(s),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'from_staff', m.from_staff, 'body', m.body, 'created_at', m.created_at,
               'by', case when m.from_staff and m.author_id is not null then public.support_staff_ref(m.author_id) end)
             order by m.created_at, m.id)
      from public.suggestion_messages m where m.suggestion_id = s.id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at,
               'by', coalesce(public.support_staff_ref(n.author_id), jsonb_build_object('display_id', n.author_display_id)))
             order by n.created_at, n.id)
      from public.suggestion_notes n where n.suggestion_id = s.id), '[]'::jsonb));
end
$$;
revoke execute on function public.support_get_request(uuid) from public, anon;
grant execute on function public.support_get_request(uuid) to authenticated;

-- Takes a request: the caller becomes responsible; a new one goes to „În lucru”.
create function public.support_take_request(p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
  v_status text;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_take_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.support_guard(v_me, s);
  v_status := case when s.status = 'new' and s.category <> 'suggestions' then 'in_progress' else s.status end;
  update public.suggestions set assigned_to = v_me.id, assigned_at = now(), status = v_status, updated_at = now()
  where id = s.id;
  perform public.staff_audit('take_request', 'suggestion', s.id::text,
    jsonb_build_object('assigned_to', (select display_id from public.profiles where id = s.assigned_to), 'request_status', s.status),
    jsonb_build_object('assigned_to', v_me.display_id, 'request_status', v_status));
  v_result := jsonb_build_object('id', s.id, 'status', v_status, 'assigned_to', v_me.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_take_request(uuid, uuid) from public, anon;
grant execute on function public.support_take_request(uuid, uuid) to authenticated;

-- Gives a request to another member of the team (an active agent or admin).
create function public.support_assign_request(p_id uuid, p_assignee uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
  a public.profiles%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_assign_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.support_guard(v_me, s);
  select * into a from public.profiles where id = p_assignee;
  if not found or a.role not in ('support', 'admin') or a.suspended or a.deleted_at is not null then
    perform public.fail('assignee_invalid');
  end if;
  update public.suggestions set assigned_to = a.id, assigned_at = now(), updated_at = now() where id = s.id;
  perform public.staff_audit('assign_request', 'suggestion', s.id::text,
    jsonb_build_object('assigned_to', (select display_id from public.profiles where id = s.assigned_to)),
    jsonb_build_object('assigned_to', a.display_id));
  v_result := jsonb_build_object('id', s.id, 'assigned_to', a.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_assign_request(uuid, uuid, uuid) from public, anon;
grant execute on function public.support_assign_request(uuid, uuid, uuid) to authenticated;

-- Changes the state; the author is told when its request is „Rezolvată”. Internal: shared by the
-- status change and the answer.
create function public.support_apply_status(p_me public.profiles, s public.suggestions, p_status text)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if p_status is null or p_status = s.status then
    return s.status;
  end if;
  if not public.support_status_allowed(s.category, p_status) then
    perform public.fail('status_invalid');
  end if;
  update public.suggestions
  set status = p_status, updated_at = now(),
      resolved_at = case when p_status = 'resolved' then now() when p_status = 'closed' then resolved_at end,
      closed_at = case when p_status = 'closed' then now() end
  where id = s.id;
  perform public.staff_audit('set_request_status', 'suggestion', s.id::text,
    jsonb_build_object('request_status', s.status), jsonb_build_object('request_status', p_status));
  return p_status;
end
$$;
revoke execute on function public.support_apply_status(public.profiles, public.suggestions, text) from public, anon, authenticated;

create function public.support_set_request_status(p_id uuid, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  s public.suggestions%rowtype;
  v_status text;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_set_request_status');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.support_guard(v_me, s);
  if p_status is null or p_status = s.status then
    perform public.fail('status_invalid');
  end if;
  v_status := public.support_apply_status(v_me, s, p_status);
  if v_status = 'resolved' and s.author_id is not null then
    perform public.notify_user(s.author_id, 'support_resolved',
      jsonb_build_object('request_id', s.id, 'title', public.support_request_label(s)), null, array['push', 'email']);
  end if;
  v_result := jsonb_build_object('id', s.id, 'status', v_status);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_set_request_status(uuid, text, uuid) from public, anon;
grant execute on function public.support_set_request_status(uuid, text, uuid) to authenticated;

-- Answers the author (who sees "Echipa Service-Hub"), optionally changing the state; a request nobody
-- handled becomes the caller's. The author is told by push and email, without the text of the answer.
create function public.support_reply_request(p_id uuid, p_body text, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  s public.suggestions%rowtype;
  m public.suggestion_messages%rowtype;
  v_status text;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_reply_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.support_guard(v_me, s);
  if s.author_id is null then
    perform public.fail('request_closed');
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'body'));
  end if;
  if p_status is not null and not public.support_status_allowed(s.category, p_status) then
    perform public.fail('status_invalid');
  end if;

  insert into public.suggestion_messages (suggestion_id, author_id, from_staff, body)
  values (s.id, v_me.id, true, v_body)
  returning * into m;
  update public.suggestions
  set last_staff_message_at = m.created_at, first_response_at = coalesce(first_response_at, m.created_at),
      assigned_to = coalesce(assigned_to, v_me.id), assigned_at = coalesce(assigned_at, now()), updated_at = now()
  where id = s.id
  returning * into s;
  v_status := public.support_apply_status(v_me, s,
    coalesce(p_status, case when s.status = 'new' and s.category <> 'suggestions' then 'in_progress' end));
  perform public.staff_audit('reply_request', 'suggestion', s.id::text, null,
    jsonb_build_object('message_id', m.id, 'request_status', v_status));
  perform public.notify_user(s.author_id, case when v_status = 'resolved' and s.status <> 'resolved' then 'support_resolved' else 'support_reply' end,
    jsonb_build_object('request_id', s.id, 'title', public.support_request_label(s)), null, array['push', 'email']);

  v_result := jsonb_build_object('id', m.id, 'status', v_status, 'created_at', m.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_reply_request(uuid, text, text, uuid) from public, anon;
grant execute on function public.support_reply_request(uuid, text, text, uuid) to authenticated;

-- An internal note: seen by the team only, never by the author.
create function public.support_add_note(p_id uuid, p_body text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public.support_add_note(uuid, text, uuid) from public, anon;
grant execute on function public.support_add_note(uuid, text, uuid) to authenticated;

-- An agent escalates to the admin (reason required): the request becomes the admin's; the agent reads
-- it and cannot change it. The author sees no difference. The admin's address gets an email.
create function public.support_escalate_request(p_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  s public.suggestions%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  if v_me.role <> 'support' then
    perform public.fail('not_allowed');
  end if;
  v_seen := public.request_begin(p_request_id, 'support_escalate_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  perform public.support_guard(v_me, s);
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  update public.suggestions
  set escalated_at = now(), escalated_by = v_me.id, escalation_reason = v_reason, assigned_to = null, assigned_at = null,
      updated_at = now()
  where id = s.id;
  perform public.staff_audit('escalate_request', 'suggestion', s.id::text,
    jsonb_build_object('assigned_to', (select display_id from public.profiles where id = s.assigned_to)),
    jsonb_build_object('escalated', true), v_reason);
  insert into public.notification_events (user_id, event, params, channels)
  values (null, 'support_escalated', jsonb_build_object(
    'request_id', s.id, 'title', public.support_request_label(s), 'category', s.category,
    'agent', v_me.display_id, 'reason', v_reason), array['email']);
  v_result := jsonb_build_object('id', s.id, 'escalated', true);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_escalate_request(uuid, text, uuid) from public, anon;
grant execute on function public.support_escalate_request(uuid, text, uuid) to authenticated;

-- The admin gives an escalated request back to the team (reason required): to the agent who escalated
-- it while that agent is active, otherwise to nobody.
create function public.admin_return_request(p_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke execute on function public.admin_return_request(uuid, text, uuid) from public, anon;
grant execute on function public.admin_return_request(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- "Datele mele": the requests with their conversation (never the internal notes, never who answered)
-- ---------------------------------------------------------------------------------------------
alter function public.export_my_data() rename to export_my_data_a3a;
revoke execute on function public.export_my_data_a3a() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_a3a() || jsonb_build_object(
    'support_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'title', s.title, 'category', s.category, 'text', s.body, 'status', s.status, 'created_at', s.created_at,
          'messages', coalesce((
            select jsonb_agg(jsonb_build_object('from', case when m.from_staff then 'Service-Hub' else 'me' end,
                                                'text', m.body, 'created_at', m.created_at) order by m.created_at, m.id)
            from public.suggestion_messages m where m.suggestion_id = s.id), '[]'::jsonb))
        order by s.created_at)
      from public.suggestions s
      where s.author_id = auth.uid()), '[]'::jsonb))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

update public.schema_version set version = 110;
