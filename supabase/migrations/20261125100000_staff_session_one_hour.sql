-- A team member's sign-in (admin, support agent) lasts 1 hour from the sign-in, then the password and
-- the second step again (Eduard, 25 Nov 2026: 8 hours was too long). Only the number changes: the
-- checks that read it (caller_session_alive, support_file_caller, require_staff) are untouched, and
-- clients and shops are not affected (the limit is asked only for the team).
create or replace function public.staff_session_hours()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1 $$;

update public.schema_version set version = 127;
