-- A notice from the team reaches the accounts that existed when it was sent (Eduard, 19 Oct 2026:
-- a brand-new account saw old notices). The admin still sees them all.

create function public.can_read_notice(p_audience text, p_city text, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (public.in_notice_audience(auth.uid(), p_audience, p_city)
        and p_created_at >= (select p.created_at from public.profiles p where p.id = auth.uid()))
$$;
revoke execute on function public.can_read_notice(text, text, timestamptz) from public, anon;
grant execute on function public.can_read_notice(text, text, timestamptz) to authenticated;

drop policy notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (public.can_read_notice(audience, city, created_at));
-- The old check, without the date, is no longer used.
drop function public.can_read_notice(text, text);

update public.schema_version set version = 82;
