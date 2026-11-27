-- A booking confirmed on the spot (T28a) writes two automatic messages in one instant: „Cerere nouă de
-- programare” and „s-a confirmat automat”. With the same time, either could come last, so the shop could
-- read „New booking request” at the end of the conversation and in its list of conversations while
-- Programări → Cereri was empty (Eduard, SH_to_fix, 26 Nov 2026). Now the request is written a
-- millisecond before the confirmation: it reads „asked, then confirmed”, the confirmation last.
--
-- Only the order of the two messages of a new instant booking changes. Who is told what (notifications),
-- the booking itself and every message already written stay as they are. The function before is kept
-- and wrapped (create_booking_a14); a request sent twice still answers the first booking and moves
-- nothing (the two messages then no longer share their time).

alter function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  rename to create_booking_a14;
revoke execute on function public.create_booking_a14(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  from public, anon, authenticated;

create function public.create_booking(
  p_shop_id uuid,
  p_service_id text,
  p_date date,
  p_slot time,
  p_request_id uuid,
  p_car_id uuid default null,
  p_car jsonb default null,
  p_save_car boolean default false,
  p_note text default null,
  p_extra_service_ids text[] default '{}',
  p_share_history boolean default false,
  p_company_vehicle_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings;
begin
  v := public.create_booking_a14(p_shop_id, p_service_id, p_date, p_slot, p_request_id, p_car_id, p_car,
    p_save_car, p_note, p_extra_service_ids, p_share_history, p_company_vehicle_id);
  update public.messages m
  set created_at = m.created_at - interval '1 millisecond'
  where m.booking_id = v.id
    and m.kind = 'system'
    and m.event = 'booking_requested'
    and exists (
      select 1 from public.messages c
      where c.booking_id = v.id and c.kind = 'system' and c.event = 'booking_auto_confirmed'
        and c.created_at = m.created_at
    );
  return v;
end
$$;

revoke execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  from public, anon;
grant execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  to authenticated;

update public.schema_version set version = 128;
