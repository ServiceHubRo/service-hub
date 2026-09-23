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

create function test.login(uid uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);
end
$$;

create function test.login_anon() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('role', 'anon', true);
end
$$;

create function test.logout() returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('role', 'none', true);
end
$$;

grant execute on all functions in schema test to public;
