-- A3a — support requests: the author's flow, the team's flow, escalation, the 14-day reopening, the
-- states by category, the suggestions written before A3a, and above all that no author can reach
-- the internal notes by any way (table, columns, functions, export, notifications, audit, Realtime).
begin;
select test.make_fleet();

create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;

-- Two agents, appointed the real way, each with a live session.
select set_config('test.ag1', test.sign_up('ag1@test.local', '{"role":"client","name":"Agent Unu","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.ag2', test.sign_up('ag2@test.local', '{"role":"client","name":"Agent Doi","lang":"ro","terms_version":"2026-09"}')::text, true);
select test.login(test.id('admin'));
select public.admin_grant_support('ag1@test.local', 'Test', test.rid()), public.admin_grant_support('ag2@test.local', 'Test', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values
  ('53000000-0000-4000-8000-000000000001', current_setting('test.ag1')::uuid),
  ('53000000-0000-4000-8000-000000000002', current_setting('test.ag2')::uuid);
create function test.as_ag1() returns void language sql as $$ select test.login_session(current_setting('test.ag1')::uuid, '53000000-0000-4000-8000-000000000001') $$;
create function test.as_ag2() returns void language sql as $$ select test.login_session(current_setting('test.ag2')::uuid, '53000000-0000-4000-8000-000000000002') $$;
grant execute on function test.as_ag1(), test.as_ag2() to public;
select set_config('test.booking_a_ref', (select ref from public.bookings where id = test.id('booking_a')), true);
select set_config('test.booking_b_ref', (select ref from public.bookings where id = test.id('booking_b')), true);

-- ------------------------------------------------------------------ the suggestions written the old way
select test.login(test.id('client_b'));
select set_config('test.old', (public.submit_suggestion('Vreau notificări pe email', test.rid()))->>'id', true);
select test.eq(test.count('select id, body, status, created_at from public.suggestions'), 1::bigint,
  'the old app still reads its own suggestions (id, body, status, created_at)');
select test.fails('select * from public.suggestions', 'permission denied', 'but never every column');
select test.fails('select assigned_to from public.suggestions', 'permission denied', 'nor who handles it');
select test.fails('select escalation_reason from public.suggestions', 'permission denied', 'nor why it was escalated');
select test.fails('select booking_id from public.suggestions', 'permission denied', 'nor the booking''s id');
select test.eq(r->0->>'category', 'suggestions', 'an old-style suggestion is in the suggestions'),
       test.eq(r->0->>'title', 'Vreau notificări pe email', 'its title is the start of its text'),
       test.eq(r->0->>'status', 'new', 'and it is new')
from public.my_support_requests() r;
select test.logout();
select test.ok(last_user_message_at is not null, 'it starts with its author''s message') from public.suggestions where id = current_setting('test.old')::uuid;

-- ------------------------------------------------------------------ categories and a new request
select test.login(test.id('client_a'));
select test.ok(exists (select 1 from jsonb_array_elements(public.support_categories_for_me()) c where c->>'key' = 'companies'),
  'a client may choose Firme și flote');
select test.login(test.id('owner1'));
select test.ok(not exists (select 1 from jsonb_array_elements(public.support_categories_for_me()) c where c->>'key' = 'companies'),
  'a shop may not');
select test.eq(test.error_params($$select public.create_support_request('companies', 'Flota mea', 'Text', null, test.rid())$$)->>'field',
  'category', 'a shop is refused a category it may not choose');

select test.login(test.id('client_a'));
select test.eq(test.error_params($$select public.create_support_request('nope', 'Titlu bun', 'Text', null, test.rid())$$)->>'field',
  'category', 'an unknown category is refused');
select test.eq(test.error_params($$select public.create_support_request('technical', 'Ab', 'Text', null, test.rid())$$)->>'field',
  'title', 'a title of 3 characters at least');
select test.eq(test.error_params($$select public.create_support_request('technical', 'Titlu bun', '   ', null, test.rid())$$)->>'field',
  'body', 'a description');
select test.eq(test.error_params(format($$select public.create_support_request('technical', 'Titlu bun', %L, null, test.rid())$$, repeat('x', 4001)))->>'field',
  'body', 'at most 4,000 characters');
select test.fails(format($$select public.create_support_request('bookings', 'Programarea altcuiva', 'Text', %L, test.rid())$$,
    current_setting('test.booking_b_ref')), 'booking_not_found', 'never another client''s booking');

select set_config('test.rid1', gen_random_uuid()::text, true);
select set_config('test.req', (public.create_support_request('bookings', 'Nu pot anula programarea', 'Butonul nu răspunde.',
  lower(current_setting('test.booking_a_ref')), current_setting('test.rid1')::uuid))->>'id', true);
select test.eq((public.create_support_request('bookings', 'Nu pot anula programarea', 'Butonul nu răspunde.',
  current_setting('test.booking_a_ref'), current_setting('test.rid1')::uuid))->>'id', current_setting('test.req'),
  'the same request id answers the first result');
select test.eq(r->>'status', 'new', 'the request is new'),
       test.eq(r->'booking'->>'ref', current_setting('test.booking_a_ref'), 'with its own booking'),
       test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(r->'booking') k), 'date,ref,shop_name,status',
               'only the booking''s code, day, shop and state'),
       test.eq((r->>'can_reply')::boolean, true, 'the author may write'),
       test.ok(not (r ? 'notes') and not (r ? 'assigned') and not (r ? 'escalated_at') and not (r ? 'escalation_reason'),
               'the author never gets notes, who handles it or the escalation')
from public.get_my_support_request(current_setting('test.req')::uuid) r;

-- A shop's colleague may link its shop's booking.
select test.login(test.id('staff1'));
select test.ok((public.create_support_request('bookings', 'Clientul nu a venit', 'Detalii.', current_setting('test.booking_a_ref'), test.rid())) ? 'id',
  'a shop member links a booking of its shop');

-- Another person cannot see the request.
select test.login(test.id('client_b'));
select test.fails(format($$select public.get_my_support_request(%L)$$, current_setting('test.req')), 'request_not_found',
  'another client cannot open it');
select test.fails(format($$select public.reply_my_support_request(%L, 'x', test.rid())$$, current_setting('test.req')), 'request_not_found',
  'nor write in it');
select test.eq(test.count(format('select id from public.suggestions where id = %L', current_setting('test.req'))), 0::bigint, 'nor read its row');

-- 5 a day, the suggestions written the old way included.
select test.login(test.id('client_b'));
select public.create_support_request('technical', 'Unu', 'x', null, test.rid()),
       public.create_support_request('technical', 'Doi', 'x', null, test.rid()),
       public.create_support_request('technical', 'Trei', 'x', null, test.rid()),
       public.create_support_request('technical', 'Patru', 'x', null, test.rid());
select test.fails($$select public.create_support_request('technical', 'Cinci', 'x', null, test.rid())$$, 'limit_suggestions',
  'at most 5 a day, together with the old suggestions');
select test.logout();

-- ------------------------------------------------------------------ nobody else does the team's work
select test.login(test.id('client_a'));
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'support_list_requests()', 'support_list_staff()', 'support_get_request(null)', 'support_take_request(null, gen_random_uuid())',
    'support_assign_request(null, null, gen_random_uuid())', 'support_reply_request(null, ''x'', null, gen_random_uuid())',
    'support_add_note(null, ''x'', gen_random_uuid())', 'support_set_request_status(null, ''resolved'', gen_random_uuid())',
    'support_escalate_request(null, ''x'', gen_random_uuid())', 'admin_return_request(null, ''x'', gen_random_uuid())']
  loop
    perform test.eq(test.error_of('select public.' || fn), 'not_allowed', 'a client cannot call ' || fn);
  end loop;
end
$$;

-- ------------------------------------------------------------------ the team: take, note, answer
select test.as_ag1();
select test.ok(exists (select 1 from jsonb_array_elements(l->'items') x where x->>'id' = current_setting('test.req')
                       and x->>'waiting_since' is not null and x->'assigned' = 'null'::jsonb),
               'the agent sees the request waiting, with nobody responsible')
from public.support_list_requests() l;
select test.ok(l @> jsonb_build_array(jsonb_build_object('id', current_setting('test.ag1')), jsonb_build_object('id', current_setting('test.ag2')),
                                         jsonb_build_object('id', test.id('admin'))),
               'the agents and the admin can be responsible'),
       test.ok(not l @> jsonb_build_array(jsonb_build_object('id', test.id('client_a'))), 'never a client')
from public.support_list_staff() l;
select test.eq(r->>'status', 'in_progress', 'taking a request puts it in progress')
from public.support_take_request(current_setting('test.req')::uuid, test.rid()) r;
select test.ok((public.support_add_note(current_setting('test.req')::uuid, 'NOTA-SECRETA-123 clientul a sunat', test.rid())) ? 'id',
  'the agent writes an internal note');
select test.eq(r->>'status', 'waiting_user', 'an answer can wait for the author')
from public.support_reply_request(current_setting('test.req')::uuid, 'Ce browser folosești?', 'waiting_user', test.rid()) r;
select test.eq(r->'booking'->>'ref', current_setting('test.booking_a_ref'), 'the team sees the booking''s code'),
       test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(r->'booking') k), 'date,ref,shop_name,status',
               'and nothing else of it: no quote, no price, no car'),
       test.eq(r->'notes'->0->>'body', 'NOTA-SECRETA-123 clientul a sunat', 'the team reads the note'),
       test.eq(r->'messages'->0->'by'->>'display_id', (select display_id from public.profiles where id = current_setting('test.ag1')::uuid),
               'and which member answered'),
       test.ok(r->'author' ? 'email_masked' and not (r->'author' ? 'email'), 'the author as an agent may see it')
from public.support_get_request(current_setting('test.req')::uuid) r;
select test.logout();

select test.eq(first_response_at is not null, true, 'the first answer is dated'),
       test.eq(assigned_to, current_setting('test.ag1')::uuid, 'the agent is responsible')
from public.suggestions where id = current_setting('test.req')::uuid;
select test.eq(count(*), 1::bigint, 'the author is told once'),
       test.eq(min(event), 'support_reply', 'that the team answered'),
       test.eq(min(array_to_string(channels, ',')), 'push,email', 'by push and email'),
       test.ok(bool_and(params::text not like '%browser%'), 'without the text of the answer')
from public.notification_events where user_id = test.id('client_a') and params->>'request_id' = current_setting('test.req');
select test.eq(count(*) filter (where action = 'support_view_request'), 1::bigint, 'opening the request is logged'),
       test.eq(count(*) filter (where action in ('take_request', 'add_request_note', 'reply_request', 'set_request_status')), 4::bigint,
               'take, note, answer and its state are logged'),
       test.ok(bool_and(coalesce(after::text, '') not like '%NOTA-SECRETA%' and coalesce(before::text, '') not like '%NOTA-SECRETA%'),
               'the log keeps the note''s id, never its text')
from public.admin_audit_log where entity_id = current_setting('test.req');

-- ------------------------------------------------------------------ the internal notes: no way for the author
select test.login(test.id('client_a'));
select test.fails('select * from public.suggestion_notes', 'permission denied', 'the author cannot read the notes table');
select test.fails('select id from public.suggestion_notes', 'permission denied', 'not a single column of it');
select test.fails($$insert into public.suggestion_notes (suggestion_id, body) values (gen_random_uuid(), 'x')$$, 'permission denied',
  'nor write it');
select test.ok(r::text not like '%NOTA-SECRETA%', 'the request as the author reads it holds no note')
from public.get_my_support_request(current_setting('test.req')::uuid) r;
select test.ok(r::text not like '%NOTA-SECRETA%', 'nor its list') from public.my_support_requests() r;
select test.ok(r::text not like '%NOTA-SECRETA%', 'nor the export of its data'),
       test.eq(jsonb_array_length(r->'support_requests'), 1, 'the export has its request'),
       test.eq(r->'support_requests'->0->'messages'->0->>'from', 'Service-Hub', 'with the team''s answer, signed Service-Hub')
from public.export_my_data() r;
select test.eq(test.count(format('select id, body from public.suggestion_messages where suggestion_id = %L', current_setting('test.req'))), 1::bigint,
  'the author reads the conversation');
select test.fails('select author_id from public.suggestion_messages', 'permission denied', 'never who wrote an answer');
select test.fails($$insert into public.suggestion_messages (suggestion_id, from_staff, body) values (gen_random_uuid(), true, 'x')$$,
  'permission denied', 'nor write a message directly');
select test.fails(format($$update public.suggestions set status = 'closed' where id = %L$$, current_setting('test.req')), 'permission denied',
  'nor change the state directly');
select test.logout();
select test.ok(not exists (select 1 from public.notification_events where params::text like '%NOTA-SECRETA%'), 'no notification carries a note');
select test.ok(not exists (select 1 from pg_publication_tables where tablename = 'suggestion_notes'), 'the notes are not in Realtime');
select test.ok(not exists (select 1 from pg_policies where tablename = 'suggestion_notes'), 'and have no policy at all');
-- A3b wraps support_get_request (support_get_request_a3a inside, not callable through the API).
select test.eq(string_agg(p.proname, ', ' order by p.proname), 'support_add_note, support_get_request_a3a',
  'only two functions in the database touch the notes, both for the team'),
       test.eq(bool_or(has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> 'support_add_note'), false,
  'and the one that reads them is not callable through the API')
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%suggestion_notes%';

-- ------------------------------------------------------------------ the author answers, the 14 days
select test.login(test.id('client_a'));
select test.eq((r->>'unread')::boolean, false, 'opening the request marked the answer read') from jsonb_array_elements(public.my_support_requests()) r
where r->>'id' = current_setting('test.req');
select test.eq(r->>'status', 'in_progress', 'the author''s answer gives it back to the team')
from public.reply_my_support_request(current_setting('test.req')::uuid, 'Chrome pe Android.', test.rid()) r;
select test.as_ag1();
select test.eq(r->>'status', 'resolved', 'the agent marks it solved')
from public.support_set_request_status(current_setting('test.req')::uuid, 'resolved', test.rid()) r;
select test.logout();
select test.eq(count(*), 1::bigint, 'the author is told it is solved')
from public.notification_events where user_id = test.id('client_a') and event = 'support_resolved';
select test.login(test.id('client_a'));
select test.ok((r->>'can_reply')::boolean and r->>'reopen_until' is not null, 'it can be reopened for 14 days')
from public.get_my_support_request(current_setting('test.req')::uuid) r;
select test.eq(r->>'status', 'in_progress', 'a message in the 14 days reopens it'), test.eq((r->>'reopened')::boolean, true, 'reopened')
from public.reply_my_support_request(current_setting('test.req')::uuid, 'Problema a revenit.', test.rid()) r;
select test.logout();
select test.ok(resolved_at is null, 'no longer solved') from public.suggestions where id = current_setting('test.req')::uuid;

select test.as_ag1();
select public.support_set_request_status(current_setting('test.req')::uuid, 'resolved', test.rid());
select test.logout();
update public.suggestions set resolved_at = now() - interval '15 days' where id = current_setting('test.req')::uuid;
select test.login(test.id('client_a'));
select test.eq((r->>'can_reply')::boolean, false, 'after 14 days it cannot be reopened')
from public.get_my_support_request(current_setting('test.req')::uuid) r;
select test.fails(format($$select public.reply_my_support_request(%L, 'Încă ceva', test.rid())$$, current_setting('test.req')),
  'request_closed', 'a message after 14 days is refused');
select test.logout();
select test.ok(public.close_resolved_support_requests() >= 1, 'the daily job closes it');
select test.eq(status, 'closed', 'closed'), test.ok(closed_at is not null, 'and dated') from public.suggestions where id = current_setting('test.req')::uuid;
select test.as_ag1();
select test.fails(format($$select public.support_reply_request(%L, 'x', null, test.rid())$$, current_setting('test.req')), 'request_closed',
  'nobody answers a closed request');
select test.fails(format($$select public.support_set_request_status(%L, 'in_progress', test.rid())$$, current_setting('test.req')), 'request_closed',
  'nor reopens it');

-- ------------------------------------------------------------------ states by category
select test.fails(format($$select public.support_set_request_status(%L, 'in_progress', test.rid())$$, current_setting('test.old')), 'status_invalid',
  'a suggestion keeps its own states');
select test.eq(r->>'status', 'planned', 'planned is a suggestion''s state')
from public.support_set_request_status(current_setting('test.old')::uuid, 'planned', test.rid()) r;
select test.logout();
select test.login(test.id('client_a'));
select set_config('test.req2', (public.create_support_request('account', 'Nu primesc emailul', 'Nu ajunge emailul de confirmare.', null, test.rid()))->>'id', true);
select test.as_ag1();
select test.fails(format($$select public.support_set_request_status(%L, 'planned', test.rid())$$, current_setting('test.req2')), 'status_invalid',
  'a request is never planned');
select test.fails(format($$select public.support_set_request_status(%L, 'new', test.rid())$$, current_setting('test.req2')), 'status_invalid',
  'nor new again');

-- ------------------------------------------------------------------ assigning
select test.fails(format($$select public.support_assign_request(%L, %L, test.rid())$$, current_setting('test.req2'), test.id('client_b')),
  'assignee_invalid', 'never to a client');
select test.eq(r->>'assigned_to', current_setting('test.ag2'), 'to another agent')
from public.support_assign_request(current_setting('test.req2')::uuid, current_setting('test.ag2')::uuid, test.rid()) r;

-- ------------------------------------------------------------------ escalation
select test.login(test.id('admin'));
select test.fails(format($$select public.support_escalate_request(%L, 'x', test.rid())$$, current_setting('test.req2')), 'not_allowed',
  'the admin does not escalate (it is the one escalated to)');
select test.as_ag2();
select test.fails(format($$select public.support_escalate_request(%L, '  ', test.rid())$$, current_setting('test.req2')), 'reason_required',
  'an escalation needs a reason');
select test.eq((r->>'escalated')::boolean, true, 'the agent escalates')
from public.support_escalate_request(current_setting('test.req2')::uuid, 'Posibil cont compromis', test.rid()) r;
select test.fails(format($$select public.support_escalate_request(%L, 'din nou', test.rid())$$, current_setting('test.req2')),
  'request_escalated', 'not twice');
do $$
declare
  fn text;
begin
  foreach fn in array array[
    format('support_take_request(%L, gen_random_uuid())', current_setting('test.req2')),
    format('support_assign_request(%L, %L, gen_random_uuid())', current_setting('test.req2'), current_setting('test.ag2')),
    format('support_reply_request(%L, ''x'', null, gen_random_uuid())', current_setting('test.req2')),
    format('support_add_note(%L, ''x'', gen_random_uuid())', current_setting('test.req2')),
    format('support_set_request_status(%L, ''resolved'', gen_random_uuid())', current_setting('test.req2'))]
  loop
    perform test.eq(test.error_of('select public.' || fn), 'request_escalated', 'an agent cannot change an escalated request: ' || fn);
  end loop;
end
$$;
select test.ok(r->>'escalated_at' is not null and r->>'escalation_reason' = 'Posibil cont compromis', 'the agent still reads it')
from public.support_get_request(current_setting('test.req2')::uuid) r;
select test.fails(format($$select public.admin_return_request(%L, 'x', test.rid())$$, current_setting('test.req2')), 'not_allowed',
  'only the admin gives it back');
select test.logout();

select test.eq(count(*), 1::bigint, 'the admin''s address gets an email'),
       test.ok(bool_and(user_id is null and channels = array['email']), 'a platform email, no user')
from public.notification_events where event = 'support_escalated' and params->>'request_id' = current_setting('test.req2');
select test.ok(assigned_to is null and escalated_by = current_setting('test.ag2')::uuid, 'the request is the admin''s now')
from public.suggestions where id = current_setting('test.req2')::uuid;

select test.login(test.id('client_a'));
select test.eq(r->>'status', 'new', 'the author sees no difference')
from public.get_my_support_request(current_setting('test.req2')::uuid) r;
select test.ok(r::text not like '%Posibil cont compromis%', 'and never the reason')
from public.my_support_requests() r;

select test.login(test.id('admin'));
select test.ok((public.support_reply_request(current_setting('test.req2')::uuid, 'Verificăm contul.', null, test.rid())) ? 'id',
  'the admin answers an escalated request');
select test.fails(format($$select public.admin_return_request(%L, '', test.rid())$$, current_setting('test.req2')), 'reason_required',
  'giving it back needs a reason');
select test.eq(r->>'assigned_to', current_setting('test.ag2'), 'given back to the agent who escalated it')
from public.admin_return_request(current_setting('test.req2')::uuid, 'Cont verificat, nu e compromis', test.rid()) r;
select test.fails(format($$select public.admin_return_request(%L, 'x', test.rid())$$, current_setting('test.req2')), 'wrong_status',
  'only an escalated request goes back');
select test.logout();
select test.eq(count(*) filter (where action = 'escalate_request' and reason = 'Posibil cont compromis' and actor_role = 'support'), 1::bigint,
         'the escalation is logged with its reason, under the agent'),
       test.eq(count(*) filter (where action = 'return_request' and reason = 'Cont verificat, nu e compromis' and actor_role = 'admin'), 1::bigint,
         'the return is logged with its reason, under the admin')
from public.admin_audit_log where entity_id = current_setting('test.req2');
select test.as_ag2();
select test.ok((public.support_reply_request(current_setting('test.req2')::uuid, 'Contul este în regulă.', 'resolved', test.rid())) ? 'id',
  'given back, the agent works on it again');
select test.logout();

-- ------------------------------------------------------------------ a suspended author can still write to support
update public.profiles set suspended = true where id = test.id('client_b');
select test.login(test.id('client_b'));
select test.ok(jsonb_array_length(public.my_support_requests()) >= 1, 'a suspended account reads its requests');
select test.ok((public.reply_my_support_request(current_setting('test.old')::uuid, 'De ce sunt suspendat?', test.rid())) ? 'id',
  'and writes to support (to contest)');
select test.logout();
update public.profiles set suspended = false where id = test.id('client_b');

rollback;
