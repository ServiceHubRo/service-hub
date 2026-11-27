-- Back to T60: the same car at another shop is refused on the whole day (car_booked_that_day).
create or replace function public.bookings_car_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate text := nullif(new.car_snapshot->>'plate_norm', '');
  v_other record;
  v_by_client boolean := new.client_id is not null and auth.uid() = new.client_id;
begin
  if auth.uid() is null or new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  if v_plate is null and new.car_id is null and new.company_vehicle_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('booking-car:' || coalesce(v_plate, new.car_id::text, new.company_vehicle_id::text)));

  select b.ref, b.date, b.slot into v_other
  from public.bookings b
  where b.shop_id = new.shop_id
    and case when new.company_id is not null then b.company_id = new.company_id
             when v_by_client then b.client_id = new.client_id
             else true end
    and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
    and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
         or (new.car_id is not null and b.car_id = new.car_id)
         or (new.company_vehicle_id is not null and b.company_vehicle_id = new.company_vehicle_id))
  order by b.date, b.slot
  limit 1;
  if found then
    perform public.fail('car_already_booked', jsonb_build_object(
      'ref', v_other.ref, 'date', v_other.date, 'slot', to_char(v_other.slot, 'HH24:MI')));
  end if;

  if v_by_client and exists (
    select 1 from public.bookings b
    where b.shop_id <> new.shop_id
      and case when new.company_id is not null then b.company_id = new.company_id else b.client_id = new.client_id end
      and b.date = new.date
      and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
      and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
           or (new.car_id is not null and b.car_id = new.car_id)
           or (new.company_vehicle_id is not null and b.company_vehicle_id = new.company_vehicle_id))) then
    perform public.fail('car_booked_that_day', jsonb_build_object('date', new.date));
  end if;
  return new;
end
$$;
revoke execute on function public.bookings_car_rule() from public, anon, authenticated;

update public.schema_version set version = 128;
