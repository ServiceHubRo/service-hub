-- Back to create_booking without the order of the two automatic messages (the function before, kept as
-- create_booking_a14, takes its name and its rights back).
drop function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid);
alter function public.create_booking_a14(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  rename to create_booking;
revoke execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  from public, anon;
grant execute on function public.create_booking(uuid, text, date, time, uuid, uuid, jsonb, boolean, text, text[], boolean, uuid)
  to authenticated;

update public.schema_version set version = 127;
