-- Client reminders, follow-up to 20260925220000_client_reminders.sql (T19d):
-- · the review request can be turned off in Cont too (profiles.review_requests, on by default);
--   off also hides the review card on Caută;
-- · neither reminder goes to a suspended account, and a service switched off in the catalog is
--   not reminded (it can no longer be booked).
-- The two job functions are as in that migration, with those conditions added.

alter table public.profiles
  add column review_requests boolean not null default true;
grant update (review_requests) on public.profiles to authenticated;

create or replace function public.send_review_requests(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_window int := coalesce((select (ps.limits->>'review_window_days')::int from public.platform_settings ps where ps.id = 1), 60);
  b public.bookings%rowtype;
  v_n int := 0;
begin
  for b in
    select bk.* from public.bookings bk
    join public.profiles p on p.id = bk.client_id
    where bk.status = 'done'
      and bk.done_at is not null
      and (bk.done_at at time zone 'Europe/Bucharest')::date between v_today - 3 and v_today - 1
      and bk.done_at > p_now - make_interval(days => v_window)
      and p.deleted_at is null and not p.suspended and p.review_requests
      and not exists (select 1 from public.reviews r where r.booking_id = bk.id)
      and not exists (select 1 from public.client_reminders cr where cr.booking_id = bk.id and cr.kind = 'review')
    order by bk.done_at
  loop
    insert into public.client_reminders (booking_id, kind) values (b.id, 'review') on conflict do nothing;
    if found then
      perform public.notify_user(b.client_id, 'review_request', public.booking_event_params(b), b.id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_review_requests(timestamptz) from public, anon, authenticated;

create or replace function public.send_service_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct on (bk.client_id, bk.car_id, bk.service_id)
           bk.*, sv.reminder_months,
           (bk.done_at at time zone 'Europe/Bucharest')::date as done_day
    from public.bookings bk
    join public.services sv on sv.id = bk.service_id and sv.reminder_months is not null and sv.enabled
    join public.cars c on c.id = bk.car_id and c.owner_id = bk.client_id
    join public.profiles p on p.id = bk.client_id and p.deleted_at is null and p.service_reminders and not p.suspended
    where bk.status = 'done' and bk.done_at is not null
    order by bk.client_id, bk.car_id, bk.service_id, bk.done_at desc
  loop
    continue when (r.done_day + make_interval(months => r.reminder_months))::date - 14 > p_today;
    continue when (r.done_day + make_interval(months => r.reminder_months))::date + 30 < p_today;
    -- Already booked for it: nothing to remind.
    continue when exists (
      select 1 from public.bookings a
      where a.client_id = r.client_id and a.car_id = r.car_id and a.service_id = r.service_id
        and a.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress'));
    insert into public.client_reminders (booking_id, kind) values (r.id, 'service') on conflict do nothing;
    continue when not found;
    perform public.notify_user(r.client_id, 'service_due', jsonb_build_object(
      'booking_id', r.id, 'shop_id', r.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = r.shop_id),
      'service_id', r.service_id, 'car_id', r.car_id,
      'make', r.car_snapshot->>'make', 'model', r.car_snapshot->>'model', 'plate', r.car_snapshot->>'plate',
      'last_done', r.done_day,
      'due', (r.done_day + make_interval(months => r.reminder_months))::date), r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_service_reminders(date) from public, anon, authenticated;

update public.schema_version set version = 30;
