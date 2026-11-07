-- A2 — the Support Agent role: appointed and withdrawn only by an admin (reason required, both in the
-- audit log), no access before the second step of sign-in, no admin function, no private data of
-- anyone (bookings, conversations, cars, companies, billing, quotes), every search, opened card and
-- change in the audit log, and access lost at once — sessions and API — when the role is withdrawn
-- or the account suspended, while the history of the agent's actions stays.
begin;
select test.make_fleet();

-- Signed in as an agent with a live session (the session id is in every real access token).
create function test.login_session(p_uid uuid, p_sid uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform test.login(p_uid, p_aal);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'session_id', p_sid)::text, true);
end
$$;
grant execute on function test.login_session(uuid, uuid, text) to public;

select set_config('test.agent', test.sign_up('agent@test.local', '{"role":"client","name":"Ioana Suport","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.fresh', test.sign_up('fresh@test.local', '{"role":"client","name":"Nou","lang":"ro","terms_version":"2026-09"}', false)::text, true);
select set_config('test.idle', test.sign_up('idle@test.local', '{"role":"client","name":"Inactiv","lang":"ro","terms_version":"2026-09"}')::text, true);
update public.profiles set suspended = true where id = current_setting('test.idle')::uuid;
select set_config('test.b_display', (select display_id from public.profiles where id = test.id('client_b')), true);

-- ------------------------------------------------------------------ appointing: only an admin, only a clean account
select test.login(current_setting('test.agent')::uuid);
select test.fails($$select public.admin_grant_support('agent@test.local', 'x', test.rid())$$, 'not_allowed',
  'a client cannot appoint itself');
select test.login(test.id('owner1'));
select test.fails($$select public.admin_grant_support('agent@test.local', 'x', test.rid())$$, 'not_allowed',
  'nor a shop owner');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_grant_support('agent@test.local', 'x', test.rid())$$, 'mfa_required',
  'nor an admin before the second step');
select test.login_anon();
select test.fails($$select public.admin_grant_support('agent@test.local', 'x', test.rid())$$, 'permission denied',
  'nor anyone signed out');

select test.login(test.id('admin'));
select test.fails($$select public.admin_grant_support('agent@test.local', '  ', test.rid())$$, 'reason_required', 'a reason is required');
select test.fails($$select public.admin_grant_support('agent@test.local', repeat('x', 501), test.rid())$$, 'reason_too_long', 'at most 500 characters');
select test.fails($$select public.admin_grant_support('nobody@test.local', 'x', test.rid())$$, 'not_found', 'an unknown account');
select test.fails($$select public.admin_grant_support('owner1@test.local', 'x', test.rid())$$, 'support_not_client', 'never a shop account');
select test.fails($$select public.admin_grant_support('admin@test.local', 'x', test.rid())$$, 'support_not_client', 'never an admin');
select test.fails($$select public.admin_grant_support('ana@test.local', 'x', test.rid())$$, 'support_account_has_data',
  'never a client with cars and bookings');
select test.fails($$select public.admin_grant_support('fresh@test.local', 'x', test.rid())$$, 'support_email_unverified',
  'never an account without a confirmed email');
select test.fails($$select public.admin_grant_support('idle@test.local', 'x', test.rid())$$, 'support_account_inactive',
  'never a suspended account');
-- A member of a company (no cars or bookings of its own) is not clean either.
select test.fails(format($$select public.admin_grant_support(%L, 'x', test.rid())$$,
    (select p.display_id from public.profiles p where p.id = test.id('acc'))),
  'support_account_has_data', 'never a member of a company');

select set_config('test.grant_rid', gen_random_uuid()::text, true);
select set_config('test.agent_display', (select display_id from public.profiles where id = current_setting('test.agent')::uuid), true);
select test.ok(r->>'display_id' ~ '^E-[0-9]{5}$', 'the agent gets an E- ID'), set_config('test.e_id', r->>'display_id', true)
from public.admin_grant_support(current_setting('test.agent_display'), 'Angajat suport, contract 12', current_setting('test.grant_rid')::uuid) r;
select test.eq(r->>'display_id', current_setting('test.e_id'), 'the same request id answers the first result')
from public.admin_grant_support(current_setting('test.agent_display'), 'Angajat suport, contract 12', current_setting('test.grant_rid')::uuid) r;
select test.fails($$select public.admin_grant_support('agent@test.local', 'x', test.rid())$$, 'wrong_status', 'already an agent');
select test.logout();

select test.eq(role, 'support', 'the role is support'), test.eq(display_id, current_setting('test.e_id'), 'with its new ID')
from public.profiles where id = current_setting('test.agent')::uuid;
select test.eq(count(*), 1::bigint, 'one audit entry for the appointment'),
       test.eq(min(reason), 'Angajat suport, contract 12', 'with its reason'),
       test.eq(min(actor_role), 'admin', 'made by an admin'),
       test.eq(min(actor_display_id), (select display_id from public.profiles where id = test.id('admin')), 'whose ID is kept'),
       test.eq(min(before->>'role'), 'client', 'before: a client'),
       test.eq(min(after->>'role'), 'support', 'after: an agent')
from public.admin_audit_log where action = 'grant_support' and entity_id = current_setting('test.agent');

-- ------------------------------------------------------------------ no access before the second step, nor without a session
insert into auth.sessions (id, user_id) values ('51000000-0000-4000-8000-000000000001', current_setting('test.agent')::uuid);
insert into auth.refresh_tokens (token, user_id, session_id)
values ('rt-agent-1', current_setting('test.agent'), '51000000-0000-4000-8000-000000000001');

select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001', 'aal1');
select test.fails($$select public.support_list_suggestions()$$, 'mfa_required', 'an agent needs the second step');
select test.fails($$select public.support_search_accounts('Ana')$$, 'mfa_required', 'for the search too');
select test.login(current_setting('test.agent')::uuid);
select test.fails($$select public.support_list_suggestions()$$, 'not_signed_in', 'an access token without a session is refused');
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-0000000000ff');
select test.fails($$select public.support_list_suggestions()$$, 'not_signed_in', 'and one whose session is gone');

-- ------------------------------------------------------------------ an agent: no admin function at all
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001');
do $$
declare
  r record;
  v_args text;
  v_err text;
  v_n int := 0;
begin
  for r in
    select p.oid, p.proname, p.pronargs, p.proargnames from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%'
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    select string_agg(case when a.n = 'p_request_id' then 'gen_random_uuid()' else 'null' end, ', ' order by a.o)
      into v_args
    from unnest(r.proargnames[1:r.pronargs]) with ordinality a(n, o);
    v_err := test.error_of(format('select public.%I(%s)', r.proname, coalesce(v_args, '')));
    if v_err <> 'not_allowed' then
      raise exception 'FAILED: % answered an agent with "%" instead of not_allowed', r.proname, v_err;
    end if;
    v_n := v_n + 1;
  end loop;
  perform test.ok(v_n >= 55, 'every admin_* function refuses an agent (' || v_n || ' checked)');
end
$$;
select test.eq(public.is_admin(), false, 'an agent is not an admin for any policy');
select test.fails($$select public.promote_to_admin('agent@test.local')$$, 'permission denied', 'nor can it promote anyone');
select test.fails($$select public.admin_account_deletion(test.id('admin'), test.id('client_b'))$$, 'permission denied', 'nor delete an account');

-- Its own role, suspension and the audit log are out of reach.
select test.fails(format($$update public.profiles set role = 'admin' where id = %L$$, current_setting('test.agent')),
  'permission denied', 'an agent cannot change its role');
select test.fails(format($$update public.profiles set suspended = false where id = %L$$, current_setting('test.agent')),
  'permission denied', 'nor its suspension');
select test.eq(test.count('select * from public.admin_audit_log'), 0::bigint, 'nor read the audit log');
select test.fails($$insert into public.admin_audit_log (action, entity_type) values ('x', 'y')$$, 'permission denied',
  'nor write it');
select test.fails($$select public.staff_audit('x', 'y', null, null, null)$$, 'permission denied', 'not even through the helper');

-- ------------------------------------------------------------------ an agent: no private data of anyone
do $$
declare
  t text;
begin
  foreach t in array array['bookings', 'threads', 'messages', 'cars', 'quotes', 'quote_items', 'companies',
    'company_members', 'company_vehicles', 'company_subscriptions', 'company_audit_log', 'company_quote_decisions',
    'fleet_expenses', 'fleet_issues', 'fleet_maintenance', 'fleet_odometer_readings', 'shop_billing', 'subscriptions',
    'invoices', 'history_reports', 'report_credits', 'favorites', 'notification_events', 'push_subscriptions',
    'phone_verifications', 'no_show_disputes', 'vehicle_intakes', 'shop_clients', 'shop_client_cars', 'imported_jobs',
    'shop_staff', 'client_referrals', 'shop_referrals', 'request_log', 'rate_events', 'account_fingerprints']
  loop
    if to_regclass('public.' || t) is not null then
      begin
        if test.count(format('select * from public.%I', t)) > 0 then
          raise exception 'FAILED: an agent reads rows of %', t;
        end if;
      exception when insufficient_privilege then
        null; -- no grant at all: fine
      end;
    end if;
  end loop;
end
$$;
select test.eq(test.count('select * from public.profiles'), 1::bigint, 'of the profiles, only its own');
select test.eq(test.count('select * from public.suggestions'), 0::bigint, 'no suggestion row directly (only through support_*)');
select test.eq(test.count('select * from public.list_threads()'), 0::bigint, 'no conversation through the inbox');
select test.eq(jsonb_array_length(public.my_companies()), 0, 'no company');

-- The client, shop and company functions refuse it, even with real ids of other people's rows.
select test.ok(test.error_of(format($$select public.send_message(%L, 'Salut', test.rid())$$, test.id('thread_b'))) <> 'ok',
  'an agent cannot write in a conversation');
select test.ok(test.error_of(format($$select public.booking_thread(%L)$$, test.id('booking_b'))) <> 'ok',
  'nor open one');
select test.ok(test.error_of(format($$select public.mark_thread_read(%L)$$, test.id('thread_b'))) <> 'ok',
  'nor mark one read');
select test.ok(test.error_of(format($$select public.cancel_booking(%L, test.rid())$$, test.id('booking_b'))) <> 'ok',
  'nor cancel a booking');
select test.ok(test.error_of(format($$select public.decide_quote(%L, %L, '{}', test.rid())$$, test.id('booking_a'), test.id('quote_a'))) <> 'ok',
  'nor decide a quote');
select test.ok(test.error_of(format($$select public.submit_review(%L, 5, test.rid(), 'x')$$, test.id('booking_b1'))) <> 'ok',
  'nor write a review');
select test.ok(test.error_of(format($$select public.set_booking_history_share(%L, false, test.rid())$$, test.id('booking_a'))) <> 'ok',
  'nor change a booking');
select test.eq(test.error_of(format($$select public.create_booking(%L, 'ulei', current_date + 3, '10:00', test.rid())$$, test.id('shop1'))),
  'not_allowed', 'nor book');
select test.eq(test.error_of($$select public.create_company('X SRL', null, null, 'Str. X 1', test.rid())$$),
  'company_clients_only', 'nor create a company');
select test.eq(test.error_of(format($$select public.fleet_overview(%L)$$, test.id('co'))),
  'company_clients_only', 'nor open a company''s fleet');
select test.eq(test.error_of($$select public.submit_suggestion('x', test.rid())$$), 'not_allowed', 'nor write a suggestion');
select test.ok(test.error_of(format($$select public.merge_cars(%L, %L, test.rid())$$, test.id('car_a'), test.id('car_b'))) <> 'ok',
  'nor merge other people''s cars');

-- ------------------------------------------------------------------ Căutare
select test.fails($$select public.support_search_accounts('an')$$, 'query_too_short', 'at least 3 characters');
select test.fails($$select public.support_search_accounts(repeat('a', 101))$$, 'query_too_long', 'at most 100');

select test.eq(jsonb_array_length(r->'items'), 1, 'by account ID: one account'),
       test.eq(r->'items'->0->>'id', test.id('client_b')::text, 'the right one'),
       test.eq(r->'items'->0->>'email_masked', 'b***@test.local', 'the email masked'),
       test.eq(r->'items'->0->>'state', 'active', 'and its state'),
       test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(r->'items'->0) k),
               'created_at,display_id,email_masked,email_verified,id,lang,last_active_at,name,phone_last3,role,shop,state',
               'and nothing else: no bookings, cars, companies, billing or messages'),
       test.eq((r->>'more')::boolean, false, 'no more results')
from public.support_search_accounts(lower(current_setting('test.b_display'))) r;
select test.eq(r->'items'->0->>'id', test.id('client_b')::text, 'by the exact email')
from public.support_search_accounts('BOGDAN@test.local') r;
select test.eq(jsonb_array_length(r->'items'), 0, 'not by a part of an email')
from public.support_search_accounts('bogdan@') r;
select test.ok(exists (select 1 from jsonb_array_elements(r->'items') x
                       where x->>'role' = 'shop' and x->'shop'->>'name' = 'Atelier Unu'),
               'by a part of the shop''s name, with the shop')
from public.support_search_accounts('atelier un') r;
select test.eq(jsonb_array_length(r->'items'), 0, 'never an admin account')
from public.support_search_accounts('admin@test.local') r;
select test.eq(jsonb_array_length(r->'items'), 0, 'nor an agent')
from public.support_search_accounts(current_setting('test.e_id')) r;
select test.eq(jsonb_array_length(r->'items'), 0, 'LIKE wildcards are plain characters')
from public.support_search_accounts('%%%') r;

-- ------------------------------------------------------------------ the account card
select test.eq(c->>'display_id', current_setting('test.b_display'), 'the card of a client'),
       test.ok(c ? 'suggestions', 'with its suggestions'),
       test.ok(not (c ? 'bookings') and not (c ? 'cars') and not (c ? 'email') and not (c ? 'phone'),
               'without bookings, cars, the full email or the phone')
from public.support_get_account(test.id('client_b')) c;
select test.fails(format($$select public.support_get_account(%L)$$, test.id('admin')), 'not_found', 'never an admin''s card');
select test.fails(format($$select public.support_get_account(%L)$$, current_setting('test.agent')), 'not_found', 'nor an agent''s');

-- ------------------------------------------------------------------ Solicitări (the suggestions)
select test.logout();
select test.login(test.id('client_b'));
select set_config('test.sugg', (public.submit_suggestion('Vreau notificări pe email', test.rid()))->>'id', true);
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001');
select test.ok(exists (select 1 from jsonb_array_elements(l->'items') x where x->>'id' = current_setting('test.sugg')),
  'the agent reads the suggestions'), test.ok((l->>'new')::int >= 1, 'and how many are new')
from public.support_list_suggestions() l;
select test.fails(format($$select public.support_set_suggestion_status(%L, 'maybe', test.rid())$$, current_setting('test.sugg')),
  'status_invalid', 'only the known states');
select set_config('test.st_rid', gen_random_uuid()::text, true);
select test.eq(r->>'status', 'planned', 'the agent sets a state')
from public.support_set_suggestion_status(current_setting('test.sugg')::uuid, 'planned', current_setting('test.st_rid')::uuid) r;
select test.eq(r->>'status', 'planned', 'the same request id answers the first result')
from public.support_set_suggestion_status(current_setting('test.sugg')::uuid, 'planned', current_setting('test.st_rid')::uuid) r;
select test.logout();
select test.eq(status, 'planned', 'the author sees the new state') from public.suggestions where id = current_setting('test.sugg')::uuid;

-- Every search, opened card and change is in the audit log, under the agent.
select test.eq(count(*) filter (where action = 'support_search'), 7::bigint, 'every search is logged (the refused ones are not)'),
       test.eq(count(*) filter (where action = 'support_view_account'), 1::bigint, 'every opened card'),
       test.eq(count(*) filter (where action = 'update_suggestion'), 1::bigint, 'every change, once'),
       test.eq(count(*) filter (where actor_role = 'support' and actor_display_id = current_setting('test.e_id')), 9::bigint,
               'all under the agent''s role and ID')
from public.admin_audit_log where admin_id = current_setting('test.agent')::uuid;
select test.eq(after->>'q', 'BOGDAN@test.local', 'a search keeps what was searched'),
       test.eq((after->>'results')::int, 1, 'and how many accounts it found')
from public.admin_audit_log
where admin_id = current_setting('test.agent')::uuid and action = 'support_search' and after->>'q' = 'BOGDAN@test.local';

-- 120 searches an hour.
insert into public.rate_events (kind, subject)
select 'support_search', current_setting('test.agent')::uuid from generate_series(1, 120);
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001');
select test.fails($$select public.support_search_accounts('Bogdan')$$, 'limit_searches', 'at most 120 searches an hour');
select test.logout();
delete from public.rate_events where kind = 'support_search';

-- ------------------------------------------------------------------ the admin keeps everything
select test.login(test.id('admin'));
select test.ok(public.admin_overview() is not null, 'the admin still reads the dashboard');
select test.ok(jsonb_array_length(public.admin_list_clients()) >= 2, 'and the clients');
select test.eq(jsonb_array_length(r->'items'), 1, 'the admin may use the agent''s search too')
from public.support_search_accounts(current_setting('test.b_display')) r;
select test.eq(a->'agents'->0->>'display_id', current_setting('test.e_id'), 'the team list shows the agent'),
       test.eq((a->'agents'->0->>'mfa_ready')::boolean, false, 'without its authenticator app yet'),
       test.ok(a->'agents'->0->>'granted_at' is not null, 'with when it was appointed')
from public.admin_list_support_agents() a;
select test.logout();
insert into auth.mfa_factors (id, user_id, factor_type, status)
values ('52000000-0000-4000-8000-000000000001', current_setting('test.agent')::uuid, 'totp', 'verified');
select test.login(test.id('admin'));
select test.eq((a->'agents'->0->>'mfa_ready')::boolean, true, 'and once it set it up')
from public.admin_list_support_agents() a;
select test.ok(exists (select 1 from jsonb_array_elements(l) e
                       where e->>'action' = 'support_search' and e->>'actor_role' = 'support'
                         and e->>'admin_display_id' = current_setting('test.e_id')),
               'the audit list names the agent and its role'),
       test.ok(exists (select 1 from jsonb_array_elements(l) e
                       where e->>'action' = 'grant_support' and e->>'reason' = 'Angajat suport, contract 12'),
               'and the reason of the appointment')
from public.admin_list_audit(null, 200) l;

-- ------------------------------------------------------------------ suspending the agent ends its access at once
select test.ok(public.admin_set_account_suspended(current_setting('test.agent')::uuid, true, 'Verificare', test.rid()) is not null,
  'the admin suspends the agent');
select test.logout();
select test.eq((select count(*) from auth.sessions where user_id = current_setting('test.agent')::uuid), 0::bigint,
  'its sessions end at once');
select test.eq((select count(*) from auth.refresh_tokens where user_id = current_setting('test.agent')), 0::bigint,
  'with their refresh tokens');
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001');
select test.fails($$select public.support_list_suggestions()$$, 'account_suspended', 'a suspended agent is refused');
select test.login(test.id('admin'));
select public.admin_set_account_suspended(current_setting('test.agent')::uuid, false, null, test.rid());
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000001');
select test.fails($$select public.support_list_suggestions()$$, 'not_signed_in', 'reactivated, the old session still does not work');
select test.logout();
insert into auth.sessions (id, user_id) values ('51000000-0000-4000-8000-000000000002', current_setting('test.agent')::uuid);
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000002');
select test.ok(public.support_list_suggestions() is not null, 'a new sign-in works again');

-- An agent cannot delete its own account (the Edge Function runs this as the service role).
select test.logout();
select test.fails(format($$select public.prepare_account_deletion(%L)$$, current_setting('test.agent')), 'not_allowed',
  'an agent cannot delete its own account');

-- ------------------------------------------------------------------ withdrawing the role
select test.login(test.id('admin'));
select test.fails(format($$select public.admin_revoke_support(%L, '', test.rid())$$, current_setting('test.agent')),
  'reason_required', 'withdrawing needs a reason');
select test.fails(format($$select public.admin_revoke_support(%L, 'x', test.rid())$$, test.id('client_b')),
  'not_found', 'only an agent''s role can be withdrawn');
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000002');
select test.fails(format($$select public.admin_revoke_support(%L, 'x', test.rid())$$, current_setting('test.agent')),
  'not_allowed', 'an agent cannot withdraw a role');
select test.login(test.id('admin'));
select test.eq(r->>'role', 'client', 'the admin withdraws the role')
from public.admin_revoke_support(current_setting('test.agent')::uuid, 'Contract încheiat', test.rid()) r;
select test.logout();
select test.eq((select count(*) from auth.sessions where user_id = current_setting('test.agent')::uuid), 0::bigint,
  'its sessions end at once');
select test.eq(role, 'client', 'the account is a client account again'), test.eq(display_id, current_setting('test.e_id'), 'its ID stays')
from public.profiles where id = current_setting('test.agent')::uuid;
select test.login_session(current_setting('test.agent')::uuid, '51000000-0000-4000-8000-000000000002');
select test.fails($$select public.support_list_suggestions()$$, 'not_allowed', 'no support function any more');
select test.fails($$select public.support_search_accounts('Bogdan')$$, 'not_allowed', 'nor the search');
select test.logout();
select test.eq(count(*), 9::bigint, 'every action the agent took is still in the audit log')
from public.admin_audit_log where admin_id = current_setting('test.agent')::uuid;
select test.eq(reason, 'Contract încheiat', 'the withdrawal has its reason'),
       test.eq(actor_role, 'admin', 'made by the admin')
from public.admin_audit_log where action = 'revoke_support' and entity_id = current_setting('test.agent');

select test.login(test.id('admin'));
select test.eq(jsonb_array_length(a->'agents'), 0, 'no agent left'),
       test.eq(a->'former'->0->>'display_id', current_setting('test.e_id'), 'the former agent is listed'),
       test.eq(a->'former'->0->>'reason', 'Contract încheiat', 'with the reason')
from public.admin_list_support_agents() a;

-- Reversible: the same account can be appointed again, with the same ID.
select test.eq(r->>'display_id', current_setting('test.e_id'), 'appointed again, with the same ID')
from public.admin_grant_support('agent@test.local', 'Revine în echipă', test.rid()) r;
select test.eq(jsonb_array_length(a->'former'), 0, 'no longer listed as former')
from public.admin_list_support_agents() a;
select public.admin_revoke_support(current_setting('test.agent')::uuid, 'Final', test.rid());
select test.logout();

-- The history keeps the author after the account is gone.
select test.ok(public.prepare_account_deletion(current_setting('test.agent')::uuid) is not null,
  'withdrawn, the account can be deleted');
delete from auth.users where id = current_setting('test.agent')::uuid;
select test.login(test.id('admin'));
select test.ok(exists (select 1 from jsonb_array_elements(l) e
                       where e->>'action' = 'support_search' and e->>'admin_display_id' = current_setting('test.e_id')
                         and e->>'actor_role' = 'support'),
               'after the account is deleted, its entries still name the agent')
from public.admin_list_audit(null, 200) l;

rollback;
