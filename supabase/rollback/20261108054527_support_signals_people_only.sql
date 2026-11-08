-- Rollback of supabase/migrations/20261108054527_support_signals_people_only.sql, schema 113 → 112:
-- every change signals again, a job's included. Loses nothing.

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
  on conflict (suggestion_id, audience) do update set changed_at = clock_timestamp()
$$;
revoke execute on function public.support_signal(uuid, boolean) from public, anon, authenticated;

update public.schema_version set version = 112;
