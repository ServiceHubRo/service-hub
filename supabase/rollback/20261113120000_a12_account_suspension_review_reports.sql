-- Rollback of A12 (supabase/migrations/20261113120000_a12_account_suspension_review_reports.sql), schema 123 → 122.
--
-- Nothing A12 wrote needs undoing: bookings it cancelled at a suspension stay cancelled (their
-- shops or clients were told). The wrapped functions go back to their names and grants at schema
-- 122, the helper to its A11 body, and `authenticated` reads a review's report columns again.
-- The app must go back with it (git revert of the A12 pull request): it expects schema 123 and
-- calls list_my_shop_reviews() and admin_pending_reports().

revoke select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at, removed_at, created_at, updated_at)
  on public.reviews from authenticated;
grant select (id, booking_id, shop_id, client_display_name, rating, text, reply, reply_at,
              report_reason, reported_at, report_status, removed_at, created_at, updated_at)
  on public.reviews to authenticated;

drop function public.report_review(uuid, text, uuid);
alter function public.report_review_a11(uuid, text, uuid) rename to report_review;
revoke execute on function public.report_review(uuid, text, uuid) from public, anon;
grant execute on function public.report_review(uuid, text, uuid) to authenticated;

drop function public.reply_review(uuid, text, uuid);
alter function public.reply_review_a11(uuid, text, uuid) rename to reply_review;
revoke execute on function public.reply_review(uuid, text, uuid) from public, anon;
grant execute on function public.reply_review(uuid, text, uuid) to authenticated;

drop function public.submit_review(uuid, integer, uuid, text);
alter function public.submit_review_a11(uuid, integer, uuid, text) rename to submit_review;
revoke execute on function public.submit_review(uuid, integer, uuid, text) from public, anon;
grant execute on function public.submit_review(uuid, integer, uuid, text) to authenticated;

drop function public.review_for_its_people(public.reviews);
drop function public.admin_pending_reports();
drop function public.list_my_shop_reviews();

drop function public.admin_set_account_suspended(uuid, boolean, text, uuid);
alter function public.admin_set_account_suspended_a11(uuid, boolean, text, uuid) rename to admin_set_account_suspended;
revoke execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) to authenticated;

drop function public.cancel_unstarted_bookings_of_suspended_client(uuid);

-- The helper as A11 made it (a suspended shop only).
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
  if not exists (select 1 from public.shops s where s.id = p_shop_id and s.suspended) then
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

update public.schema_version set version = 122;
