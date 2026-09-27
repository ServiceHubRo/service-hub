-- Admin platform tools (T16b, FR §5.6–5.11): only an admin reads and changes them; every change is
-- idempotent and audited; settings apply only to records made after the change.
begin;
select test.make_world();

-- ------------------------------------------------------------------ only an admin
select test.login(test.id('client_a'));
select test.fails($$select public.admin_list_subscriptions()$$, 'not_allowed', 'a client cannot list subscriptions');
select test.fails($$select public.admin_set_subscription_price(test.id('shop1'), 50, test.rid())$$, 'not_allowed', 'nor set a price');
select test.fails($$select public.admin_list_history_reports()$$, 'not_allowed', 'nor list reports');
select test.fails($$select public.admin_void_history_report(gen_random_uuid(), 'x', test.rid())$$, 'not_allowed', 'nor void one');
select test.fails($$select public.admin_list_catalog()$$, 'not_allowed', 'nor read the catalog tool');
select test.fails($$select public.admin_create_category('cat_x', 'X', 'X', test.rid())$$, 'not_allowed', 'nor add a category');
select test.fails($$select public.admin_update_category('cat_rev', 'X', 'X', false, test.rid())$$, 'not_allowed', 'nor change one');
select test.fails($$select public.admin_create_service('x_new', 'cat_rev', null, 'X', 'X', test.rid())$$, 'not_allowed', 'nor add a service');
select test.fails($$select public.admin_update_service('ulei', 'cat_rev', null, 'X', 'X', false, test.rid())$$, 'not_allowed', 'nor change one');
select test.fails($$select public.admin_move_catalog_item('category', 'cat_rev', 1, test.rid())$$, 'not_allowed', 'nor reorder');
select test.fails($$select public.admin_update_settings('{"trial_days":1}', test.rid())$$, 'not_allowed', 'nor change settings');
select test.fails($$select public.admin_set_notification_text('client.quote_sent', 'X', null, null, null, test.rid())$$,
  'not_allowed', 'nor a notification text');
select test.fails($$select public.admin_notice_preview('all', null)$$, 'not_allowed', 'nor preview a notice');
select test.fails($$select public.admin_send_notice('all', null, 'X', 'Y', null, null, false, test.rid())$$, 'not_allowed', 'nor send one');
select test.fails($$select public.admin_list_notices()$$, 'not_allowed', 'nor list them');
select test.fails($$select public.admin_withdraw_notice(gen_random_uuid(), test.rid())$$, 'not_allowed', 'nor withdraw one');
select test.fails($$select public.admin_export('clients')$$, 'not_allowed', 'nor export');
select test.fails($$update public.platform_settings set trial_days = 1$$, 'permission denied', 'settings are not writable directly');
select test.fails($$update public.services set enabled = false where id = 'ulei'$$, 'permission denied', 'nor the catalog');

select test.login(test.id('owner1'));
select test.fails($$select public.admin_export('shops')$$, 'not_allowed', 'a shop cannot export');
select test.fails($$select public.admin_update_settings('{"trial_days":1}', test.rid())$$, 'not_allowed', 'nor change settings');

select test.login_anon();
select test.fails($$select public.admin_list_catalog()$$, 'permission denied', 'signed out: not callable');

-- ------------------------------------------------------------------ subscriptions and invoices
select test.login(test.id('admin'));
select test.eq(jsonb_array_length(l->'subscriptions'), 2, 'every subscription listed'),
       test.eq((select x->>'status' from jsonb_array_elements(l->'subscriptions') x where x->>'shop_id' = test.id('shop1')::text),
               'trial', 'with its status'),
       test.eq((select (x->>'next_billing')::timestamptz = (x->>'trial_ends_at')::timestamptz
                from jsonb_array_elements(l->'subscriptions') x where x->>'shop_id' = test.id('shop1')::text),
               true, 'the next billing of a trial is its end'),
       test.eq(jsonb_array_length(l->'invoices'), 0, 'no payments yet')
from public.admin_list_subscriptions() l;

select set_config('test.rid_price', test.rid()::text, true);
select test.eq((public.admin_set_subscription_price(test.id('shop1'), 79.5, current_setting('test.rid_price')::uuid))->>'price_ron',
               '79.50', 'a founder''s price set by hand');
select test.eq((public.admin_set_subscription_price(test.id('shop1'), 60, current_setting('test.rid_price')::uuid))->>'price_ron',
               '79.50', 'the same tap again changes nothing');
select test.eq(price_ron, 79.50::numeric(10,2), 'stored') from public.subscriptions where shop_id = test.id('shop1');
select test.eq(count(*), 1::bigint, 'logged once with before and after')
from public.admin_audit_log where action = 'set_subscription_price' and entity_id = test.id('shop1')::text
  and before->>'price_ron' = '100.00' and after->>'price_ron' = '79.50';
select test.eq(test.error_params($$select public.admin_set_subscription_price(test.id('shop1'), 0, test.rid())$$)->>'field',
               'price_ron', 'a price under 1 leu is refused');
select test.logout();
update public.subscriptions set stripe_status = 'trialing' where shop_id = test.id('shop2');
select test.login(test.id('admin'));
select test.fails($$select public.admin_set_subscription_price(test.id('shop2'), 50, test.rid())$$, 'subscription_in_stripe',
  'refused while Stripe runs the subscription');

-- ------------------------------------------------------------------ history reports
select set_config('test.report', (select id::text from public.history_reports limit 1), true);
select test.eq(jsonb_array_length(l), 1, 'every report listed'),
       test.eq(l->0->>'client_display_id', (select display_id from public.profiles where id = test.id('client_a')), 'with the client')
from public.admin_list_history_reports() l;
select test.fails(format($$select public.admin_void_history_report('%s', '  ', test.rid())$$, current_setting('test.report')),
  'reason_required', 'voiding needs a reason');
select test.eq((public.admin_void_history_report(current_setting('test.report')::uuid, 'Emis greșit', test.rid()))->>'status',
               'void', 'a report issued in error is voided');
select test.eq(status || '|' || void_reason, 'void|Emis greșit', 'with its reason'),
       test.ok(voided_at is not null, 'and when')
from public.history_reports where id = current_setting('test.report')::uuid;
select test.eq((public.verify_report((select code from public.history_reports where id = current_setting('test.report')::uuid)))->>'void',
               'true', '/verifica says it is void');
select test.fails(format($$select public.admin_void_history_report('%s', 'x', test.rid())$$, current_setting('test.report')),
  'wrong_status', 'a void report cannot be voided again');
select test.logout();
select test.fails(format($$select public.history_report_for('%s', '%s')$$, test.id('client_a'), current_setting('test.report')),
  'report_void', 'the client can no longer download it');
select test.login(test.id('admin'));
select test.eq(count(*), 1::bigint, 'voiding is logged')
from public.admin_audit_log where action = 'void_report' and entity_id = current_setting('test.report');

-- ------------------------------------------------------------------ catalog
select test.eq(jsonb_array_length(c), 19, 'every category'),
       test.eq((select (s->>'shops')::int from jsonb_array_elements(c->0->'services') s where s->>'id' = 'ulei'), 1,
               'how many shops offer a service'),
       test.eq((select (s->>'bookings')::int from jsonb_array_elements(c->0->'services') s where s->>'id' = 'ulei'), 2,
               'and how many bookings use it')
from public.admin_list_catalog() c;

select test.eq(test.error_params($$select public.admin_create_category('Revizii', 'X', 'X', test.rid())$$)->>'field',
               'category_key', 'a category key is cat_ + simple letters');
select test.eq(test.error_params($$select public.admin_create_category('cat_nou', ' ', 'New', test.rid())$$)->>'field',
               'name_ro', 'names are required');
select test.eq((public.admin_create_category('cat_nou', 'Categorie nouă', 'New category', test.rid()))->>'position',
               '20', 'a new category goes to the end');
select test.fails($$select public.admin_create_category('cat_nou', 'A', 'B', test.rid())$$, 'key_taken', 'keys are unique');

select test.eq(test.error_params($$select public.admin_create_service('Ulei nou', 'cat_nou', null, 'X', 'X', test.rid())$$)->>'field',
               'service_id', 'a service id is simple letters');
select test.eq(test.error_params($$select public.admin_create_service('test_polish_x', 'cat_nou', 'bad icon', 'X', 'X', test.rid())$$)->>'field',
               'icon', 'an icon is a Lucide name');
select test.fails($$select public.admin_create_service('test_polish_x', 'cat_none', null, 'X', 'X', test.rid())$$, 'category_not_found',
  'the category must exist');
select test.fails($$select public.admin_create_service('ulei', 'cat_nou', null, 'X', 'X', test.rid())$$, 'key_taken', 'ids are unique');
select test.eq((public.admin_create_service('test_polish_x', 'cat_nou', 'Sparkles', 'Polish faruri', 'Headlight polish', test.rid()))->>'enabled',
               'true', 'a new service');

-- Renaming never changes the id; old bookings keep pointing at it.
select public.admin_update_service('ulei', 'cat_rev', 'Droplet', 'Schimb ulei', 'Oil change', true, test.rid());
select test.eq(name_ro || '|' || name_en, 'Schimb ulei|Oil change', 'renamed') from public.services where id = 'ulei';
select test.eq(count(*), 2::bigint, 'bookings still point at the same id') from public.bookings where service_id = 'ulei';
select test.eq(count(*), 1::bigint, 'the rename is logged with before and after')
from public.admin_audit_log where action = 'update_service' and entity_id = 'ulei'
  and before->>'name_ro' = 'Schimb ulei + filtru ulei' and after->>'name_ro' = 'Schimb ulei';

-- Switching a service off: shops can no longer book it; the bookings that have it stay.
select public.admin_update_service('frane', 'cat_fra', 'Disc', (select name_ro from public.services where id = 'frane'),
  (select name_en from public.services where id = 'frane'), false, test.rid());
select test.eq(test.error_of(format($$select test.book('%s', '%s', test.workday(2), '10:00', 'frane')$$,
  test.id('client_a'), test.id('shop1'))), 'service_unavailable', 'a switched-off service cannot be booked');
select test.eq(count(*), 1::bigint, 'its old booking stays') from public.bookings where service_id = 'frane';

-- Switching a category off switches its services off; one of them cannot be switched on alone.
select test.eq((public.admin_update_category('cat_nou', 'Categorie nouă', 'New category', false, test.rid()))->>'services_off',
               '1', 'the category''s services are switched off with it');
select test.eq(enabled, false, 'polish is off') from public.services where id = 'test_polish_x';
select test.fails($$select public.admin_update_service('test_polish_x', 'cat_nou', 'Sparkles', 'Polish faruri', 'Headlight polish', true, test.rid())$$,
  'category_disabled', 'a service cannot be on in a category that is off');
select test.eq((public.admin_update_service('test_polish_x', 'cat_rev', 'Sparkles', 'Polish faruri', 'Headlight polish', true, test.rid()))->>'category_key',
               'cat_rev', 'moved to a category that is on, it can be switched on');
select test.eq(position, (select max(position) from public.services where category_key = 'cat_rev'), 'at the end of its new category')
from public.services where id = 'test_polish_x';

-- Reordering.
select public.admin_move_catalog_item('category', 'cat_mot', -1, test.rid());
select test.eq(array_agg(key order by position), array['cat_mot', 'cat_rev'], 'a category moved up')
from (select key, position from public.service_categories order by position limit 2) x;
select test.fails($$select public.admin_move_catalog_item('category', 'cat_mot', -1, test.rid())$$, 'cannot_move',
  'the first one cannot move up');
select public.admin_move_catalog_item('service', 'revizie', -1, test.rid());
select test.eq(array_agg(id order by position), array['revizie', 'ulei'], 'a service moved up inside its category')
from (select id, position from public.services where category_key = 'cat_rev' order by position limit 2) x;
select test.fails($$select public.admin_move_catalog_item('shop', 'x', 1, test.rid())$$, 'kind_invalid', 'only categories and services');
select test.eq(count(*), 2::bigint, 'moves are logged')
from public.admin_audit_log where action in ('move_category', 'move_service');

-- ------------------------------------------------------------------ platform settings
-- A quote sent before the change keeps its expiry.
select test.logout();
select set_config('test.old_booking', test.raw_booking(test.id('shop1'), test.id('client_a'), 'quote_sent', test.workday(3), '09:00')::text, true);
select set_config('test.old_quote', test.raw_quote(current_setting('test.old_booking')::uuid)::text, true);
select set_config('test.old_expiry', (select expires_at::text from public.quotes where id = current_setting('test.old_quote')::uuid), true);
select set_config('test.new_booking', test.raw_booking(test.id('shop1'), test.id('client_a'), 'in_inspection', test.workday(3), '11:00')::text, true);
select test.login(test.id('admin'));

select test.eq(test.error_params($$select public.admin_update_settings('{"trial_days":999}', test.rid())$$)->>'field',
               'trial_days', 'a value out of range names its field');
select test.eq(test.error_params($$select public.admin_update_settings('{"quote_expiry_days":2.5}', test.rid())$$)->>'field',
               'quote_expiry_days', 'days are whole');
select test.eq(test.error_params($$select public.admin_update_settings('{"owner_id":"x"}', test.rid())$$)->>'field',
               'owner_id', 'unknown settings are refused');
select test.eq(test.error_params($$select public.admin_update_settings('{"limits":{"review_window_days":0}}', test.rid())$$)->>'field',
               'review_window_days', 'limits have ranges');
select test.eq(test.error_params($$select public.admin_update_settings('{"limits":{"anything":3}}', test.rid())$$)->>'field',
               'anything', 'unknown limits are refused');
select test.eq(test.error_params($$select public.admin_update_settings('{"subscription_price_ron":0}', test.rid())$$)->>'field',
               'subscription_price_ron', 'a price of 0 is refused');

select public.admin_update_settings(
  '{"quote_expiry_days":7,"trial_days":30,"subscription_price_ron":120,"limits":{"review_window_days":30},"ranking_prior_avg":4.3}',
  test.rid());
select test.eq(quote_expiry_days, 7, 'quote expiry changed'),
       test.eq(trial_days, 30, 'free period changed'),
       test.eq((limits->>'review_window_days')::int, 30, 'one limit changed'),
       test.eq((limits->>'active_bookings_per_shop')::int, 3, 'the other limits stay'),
       test.eq(updated_by, test.id('admin'), 'who changed them')
from public.platform_settings;
select test.eq(before, '{"trial_days": 90, "limits": {"review_window_days": 60}, "quote_expiry_days": 3, "subscription_price_ron": 100.00}'::jsonb,
               'the log keeps only what changed (before)'),
       test.eq(after, '{"trial_days": 30, "limits": {"review_window_days": 30}, "quote_expiry_days": 7, "subscription_price_ron": 120.00}'::jsonb,
               'and after')
from public.admin_audit_log where action = 'update_settings';

select test.eq((select expires_at::text from public.quotes where id = current_setting('test.old_quote')::uuid),
               current_setting('test.old_expiry'), 'the quote sent before keeps its expiry');
select test.login(test.id('owner1'));
select public.send_quote(current_setting('test.new_booking')::uuid, '[{"name":"Plăcuțe","price":300}]', test.rid());
select test.login(test.id('admin'));
select test.ok(expires_at between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute',
               'a quote sent after the change expires after 7 days')
from public.quotes where booking_id = current_setting('test.new_booking')::uuid;

-- A shop signed up after the change gets the new free period and price; the old ones keep theirs.
select test.logout();
select test.sign_up('owner3@test.local',
  '{"role":"shop","name":"Nou","phone":"0268000003","shop_name":"Atelier Trei","city":"Brașov","lang":"ro","terms_version":"2026-09"}');
select test.eq(sub.price_ron, 120.00::numeric(10,2), 'new shop: new price'),
       test.ok(sub.trial_ends_at between now() + interval '29 days' and now() + interval '31 days', 'new shop: 30 free days')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Atelier Trei';
select test.ok(trial_ends_at > now() + interval '80 days', 'an existing free period is unchanged'),
       test.eq(price_ron, 100.00::numeric(10,2), 'and so is its price')
from public.subscriptions where shop_id = test.id('shop2');
select test.login(test.id('admin'));

-- Push texts.
select test.eq(test.error_params($$select public.admin_set_notification_text('admin.x', 'X', null, null, null, test.rid())$$)->>'field',
               'text_key', 'only client.* and shop.* texts');
select public.admin_set_notification_text('client.quote_sent', ' Deviz nou ', 'Total {total}', null, '', test.rid());
select test.eq(notification_texts->'client.quote_sent', '{"ro": {"body": "Total {total}", "title": "Deviz nou"}}'::jsonb,
               'a text overridden in Romanian only (empty fields keep the built-in text)')
from public.platform_settings;
select public.admin_set_notification_text('client.quote_sent', '', '', '', '', test.rid());
select test.eq(notification_texts ? 'client.quote_sent', false, 'all empty: back to the built-in text') from public.platform_settings;
select test.eq(count(*), 2::bigint, 'both changes logged') from public.admin_audit_log where action = 'set_notification_text';

-- ------------------------------------------------------------------ notices
select test.fails($$select public.admin_notice_preview('city', 'Codlea')$$, 'audience_invalid', 'audience is shops, clients or all');
select test.eq(p, '{"recipients": 2, "with_push": 2}'::jsonb, 'clients in Brașov: both booked there, both have push')
from public.admin_notice_preview('clients', 'Brasov') p;
select test.eq(p->>'recipients', '1', 'clients in Codlea: only the one who booked there')
from public.admin_notice_preview('clients', 'codlea') p;
select test.eq(p->>'recipients', '3', 'shops in Brașov: owner and staff of shop1, and the new shop''s owner')
from public.admin_notice_preview('shops', 'Brașov') p;
select test.fails($$select public.admin_send_notice('all', 'Cluj', 'X', 'Y', null, null, false, test.rid())$$, 'no_recipients',
  'nobody in that city');
select test.eq(test.error_params($$select public.admin_send_notice('all', null, ' ', 'Y', null, null, false, test.rid())$$)->>'field',
               'notice_title', 'a title is required');

select set_config('test.rid_notice', test.rid()::text, true);
select set_config('test.notice', (public.admin_send_notice('clients', 'Codlea', 'Program de sărbători', 'Închis pe 1 decembrie.',
  null, null, true, current_setting('test.rid_notice')::uuid))->>'id', true);
select test.eq((public.admin_send_notice('clients', 'Codlea', 'Program de sărbători', 'Închis pe 1 decembrie.',
  null, null, true, current_setting('test.rid_notice')::uuid))->>'id', current_setting('test.notice'), 'the same tap sends once');
select test.eq(title_en || '|' || body_en, 'Program de sărbători|Închis pe 1 decembrie.', 'English left empty = the Romanian text'),
       test.eq(recipients, 1, 'one recipient'),
       test.eq(push_recipients, 1, 'one push')
from public.notices where id = current_setting('test.notice')::uuid;
select test.eq(count(*), 1::bigint, 'one broadcast push, to the client in Codlea')
from public.notification_events
where event = 'broadcast' and user_id = test.id('client_b') and params->>'notice_id' = current_setting('test.notice')
  and channels = array['push'] and params->>'title_en' = 'Program de sărbători';
select test.eq(count(*), 1::bigint, 'the notice is logged with its audience')
from public.admin_audit_log where action = 'send_notice' and after->>'audience' = 'clients' and after->>'city' = 'Codlea';

select test.login(test.id('client_b'));
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 1::bigint,
  'the client in Codlea sees it');
insert into public.notice_reads (notice_id) values (current_setting('test.notice')::uuid);
select test.login(test.id('client_a'));
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 0::bigint,
  'a client who never booked in Codlea does not');
select test.login(test.id('owner2'));
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 0::bigint,
  'nor the shop in Codlea (it was for clients)');

select test.login(test.id('admin'));
select test.eq((select (n->>'reads')::int from jsonb_array_elements(public.admin_list_notices()) n
                where n->>'id' = current_setting('test.notice')), 1, 'the list shows how many read it');
select public.admin_withdraw_notice(current_setting('test.notice')::uuid, test.rid());
select test.eq(count(*), 0::bigint, 'withdrawn') from public.notices where id = current_setting('test.notice')::uuid;
select test.eq(last_error, 'withdrawn', 'its push not sent yet is dropped'),
       test.ok(processed_at is not null, 'and closed')
from public.notification_events where event = 'broadcast' and params->>'notice_id' = current_setting('test.notice');
select test.fails(format($$select public.admin_withdraw_notice('%s', test.rid())$$, current_setting('test.notice')),
  'notice_not_found', 'a withdrawn notice is gone');

-- The old "everyone in a city" notice from the fixtures reaches the shop there and its clients.
select test.login(test.id('client_b'));
select test.eq(test.count($$select 1 from public.notices where audience = 'city'$$), 1::bigint,
  'a client who booked in Codlea sees the Codlea notice');
select test.login(test.id('admin'));

-- ------------------------------------------------------------------ export
select test.eq(jsonb_array_length(public.admin_export('shops')), 3, 'shops export: every shop'),
       test.eq(jsonb_array_length(public.admin_export('clients')), 2, 'clients export'),
       test.eq(jsonb_array_length(public.admin_export('subscriptions')), 3, 'subscriptions export'),
       test.eq(jsonb_array_length(public.admin_export('reviews')), 2, 'reviews export: every review'),
       test.eq(jsonb_array_length(public.admin_export('reviews', '{"q":"prompt"}')), 1, 'or those matching the text'),
       test.eq(jsonb_array_length(public.admin_export('bookings', '{"statuses":["done"]}')), 2, 'bookings export with the status filter'),
       test.eq(jsonb_array_length(public.admin_export('bookings', format('{"shop_id":"%s"}', test.id('shop2'))::jsonb)), 1,
               'and the shop filter');
select test.eq((select x->>'plate' from jsonb_array_elements(public.admin_export('bookings', '{"q":"bv12abc"}')) x), 'BV 12 ABC',
               'bookings export finds a plate');
select test.fails($$select public.admin_export('passwords')$$, 'kind_invalid', 'only the five lists');
select test.eq(count(*), 8::bigint, 'every export is logged')
from public.admin_audit_log where action = 'export';
select test.eq(after->'filters', '{"statuses": ["done"]}'::jsonb, 'with its filters')
from public.admin_audit_log where action = 'export' and after->'filters' ? 'statuses';

-- ------------------------------------------------------------------ audit labels
select test.eq((select e->>'label' from jsonb_array_elements(public.admin_list_audit()) e where e->>'action' = 'void_report'),
               (select code from public.history_reports where id = current_setting('test.report')::uuid), 'a report shows its code'),
       test.eq((select e->>'label' from jsonb_array_elements(public.admin_list_audit()) e where e->>'action' = 'withdraw_notice'),
               'Program de sărbători', 'a withdrawn notice keeps its title'),
       test.eq((select e->>'label' from jsonb_array_elements(public.admin_list_audit()) e
                where e->>'action' = 'create_service'), 'Polish faruri', 'a service shows its name');

rollback;
