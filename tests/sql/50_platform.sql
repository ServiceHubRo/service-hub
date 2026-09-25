-- Platform-wide guarantees: catalog, storage, realtime, schema version, and structural checks that
-- catch a forgotten RLS policy or grant in any future migration.
\set catalog `cat docs/service-catalog.json`
\set expected_version `sed -n 's/^export const EXPECTED_SCHEMA_VERSION[^=]*= \([0-9]*\);/\1/p' src/lib/schema.ts`
begin;
select set_config('test.catalog', :'catalog', true);
select set_config('test.expected_version', :'expected_version', true);

-- Schema version matches what the frontend expects (src/lib/schema.ts).
select test.eq(public.get_schema_version(), current_setting('test.expected_version')::int,
  'schema_version equals EXPECTED_SCHEMA_VERSION in src/lib/schema.ts');

-- Catalog: every category and service from docs/service-catalog.json, names in RO and EN.
select test.eq((select count(*) from public.service_categories),
               jsonb_array_length(current_setting('test.catalog')::jsonb->'categories')::bigint, 'all categories loaded');
select test.eq((select count(*) from public.services),
               jsonb_array_length(current_setting('test.catalog')::jsonb->'services')::bigint, 'all services loaded');
select test.eq(count(*), 0::bigint, 'every catalog service present with the same names and category')
from jsonb_array_elements(current_setting('test.catalog')::jsonb->'services') j
left join public.services s
  on s.id = j->>'id' and s.name_ro = j->>'ro' and s.name_en = j->>'en'
 and s.category_key = j->>'category' and s.icon = j->>'icon'
where s.id is null;
select test.eq(count(*), 150::bigint, 'all 150 services enabled') from public.services where enabled;

-- Platform settings defaults.
select test.eq(subscription_price_ron, 100.00::numeric(10,2), 'price 100 lei'),
       test.eq(trial_days, 90, 'trial 90 days'),
       test.eq(quote_expiry_days, 3, 'quotes expire after 3 days'),
       test.eq(report_price_ron, 29.00::numeric(10,2), 'report 29 lei'),
       test.eq(ranking_prior_avg, 4.30::numeric(3,2), 'prior average 4.3'),
       test.eq(ranking_prior_weight, 3.00::numeric(6,2), 'prior weight 3'),
       test.eq((limits->>'active_bookings_per_shop')::int, 3, 'limit per shop'),
       test.eq((limits->>'active_bookings_total')::int, 10, 'limit total'),
       test.eq((limits->>'new_bookings_per_24h')::int, 5, 'limit per 24 h'),
       test.eq((limits->>'messages_per_thread_per_hour')::int, 30, 'message limit'),
       test.eq((limits->>'review_window_days')::int, 60, 'review window'),
       test.eq((limits->>'quote_versions_max')::int, 20, 'quote versions')
from public.platform_settings;

-- Storage buckets.
select test.eq(public, true, 'logos bucket public'),
       test.eq(file_size_limit, 2097152::bigint, 'logos up to 2 MB')
from storage.buckets where id = 'logos';
select test.eq(public, false, 'reports bucket private') from storage.buckets where id = 'reports';

-- Realtime publication.
select test.eq(array_agg(tablename::text order by tablename),
               array['bookings', 'invoices', 'messages', 'notices', 'reviews', 'subscriptions', 'threads'], 'realtime tables')
from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';

-- Logo uploads: only members of that shop, only in the shop's folder; reports never from the browser.
select test.make_world();
select test.login(test.id('owner1'));
insert into storage.objects (bucket_id, name) values ('logos', test.id('shop1') || '/logo.png');
update storage.objects set metadata = '{"v":2}' where bucket_id = 'logos' and name = test.id('shop1') || '/logo.png';
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('logos', '%s/logo.png')$$, test.id('shop2')),
  'row-level security', 'owner1 cannot upload into shop2''s folder');
select test.fails($$insert into storage.objects (bucket_id, name) values ('logos', 'logo.png')$$,
  'row-level security', 'logo must be inside a shop folder');
select test.fails($$insert into storage.objects (bucket_id, name) values ('logos', 'not-a-uuid/logo.png')$$,
  'row-level security', 'folder must be a shop id');
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('reports', '%s/r.pdf')$$, test.id('shop1')),
  'row-level security', 'reports bucket is not writable from the browser');
select test.logout();
select test.login(test.id('staff1'));
insert into storage.objects (bucket_id, name) values ('logos', test.id('shop1') || '/logo-2.png');
select test.logout();
select test.login(test.id('client_a'));
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('logos', '%s/x.png')$$, test.id('shop1')),
  'row-level security', 'a client cannot upload shop logos');
-- (Deleting is checked through the real Storage API: Supabase refuses direct deletes in SQL.)
update storage.objects set metadata = '{"hacked":true}' where bucket_id = 'logos';
select test.logout();
select test.login(test.id('owner2'));
update storage.objects set metadata = '{"hacked":true}' where bucket_id = 'logos';
select test.eq(test.count($$select 1 from storage.objects where bucket_id = 'logos'$$), 0::bigint,
  'another shop cannot even list shop1''s logo files');
select test.logout();
select test.eq(count(*) filter (where metadata ? 'hacked'), 0::bigint, 'client and other shop could not change logos'),
       test.eq(count(*), 2::bigint, 'both logos still there')
from storage.objects where bucket_id = 'logos';

-- ------------------------------------------------------------------ structural checks
-- Every table in public has Row Level Security on.
select test.eq(string_agg(c.relname, ', '), null, 'tables without RLS')
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;

-- Every security definer function pins its search_path.
select test.eq(string_agg(p.proname, ', '), null, 'security definer functions without search_path')
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');

-- Signed-out visitors reach only the catalog and the schema version.
select test.eq(string_agg(distinct table_name::text, ', ' order by table_name::text), 'service_categories, services',
  'tables readable by anon')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
select test.eq(count(*), 0::bigint, 'anon has no write grants')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT';
select test.eq(count(*), 0::bigint, 'anon has no column write grants')
from information_schema.column_privileges
where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT';

-- Functions callable from the API are an explicit list (a new RPC must be granted on purpose).
select test.eq(
  string_agg(p.proname, ', ' order by p.proname) filter (where has_function_privilege('anon', p.oid, 'execute')),
  'format_sequence_id, get_schema_version, get_staff_invite, is_valid_cui, is_valid_iban, is_valid_postal_code, is_valid_regcom, is_valid_vin, normalize_code, try_uuid',
  'functions callable by anon')
from pg_proc p where p.pronamespace = 'public'::regnamespace;
select test.eq(
  string_agg(p.proname, ', ' order by p.proname) filter (
    where has_function_privilege('authenticated', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')),
  'admin_force_cancel, booking_thread, can_read_booking, can_read_notice, can_read_shop, can_read_thread, cancel_booking, '
  || 'cancel_email_change, check_phone_code, client_no_show_count, complete_job, confirm_booking, create_booking, decide_quote, '
  || 'decline_booking, export_my_data, get_availability, get_shop_page, get_shop_setup, invite_staff, is_admin, is_shop_member, '
  || 'is_shop_owner, is_shop_public, last_odometer_for_booking, list_shop_bookings, list_shop_history, list_shop_staff, list_threads, '
  || 'mark_no_show, mark_thread_read, my_phone_verification, my_shop_id, replace_quote, reply_review, report_review, reschedule_booking, save_push_subscription, '
  || 'save_shop_hours, search_cities, search_shops, send_message, send_quote, set_shop_services, shop_cancel_booking, start_inspection, '
  || 'start_work, submit_review, toggle_favorite, withdraw_quote',
  'functions callable only when signed in')
from pg_proc p where p.pronamespace = 'public'::regnamespace;

-- Nobody gets UPDATE on a whole table: browser updates are always column-scoped.
select test.eq(string_agg(distinct table_name::text, ', '), null, 'tables with full-row update for authenticated')
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('UPDATE', 'INSERT', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

rollback;
