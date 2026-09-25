-- T17 — Rapoarte, the shop owner's reports (FR §4.9, P22).
--   shop_reports(): what the Rapoarte screen needs, in one read, for the owner of the caller's shop
--   only (it holds the takings); staff get null and see "only the owner". The screen does the sums
--   (src/lib/shopReports.ts), so switching the period is instant and the figures follow the same
--   rules as Istoric: a finished job counts on the day it was finished (Bucharest), for its `cost`.

-- ---------------------------------------------------------------------------------------------
-- shop_reports — returns null for staff, else
--   {shop: {id, name, daily_capacity, since},     since = the day the shop joined (Bucharest)
--    open_weekdays: [0–6],                         the days the week's hours keep open (0 = Sunday)
--    closures: [{start, end}],                     holidays and other closed days
--    jobs: [{id, ref, status, ended_at, cost, service_id, service_ro, service_en, client,
--            client_name, car_snapshot}],          every finished job, and every refused quote
--                                                  (its cost is the inspection fee collected)
--    quotes: [{status, sent_at, decided_at}],      every quote the client decided or let expire
--                                                  (replaced and withdrawn versions are not decisions)
--    days: [{date, cars}]}                         cars that took a place, per day, up to today
-- `client` is the client's account id, or null once the account was deleted.
-- A jsonb answer, so a busy shop is never cut at PostgREST's row limit.
-- ---------------------------------------------------------------------------------------------
create function public.shop_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_today date := (now() at time zone 'Europe/Bucharest')::date;
begin
  perform public.require_caller();
  select * into v_shop from public.shops where id = public.require_my_shop();
  if v_shop.owner_id is distinct from auth.uid() then
    return null;
  end if;

  return jsonb_build_object(
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'daily_capacity', v_shop.daily_capacity,
      'since', (v_shop.created_at at time zone 'Europe/Bucharest')::date
    ),
    'open_weekdays', coalesce((
      select jsonb_agg(h.weekday order by h.weekday)
      from public.shop_hours h
      where h.shop_id = v_shop.id and not h.is_closed
    ), '[]'::jsonb),
    'closures', coalesce((
      select jsonb_agg(jsonb_build_object('start', c.start_date, 'end', c.end_date) order by c.start_date)
      from public.shop_closures c
      where c.shop_id = v_shop.id
    ), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id,
          'ref', b.ref,
          'status', b.status,
          'ended_at', coalesce(b.done_at, b.status_changed_at),
          'cost', b.cost,
          'service_id', b.service_id,
          'service_ro', s.name_ro,
          'service_en', s.name_en,
          'client', b.client_id,
          'client_name', b.client_name,
          'car_snapshot', b.car_snapshot
        ) order by coalesce(b.done_at, b.status_changed_at) desc, b.id)
      from public.bookings b
      left join public.services s on s.id = b.service_id
      where b.shop_id = v_shop.id
        and b.status in ('done', 'quote_refused')
    ), '[]'::jsonb),
    'quotes', coalesce((
      select jsonb_agg(jsonb_build_object('status', q.status, 'sent_at', q.sent_at, 'decided_at', q.decided_at)
        order by q.decided_at)
      from public.quotes q
      join public.bookings b on b.id = q.booking_id
      where b.shop_id = v_shop.id
        and q.status in ('accepted', 'partially_accepted', 'refused', 'expired')
        and q.decided_at is not null
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.date, 'cars', d.cars) order by d.date)
      from (
        select b.date, count(*) as cars
        from public.bookings b
        where b.shop_id = v_shop.id
          and b.date <= v_today
          and b.status in ('confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress',
                           'done', 'quote_refused', 'expired')
        group by b.date
      ) d
    ), '[]'::jsonb)
  );
end
$$;

grant execute on function public.shop_reports() to authenticated;

update public.schema_version set version = 23;
