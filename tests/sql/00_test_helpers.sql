-- Assertion helpers for the SQL tests. Test-only, never applied to a real project.
-- Tests switch identity with test.login(user_id) / test.login_anon() / test.logout(),
-- which set the same role and JWT claim that PostgREST sets for a real request.

create schema test;
grant usage on schema test to public;

-- Fails the run with a readable message.
create function test.ok(condition boolean, description text) returns void
language plpgsql
as $$
begin
  if condition is distinct from true then
    raise exception 'FAILED: %', description;
  end if;
end
$$;

-- Asserts that two values are equal (compared as text).
create function test.eq(actual anyelement, expected anyelement, description text) returns void
language plpgsql
as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED: % (expected %, got %)', description, expected, actual;
  end if;
end
$$;

-- Runs a statement and asserts it fails with an error whose message contains `expected`.
create function test.fails(statement text, expected text, description text) returns void
language plpgsql
as $$
declare
  msg text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics msg = message_text;
    if position(lower(expected) in lower(msg)) = 0 then
      raise exception 'FAILED: % (expected error containing "%", got "%")', description, expected, msg;
    end if;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded: %)', description, statement;
end
$$;

-- Number of rows a query returns, as seen by the current role.
create function test.count(query text) returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  execute format('select count(*) from (%s) q', query) into n;
  return n;
end
$$;

-- Creates an auth user the way Supabase sign-up does; the migrations' trigger builds the profile.
create function test.sign_up(email text, meta jsonb, confirmed boolean default true) returns uuid
language plpgsql
as $$
declare
  uid uuid;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values (gen_random_uuid(), 'authenticated', 'authenticated', email,
          case when confirmed then now() end, meta)
  returning id into uid;
  return uid;
end
$$;

-- A6: an admin's sign-in has a session in auth.sessions, as in the app (its token is refused once
-- the session is gone). The admin's first live session is reused; a new one is made after the
-- last was ended. Other roles get none here (an agent's tests make theirs: test.login_session).
create function test.admin_session(uid uuid) returns uuid
language plpgsql
security definer
as $$
declare
  sid uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin')
     or not exists (select 1 from auth.users u where u.id = uid) then
    return null;
  end if;
  select s.id into sid from auth.sessions s where s.user_id = uid order by s.created_at, s.id limit 1;
  if sid is null then
    insert into auth.sessions (user_id) values (uid) returning id into sid;
  end if;
  return sid;
end
$$;
grant execute on function test.admin_session(uuid) to public;

-- Signed in as after the second step (aal2, T25): what an admin needs; clients and shops do not care.
create function test.login(uid uuid, aal text default 'aal2') returns void
language plpgsql
as $$
declare
  sid uuid := test.admin_session(uid);
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', aal, 'session_id', sid))::text, true);
  perform set_config('role', 'authenticated', true);
end
$$;

create function test.login_anon() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end
$$;

create function test.logout() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('role', 'none', true);
end
$$;

grant execute on all functions in schema test to public;

-- A6: the audit log is append-only. Test setups that clear or reshape it on purpose unlock it for
-- their own transaction, the way only the retention job and the erasure do (superuser only).
create function test.unlock_audit_log() returns void
language plpgsql
security definer
as $$ begin insert into public.audit_log_unlocks (txid, purpose) values (txid_current(), 'launch_reset') on conflict (txid) do nothing; end $$;
grant execute on function test.unlock_audit_log() to public;

-- A6: forgets a rate limit's past uses (a test that needs more calls than the hourly limit).
create function test.forget_rate(p_kind text) returns void
language plpgsql
security definer
as $$ begin delete from public.rate_events where kind = p_kind; end $$;
grant execute on function test.forget_rate(text) to public;
