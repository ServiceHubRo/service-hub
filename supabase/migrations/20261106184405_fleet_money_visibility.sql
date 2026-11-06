-- 107 / T77 — quote money visibility, row-level (Eduard, 6 Nov 2026, decision 6: approved in
-- docs/FLEET_EXTENSION_PLAN.md §107).
--
-- For a company booking, a member without `costs.view` in that company (checked at every read and every
-- send) cannot obtain amounts through any path. Personal bookings, shops and platform admins are
-- unchanged. The paths (audit in the plan, numbered as there):
--   1  bookings_select: a company row is visible to its client only with costs.view; such a client
--      reads it through my_company_bookings() — no cost, no quote totals, no prices;
--   2  realtime on bookings follows the policy (the screens refresh on the booking's thread messages);
--   5–6 cancel_booking, decide_quote, reschedule_booking, set_booking_history_share answer cost = null
--      (a replayed request too: the stored answer goes through the same filter);
--   7  export_my_data: no amounts or prices for those bookings;
--   8  job_document_data (the PDFs): refused for them;
--   9  report_jobs (the history report): those bookings left out;
--   10 post_booking_event: no money keys in a company booking's thread message;
--   11 notify_user: no money keys for a recipient without costs.view (texts without amounts exist);
--   12 quotes / quote_items: the client branch requires costs.view for a company booking.
-- The global way of reading costs is not changed. No existing row is modified. Rollback:
-- supabase/rollback/20261106184405_fleet_money_visibility.sql.

-- ------------------------------------------------------------------ who may see a booking's money
-- The booking's client (personal booking, or company booking with costs.view), a member of its shop, a
-- platform admin.
create function public.can_read_booking_money(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and ((b.client_id = auth.uid() and (b.company_id is null or public.fleet_can(b.company_id, 'costs.view')))
           or public.is_shop_member(b.shop_id) or public.is_admin()))
$$;
revoke execute on function public.can_read_booking_money(uuid) from public, anon;
grant execute on function public.can_read_booking_money(uuid) to authenticated;

-- 1. The direct read.
alter policy bookings_select on public.bookings
  using ((client_id = auth.uid() and (company_id is null or public.fleet_can(company_id, 'costs.view')))
         or public.is_shop_member(shop_id) or public.is_admin());

-- 12. The quotes and their lines.
alter policy quotes_select on public.quotes using (public.can_read_booking_money(booking_id));
alter policy quote_items_select on public.quote_items
  using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and public.can_read_booking_money(q.booking_id)));

-- The company bookings of a client who may not see their money: the same shape as the app's direct
-- read, every amount and price left out.
create function public.my_company_bookings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date, 'slot', b.slot, 'note', b.note, 'car_id', b.car_id,
      'car_snapshot', b.car_snapshot, 'created_at', b.created_at, 'shop_id', b.shop_id, 'service_id', b.service_id,
      'extra_service_ids', to_jsonb(b.extra_service_ids), 'offer_percent', b.offer_percent, 'offer_kind', b.offer_kind,
      'loyalty_percent', b.loyalty_percent, 'loyalty_level', b.loyalty_level, 'share_history', b.share_history,
      'company_id', b.company_id, 'inspection_started_at', b.inspection_started_at, 'started_at', b.started_at,
      'done_at', b.done_at, 'odometer', b.odometer, 'work', b.work, 'cost', null, 'warranty_months', b.warranty_months,
      'warranty_until', b.warranty_until, 'quote_number', b.quote_number, 'intake_sent_at', b.intake_sent_at,
      'intake_confirmed_at', b.intake_confirmed_at, 'cancelled_by', b.cancelled_by, 'cancel_reason', b.cancel_reason,
      'decline_reason', b.decline_reason, 'closed_reason', b.closed_reason, 'money_hidden', true,
      'shop', (select jsonb_build_object('name', s.name, 'city', s.city, 'phone', s.phone, 'cancel_deadline_hours', s.cancel_deadline_hours,
                                         'street', s.street, 'latitude', s.latitude, 'longitude', s.longitude, 'slot_minutes', s.slot_minutes)
               from public.shops s where s.id = b.shop_id),
      'service', (select jsonb_build_object('name_ro', sv.name_ro, 'name_en', sv.name_en, 'icon', sv.icon, 'category_key', sv.category_key)
                  from public.services sv where sv.id = b.service_id),
      'quotes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', q.id, 'version', q.version, 'status', q.status, 'note', q.note, 'inspection_fee', null, 'total_sent', null,
                 'total_approved', null, 'sent_at', q.sent_at, 'expires_at', q.expires_at, 'decided_at', q.decided_at,
                 'vat_rate', q.vat_rate, 'est_hours', q.est_hours,
                 'items', coalesce((
                   select jsonb_agg(jsonb_build_object('id', qi.id, 'position', qi.position, 'name', qi.name, 'price', null,
                                                       'approved', qi.approved, 'option_group', qi.option_group, 'variant', qi.variant,
                                                       'brand', qi.brand, 'kind', qi.kind, 'quantity', qi.quantity, 'unit_price', null)
                                    order by qi.position)
                   from public.quote_items qi where qi.quote_id = q.id), '[]'::jsonb)) order by q.version)
        from public.quotes q where q.booking_id = b.id), '[]'::jsonb),
      'review', (select jsonb_build_object('id', r.id, 'rating', r.rating) from public.reviews r where r.booking_id = b.id))
    order by b.date desc, b.slot desc), '[]'::jsonb)
  from public.bookings b
  where b.client_id = auth.uid() and b.company_id is not null and not public.fleet_can(b.company_id, 'costs.view')
$$;
revoke execute on function public.my_company_bookings() from public, anon;
grant execute on function public.my_company_bookings() to authenticated;

-- ------------------------------------------------------------------ 5–6. RPCs that answer a booking row
-- A company booking answered to someone who may not see its money: cost null.
create function public.booking_for_caller(b public.bookings)
returns public.bookings
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if b.company_id is not null and not public.fleet_can(b.company_id, 'costs.view')
     and not public.is_shop_member(b.shop_id) and not public.is_admin() then
    b.cost := null;
  end if;
  return b;
end
$$;
revoke execute on function public.booking_for_caller(public.bookings) from public, anon, authenticated;

alter function public.cancel_booking(uuid, uuid) rename to cancel_booking_t77;
alter function public.decide_quote(uuid, uuid, uuid[], uuid) rename to decide_quote_t77;
alter function public.reschedule_booking(uuid, date, time, uuid) rename to reschedule_booking_t77;
alter function public.set_booking_history_share(uuid, boolean, uuid) rename to set_booking_history_share_t77;
revoke execute on function public.cancel_booking_t77(uuid, uuid), public.decide_quote_t77(uuid, uuid, uuid[], uuid),
  public.reschedule_booking_t77(uuid, date, time, uuid), public.set_booking_history_share_t77(uuid, boolean, uuid)
  from public, anon, authenticated;

create function public.cancel_booking(p_booking_id uuid, p_request_id uuid)
returns public.bookings
language sql
security definer
set search_path = ''
as $$ select public.booking_for_caller(public.cancel_booking_t77(p_booking_id, p_request_id)) $$;
create function public.decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
returns public.bookings
language sql
security definer
set search_path = ''
as $$ select public.booking_for_caller(public.decide_quote_t77(p_booking_id, p_quote_id, p_approved_item_ids, p_request_id)) $$;
create function public.reschedule_booking(p_booking_id uuid, p_date date, p_slot time, p_request_id uuid)
returns public.bookings
language sql
security definer
set search_path = ''
as $$ select public.booking_for_caller(public.reschedule_booking_t77(p_booking_id, p_date, p_slot, p_request_id)) $$;
create function public.set_booking_history_share(p_booking_id uuid, p_share boolean, p_request_id uuid)
returns public.bookings
language sql
security definer
set search_path = ''
as $$ select public.booking_for_caller(public.set_booking_history_share_t77(p_booking_id, p_share, p_request_id)) $$;
revoke execute on function public.cancel_booking(uuid, uuid), public.decide_quote(uuid, uuid, uuid[], uuid),
  public.reschedule_booking(uuid, date, time, uuid), public.set_booking_history_share(uuid, boolean, uuid) from public, anon;
grant execute on function public.cancel_booking(uuid, uuid), public.decide_quote(uuid, uuid, uuid[], uuid),
  public.reschedule_booking(uuid, date, time, uuid), public.set_booking_history_share(uuid, boolean, uuid) to authenticated;

-- ------------------------------------------------------------------ 7. „Datele mele”
alter function public.export_my_data() rename to export_my_data_t77;
revoke execute on function public.export_my_data_t77() from public, anon, authenticated;
create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.export_my_data_t77();
begin
  return jsonb_set(v, '{bookings}', coalesce((
    select jsonb_agg(
             case when (x->>'company_id') is not null and not public.fleet_can((x->>'company_id')::uuid, 'costs.view')
                  then (x - 'cost') || jsonb_build_object('quotes', coalesce((
                         select jsonb_agg((q - array['inspection_fee', 'total_sent', 'total_approved'])
                                          || jsonb_build_object('items', coalesce((
                                               select jsonb_agg(i - 'price' order by n2) from jsonb_array_elements(q->'items') with ordinality i2(i, n2)), '[]'::jsonb))
                                          order by n1)
                         from jsonb_array_elements(x->'quotes') with ordinality q1(q, n1)), '[]'::jsonb))
                  else x end
             order by n)
    from jsonb_array_elements(v->'bookings') with ordinality b(x, n)), '[]'::jsonb));
end
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ------------------------------------------------------------------ 8. The job documents (PDFs)
alter function public.job_document_data(uuid, uuid, text, text) rename to job_document_data_t77;
revoke execute on function public.job_document_data_t77(uuid, uuid, text, text) from public, anon, authenticated;
create function public.job_document_data(p_user_id uuid, p_booking_id uuid, p_kind text, p_aal text default 'aal1')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bookings b
             where b.id = p_booking_id and b.client_id = p_user_id and b.company_id is not null
               and not public.fleet_user_can(p_user_id, b.company_id, 'costs.view')
               and not exists (select 1 from public.shop_staff st where st.shop_id = b.shop_id and st.user_id = p_user_id and st.accepted_at is not null)) then
    perform public.fail('not_found');
  end if;
  return public.job_document_data_t77(p_user_id, p_booking_id, p_kind, p_aal);
end
$$;

-- ------------------------------------------------------------------ 9. The history report's jobs
alter function public.report_jobs(uuid, text) rename to report_jobs_t77;
create function public.report_jobs(p_client_id uuid, p_vehicle_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(j order by n), '[]'::jsonb)
  from jsonb_array_elements(public.report_jobs_t77(p_client_id, p_vehicle_key)) with ordinality x(j, n)
  where not exists (select 1 from public.bookings b
                    where b.id = public.try_uuid(j->>'id') and b.company_id is not null
                      and not public.fleet_user_can(p_client_id, b.company_id, 'costs.view'))
$$;

-- Both for the Edge Functions only (service role), as the functions they wrap.
revoke execute on function public.job_document_data(uuid, uuid, text, text), public.report_jobs(uuid, text) from public, anon, authenticated;
grant execute on function public.job_document_data(uuid, uuid, text, text), public.report_jobs(uuid, text) to service_role;
-- ------------------------------------------------------------------ 11. Notifications
-- A notification about a company booking to its client or to a company member without costs.view
-- carries no amounts (the shop's members keep theirs; the texts without amounts exist).
create or replace function public.notify_user(p_user_id uuid, p_event text, p_params jsonb, p_booking_id uuid,
                                              p_channels text[] default array['push'])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  b public.bookings%rowtype;
begin
  if p_user_id is null then
    return;
  end if;
  if p_booking_id is not null then
    select * into b from public.bookings where id = p_booking_id;
    if b.company_id is not null
       and (b.client_id = p_user_id
            or exists (select 1 from public.company_members m where m.company_id = b.company_id and m.user_id = p_user_id))
       and not exists (select 1 from public.shop_staff st where st.shop_id = b.shop_id and st.user_id = p_user_id and st.accepted_at is not null)
       and not public.fleet_user_can(p_user_id, b.company_id, 'costs.view') then
      v_params := v_params - array['total', 'total_sent', 'cost', 'inspection_fee', 'amount'];
    end if;
  end if;
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  values (p_user_id, p_event, v_params, p_booking_id, p_channels);
end
$$;

-- ------------------------------------------------------------------ 10. The thread messages
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
          -- 107: a company booking's thread carries no amounts (approvers read them from the quote).
          jsonb_build_object('ref', p_booking.ref, 'by', p_by)
            || case when p_booking.company_id is null then coalesce(p_params, '{}'::jsonb)
                    else coalesce(p_params, '{}'::jsonb) - array['total', 'total_sent', 'cost', 'inspection_fee', 'amount'] end,
          p_booking.id);
  update public.threads set last_message_at = now() where id = v_thread;
end
$$;

update public.schema_version set version = 107;
