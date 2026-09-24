-- T11 — Messages and reviews (FR §3.7, §4.4, §4.5).
--   1. list_threads(): the caller's conversations, newest first, with the other side's name, the
--      last message and how many messages are unread — one read for the Mesaje list and the badge
--      on its tab.
--   2. booking_thread(booking): the conversation between a booking's client and shop, for the
--      "Mesaj" button on booking cards (both sides).
-- Sending, read markers, replies and reports already exist (T03): send_message, mark_thread_read,
-- reply_review, report_review. The shop's reviews are read straight from the table (RLS).

-- ---------------------------------------------------------------------------------------------
-- Whether a message came from the reader's own side. A client's side: their own messages and the
-- automatic messages they caused (`params.by = 'client'`); a shop's side: messages of any member
-- (every sender who is not the thread's client) and the automatic messages the shop caused.
-- Automatic messages caused by the admin or the system belong to neither side.
-- ---------------------------------------------------------------------------------------------
create function public.message_is_own_side(p_message public.messages, p_client_id uuid, p_side text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_message.kind = 'system' then coalesce(p_message.params->>'by', '') = p_side
    when p_side = 'client' then p_message.sender_id is not distinct from p_client_id and p_client_id is not null
    else p_message.sender_id is not null and p_message.sender_id is distinct from p_client_id
  end
$$;

-- ---------------------------------------------------------------------------------------------
-- list_threads — a client gets their threads, a shop member the shop's threads (admin: none; the
-- admin's message tools are T16a). Newest message first. `unread` counts the other side's
-- messages after the caller's side read marker. The last message comes as stored (an automatic
-- one as event + params, rendered in the reader's language by the app).
-- ---------------------------------------------------------------------------------------------
create function public.list_threads()
returns table (
  thread_id uuid,
  shop_id uuid,
  client_id uuid,
  shop_name text,
  shop_logo_url text,
  client_name text,
  last_message_at timestamptz,
  last_kind text,
  last_body text,
  last_event text,
  last_params jsonb,
  last_own boolean,
  unread int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me public.profiles%rowtype;
  v_side text;
  v_shop uuid;
begin
  v_me := public.require_caller();
  if v_me.role = 'client' then
    v_side := 'client';
  elsif v_me.role = 'shop' then
    v_side := 'shop';
    v_shop := public.my_shop_id();
    if v_shop is null then
      return; -- a member removed from their shop has no conversations
    end if;
  else
    return;
  end if;

  return query
  select
    t.id, t.shop_id, t.client_id, s.name, s.logo_url, t.client_name, t.last_message_at,
    lm.kind, lm.body, lm.event, case when lm.kind = 'system' then lm.params end,
    public.message_is_own_side(lm, t.client_id, v_side),
    (select count(*)::int from public.messages m
     where m.thread_id = t.id
       and m.created_at > coalesce(case when v_side = 'client' then t.client_last_read_at else t.shop_last_read_at end,
                                   '-infinity'::timestamptz)
       and not public.message_is_own_side(m, t.client_id, v_side))
  from public.threads t
  join public.shops s on s.id = t.shop_id
  left join lateral (
    select m.* from public.messages m
    where m.thread_id = t.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where (v_side = 'client' and t.client_id = v_me.id)
     or (v_side = 'shop' and t.shop_id = v_shop)
  order by t.last_message_at desc nulls last, t.created_at desc;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- booking_thread — the thread of a booking's (shop, client) pair, for its client or a member of
-- its shop. Every booking writes an automatic message when it is created, so the thread exists;
-- `thread_not_found` only when the client deleted the account.
-- ---------------------------------------------------------------------------------------------
create function public.booking_thread(p_booking_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_thread uuid;
begin
  perform public.require_caller();
  select * into v from public.bookings where id = p_booking_id;
  if not found or not (v.client_id = auth.uid() or public.is_shop_member(v.shop_id)) then
    perform public.fail('booking_not_found');
  end if;
  select t.id into v_thread from public.threads t where t.shop_id = v.shop_id and t.client_id = v.client_id;
  if v_thread is null then
    perform public.fail('thread_not_found');
  end if;
  return v_thread;
end
$$;

grant execute on function
  public.list_threads(),
  public.booking_thread(uuid)
to authenticated;

update public.schema_version set version = 15;
