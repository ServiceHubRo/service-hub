-- A3c1 — the support dashboard and live updates: who may read the counters and the list (the team
-- only, after the second step, with a live session), what the live signals carry and to whom (the
-- author hears only its own requests and never the team's internal work; nobody else hears
-- anything), the list one page at a time (every row exactly once, in order, with every filter) and
-- the counters over a large number of requests.
begin;
select test.make_world();

create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;

select set_config('test.ag', test.sign_up('agd@test.local', '{"role":"client","name":"Agent Panou","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('agd@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('55000000-0000-4000-8000-000000000001', current_setting('test.ag')::uuid);
create function test.as_ag(p_aal text default 'aal2') returns void language sql as $$
  select test.login_session(current_setting('test.ag')::uuid, '55000000-0000-4000-8000-000000000001', p_aal) $$;
grant execute on function test.as_ag(text) to public;

-- What a signed-in caller hears (RLS of support_signals, as Realtime applies it).
create function test.signals(p_audience text) returns bigint language sql as $$
  select count(*) from public.support_signals where audience = p_audience $$;
grant execute on function test.signals(text) to public;
-- When a request last changed for an audience (read past RLS).
create function test.changed(p_id uuid, p_audience text) returns timestamptz language sql security definer as $$
  select changed_at from public.support_signals where suggestion_id = p_id and audience = p_audience $$;
grant execute on function test.changed(uuid, text) to public;

-- ------------------------------------------------------------------ who may read the dashboard and the list
do $$
declare
  fn text;
begin
  foreach fn in array array['support_dashboard()', 'support_inbox()'] loop
    perform test.logout();
    perform test.ok(test.error_of('select public.' || fn) <> 'ok', 'signed out: ' || fn || ' refused');
    perform test.login(test.id('client_a'));
    perform test.ok(test.error_of('select public.' || fn) ilike '%not_allowed%', 'a client: ' || fn || ' refused');
    perform test.login(test.id('owner1'));
    perform test.ok(test.error_of('select public.' || fn) ilike '%not_allowed%', 'a shop: ' || fn || ' refused');
    perform test.as_ag('aal1');
    perform test.ok(test.error_of('select public.' || fn) ilike '%mfa_required%', 'an agent without the second step: ' || fn || ' refused');
    perform test.login_session(current_setting('test.ag')::uuid, '55000000-0000-4000-8000-0000000000ff');
    perform test.ok(test.error_of('select public.' || fn) ilike '%not_signed_in%', 'an agent whose session ended: ' || fn || ' refused');
    perform test.as_ag();
    perform test.ok(test.error_of('select public.' || fn) = 'ok', 'an agent: ' || fn || ' answers');
    perform test.login(test.id('admin'));
    perform test.ok(test.error_of('select public.' || fn) = 'ok', 'the admin: ' || fn || ' answers');
  end loop;
  perform test.logout();
end
$$;

-- Wrong filters are refused, never guessed.
select test.as_ag();
select test.eq(test.error_params($$select public.support_inbox(p_owner => 'cineva')$$)->>'field', 'owner', 'an unknown owner filter'),
       test.eq(test.error_params($$select public.support_inbox(p_status => 'pierdută')$$)->>'field', 'status', 'an unknown state'),
       test.eq(test.error_params($$select public.support_inbox(p_category => 'nope')$$)->>'field', 'category', 'an unknown category'),
       test.eq(test.error_params($$select public.support_inbox(p_age => 12)$$)->>'field', 'age', 'an age other than 24 or 48'),
       test.eq(test.error_params($$select public.support_inbox(p_limit => 0)$$)->>'field', 'limit', 'an empty page'),
       test.eq(test.error_params($$select public.support_inbox(p_limit => 101)$$)->>'field', 'limit', 'a page over 100'),
       test.eq(test.error_params($$select public.support_inbox(p_after_id => gen_random_uuid())$$)->>'field', 'after', 'half a cursor');
select test.logout();

-- ------------------------------------------------------------------ the live signals: nothing but "changed"
select test.login(test.id('client_a'));
select set_config('test.req', (public.create_support_request('technical', 'Aplicația se închide', 'La deschidere', null, test.rid()))->>'id', true);
select test.login(test.id('client_b'));
select set_config('test.req_b', (public.create_support_request('account', 'Nu primesc emailul', 'Text', null, test.rid()))->>'id', true);
select test.logout();

select test.login(test.id('client_a'));
select test.eq(test.signals('author'), 1::bigint, 'the author hears its own request'),
       test.eq(test.signals('team'), 0::bigint, 'and nothing of the team''s'),
       test.ok((select bool_and(author_id = test.id('client_a') and suggestion_id = current_setting('test.req')::uuid)
                from public.support_signals), 'only its own row');
select test.eq((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
                where table_schema = 'public' and table_name = 'support_signals'),
               array['id', 'suggestion_id', 'audience', 'author_id', 'changed_at'],
               'a signal holds no text, no state, no team member');
select test.fails('insert into public.support_signals (suggestion_id, audience) values (gen_random_uuid(), ''team'')', 'permission denied', 'nobody writes a signal');
select test.fails('update public.support_signals set changed_at = now()', 'permission denied', 'nor changes one');
select test.fails('delete from public.support_signals', 'permission denied', 'nor deletes one');
select test.ok(test.error_of(format('select public.support_signal(%L, true)', current_setting('test.req'))) ilike '%permission denied%',
  'nor calls the function that makes them');
select test.login(test.id('client_b'));
select test.eq(test.signals('author'), 1::bigint, 'another client hears only its own');
select test.ok(not exists (select 1 from public.support_signals where suggestion_id = current_setting('test.req')::uuid), 'never the first client''s');
select test.login(test.id('owner1'));
select test.eq(test.count('select id from public.support_signals'), 0::bigint, 'a shop without requests hears nothing');
select test.as_ag();
select test.eq(test.signals('team'), 2::bigint, 'the team hears every request'),
       test.eq(test.signals('author'), 0::bigint, 'but not the authors'' rows');
select test.as_ag('aal1');
select test.eq(test.count('select id from public.support_signals'), 0::bigint, 'an agent without the second step hears nothing');
select test.login_session(current_setting('test.ag')::uuid, '55000000-0000-4000-8000-0000000000ff');
select test.eq(test.count('select id from public.support_signals'), 0::bigint, 'nor one whose session ended');
select test.login(test.id('admin'));
select test.eq(test.signals('team'), 2::bigint, 'the admin hears every request');
select test.logout();

-- Realtime streams the signals only, never the requests, the conversation, the notes or the files.
select test.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                           and tablename in ('suggestions', 'suggestion_messages', 'suggestion_notes', 'suggestion_files')),
  'no request, message, note or file is streamed')
where exists (select 1 from pg_publication where pubname = 'supabase_realtime');
select test.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'support_signals'),
  'the signals are')
where exists (select 1 from pg_publication where pubname = 'supabase_realtime');

-- What reaches the author: the team's answers and the state, never its internal work.
select set_config('test.t', test.changed(current_setting('test.req')::uuid, 'author')::text, true);
select test.as_ag();
select public.support_take_request(current_setting('test.req')::uuid, test.rid());
select test.logout();
select test.ok(test.changed(current_setting('test.req')::uuid, 'author') > current_setting('test.t')::timestamptz,
  'taken: the state becomes „În lucru”, which the author sees');
select set_config('test.t0', test.changed(current_setting('test.req')::uuid, 'author')::text, true);
select set_config('test.k0', test.changed(current_setting('test.req')::uuid, 'team')::text, true);
select test.as_ag();
select public.support_add_note(current_setting('test.req')::uuid, 'Verific jurnalul de erori', test.rid());
select public.support_assign_request(current_setting('test.req')::uuid, test.id('admin'), test.rid());
select test.logout();
select test.eq(test.changed(current_setting('test.req')::uuid, 'author'), current_setting('test.t0')::timestamptz,
  'a note and a new responsible: the author hears nothing');
select test.ok(test.changed(current_setting('test.req')::uuid, 'team') > current_setting('test.k0')::timestamptz, 'the team does');
select test.as_ag();
select public.support_reply_request(current_setting('test.req')::uuid, 'Încearcă versiunea nouă', 'waiting_user', test.rid());
select test.logout();
select test.ok(test.changed(current_setting('test.req')::uuid, 'author') > current_setting('test.t0')::timestamptz, 'the team''s answer: the author hears it');
select set_config('test.t1', test.changed(current_setting('test.req')::uuid, 'author')::text, true);
select test.as_ag();
select public.support_escalate_request(current_setting('test.req')::uuid, 'Eroare de plată', test.rid());
select test.logout();
select test.eq(test.changed(current_setting('test.req')::uuid, 'author'), current_setting('test.t1')::timestamptz,
  'an escalation: the author hears nothing');
select test.login(test.id('client_a'));
select public.get_my_support_request(current_setting('test.req')::uuid);
select test.logout();
select test.eq(test.changed(current_setting('test.req')::uuid, 'author'), current_setting('test.t1')::timestamptz,
  'the author reading its request does not signal itself (no endless reload)');

-- A deleted request takes its signals with it.
delete from auth.users where id = test.id('client_b');
select test.eq((select count(*) from public.support_signals where suggestion_id = current_setting('test.req_b')::uuid), 0::bigint,
  'an account deleted: its requests'' signals go with them');

-- A change nobody signed in made (a job, a service action, an import) signals nothing: thousands at
-- once would go over Realtime's events-per-second limit and lose other people's events.
select set_config('test.t2', test.changed(current_setting('test.req')::uuid, 'team')::text, true);
update public.suggestions set status = 'closed', closed_at = now() where id = current_setting('test.req')::uuid;
select test.eq(test.changed(current_setting('test.req')::uuid, 'team'), current_setting('test.t2')::timestamptz,
  'a change without a signed-in person: no signal');
select set_config('test.signals_before_bulk', (select count(*) from public.support_signals)::text, true);

-- ------------------------------------------------------------------ many requests: counters and pages
-- 3,000 requests as the API would leave them: every state, nine categories, half with someone
-- responsible, some escalated, the author waiting from minutes to days.
insert into public.suggestions (author_id, author_role, title, body, category, status, assigned_to, escalated_at,
                                created_at, last_user_message_at, last_staff_message_at)
select test.id('client_a'), 'client', 'Volum ' || g, 'Text ' || g,
       c.key,
       case when c.key = 'suggestions' then (array['new', 'planned', 'done', 'declined', 'closed'])[1 + g % 5]
            else (array['new', 'in_progress', 'waiting_user', 'resolved', 'closed'])[1 + g % 5] end,
       case when g % 2 = 0 then current_setting('test.ag')::uuid when g % 7 = 0 then test.id('admin') end,
       case when g % 11 = 0 then now() - interval '1 hour' end,
       now() - make_interval(hours => g % 120 + 1),
       -- some share the same moment, so the order must also rely on the id
       now() - make_interval(mins => (g / 3) * 7),
       case when g % 3 = 0 then now() - make_interval(mins => (g / 3) * 7 - 1) end
from generate_series(1, 3000) g
cross join lateral (select key from public.support_categories order by position offset (g % 9) limit 1) c;

-- The expected numbers, read past RLS (a view runs with its owner's rights).
create view test.all_suggestions as select * from public.suggestions;
grant select on test.all_suggestions to public;
select test.eq((select count(*) from public.support_signals), current_setting('test.signals_before_bulk')::bigint,
  '3,000 requests written at once by no one signed in: not a single signal');
select test.as_ag();
-- The counters count every request, not a page.
select test.eq((d->'counts'->>'new')::bigint, (select count(*) from test.all_suggestions where status = 'new'), 'Noi'),
       test.eq((d->'counts'->>'in_progress')::bigint, (select count(*) from test.all_suggestions where status = 'in_progress'), 'În lucru'),
       test.eq((d->'counts'->>'waiting_user')::bigint, (select count(*) from test.all_suggestions where status = 'waiting_user'), 'Așteaptă utilizatorul'),
       test.eq((d->'counts'->>'resolved')::bigint, (select count(*) from test.all_suggestions where status = 'resolved'), 'Rezolvate'),
       test.eq((d->'counts'->>'closed')::bigint, (select count(*) from test.all_suggestions where status = 'closed'), 'Închise'),
       test.eq((d->'counts'->>'escalated')::bigint,
               (select count(*) from test.all_suggestions where escalated_at is not null and status in ('new', 'in_progress', 'waiting_user', 'planned')), 'Escaladate (open)'),
       test.eq((d->'counts'->>'unassigned')::bigint,
               (select count(*) from test.all_suggestions where assigned_to is null and escalated_at is null and status in ('new', 'in_progress', 'waiting_user', 'planned')), 'Fără responsabil'),
       test.eq((d->'counts'->>'mine')::bigint,
               (select count(*) from test.all_suggestions where assigned_to = current_setting('test.ag')::uuid and status in ('new', 'in_progress', 'waiting_user', 'planned')), 'Ale mele'),
       test.eq((d->'counts'->>'over_24')::bigint,
               (select count(*) from test.all_suggestions s where s.status in ('new', 'in_progress', 'planned')
                  and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity')
                  and coalesce(s.last_user_message_at, s.created_at) <= now() - interval '24 hours'), 'waiting over 24 hours'),
       test.eq((d->'counts'->>'over_48')::bigint,
               (select count(*) from test.all_suggestions s where s.status in ('new', 'in_progress', 'planned')
                  and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity')
                  and coalesce(s.last_user_message_at, s.created_at) <= now() - interval '48 hours'), 'waiting over 48 hours'),
       test.ok((d->'counts'->>'over_48')::int > 0 and (d->'counts'->>'over_24')::int > (d->'counts'->>'over_48')::int,
               'both warnings have requests (the data is meaningful)'),
       test.eq(d->'oldest'->>'id',
               (select s.id::text from test.all_suggestions s where s.status in ('new', 'in_progress', 'planned')
                  and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity')
                order by coalesce(s.last_user_message_at, s.created_at), s.id limit 1), 'the oldest request without answer')
from public.support_dashboard() d;

select test.logout();
-- Walks every page of a filter; answers how many rows, how many distinct, and whether the order held.
create function test.walk(p_owner text, p_status text, p_category text, p_age int, p_limit int)
returns table (total bigint, distinct_ids bigint, ordered boolean, pages int)
language plpgsql as $$
declare
  v jsonb;
  v_ids uuid[] := '{}';
  v_keys text[] := '{}';
  v_next jsonb := null;
  v_pages int := 0;
begin
  loop
    v := public.support_inbox(p_owner, p_status, p_category, p_age,
                              (v_next->>'open')::boolean, (v_next->>'at')::timestamptz, (v_next->>'id')::uuid, p_limit);
    v_pages := v_pages + 1;
    v_ids := v_ids || array(select (i->>'id')::uuid from jsonb_array_elements(v->'items') i);
    v_keys := v_keys || array(select (case when i->>'status' in ('new', 'in_progress', 'waiting_user', 'planned') then '1' else '0' end)
                                     || '|' || to_char((i->>'last_user_message_at')::timestamptz at time zone 'UTC', 'YYYYMMDDHH24MISSUS')
                                     || '|' || (i->>'id') from jsonb_array_elements(v->'items') i);
    v_next := v->'next';
    exit when v_next is null or jsonb_typeof(v_next) = 'null' or v_pages > 1000;
  end loop;
  return query select cardinality(v_ids)::bigint, (select count(distinct x) from unnest(v_ids) x),
    v_keys = array(select k from unnest(v_keys) k order by k collate "C" desc), v_pages;
end
$$;
grant execute on function test.walk(text, text, text, int, int) to public;
select test.as_ag();

select test.eq(w.total, (select count(*) from test.all_suggestions), 'every request, page after page'),
       test.eq(w.distinct_ids, w.total, 'none twice'),
       test.ok(w.ordered, 'open first, then the newest message, the id deciding ties'),
       test.eq(w.pages, (select (count(*) / 100 + 1)::int from test.all_suggestions), 'in pages of 100')
from test.walk('all', 'all', 'all', null, 100) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where status in ('new', 'in_progress', 'waiting_user', 'planned')), 'the open ones'),
       test.eq(w.distinct_ids, w.total, 'none twice'), test.ok(w.ordered, 'in order')
from test.walk('all', 'open', 'all', null, 37) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where assigned_to = current_setting('test.ag')::uuid
                          and status in ('new', 'in_progress', 'waiting_user', 'planned')), 'mine'),
       test.ok(w.ordered, 'in order')
from test.walk('mine', 'open', 'all', null, 50) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where assigned_to = test.id('admin')), 'one member''s, every state')
from test.walk(test.id('admin')::text, 'all', 'all', null, 100) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where assigned_to is null and escalated_at is null), 'nobody''s')
from test.walk('none', 'all', 'all', null, 100) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where escalated_at is not null), 'escalated')
from test.walk('escalated', 'all', 'all', null, 100) w;
select test.eq(w.total, (select count(*) from test.all_suggestions where status = 'waiting_user' and category = 'account'), 'one state of one category')
from test.walk('all', 'waiting_user', 'account', null, 100) w;
select test.eq(w.total, (d->'counts'->>'over_48')::bigint, 'waiting over 48 hours: the list matches the counter'),
       test.ok(w.ordered, 'in order')
from test.walk('all', 'open', 'all', 48, 100) w, public.support_dashboard() d;
select test.eq(w.total, (d->'counts'->>'over_24')::bigint, 'over 24 hours: the list matches the counter')
from test.walk('all', 'open', 'all', 24, 100) w, public.support_dashboard() d;
select test.eq(jsonb_array_length(v->'items'), 30, 'a page holds 30 by default'),
       test.ok(v->'next' is not null and jsonb_typeof(v->'next') = 'object', 'and points to the next')
from public.support_inbox() v;
select test.ok(jsonb_typeof(v->'next') = 'null', 'the last page says so')
from public.support_inbox('all', 'waiting_user', 'account', null, null, null, null, 100) v;

-- Fast enough for the screen: a page and the counters over 3,000 requests.
do $$
declare
  t0 timestamptz;
  v jsonb;
begin
  t0 := clock_timestamp();
  v := public.support_inbox();
  v := public.support_inbox('all', 'all', 'all', null, (v->'next'->>'open')::boolean, (v->'next'->>'at')::timestamptz, (v->'next'->>'id')::uuid, 100);
  v := public.support_dashboard();
  perform test.ok(clock_timestamp() - t0 < interval '2 seconds', 'two pages and the counters in under 2 seconds');
end
$$;
select test.logout();

rollback;
