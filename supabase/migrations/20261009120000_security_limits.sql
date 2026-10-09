-- Security limits (after T35, Eduard 9 Oct: "fă tot ce poți"). Two things a signed-in account could
-- repeat without end are now counted in the database:
--
-- · staff invitations: every invitation (or a new one to the same address) sends an email from
--   our address, so an owner could flood someone's inbox and spoil our sending reputation.
--   At most 20 a day per shop: `limit_invites`.
-- · the address lookup (Edge Function geocode, OpenStreetMap Nominatim): their rules allow about
--   one request a second for the whole platform; called in a loop it would get every shop's map
--   blocked. At most 10 an hour per shop (the function answers "map unavailable").
--
-- rate_events keeps one row per counted action, for 2 days; nobody reads it from the browser.

create table public.rate_events (
  id bigint generated always as identity primary key,
  kind text not null check (char_length(kind) <= 40),
  subject uuid not null,
  at timestamptz not null default now()
);
create index rate_events_lookup_idx on public.rate_events (kind, subject, at desc);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from public, anon, authenticated;

-- Takes one action of this kind for this subject if fewer than p_max were taken in the window;
-- true when taken. Concurrent calls for the same subject wait for each other.
create function public.rate_take(p_kind text, p_subject uuid, p_max int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_subject::text, 0));
  delete from public.rate_events where kind = p_kind and subject = p_subject and at < now() - interval '2 days';
  if (select count(*) from public.rate_events
      where kind = p_kind and subject = p_subject and at > now() - p_window) >= p_max then
    return false;
  end if;
  insert into public.rate_events (kind, subject) values (p_kind, p_subject);
  return true;
end
$$;
revoke execute on function public.rate_take(text, uuid, int, interval) from public, anon, authenticated;
grant execute on function public.rate_take(text, uuid, int, interval) to service_role;

-- Staff invitations: the same function, counted first (a repeated request id is answered as
-- before and counts nothing).
alter function public.invite_staff(text, text, uuid) rename to invite_staff_base;
revoke execute on function public.invite_staff_base(text, text, uuid) from public, anon, authenticated;

create function public.invite_staff(p_email text, p_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
begin
  if p_request_id is not null and exists (select 1 from public.request_log r where r.request_id = p_request_id) then
    return public.invite_staff_base(p_email, p_token, p_request_id);
  end if;
  select s.id into v_shop from public.shops s where s.owner_id = auth.uid();
  if v_shop is not null and not public.rate_take('staff_invite', v_shop, 20, interval '1 day') then
    perform public.fail('limit_invites', jsonb_build_object('limit', 20));
  end if;
  return public.invite_staff_base(p_email, p_token, p_request_id);
end
$$;
revoke execute on function public.invite_staff(text, text, uuid) from public, anon;
grant execute on function public.invite_staff(text, text, uuid) to authenticated;

update public.schema_version set version = 70;
