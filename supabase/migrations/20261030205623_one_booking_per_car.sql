-- One active booking per car at a shop (Eduard, 30 Oct 2026: "pot programa o mașină de două sau mai
-- multe ori la service, chiar dacă se află deja programată"; his choice: "Una la același service").
-- ARCHITECTURE §6.
--
-- · At one shop a car has at most one active booking (pending, confirmed, in_inspection, quote_sent,
--   approved, in_progress). A second one is refused with `car_already_booked {ref, date, slot}`;
--   more work goes on the booking that exists (its extra services, its quote).
-- · At another shop, not on the same day: `car_booked_that_day {date}`. Only when the client books
--   for themselves: a shop adding a booking is never told about another shop's bookings.
-- · A client is checked against their own bookings only, a shop against its own bookings (it sees
--   them all). Someone typing another person's plate never blocks that car and never learns about
--   another person's booking.
-- · The car is its plate (car_snapshot.plate_norm) or, without a plate, the client's saved car.
-- · Checked for bookings made in the app (a signed-in caller). Rows written by the server and the
--   demo seed, and the bookings that already exist, are left as they are. A lock per car makes two
--   requests for the same car at the same moment wait for each other.

create function public.bookings_car_rule()
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
  if v_plate is null and new.car_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('booking-car:' || coalesce(v_plate, new.car_id::text)));

  select b.ref, b.date, b.slot into v_other
  from public.bookings b
  where b.shop_id = new.shop_id
    and (not v_by_client or b.client_id = new.client_id)
    and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
    and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
         or (new.car_id is not null and b.car_id = new.car_id))
  order by b.date, b.slot
  limit 1;
  if found then
    perform public.fail('car_already_booked', jsonb_build_object(
      'ref', v_other.ref, 'date', v_other.date, 'slot', to_char(v_other.slot, 'HH24:MI')));
  end if;

  if v_by_client and exists (
    select 1 from public.bookings b
    where b.shop_id <> new.shop_id
      and b.client_id = new.client_id
      and b.date = new.date
      and b.status in ('pending', 'confirmed', 'in_inspection', 'quote_sent', 'approved', 'in_progress')
      and ((v_plate is not null and b.car_snapshot->>'plate_norm' = v_plate)
           or (new.car_id is not null and b.car_id = new.car_id))) then
    perform public.fail('car_booked_that_day', jsonb_build_object('date', new.date));
  end if;
  return new;
end
$$;
revoke execute on function public.bookings_car_rule() from public, anon, authenticated;
create trigger bookings_rule_car before insert on public.bookings
  for each row execute function public.bookings_car_rule();

update public.schema_version set version = 90;
