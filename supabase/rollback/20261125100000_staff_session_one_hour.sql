-- Back to 8 hours.
create or replace function public.staff_session_hours()
returns integer
language sql
immutable
set search_path = ''
as $$ select 8 $$;

update public.schema_version set version = 126;
