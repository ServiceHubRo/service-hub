-- A12 — what was left of the master audit of 13 Nov 2026 (Eduard, the same day: "repair everything
-- that is left"), on schema 122. Nothing existing is deleted or rewritten: functions keep their
-- inner code (renamed `*_a11`, revoked, wrapped), one table loses three more column read grants.
--
-- 1. A suspended account's bookings. Suspending a client left their waiting and confirmed bookings
--    active: the shop kept a place for someone who can no longer use the app, and was told
--    nothing. Suspending a shop owner's account hides the shop exactly like suspending the shop
--    (is_shop_public), but A11's cancellation did not run. Now, in the same transaction as the
--    suspension of an account:
--      · a client's own bookings that have not started (`pending`, `confirmed`; never a company's
--        booking, which is the company's) are cancelled by the platform, with the thread message
--        and the shop's notification (`booking_cancelled_admin`), the reason in the shop's language;
--      · a shop owner's shop has its bookings that have not started cancelled as in A11, and their
--        clients told.
--    Jobs already begun go on. A colleague's or an agent's suspension cancels nothing.
-- 2. A review's report (the rest of P2-1). `report_reason`, `reported_at` and `report_status` of a
--    public review were still readable by every signed-in user (A10 kept them for the shop's
--    Recenzii screen and the admin's badge). The shop now reads its reviews through
--    `list_my_shop_reviews()`, the admin's badge through `admin_pending_reports()`, and the three
--    columns are no longer granted. `submit_review`, `reply_review` and `report_review` answer the
--    review without the admin's note, the time of the decision and the fraud-check mark.

-- ---------------------------------------------------------------------------------------------
-- 1. A suspended account's bookings
-- ---------------------------------------------------------------------------------------------

-- A11's helper, now also for a shop hidden because its owner's account is suspended.
create or replace function public.cancel_unstarted_bookings_of_suspended_shop(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_reason text;
  v_n integer := 0;
begin
  if not exists (select 1 from public.shops s join public.profiles o on o.id = s.owner_id
                 where s.id = p_shop_id and (s.suspended or o.suspended)) then
    return 0;
  end if;
  for v in
    select * from public.bookings b
    where b.shop_id = p_shop_id and b.status in ('pending', 'confirmed')
    order by b.date, b.slot, b.id
    for no key update
  loop
    v_reason := case when v.client_lang = 'en' then 'The shop is no longer available on Service-Hub.'
                     else 'Service-ul nu mai este disponibil pe Service-Hub.' end;
    update public.bookings
      set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), cancel_reason = v_reason
    where id = v.id returning * into v;
    perform public.post_booking_event(v, 'booking_cancelled_admin', 'admin', jsonb_build_object('reason', v_reason));
    perform public.notify_user(v.client_id, 'booking_cancelled_admin',
      public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.cancel_unstarted_bookings_of_suspended_shop(uuid) from public, anon, authenticated;

-- Cancels a suspended client's own bookings that have not started and tells each shop. Server only.
create function public.cancel_unstarted_bookings_of_suspended_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_reason text;
  v_n integer := 0;
begin
  if not exists (select 1 from public.profiles p where p.id = p_client_id and p.role = 'client' and p.suspended) then
    return 0;
  end if;
  for v in
    select * from public.bookings b
    where b.client_id = p_client_id and b.company_id is null and b.status in ('pending', 'confirmed')
    order by b.date, b.slot, b.id
    for no key update
  loop
    v_reason := case when (select s.lang from public.shops s where s.id = v.shop_id) = 'en'
                     then 'The client''s account is no longer available on Service-Hub.'
                     else 'Contul clientului nu mai este disponibil pe Service-Hub.' end;
    update public.bookings
      set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), cancel_reason = v_reason
    where id = v.id returning * into v;
    perform public.post_booking_event(v, 'booking_cancelled_admin', 'admin', jsonb_build_object('reason', v_reason));
    perform public.notify_shop(v.shop_id, 'booking_cancelled_admin',
      public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.cancel_unstarted_bookings_of_suspended_client(uuid) from public, anon, authenticated;

alter function public.admin_set_account_suspended(uuid, boolean, text, uuid) rename to admin_set_account_suspended_a11;
revoke execute on function public.admin_set_account_suspended_a11(uuid, boolean, text, uuid) from public, anon, authenticated;

create function public.admin_set_account_suspended(p_user_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  v_shop uuid;
begin
  -- The inner function checks the admin, the reason and the state, and suspends. Then the
  -- bookings: the same request sent again finds none left.
  v := public.admin_set_account_suspended_a11(p_user_id, p_suspended, p_reason, p_request_id);
  if p_suspended then
    perform public.cancel_unstarted_bookings_of_suspended_client(p_user_id);
    for v_shop in select s.id from public.shops s where s.owner_id = p_user_id loop
      perform public.cancel_unstarted_bookings_of_suspended_shop(v_shop);
    end loop;
  end if;
  return v;
end
$$;
revoke execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. A review's report
-- ---------------------------------------------------------------------------------------------

-- The caller's shop's reviews, newest first, removed ones included, each with its booking's
-- reference and service: what Recenzii read from the table.
create function public.list_my_shop_reviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop uuid := public.my_shop_id();
begin
  if v_shop is null then
    perform public.fail('not_allowed');
  end if;
  return jsonb_build_object(
    'shop_id', v_shop,
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'booking_id', r.booking_id, 'shop_id', r.shop_id,
          'client_display_name', r.client_display_name, 'rating', r.rating, 'text', r.text,
          'reply', r.reply, 'reply_at', r.reply_at,
          'report_reason', r.report_reason, 'reported_at', r.reported_at, 'report_status', r.report_status,
          'removed_at', r.removed_at, 'created_at', r.created_at,
          'booking', (select jsonb_build_object('ref', b.ref, 'service',
                        (select jsonb_build_object('name_ro', sv.name_ro, 'name_en', sv.name_en)
                         from public.services sv where sv.id = b.service_id))
                      from public.bookings b where b.id = r.booking_id)
        ) order by r.created_at desc, r.id)
      from public.reviews r where r.shop_id = v_shop), '[]'::jsonb));
end
$$;
revoke execute on function public.list_my_shop_reviews() from public, anon;
grant execute on function public.list_my_shop_reviews() to authenticated;

-- Reported reviews waiting for a decision: the badge on Moderare.
create function public.admin_pending_reports()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (select count(*)::integer from public.reviews r where r.report_status = 'pending');
end
$$;
revoke execute on function public.admin_pending_reports() from public, anon;
grant execute on function public.admin_pending_reports() to authenticated;

-- The review a client or a shop gets back from its own action: without the moderation fields.
create function public.review_for_its_people(r public.reviews)
returns public.reviews
language plpgsql
immutable
set search_path = ''
as $$
begin
  r.report_note := null;
  r.report_decided_at := null;
  r.signals_cleared_at := null;
  return r;
end
$$;
revoke execute on function public.review_for_its_people(public.reviews) from public, anon, authenticated;

alter function public.submit_review(uuid, integer, uuid, text) rename to submit_review_a11;
revoke execute on function public.submit_review_a11(uuid, integer, uuid, text) from public, anon, authenticated;
create function public.submit_review(p_booking_id uuid, p_rating integer, p_request_id uuid, p_text text default null)
returns public.reviews
language sql
security definer
set search_path = ''
as $$
  select public.review_for_its_people(public.submit_review_a11(p_booking_id, p_rating, p_request_id, p_text))
$$;
revoke execute on function public.submit_review(uuid, integer, uuid, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, uuid, text) to authenticated;

alter function public.reply_review(uuid, text, uuid) rename to reply_review_a11;
revoke execute on function public.reply_review_a11(uuid, text, uuid) from public, anon, authenticated;
create function public.reply_review(p_review_id uuid, p_reply text, p_request_id uuid)
returns public.reviews
language sql
security definer
set search_path = ''
as $$
  select public.review_for_its_people(public.reply_review_a11(p_review_id, p_reply, p_request_id))
$$;
revoke execute on function public.reply_review(uuid, text, uuid) from public, anon;
grant execute on function public.reply_review(uuid, text, uuid) to authenticated;

alter function public.report_review(uuid, text, uuid) rename to report_review_a11;
revoke execute on function public.report_review_a11(uuid, text, uuid) from public, anon, authenticated;
create function public.report_review(p_review_id uuid, p_reason text, p_request_id uuid)
returns public.reviews
language sql
security definer
set search_path = ''
as $$
  select public.review_for_its_people(public.report_review_a11(p_review_id, p_reason, p_request_id))
$$;
revoke execute on function public.report_review(uuid, text, uuid) from public, anon;
grant execute on function public.report_review(uuid, text, uuid) to authenticated;

revoke select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at,
               report_reason, reported_at, report_status, removed_at, created_at, updated_at)
  on public.reviews from authenticated;
grant select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at, removed_at, created_at, updated_at)
  on public.reviews to authenticated;

update public.schema_version set version = 123;
