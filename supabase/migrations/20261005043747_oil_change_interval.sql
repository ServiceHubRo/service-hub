-- T30: the client's own oil-change interval, and the other service reminders as a gentle heads-up.
--
-- Each car in the Garage can carry how often its owner changes the oil (in months; empty = the
-- catalog's interval for "Schimb ulei") and when it was last changed (for a change made before
-- Service-Hub or elsewhere). The oil reminder counts from the newest of that date and the last
-- finished oil change or full service ("revizie") of the car. Every other service reminder keeps
-- the catalog's interval and becomes a heads-up ("poate nu e cazul încă").

alter table public.cars
  add column oil_change_months int check (oil_change_months between 1 and 24),
  add column last_oil_change date check (last_oil_change >= date '1990-01-01');

grant insert (oil_change_months, last_oil_change) on public.cars to authenticated;
grant update (oil_change_months, last_oil_change) on public.cars to authenticated;

-- A date in the future is a typo (the day, Bucharest). Security definer: the client writes the row,
-- the stable error code comes from public.fail.
create function public.cars_check_oil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.last_oil_change is not null and new.last_oil_change > public.bucharest_today() then
    perform public.fail('car_oil_date_invalid');
  end if;
  return new;
end
$$;
revoke execute on function public.cars_check_oil() from public, anon, authenticated;
create trigger cars_check_oil before insert or update of last_oil_change on public.cars
  for each row execute function public.cars_check_oil();

-- The services that change the oil: the oil change itself and a full service.
create function public.oil_service_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['ulei', 'revizie'] $$;

create or replace function public.send_service_reminders(p_today date default public.bucharest_today())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
  v_months int;
  v_job_id uuid;
  v_job_shop uuid;
  v_job_day date;
  v_job_revizie boolean;
  v_base date;
  v_due date;
  v_revizie int;
  v_key text;
begin
  -- ------------------------------------------------------------------ every service but the oil
  -- The catalog's interval, worded as a heads-up (params.kind = 'headsup').
  for r in
    -- Every service of a booking counts, the first one and those added to it (T21).
    select distinct on (bk.client_id, bk.car_id, u.service_id)
           bk.id, bk.client_id, bk.car_id, bk.shop_id, bk.car_snapshot, u.service_id, sv.reminder_months,
           (bk.done_at at time zone 'Europe/Bucharest')::date as done_day
    from public.bookings bk
    cross join lateral unnest(array[bk.service_id] || bk.extra_service_ids) as u(service_id)
    join public.services sv on sv.id = u.service_id and sv.reminder_months is not null and sv.enabled
    join public.cars c on c.id = bk.car_id and c.owner_id = bk.client_id
    join public.profiles p on p.id = bk.client_id and p.deleted_at is null and p.service_reminders and not p.suspended
    where bk.status = 'done' and bk.done_at is not null and u.service_id <> 'ulei'
    order by bk.client_id, bk.car_id, u.service_id, bk.done_at desc
  loop
    continue when (r.done_day + make_interval(months => r.reminder_months))::date - 14 > p_today;
    continue when (r.done_day + make_interval(months => r.reminder_months))::date + 30 < p_today;
    -- Already booked for it: nothing to remind.
    continue when exists (
      select 1 from public.bookings a
      where a.client_id = r.client_id and a.car_id = r.car_id
        and (a.service_id = r.service_id or r.service_id = any (a.extra_service_ids))
        and a.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress'));
    insert into public.client_reminders (booking_id, kind, service_id) values (r.id, 'service', r.service_id)
      on conflict do nothing;
    continue when not found;
    perform public.notify_user(r.client_id, 'service_due', jsonb_build_object(
      'kind', 'headsup',
      'booking_id', r.id, 'shop_id', r.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = r.shop_id),
      'service_id', r.service_id, 'car_id', r.car_id,
      'make', r.car_snapshot->>'make', 'model', r.car_snapshot->>'model', 'plate', r.car_snapshot->>'plate',
      'last_done', r.done_day,
      'due', (r.done_day + make_interval(months => r.reminder_months))::date), r.id);
    v_n := v_n + 1;
  end loop;

  -- ------------------------------------------------------------------ the oil
  -- Per car in the Garage: the client's interval, else the catalog's; from the newest of the date
  -- the client wrote and the last finished oil change or full service of that car.
  for r in
    select c.id as car_id, c.owner_id, c.make, c.model, c.plate, c.oil_change_months, c.last_oil_change, c.reminded,
           sv.reminder_months as standard
    from public.cars c
    join public.profiles p on p.id = c.owner_id and p.role = 'client' and p.deleted_at is null
                          and p.service_reminders and not p.suspended
    join public.services sv on sv.id = 'ulei' and sv.enabled
  loop
    v_months := coalesce(r.oil_change_months, r.standard);
    continue when v_months is null;

    v_job_id := null;
    select bk.id, bk.shop_id, (bk.done_at at time zone 'Europe/Bucharest')::date,
           'revizie' = any (array[bk.service_id] || bk.extra_service_ids)
      into v_job_id, v_job_shop, v_job_day, v_job_revizie
    from public.bookings bk
    where bk.car_id = r.car_id and bk.client_id = r.owner_id and bk.status = 'done' and bk.done_at is not null
      and (bk.service_id = any (public.oil_service_ids()) or bk.extra_service_ids && public.oil_service_ids())
    order by bk.done_at desc
    limit 1;

    -- The job counts when it is the newest; the date the client wrote otherwise.
    if v_job_id is not null and (r.last_oil_change is null or v_job_day >= r.last_oil_change) then
      v_base := v_job_day;
    else
      v_job_id := null;
      v_job_shop := null;
      v_job_revizie := false;
      v_base := r.last_oil_change;
    end if;
    continue when v_base is null;

    v_due := (v_base + make_interval(months => v_months))::date;
    continue when v_due - 14 > p_today or v_due + 30 < p_today;

    -- A full service whose own reminder falls on the same day says it already.
    if v_job_revizie then
      select reminder_months into v_revizie from public.services where id = 'revizie' and enabled;
      continue when v_revizie is not null and (v_base + make_interval(months => v_revizie))::date = v_due;
    end if;

    continue when exists (
      select 1 from public.bookings a
      where a.client_id = r.owner_id and a.car_id = r.car_id
        and (a.service_id = any (public.oil_service_ids()) or a.extra_service_ids && public.oil_service_ids())
        and a.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress'));

    -- Once per change: per job (as before), or per date written in the Garage (cars.reminded.oil).
    if v_job_id is not null then
      insert into public.client_reminders (booking_id, kind, service_id) values (v_job_id, 'service', 'ulei')
        on conflict do nothing;
      continue when not found;
    else
      v_key := v_base::text;
      continue when coalesce(r.reminded -> 'oil', '{}'::jsonb) ? v_key;
      update public.cars
        set reminded = jsonb_set(coalesce(reminded, '{}'::jsonb), '{oil}', jsonb_build_object(v_key, v_due))
      where id = r.car_id;
    end if;

    perform public.notify_user(r.owner_id, 'service_due', jsonb_build_object(
      'kind', 'oil',
      'months', v_months,
      'booking_id', v_job_id, 'shop_id', v_job_shop,
      'shop_name', (select s.name from public.shops s where s.id = v_job_shop),
      'service_id', 'ulei', 'car_id', r.car_id,
      'make', r.make, 'model', r.model, 'plate', r.plate,
      'last_done', v_base,
      'due', v_due), v_job_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_service_reminders(date) from public, anon, authenticated;

update public.schema_version set version = 60;
