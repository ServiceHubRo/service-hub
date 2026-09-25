-- Admin (T16a, FR §5.1–5.5, §5.8): only an admin reads the platform-wide screens and takes the
-- actions; every action is idempotent, changes what it says, tells the people concerned and
-- writes the audit log with the values before and after.
begin;
select test.make_world();

-- ------------------------------------------------------------------ only an admin
select test.login(test.id('client_a'));
select test.fails($$select public.admin_overview()$$, 'not_allowed', 'a client cannot read the overview');
select test.fails($$select public.admin_list_shops()$$, 'not_allowed', 'nor the shops');
select test.fails($$select public.admin_get_shop(test.id('shop1'))$$, 'not_allowed', 'nor a shop');
select test.fails($$select public.admin_list_clients()$$, 'not_allowed', 'nor the clients');
select test.fails($$select public.admin_get_client(test.id('client_b'))$$, 'not_allowed', 'nor another client');
select test.fails($$select public.admin_list_bookings()$$, 'not_allowed', 'nor all bookings');
select test.fails($$select public.admin_get_booking(test.id('booking_b'))$$, 'not_allowed', 'nor a booking');
select test.fails($$select public.admin_get_thread(test.id('thread_b'))$$, 'not_allowed', 'nor a conversation');
select test.fails($$select public.admin_list_reviews()$$, 'not_allowed', 'nor the moderation queue');
select test.fails($$select public.admin_list_audit()$$, 'not_allowed', 'nor the audit log');
select test.fails($$select public.admin_verify_phone(test.id('owner2'), test.rid())$$, 'not_allowed', 'nor verify a phone');
select test.fails($$select public.admin_set_shop_suspended(test.id('shop1'), true, 'x', test.rid())$$, 'not_allowed', 'nor suspend a shop');
select test.fails($$select public.admin_set_account_suspended(test.id('client_b'), true, 'x', test.rid())$$, 'not_allowed', 'nor suspend an account');
select test.fails($$select public.admin_update_shop(test.id('shop1'), '{"name":"X"}', null, test.rid())$$, 'not_allowed', 'nor edit a shop');
select test.fails($$select public.admin_extend_trial(test.id('shop1'), 30, test.rid())$$, 'not_allowed', 'nor extend a trial');
select test.fails($$select public.admin_set_subscription_status(test.id('shop1'), 'active', test.rid())$$, 'not_allowed', 'nor set a plan status');
select test.fails($$select public.admin_decide_review(gen_random_uuid(), 'keep', null, test.rid())$$, 'not_allowed', 'nor moderate');
select test.eq(test.count('select * from public.admin_audit_log'), 0::bigint, 'nor read the audit table');
select test.fails($$select public.admin_account_deletion(test.id('client_a'), test.id('client_b'))$$, 'permission denied',
  'account deletion is not callable from the browser');

select test.login(test.id('owner1'));
select test.fails($$select public.admin_overview()$$, 'not_allowed', 'a shop owner cannot read the overview');
select test.fails($$select public.admin_set_shop_suspended(test.id('shop2'), true, 'x', test.rid())$$, 'not_allowed',
  'nor suspend another shop');

select test.login_anon();
select test.fails($$select public.admin_overview()$$, 'permission denied', 'signed out: not callable at all');
select test.fails($$select public.touch_last_active()$$, 'permission denied', 'signed out: no activity stamp');

-- A suspended admin is refused like anyone suspended.
select test.logout();
update public.profiles set suspended = true where id = test.id('admin');
select test.login(test.id('admin'));
select test.fails($$select public.admin_overview()$$, 'account_suspended', 'a suspended admin is refused');
select test.logout();
update public.profiles set suspended = false where id = test.id('admin');

-- ------------------------------------------------------------------ reads
select test.login(test.id('admin'));

select test.eq((o->'shops'->>'trial')::int, 2, 'both shops in their free period'),
       test.eq((o->'shops'->>'total')::int, 2, 'two shops'),
       test.eq((o->'shops'->>'suspended')::int, 0, 'none suspended'),
       test.eq((o->>'clients')::int, 2, 'two clients (staff and admin are not clients)'),
       test.eq((o->>'reports_pending')::int, 0, 'no report waiting'),
       test.eq((o->'bookings'->'month'->>'total')::int, 3, 'three bookings made this month'),
       test.eq((o->'bookings'->'month'->'by_status'->>'done')::int, 2, 'two of them done'),
       test.eq((o->'subscriptions'->>'mrr')::numeric, 0::numeric, 'nobody pays yet'),
       test.ok(jsonb_array_length(o->'activity') between 1 and 50, 'recent activity, at most 50'),
       test.ok(exists (select 1 from jsonb_array_elements(o->'activity') a where a->>'kind' = 'booking_created'),
               'new bookings are in the activity feed')
from public.admin_overview() o;

select test.eq(jsonb_array_length(l), 2, 'both shops listed'),
       test.eq((select x->>'email' from jsonb_array_elements(l) x where x->>'id' = test.id('shop1')::text),
               'owner1@test.local', 'with the owner''s email'),
       test.eq((select (x->>'phone_verified')::boolean from jsonb_array_elements(l) x where x->>'id' = test.id('shop2')::text),
               false, 'and whether the phone is verified'),
       test.eq((select x->>'state' from jsonb_array_elements(l) x where x->>'id' = test.id('shop1')::text),
               'trial', 'and the state')
from public.admin_list_shops() l;

select test.eq(s->'billing'->>'legal_name', 'AUTO UNU SRL', 'the shop detail has the fiscal data'),
       test.eq((s->>'public')::boolean, true, 'shop1 is public'),
       test.eq(jsonb_array_length(s->'reasons'), 0, 'with nothing missing'),
       test.eq(jsonb_array_length(s->'staff'), 2, 'owner and staff'),
       test.eq(jsonb_array_length(s->'services'), 2, 'two services'),
       test.eq(jsonb_array_length(s->'hours'), 7, 'the week''s hours'),
       test.eq(jsonb_array_length(s->'reviews'), 2, 'the removed review too'),
       test.eq(s->'owner'->>'email', 'owner1@test.local', 'the owner''s email')
from public.admin_get_shop(test.id('shop1')) s;
select test.ok((s->'reasons') ? 'phone_unverified' and (s->'reasons') ? 'no_services',
  'shop2 says why it is hidden') from public.admin_get_shop(test.id('shop2')) s;
select test.fails($$select public.admin_get_shop(gen_random_uuid())$$, 'shop_not_found', 'an unknown shop');

select test.eq(jsonb_array_length(l), 2, 'two clients listed'),
       test.eq((select (x->>'bookings')::int from jsonb_array_elements(l) x where x->>'id' = test.id('client_b')::text),
               2, 'with their booking count'),
       test.eq((select x->>'email' from jsonb_array_elements(l) x where x->>'id' = test.id('client_a')::text),
               'ana@test.local', 'and email')
from public.admin_list_clients() l;

select test.eq(jsonb_array_length(c->'cars'), 1, 'the client''s cars'),
       test.eq(jsonb_array_length(c->'bookings'), 1, 'bookings'),
       test.eq(jsonb_array_length(c->'reviews'), 1, 'reviews'),
       test.eq(jsonb_array_length(c->'threads'), 1, 'conversations'),
       test.eq((c->'threads'->0->>'messages')::int, 2, 'with their message count')
from public.admin_get_client(test.id('client_a')) c;
select test.fails($$select public.admin_get_client(test.id('owner1'))$$, 'not_found', 'a shop account is not a client');

select test.eq((b->>'total')::int, 3, 'all bookings') from public.admin_list_bookings() b;
select test.eq((b->>'total')::int, 1, 'filtered by status') from public.admin_list_bookings(array['pending']) b;
select test.eq(b->'bookings'->0->>'id', test.id('booking_a')::text, 'found by plate, as typed')
from public.admin_list_bookings(p_q => 'bv 12') b;
select test.eq((b->>'total')::int, 2, 'found by shop name, without diacritics') from public.admin_list_bookings(p_q => 'atelier unu') b;
select test.eq((b->>'total')::int, 2, 'found by client') from public.admin_list_bookings(p_q => 'bogdan') b;
select test.eq((b->>'total')::int, 1, 'by shop and status')
from public.admin_list_bookings(array['done'], test.id('shop1'), test.id('client_b')) b;
select test.eq((b->>'total')::int, 1, 'by appointment day')
from public.admin_list_bookings(p_from => test.today(), p_to => test.today() + 30) b;
select test.eq(jsonb_array_length(b->'bookings'), 1, 'at most the limit asked, with the full total'),
       test.eq((b->>'total')::int, 3, 'total')
from public.admin_list_bookings(p_limit => 1) b;

select test.eq(jsonb_array_length(b->'quotes'), 1, 'the booking''s quote'),
       test.eq(jsonb_array_length(b->'quotes'->0->'items'), 2, 'with its lines'),
       test.eq(jsonb_array_length(b->'messages'), 2, 'the conversation'),
       test.eq((select string_agg(m->>'side', ',' order by m->>'side') from jsonb_array_elements(b->'messages') m),
               'client,system', 'an automatic message and the client''s own'),
       test.eq((b->'review'->>'rating')::int, 5, 'the review'),
       test.eq(b->'client'->>'email', 'ana@test.local', 'the client')
from public.admin_get_booking(test.id('booking_a')) b;
select test.eq(jsonb_array_length(t->'messages'), 1, 'any conversation, read-only'),
       test.eq(t->'thread'->>'shop_name', 'Atelier Doi', 'with the shop')
from public.admin_get_thread(test.id('thread_b')) t;

-- ------------------------------------------------------------------ verify a phone
select test.logout();
delete from public.admin_audit_log;
delete from public.notification_events;
select test.login(test.id('admin'));
select set_config('test.rid', gen_random_uuid()::text, true);
select public.admin_verify_phone(test.id('owner2'), current_setting('test.rid')::uuid);
select public.admin_verify_phone(test.id('owner2'), current_setting('test.rid')::uuid);
select test.fails($$select public.admin_verify_phone(test.id('owner2'), test.rid())$$, 'phone_already_verified',
  'a verified phone is not verified twice');
select test.logout();
select test.eq(phone_verified_by_admin, true, 'the phone is verified') from public.profiles where id = test.id('owner2');
select test.eq(count(*), 1::bigint, 'one audit row for the repeated tap'),
       test.eq(max(before->>'phone_verified_by_admin'), 'false', 'before'),
       test.eq(max(after->>'phone_verified_by_admin'), 'true', 'after'),
       test.eq(max(admin_id::text), test.id('admin')::text, 'who')
from public.admin_audit_log where action = 'verify_phone' and entity_id = test.id('owner2')::text;

-- ------------------------------------------------------------------ suspend a shop
select test.login(test.id('admin'));
select test.fails($$select public.admin_set_shop_suspended(test.id('shop1'), true, '  ', test.rid())$$, 'reason_required',
  'suspending needs a reason');
select public.admin_set_shop_suspended(test.id('shop1'), true, 'Reclamații repetate', test.rid());
select test.fails($$select public.admin_set_shop_suspended(test.id('shop1'), true, 'x', test.rid())$$, 'wrong_status',
  'an already suspended shop');
select test.ok(not public.is_shop_public(test.id('shop1')), 'a suspended shop leaves search at once');
select test.eq((select x->>'state' from jsonb_array_elements(public.admin_list_shops()) x
                where x->>'id' = test.id('shop1')::text), 'suspended', 'its state');
select test.logout();
select test.eq(count(*), 1::bigint, 'the owner gets the suspension email')
from public.notification_events where user_id = test.id('owner1') and event = 'account_suspended';
select test.eq(after->>'reason', 'Reclamații repetate', 'the reason is in the log')
from public.admin_audit_log where action = 'suspend_shop';

select test.login(test.id('client_a'));
select test.fails(format($$select public.create_booking(%L, 'ulei', %L, '10:00', %L, p_car_id => %L)$$,
  test.id('shop1'), test.workday(1), gen_random_uuid(), test.id('car_a')), 'shop_unavailable',
  'nobody can book a suspended shop');

select test.login(test.id('admin'));
select public.admin_set_shop_suspended(test.id('shop1'), false, null, test.rid());
select test.ok(public.is_shop_public(test.id('shop1')), 'reactivated: back in search');

-- ------------------------------------------------------------------ suspend an account
select public.admin_set_account_suspended(test.id('client_a'), true, 'Abuz', test.rid());
select test.login(test.id('client_a'));
select test.fails($$select public.toggle_favorite(test.id('shop1'), test.rid())$$, 'account_suspended',
  'a suspended client can do nothing');
select test.login(test.id('admin'));
select test.fails($$select public.admin_set_account_suspended(test.id('admin'), true, 'x', test.rid())$$, 'not_found',
  'an admin account is not suspended from here');
select public.admin_set_account_suspended(test.id('client_a'), false, null, test.rid());
select test.login(test.id('client_a'));
select test.ok(public.toggle_favorite(test.id('shop1'), test.rid()), 'reactivated: the client acts again');
select test.logout();
select test.eq(count(*), 2::bigint, 'suspend and reactivate are both logged')
from public.admin_audit_log where entity_id = test.id('client_a')::text and action in ('suspend_account', 'unsuspend_account');

-- ------------------------------------------------------------------ edit a shop
select test.login(test.id('admin'));
select test.eq(test.error_of($$select public.admin_update_shop(test.id('shop1'), '{"owner_id":"x"}', null, test.rid())$$),
  'field_invalid', 'only the listed fields can be edited');
select test.eq(test.error_params($$select public.admin_update_shop(test.id('shop1'), null, '{"iban":"RO00XXXX"}', test.rid())$$)->>'field',
  'iban', 'an invalid IBAN names the field');
select test.eq(test.error_params($$select public.admin_update_shop(test.id('shop1'), '{"daily_capacity":0}', null, test.rid())$$)->>'field',
  'daily_capacity', 'a capacity out of range names the field');
select test.eq(test.error_params($$select public.admin_update_shop(test.id('shop1'), '{"name":" "}', null, test.rid())$$)->>'field',
  'name', 'the name cannot be emptied');
select test.eq(test.error_of($$select public.admin_update_shop(test.id('shop1'), '{"daily_capacity":"abc"}', null, test.rid())$$),
  'field_invalid', 'a number field refuses text');

select test.eq((r->>'address_changed')::boolean, true, 'a new city is an address change'),
       test.eq(r->'shop'->>'name', 'Atelier Unu Plus', 'saved, trimmed'),
       test.eq(r->'billing'->>'legal_rep', 'Maria Popescu', 'fiscal data too'),
       test.ok(r->'shop'->'website' = 'null'::jsonb, 'an emptied field becomes not set')
from public.admin_update_shop(test.id('shop1'),
  '{"name":" Atelier Unu Plus ","city":"Codlea","daily_capacity":8,"website":""}',
  '{"legal_rep":"Maria Popescu"}', test.rid()) r;
select test.eq((r->>'address_changed')::boolean, false, 'no address change')
from public.admin_update_shop(test.id('shop1'), '{"inspection_fee":50}', null, test.rid()) r;
select test.logout();
select test.eq(before, '{"city": "Brașov", "name": "Atelier Unu", "daily_capacity": 5, "billing": {"legal_rep": "Ion Popescu"}}'::jsonb,
               'only what changed, before'),
       test.eq(after, '{"city": "Codlea", "name": "Atelier Unu Plus", "daily_capacity": 8, "billing": {"legal_rep": "Maria Popescu"}}'::jsonb,
               'and after')
from public.admin_audit_log where action = 'update_shop' and after ? 'name';

-- ------------------------------------------------------------------ the free period and the plan status
update public.subscriptions set trial_ends_at = now() - interval '1 day' where shop_id = test.id('shop1');
select public.end_expired_trials();
select test.ok(not public.is_shop_public(test.id('shop1')), 'an ended free period hides the shop');
delete from public.notification_events;

select test.login(test.id('admin'));
select test.fails($$select public.admin_extend_trial(test.id('shop1'), 0, test.rid())$$, 'days_invalid', 'at least one day');
select test.fails($$select public.admin_extend_trial(test.id('shop1'), 400, test.rid())$$, 'days_invalid', 'at most a year');
select test.eq(r->>'status', 'trial', 'extended: in the free period again'),
       test.ok((r->>'trial_ends_at')::timestamptz between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour',
               '30 days from today (the old end had passed)')
from public.admin_extend_trial(test.id('shop1'), 30, test.rid()) r;
select test.ok(public.is_shop_public(test.id('shop1')), 'and back in search');
select test.ok((r->>'trial_ends_at')::timestamptz > now() + interval '44 days', 'a second extension adds to the end')
from public.admin_extend_trial(test.id('shop1'), 15, test.rid()) r;

select test.fails($$select public.admin_set_subscription_status(test.id('shop1'), 'trial', test.rid())$$, 'status_invalid',
  'the free period is set by extending it');
select test.eq(r->>'status', 'inactive', 'stopped by hand'),
       test.eq(r->>'ended_reason', 'admin', 'says it was the admin')
from public.admin_set_subscription_status(test.id('shop1'), 'inactive', test.rid()) r;
select test.ok(not public.is_shop_public(test.id('shop1')), 'an inactive shop leaves search');
select test.fails($$select public.admin_set_subscription_status(test.id('shop1'), 'inactive', test.rid())$$, 'wrong_status',
  'the same status twice');
select test.logout();
select test.eq(params->>'reason', 'admin', 'the owner is told, with the reason')
from public.notification_events where user_id = test.id('owner1') and event = 'shop_inactive';
select test.login(test.id('admin'));
select test.eq(r->>'status', 'active', 'marked active'),
       test.ok(r->'ended_reason' = 'null'::jsonb, 'no end reason any more')
from public.admin_set_subscription_status(test.id('shop1'), 'active', test.rid()) r;
select test.ok(public.is_shop_public(test.id('shop1')), 'an active shop is public');
-- 100 lei + one colleague with an account (staff1) × 20 lei.
select test.eq((public.admin_overview()->'subscriptions'->>'mrr')::numeric, 120::numeric, 'it counts in the monthly revenue, with its colleague');

select test.logout();
update public.subscriptions set stripe_status = 'active', stripe_subscription_id = 'sub_1' where shop_id = test.id('shop1');
select test.login(test.id('admin'));
select test.fails($$select public.admin_extend_trial(test.id('shop1'), 10, test.rid())$$, 'subscription_in_stripe',
  'a subscription running in Stripe is changed in Stripe');
select test.logout();
select test.eq(count(*), 4::bigint, 'every plan change is logged')
from public.admin_audit_log where entity_id = test.id('shop1')::text and action in ('extend_trial', 'set_subscription_status');

-- ------------------------------------------------------------------ moderation
select test.login(test.id('owner1'));
select public.report_review((select id from public.reviews where booking_id = test.id('booking_a')), 'abusive', test.rid());
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(l->'queue'), 1, 'the reported review waits in the queue'),
       test.eq(l->'queue'->0->>'shop_name', 'Atelier Unu Plus', 'with its shop'),
       test.eq(l->'queue'->0->>'report_reason', 'abusive', 'and the reason'),
       test.eq(jsonb_array_length(l->'reviews'), 2, 'every review below it')
from public.admin_list_reviews() l;
select test.eq(jsonb_array_length(l->'reviews'), 1, 'the review list is searchable') from public.admin_list_reviews('prompt') l;
select test.eq((public.admin_overview()->>'reports_pending')::int, 1, 'the overview counts it');

select test.logout();
delete from public.notification_events;
select test.login(test.id('admin'));
select test.fails(format($$select public.admin_decide_review(%L, 'maybe', null, test.rid())$$,
  (select id from public.reviews where booking_id = test.id('booking_a'))), 'decision_invalid', 'keep or remove only');
select test.eq(r->>'report_status', 'kept', 'kept'),
       test.ok(r->'removed_at' = 'null'::jsonb, 'still visible')
from public.admin_decide_review((select id from public.reviews where booking_id = test.id('booking_a')), 'keep',
  'Opinie legitimă', test.rid()) r;
select test.fails(format($$select public.admin_decide_review(%L, 'remove', null, test.rid())$$,
  (select id from public.reviews where booking_id = test.id('booking_a'))), 'wrong_status', 'a decided report is closed');
select test.logout();
select test.eq(count(*), 2::bigint, 'the shop''s members are told')
from public.notification_events where event = 'review_report_decided' and user_id in (test.id('owner1'), test.id('staff1'));
select test.eq(count(*), 0::bigint, 'the client is not told about a kept review')
from public.notification_events where event = 'review_report_decided' and user_id = test.id('client_a');
select test.eq(report_note, 'Opinie legitimă', 'the note is kept') from public.reviews where booking_id = test.id('booking_a');

-- Removing one: out of the average, the client is told.
update public.reviews set report_status = null, report_decided_at = null, reported_at = null, report_reason = null
where booking_id = test.id('booking_a');
select test.login(test.id('owner1'));
select public.report_review((select id from public.reviews where booking_id = test.id('booking_a')), 'fake', test.rid());
select test.login(test.id('admin'));
select test.eq((select review_count from public.shop_ratings where shop_id = test.id('shop1')), 1, 'counted before');
select test.ok(r->>'removed_at' is not null, 'removed')
from public.admin_decide_review((select id from public.reviews where booking_id = test.id('booking_a')), 'remove', null, test.rid()) r;
select test.eq((select review_count from public.shop_ratings where shop_id = test.id('shop1')), 0, 'the average no longer counts it');
select test.logout();
select test.eq(count(*), 1::bigint, 'the client is told their review was removed')
from public.notification_events where event = 'review_report_decided' and user_id = test.id('client_a');
select test.eq(count(*), 2::bigint, 'both decisions are logged')
from public.admin_audit_log where action in ('keep_review', 'remove_review');

-- ------------------------------------------------------------------ force-cancel and the audit log screen
select test.login(test.id('admin'));
select public.admin_force_cancel(test.id('booking_b'), 'Service închis temporar', test.rid());
select test.eq(jsonb_array_length(b->'audit'), 1, 'the booking detail shows its audit entry'),
       test.eq(b->'audit'->0->>'admin_display_id', (select display_id from public.profiles where id = test.id('admin')),
               'with the admin''s account id')
from public.admin_get_booking(test.id('booking_b')) b;
select test.ok(jsonb_array_length(a) >= 10, 'the audit log lists every action'),
       test.eq((select e->>'label' from jsonb_array_elements(a) e where e->>'action' = 'admin_force_cancel'),
               (select ref from public.bookings where id = test.id('booking_b')), 'with a label')
from public.admin_list_audit() a;
select test.eq(jsonb_array_length(public.admin_list_audit(p_limit => 2)), 2, 'a page at a time');
select test.eq(jsonb_array_length(public.admin_list_audit(now() - interval '1 day')), 0, 'older pages by time');
select test.ok(jsonb_array_length(s->'audit') >= 6, 'the shop detail shows its own entries')
from public.admin_get_shop(test.id('shop1')) s;

-- ------------------------------------------------------------------ deleting an account (service role)
select test.logout();
select test.fails($$select public.admin_account_deletion(test.id('client_a'), test.id('client_b'))$$, 'not_allowed',
  'only an admin may delete someone');
select test.fails($$select public.admin_account_deletion(test.id('admin'), test.id('admin'))$$, 'not_allowed',
  'an admin account is not deleted here');
select test.fails($$select public.admin_account_deletion(test.id('admin'), gen_random_uuid())$$, 'not_found', 'an unknown account');
insert into public.bookings (shop_id, client_id, service_id, client_name, car_snapshot, date, slot, status)
values (test.id('shop2'), test.id('client_b'), 'ulei', 'Bogdan Pop', '{}', current_date + 5, '09:00', 'confirmed');
select test.fails($$select public.admin_account_deletion(test.id('admin'), test.id('client_b'))$$, 'account_has_active_bookings',
  'an account with active bookings is refused');
select test.fails($$select public.admin_account_deletion(test.id('admin'), test.id('owner2'))$$, 'shop_has_active_bookings',
  'a shop with active bookings too');
select test.eq(public.admin_account_deletion(test.id('admin'), test.id('client_a')), 'delete', 'a client is deleted');
select test.eq(before->>'email', 'ana@test.local', 'who it was, in the log'),
       test.eq(after->>'mode', 'delete', 'and how'),
       test.eq(admin_id, test.id('admin'), 'by whom')
from public.admin_audit_log where action = 'delete_account' and entity_id = test.id('client_a')::text;
select test.eq(public.admin_account_deletion(test.id('admin'), test.id('owner1')), 'anonymize',
  'a shop with records is anonymized');
select test.eq(entity_type, 'shop', 'logged on the shop') from public.admin_audit_log
where action = 'delete_account' and entity_id = test.id('shop1')::text;
select test.eq(public.shop_state(test.id('shop1')), 'deleted', 'its state');

-- ------------------------------------------------------------------ last activity
select test.login(test.id('client_b'));
select public.touch_last_active();
select test.logout();
select test.ok(last_active_at > now() - interval '1 minute', 'stamped') from public.profiles where id = test.id('client_b');
update public.profiles set last_active_at = now() - interval '10 minutes' where id = test.id('client_b');
select test.login(test.id('client_b'));
select public.touch_last_active();
select test.logout();
select test.ok(last_active_at < now() - interval '9 minutes', 'at most once an hour') from public.profiles where id = test.id('client_b');

rollback;
