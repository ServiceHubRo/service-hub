-- The car's history from other shops is shown to the shop a client books with by default, with one
-- switch in Cont to turn it off (Eduard, 10 Oct, after a tester: the history helps the shop do the
-- job right). Legal basis: legitimate interest, with the right to object through that switch
-- (Privacy Policy §3, §5). What the shop sees does not change (shop_vehicle_file: no prices, no
-- other shop's name or city, only while a booking is open).
--
-- The switch is profiles.share_history. A new booking takes it; changing it changes every open
-- booking of the client at once. bookings.share_history stays the flag the shop side reads.
-- Bookings made before this migration keep what the client chose for them.

alter table public.profiles
  add column share_history boolean not null default true;
grant update (share_history) on public.profiles to authenticated;

-- A new booking with a client account follows the client's switch, whatever the form sent.
create function public.booking_share_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share boolean;
begin
  if new.client_id is not null then
    select p.share_history into v_share from public.profiles p where p.id = new.client_id;
    new.share_history := coalesce(v_share, true);
    new.share_history_at := case when new.share_history then now() end;
  end if;
  return new;
end
$$;
revoke execute on function public.booking_share_from_profile() from public, anon, authenticated;

create trigger bookings_share_from_profile
  before insert on public.bookings
  for each row execute function public.booking_share_from_profile();

-- The switch in Cont applies to every open booking of the client at once.
create function public.profile_share_to_bookings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings b
  set share_history = new.share_history, share_history_at = now()
  where b.client_id = new.id
    and b.share_history is distinct from new.share_history
    and public.is_active_status(b.status);
  return new;
end
$$;
revoke execute on function public.profile_share_to_bookings() from public, anon, authenticated;

create trigger profiles_share_to_bookings
  after update of share_history on public.profiles
  for each row when (new.share_history is distinct from old.share_history)
  execute function public.profile_share_to_bookings();

update public.schema_version set version = 73;
