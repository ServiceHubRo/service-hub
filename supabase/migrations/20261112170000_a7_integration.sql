-- A7 — integrated testing of the whole platform (Eduard, 12 Nov 2026): fixes for the problems
-- found between modules. Nothing existing is deleted or rewritten; functions keep their inner code
-- (renamed `*_a6`, revoked, wrapped) the way A6 did it.
--
-- 1. A notification that waited (quiet hours, 21:00–09:00, or a retry) is no longer sent once what
--    it announces is over: the reminder of an appointment that was cancelled or moved, "request
--    waiting" / "last call" for a request already answered, "quote expiring" for a quote already
--    decided or replaced, "did the client come?" for a booking already marked. Nor is it sent to a
--    person who has left the booking's shop or company in the meantime (a colleague removed during
--    the night must not receive the client's name and plate in the morning).
--    `notification_still_due()` decides it; `claim_notifications()` closes the others first
--    (processed, `last_error = 'obsolete'`), so the dispatcher never receives them.
-- 2. The last administrator of a company with other members cannot have the account deleted on any
--    path. The rule (FLEET_PLAN R7) was checked only by the `delete-account` Edge Function before
--    `prepare_account_deletion`; the admin's deletion (`admin-delete-account` →
--    `admin_account_deletion` → `prepare_account_deletion`) skipped it and left the company without
--    an administrator, so nobody could manage its members, vehicles or plan. The check now lives in
--    `prepare_account_deletion` itself, under the person's row lock: `company_last_admin {companies}`.

-- ---------------------------------------------------------------------------------------------
-- 1. Notifications that are no longer due
-- ---------------------------------------------------------------------------------------------

-- Whether a booking's notification still means something for its recipient when it is about to go.
-- Events without a booking or without a recipient (platform emails, a walk-in invitation) always do.
create function public.notification_still_due(p_user uuid, p_event text, p_params jsonb, p_booking uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
begin
  if p_user is null or p_booking is null then
    return true;
  end if;
  select * into b from public.bookings where id = p_booking;
  if not found then
    return true;
  end if;

  -- The recipient must still be one of the booking's people: its client, a member of its shop, a
  -- member of its company, or a platform admin.
  if b.client_id is distinct from p_user
     and not exists (select 1 from public.shop_staff st
                     where st.shop_id = b.shop_id and st.user_id = p_user and st.accepted_at is not null)
     and not (b.company_id is not null
              and exists (select 1 from public.company_members m
                          where m.company_id = b.company_id and m.user_id = p_user and m.accepted_at is not null))
     and not exists (select 1 from public.profiles p where p.id = p_user and p.role = 'admin') then
    return false;
  end if;

  return case p_event
    when 'appointment_reminder' then
      b.status = 'confirmed'
      and to_char(b.date, 'YYYY-MM-DD') = coalesce(p_params->>'date', to_char(b.date, 'YYYY-MM-DD'))
      and to_char(b.slot, 'HH24:MI') = coalesce(p_params->>'slot', to_char(b.slot, 'HH24:MI'))
    when 'booking_request_waiting' then
      b.status = 'pending' and public.slot_starts_at(b.date, b.slot) > now()
    when 'booking_request_last_call' then
      b.status = 'pending' and public.slot_starts_at(b.date, b.slot) > now()
    when 'quote_expiring' then
      b.status = 'quote_sent'
      and (p_params->>'quote_id' is null
           or exists (select 1 from public.quotes q where q.id = (p_params->>'quote_id')::uuid and q.status = 'sent'))
    when 'booking_followup' then
      b.status = 'confirmed'
    else true
  end;
end
$$;
revoke execute on function public.notification_still_due(uuid, text, jsonb, uuid) from public, anon, authenticated;

-- The dispatcher's claim (schema 61, `walk_in_bookings`), unchanged, after closing the events that
-- are due but no longer mean anything.
alter function public.claim_notifications(integer) rename to claim_notifications_a6;
revoke execute on function public.claim_notifications_a6(integer) from public, anon, authenticated;

create function public.claim_notifications(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_events e
    set processed_at = now(), locked_until = null, last_error = 'obsolete'
  where e.processed_at is null
    and e.booking_id is not null
    and e.user_id is not null
    and (e.locked_until is null or e.locked_until < now())
    and (e.not_before is null or e.not_before <= now())
    and not public.notification_still_due(e.user_id, e.event, e.params, e.booking_id);

  return public.claim_notifications_a6(p_limit);
end
$$;
revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. The last administrator of a company
-- ---------------------------------------------------------------------------------------------
alter function public.prepare_account_deletion(uuid) rename to prepare_account_deletion_a6;
revoke execute on function public.prepare_account_deletion_a6(uuid) from public, anon, authenticated;

create function public.prepare_account_deletion(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers jsonb;
begin
  -- The same row lock the inner function takes, first: a member promoted or leaving meanwhile waits.
  perform 1 from public.profiles where id = p_user_id for update;
  v_blockers := public.company_deletion_blockers(p_user_id);
  if jsonb_array_length(v_blockers) > 0 then
    perform public.fail('company_last_admin',
      jsonb_build_object('companies', (select jsonb_agg(c->>'name') from jsonb_array_elements(v_blockers) c)));
  end if;
  return public.prepare_account_deletion_a6(p_user_id);
end
$$;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

update public.schema_version set version = 120;
