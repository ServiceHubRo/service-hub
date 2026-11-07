-- P3 — the platform admin no longer reads private conversations (Eduard, 6 Nov 2026: option A).
--
-- Removed for the admin: the threads policy branch, the admin branch of can_read_thread (which the
-- messages policy uses, so messages and Realtime follow), admin_get_thread and admin_thread_messages,
-- and the direct read of notification_events, whose new-message events keep the start of the message
-- (params.preview). No screen reads that table; the admin's counters use security definer functions.
-- Kept: on the client's page, each conversation's shop, date of the last message and number of messages
-- (no content); on a booking's page, its automatic events (confirmed, quote sent, cancelled, …), never a
-- message written by the client or the shop. Clients and shops keep exactly their access.
--
-- No row is modified. Rollback: supabase/rollback/20261106205957_admin_no_private_messages.sql.

alter policy threads_select on public.threads
  using ((client_id = auth.uid()) or public.is_shop_member(shop_id));

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
      and (t.client_id = auth.uid() or public.is_shop_member(t.shop_id))
  )
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
begin
  perform public.require_admin();
  select * into v from public.bookings where id = p_booking_id;
  if not found then
    perform public.fail('booking_not_found');
  end if;
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
    -- P3: the booking's automatic events only (confirmed, quote sent, cancelled, …), never a message
    -- written by the client or the shop.
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'event', m.event, 'params', m.params, 'created_at', m.created_at)
             order by m.created_at, m.id)
      from public.messages m where m.booking_id = v.id and m.kind = 'system'), '[]'::jsonb),
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

drop policy notification_events_select_admin on public.notification_events;

drop function public.admin_get_thread(uuid);
drop function public.admin_thread_messages(uuid);

update public.schema_version set version = 108;
