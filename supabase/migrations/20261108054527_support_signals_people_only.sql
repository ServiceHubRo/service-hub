-- A3c1 (follow-up of 20261108045828_support_dashboard): signals only for changes made by a signed-in
-- person (an author, an agent, the admin). A job or a service action changing many requests at once
-- (the daily closing of resolved requests, the files' cleanup, an import) would otherwise send
-- thousands of Realtime events in a second: over the project's events-per-second limit, Realtime
-- drops events, other people's included. Such changes appear at the next read of the screen.

create or replace function public.support_signal(p_suggestion uuid, p_author boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.support_signals (suggestion_id, audience, author_id)
  select s.id, a.audience, case when a.audience = 'author' then s.author_id end
  from public.suggestions s
  cross join (values ('team'), ('author')) a (audience)
  where s.id = p_suggestion and (a.audience = 'team' or p_author)
    and auth.uid() is not null
  on conflict (suggestion_id, audience) do update set changed_at = clock_timestamp()
$$;
revoke execute on function public.support_signal(uuid, boolean) from public, anon, authenticated;

update public.schema_version set version = 113;
