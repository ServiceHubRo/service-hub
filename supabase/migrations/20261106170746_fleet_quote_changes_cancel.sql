-- M5 / T74 — quote changes and the manager's cancel (Eduard, 6 Nov 2026: approved in
-- docs/FLEET_EXTENSION_PLAN.md §M5).
--
-- „Cere modificări”: an approver of the company (quotes.approve) asks the shop to change a sent quote,
-- with a reason. The quote stays sent; the shop revises it with replace_quote; approvers may still
-- approve or refuse it meanwhile. Once per quote.
--
-- „Anulează programarea”: an approver cancels a company booking, with a reason: pending at any time,
-- confirmed only before the shop's cancel deadline and before the slot starts (the same rule as
-- cancel_booking, plus the slot start, Eduard 6 Nov decision 2). A started or finished booking is
-- refused. Allowed in a read-only company: the only operation exempt (decision 3). The slot is freed
-- (is_active_status) and the waitlist is told (trigger bookings_slot_waitlist); the thread gets the
-- message and the shop the notification in the same transaction. A driver who booked keeps
-- cancel_booking unchanged; personal bookings are untouched.
--
-- Changes: company_quote_decisions takes the decision `changes_requested` and a `reason` column.
-- Nothing existing is modified. Rollback: supabase/rollback/20261106170746_fleet_quote_changes_cancel.sql.

-- No IF EXISTS: the constraint is named in 20261031175248_fleet_bookings.sql; a missing one fails loudly.
alter table public.company_quote_decisions drop constraint company_quote_decisions_decision_check;
alter table public.company_quote_decisions add constraint company_quote_decisions_decision_check
  check (decision in ('approved', 'partially_approved', 'refused', 'changes_requested'));
alter table public.company_quote_decisions add column reason text check (char_length(reason) <= 500);

-- ------------------------------------------------------------------ cancel (approvers)
create function public.fleet_cancel_booking(p_booking_id uuid, p_reason text, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_deadline int;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_cancel_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  -- A second cancel at the same moment waits here, then sees `cancelled` and is refused.
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found or v.company_id is null or public.company_role(v.company_id) is null then
    perform public.fail('booking_not_found');
  end if;
  -- Admin, manager, or quotes.approve given as a right. Not refused in a read-only company.
  perform public.require_company(v.company_id, 'quotes.approve');

  if v.status in ('in_inspection', 'quote_sent', 'approved', 'in_progress') then
    perform public.fail('booking_started');
  end if;
  perform public.require_status(v, 'pending', 'confirmed');
  if v.status = 'confirmed' then
    select cancel_deadline_hours into v_deadline from public.shops where id = v.shop_id;
    if now() >= public.slot_starts_at(v.date, v.slot) then
      perform public.fail('booking_started');
    end if;
    if v_deadline > 0 and now() > public.slot_starts_at(v.date, v.slot) - make_interval(hours => v_deadline) then
      perform public.fail('cancel_deadline_passed', jsonb_build_object('hours', v_deadline));
    end if;
  end if;
  if char_length(v_reason) < 3 then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;

  update public.bookings set status = 'cancelled', cancelled_by = 'client', cancelled_at = now(), cancel_reason = v_reason
  where id = v.id returning * into v;
  perform public.company_audit(v.company_id, 'booking_cancelled', 'booking', v.id, null,
    jsonb_build_object('reason', v_reason, 'ref', v.ref));
  perform public.post_booking_event(v, 'booking_cancelled_company', 'client', jsonb_build_object('reason', v_reason));
  perform public.notify_shop(v.shop_id, 'booking_cancelled_client', public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- ------------------------------------------------------------------ ask for changes (approvers)
create function public.fleet_request_quote_changes(p_booking_id uuid, p_quote_id uuid, p_reason text, p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_quote public.quotes%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_request_quote_changes');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found or v.company_id is null or public.company_role(v.company_id) is null then
    perform public.fail('booking_not_found');
  end if;
  perform public.require_company(v.company_id, 'quotes.approve');
  if public.company_read_only(v.company_id) then
    perform public.fail('fleet_read_only');
  end if;
  perform public.require_status(v, 'quote_sent');
  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  if v_quote.expires_at is not null and v_quote.expires_at <= now() then
    perform public.fail('quote_expired');
  end if;
  if exists (select 1 from public.company_quote_decisions d where d.quote_id = v_quote.id and d.decision = 'changes_requested') then
    perform public.fail('changes_already_requested');
  end if;
  if char_length(v_reason) < 3 then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;

  insert into public.company_quote_decisions (company_id, booking_id, quote_id, user_id, role, decision, amount, reason)
  values (v.company_id, v.id, v_quote.id, auth.uid(), public.company_role(v.company_id), 'changes_requested', coalesce(v_quote.total_sent, 0), v_reason);
  perform public.company_audit(v.company_id, 'quote_changes_requested', 'booking', v.id, null,
    jsonb_build_object('quote_id', v_quote.id, 'reason', v_reason));
  perform public.post_booking_event(v, 'quote_changes_requested', 'client', jsonb_build_object('quote_id', v_quote.id, 'reason', v_reason));
  perform public.notify_shop(v.shop_id, 'quote_changes_requested', public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

revoke execute on function public.fleet_cancel_booking(uuid, text, uuid), public.fleet_request_quote_changes(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.fleet_cancel_booking(uuid, text, uuid), public.fleet_request_quote_changes(uuid, uuid, text, uuid) to authenticated;

update public.schema_version set version = 104;
