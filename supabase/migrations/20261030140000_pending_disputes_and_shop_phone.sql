-- After the audit (Eduard, 30 Oct 2026), two rules. ARCHITECTURE §6 and §2.
--
-- · A no-show under dispute keeps counting until the admin decides (variant A): disputing does not
--   lift the acknowledgement, the phone rule or instant confirmation. Only a dispute the admin
--   upheld takes a no-show out of every count. Before (T53) a pending dispute already did.
-- · A shop's public phones (shops.phone, phone2) changed by its owner need a new SMS code: the
--   owner's confirmation is cleared, so the shop leaves search until the owner types the code sent
--   to the number on their account (the existing phone-verify-start / check_phone_code). The code
--   goes to the owner's number, not to the new one: a shop's number is often a landline, which
--   cannot receive an SMS. A change of formatting only (same digits) changes nothing; a change the
--   admin makes (admin_update_shop) changes nothing either.

create or replace function public.active_no_show_count(p_client_id uuid, p_days int default 90)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.bookings b
  where b.client_id = p_client_id and b.status = 'no_show' and b.source = 'app'
    and b.date > public.bucharest_today() - least(greatest(coalesce(p_days, 90), 1), 3650)
    and not exists (select 1 from public.no_show_disputes d
                    where d.booking_id = b.id and d.status = 'upheld')
$$;
revoke execute on function public.active_no_show_count(uuid, int) from public, anon, authenticated;

create function public.shops_phone_reconfirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from new.owner_id then
    return null;
  end if;
  if public.phone_digits(new.phone) is not distinct from public.phone_digits(old.phone)
     and public.phone_digits(new.phone2) is not distinct from public.phone_digits(old.phone2) then
    return null;
  end if;
  update public.profiles
    set phone_verified_at = null, phone_verified_by_admin = false
  where id = new.owner_id and (phone_verified_at is not null or phone_verified_by_admin);
  return null;
end
$$;
revoke execute on function public.shops_phone_reconfirm() from public, anon, authenticated;
create trigger shops_phone_reconfirm after update of phone, phone2 on public.shops
  for each row execute function public.shops_phone_reconfirm();

update public.schema_version set version = 89;
