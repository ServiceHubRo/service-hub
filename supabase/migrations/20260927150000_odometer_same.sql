-- The same odometer reading as a job on another day is not taken as is (Eduard): complete_job
-- answers `odometer_same` until the shop confirms it (the same p_confirm_jump as a big jump). Two
-- jobs on the same day may share a reading, so they pass. The history report notes such readings
-- (_shared/report.ts, repeatedOdometer). complete_job is otherwise unchanged.

create or replace function public.complete_job(
  p_booking_id uuid,
  p_odometer int,
  p_request_id uuid,
  p_work text default null,
  p_cost numeric default null,
  p_confirm_jump boolean default false
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_last int;
  v_work text := nullif(btrim(p_work), '');
  v_cost numeric := p_cost;
  v_quote public.quotes%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'complete_job');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  v := public.lock_booking_as_shop(p_booking_id);
  perform public.require_status(v, 'in_progress');

  if p_odometer is null then
    perform public.fail('odometer_required');
  end if;
  if p_odometer < 100 or p_odometer > 2000000 then
    perform public.fail('odometer_invalid');
  end if;
  v_last := public.last_odometer_for_plate(v.car_snapshot->>'plate_norm');
  if v_last is not null and p_odometer < v_last then
    perform public.fail('odometer_lower', jsonb_build_object('previous', v_last));
  end if;
  if v_last is not null and p_odometer - v_last > 50000 and not coalesce(p_confirm_jump, false) then
    perform public.fail('odometer_jump', jsonb_build_object('previous', v_last, 'diff', p_odometer - v_last));
  end if;
  -- The same reading as a job on another day: the car was driven in between, so it is probably
  -- the old number typed again. The shop reads the dashboard again and confirms (p_confirm_jump).
  if v_last is not null and p_odometer = v_last and not coalesce(p_confirm_jump, false) and exists (
    select 1 from public.bookings b
    where b.car_snapshot->>'plate_norm' = v.car_snapshot->>'plate_norm'
      and b.status = 'done' and b.odometer = v_last
      and (b.done_at at time zone 'Europe/Bucharest')::date <> (now() at time zone 'Europe/Bucharest')::date
  ) then
    perform public.fail('odometer_same', jsonb_build_object('previous', v_last));
  end if;

  if char_length(v_work) > 4000 then
    perform public.fail('work_too_long');
  end if;
  if v_cost is not null and (v_cost < 0 or v_cost > 1000000 or v_cost <> round(v_cost, 2)) then
    perform public.fail('cost_invalid');
  end if;

  select * into v_quote from public.quotes
  where booking_id = v.id and status in ('accepted', 'partially_accepted')
  order by version desc limit 1;
  if v_work is null and v_quote.id is not null then
    select string_agg(qi.name, ', ' order by qi.position) into v_work
    from public.quote_items qi where qi.quote_id = v_quote.id and qi.approved;
  end if;
  if v_cost is null then
    v_cost := v_quote.total_approved;
  end if;

  update public.bookings
    set status = 'done', done_at = now(), odometer = p_odometer, work = left(v_work, 4000), cost = v_cost
  where id = v.id returning * into v;

  perform public.post_booking_event(v, 'job_done', 'shop', jsonb_build_object('odometer', v.odometer, 'cost', v.cost));
  perform public.notify_user(v.client_id, 'job_done',
    public.booking_event_params(v) || jsonb_build_object('odometer', v.odometer, 'cost', v.cost), v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

update public.schema_version set version = 35;
