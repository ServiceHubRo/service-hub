-- Rollback of 107 (supabase/migrations/20261106184405_fleet_money_visibility.sql), schema 107 → 106.
-- Run only in reverse order. Nothing is lost: no data was written by 107.
create or replace function public.notify_user(p_user_id uuid, p_event text, p_params jsonb, p_booking_id uuid,
                                   p_channels text[] default array['push'])
returns void
language sql
set search_path = ''
as $$
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  select p_user_id, p_event, coalesce(p_params, '{}'::jsonb), p_booking_id, p_channels
  where p_user_id is not null
$$;

create or replace function public.post_booking_event(p_booking public.bookings, p_event text, p_by text, p_params jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_thread uuid;
begin
  if p_booking.client_id is null then
    return; -- client account deleted: no thread to write into
  end if;
  v_thread := public.ensure_thread(p_booking.shop_id, p_booking.client_id);
  insert into public.messages (thread_id, kind, event, params, booking_id)
  values (v_thread, 'system', p_event,
          jsonb_build_object('ref', p_booking.ref, 'by', p_by) || coalesce(p_params, '{}'::jsonb),
          p_booking.id);
  update public.threads set last_message_at = now() where id = v_thread;
end
$$;

drop function public.report_jobs(uuid, text);
alter function public.report_jobs_t77(uuid, text) rename to report_jobs;
drop function public.job_document_data(uuid, uuid, text, text);
alter function public.job_document_data_t77(uuid, uuid, text, text) rename to job_document_data;
drop function public.export_my_data();
alter function public.export_my_data_t77() rename to export_my_data;
drop function public.set_booking_history_share(uuid, boolean, uuid);
drop function public.reschedule_booking(uuid, date, time, uuid);
drop function public.decide_quote(uuid, uuid, uuid[], uuid);
drop function public.cancel_booking(uuid, uuid);
alter function public.set_booking_history_share_t77(uuid, boolean, uuid) rename to set_booking_history_share;
alter function public.reschedule_booking_t77(uuid, date, time, uuid) rename to reschedule_booking;
alter function public.decide_quote_t77(uuid, uuid, uuid[], uuid) rename to decide_quote;
alter function public.cancel_booking_t77(uuid, uuid) rename to cancel_booking;
-- The grants as they were before 107.
grant execute on function public.cancel_booking(uuid, uuid), public.decide_quote(uuid, uuid, uuid[], uuid),
  public.reschedule_booking(uuid, date, time, uuid), public.set_booking_history_share(uuid, boolean, uuid), public.export_my_data()
  to authenticated;
drop function public.booking_for_caller(public.bookings);
drop function public.my_company_bookings();
alter policy quote_items_select on public.quote_items
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and public.can_read_booking(q.booking_id)));
alter policy quotes_select on public.quotes using (public.can_read_booking(booking_id));
alter policy bookings_select on public.bookings
  using ((client_id = auth.uid()) or public.is_shop_member(shop_id) or public.is_admin());
drop function public.can_read_booking_money(uuid);

update public.schema_version set version = 106;
