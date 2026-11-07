-- Rollback of P3 (supabase/migrations/20261106205957_admin_no_private_messages.sql), schema 108 → 107.
-- Restores the admin's read access to conversations exactly as before. Nothing is lost.
create function public.admin_thread_messages(p_thread_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.item order by x.created_at, x.id), '[]'::jsonb)
  from (
    select m.id, m.created_at, jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'body', m.body, 'event', m.event, 'params', m.params,
        'booking_id', m.booking_id, 'created_at', m.created_at,
        'side', case when m.kind = 'system' then 'system'
                     when m.sender_id is not null and m.sender_id = t.client_id then 'client'
                     when m.sender_id is null then 'unknown'
                     else 'shop' end,
        'sender_name', p.name) as item
    from public.messages m
    join public.threads t on t.id = m.thread_id
    left join public.profiles p on p.id = m.sender_id
    where m.thread_id = p_thread_id
    order by m.created_at desc, m.id desc
    limit 300
  ) x
$$;

create function public.admin_get_thread(p_thread_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.threads%rowtype;
begin
  perform public.require_admin();
  select * into v from public.threads where id = p_thread_id;
  if not found then
    perform public.fail('thread_not_found');
  end if;
  return jsonb_build_object(
    'thread', jsonb_build_object('id', v.id, 'shop_id', v.shop_id, 'client_id', v.client_id,
                'client_name', v.client_name, 'last_message_at', v.last_message_at,
                'client_display_id', (select p.display_id from public.profiles p where p.id = v.client_id),
                'shop_name', (select s.name from public.shops s where s.id = v.shop_id)),
    'messages', public.admin_thread_messages(v.id));
end
$$;

create or replace function public.admin_get_booking(p_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_thread uuid;
begin
  perform public.require_admin();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
  select t.id into v_thread from public.threads t where t.shop_id = v.shop_id and t.client_id = v.client_id;

  return jsonb_build_object(
    'booking', to_jsonb(v) || jsonb_build_object('slot', to_char(v.slot, 'HH24:MI')),
    'service', (select jsonb_build_object('id', sv.id, 'name_ro', sv.name_ro, 'name_en', sv.name_en, 'icon', sv.icon)
                from public.services sv where sv.id = v.service_id),
    'extra_services', public.service_names(v.extra_service_ids),
    'shop', (select jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'phone', s.phone,
                      'display_id', o.display_id)
             from public.shops s join public.profiles o on o.id = s.owner_id where s.id = v.shop_id),
    'client', (select jsonb_build_object('id', p.id, 'display_id', p.display_id, 'name', p.name, 'phone', p.phone,
                        'email', public.account_email(p.id), 'no_shows', public.client_no_show_count(p.id, 90))
               from public.profiles p where p.id = v.client_id),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'version', q.version, 'status', q.status, 'note', q.note,
               'inspection_fee', q.inspection_fee, 'total_sent', q.total_sent, 'total_approved', q.total_approved,
               'sent_at', q.sent_at, 'expires_at', q.expires_at, 'decided_at', q.decided_at,
               'items', coalesce((select jsonb_agg(jsonb_build_object('id', qi.id, 'name', qi.name, 'price', qi.price,
                                     'approved', qi.approved) order by qi.position)
                                  from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb))
             order by q.version desc)
      from public.quotes q where q.booking_id = v.id), '[]'::jsonb),
    'review', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'reply', r.reply,
                        'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
               from public.reviews r where r.booking_id = v.id),
    'thread_id', v_thread,
    'messages', case when v_thread is null then '[]'::jsonb else public.admin_thread_messages(v_thread) end,
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

create or replace function public.can_read_thread(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.threads t
    where t.id = p_thread_id
      and (t.client_id = auth.uid() or public.is_shop_member(t.shop_id) or public.is_admin())
  )
$$;

revoke execute on function public.admin_get_thread(uuid) from public, anon;
grant execute on function public.admin_get_thread(uuid) to authenticated;

alter policy threads_select on public.threads
  using ((client_id = auth.uid()) or public.is_shop_member(shop_id) or public.is_admin());

create policy notification_events_select_admin on public.notification_events for select to authenticated
  using (public.is_admin());

update public.schema_version set version = 107;
