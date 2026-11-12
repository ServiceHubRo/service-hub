-- A3c2b3 — audit of the historical logs. READ-ONLY: one SELECT, it changes nothing.
--
-- What it does: counts, per source, the rows that hold personal data, belong to deleted accounts,
-- are past their retention period, are under legal hold, and the rows that contradict the rules
-- built in A3c2a / A3c2b1 / A3c2b2. It returns ONE json value with numbers only: never a name, an
-- email, a phone number, a search word, a text, a file name, an id or a secret. Dates are months.
--
-- How to run (Eduard): Supabase → SQL Editor → paste the whole file → Run. Needs schema 116
-- (A3c2b2). For an extra guarantee, run it as:   begin read only;  <this file>  rollback;
-- (Postgres then refuses any write, even from a function.)
--
-- Policy of reference (Eduard, 12 Nov 2026): support requests 12 months; search words 90 days;
-- admin and security log 3 years (not validated legally; the admin_log job stays locked); legal-hold
-- log while the hold is active + 3 years after release.
--
-- Optional sources (auth audit log, Storage, pg_cron) are read through query_to_xml, so the query
-- still runs where one of them does not exist; their value is then null.
with
p as (
  select now() as at, public.audit_retention_cutoff() as cutoff,
         (select version from public.schema_version limit 1) as schema_version
),

-- ===================================================================== A. support requests
req as (
  select s.id, s.category = 'suggestions' as is_suggestion, s.status, s.author_id, s.former_author_id,
         s.last_activity_at, s.closed_at, s.created_at,
         public.legal_hold_covers_request(s.id) as held,
         public.suggestion_text_findings(coalesce(s.title, '') || E'\n' || coalesce(s.body, '')) as f,
         public.text_has_secret(coalesce(s.title, '') || E'\n' || coalesce(s.body, '')) as secret
  from public.suggestions s
),
msg as (
  select m.suggestion_id, m.from_staff, m.author_id is null as author_gone, m.created_at,
         public.suggestion_text_findings(m.body) as f, public.text_has_secret(m.body) as secret
  from public.suggestion_messages m
),
note as (
  select n.suggestion_id, n.author_id is null as author_gone,
         public.suggestion_text_findings(n.body) as f, public.text_has_secret(n.body) as secret
  from public.suggestion_notes n
),
sfile as (
  select f.id, f.suggestion_id, f.message_id, f.created_at, f.attached_at, f.uploaded_by is null as uploader_gone,
         public.suggestion_text_findings(f.name) as f,
         r.closed_at, coalesce(r.held, false) as held
  from public.suggestion_files f left join req r on r.id = f.suggestion_id
),
support as (
  select jsonb_build_object(
    'requests', jsonb_build_object(
      'total', (select count(*) from req),
      'support', (select count(*) from req where not is_suggestion),
      'suggestions', (select count(*) from req where is_suggestion),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from req group by status) x), '{}'::jsonb),
      'oldest_activity_month', (select to_char(min(last_activity_at), 'YYYY-MM') from req),
      'author_account_deleted', (select count(*) from req where author_id is null),
      'author_deleted_kept_after_deletion', (select count(*) from req where author_id is null and former_author_id is not null),
      'past_12_months_without_activity', (select count(*) from req, p where last_activity_at + interval '12 months' <= p.at),
      'past_12_months_held', (select count(*) from req, p where last_activity_at + interval '12 months' <= p.at and held),
      'held', (select count(*) from req where held),
      'with_personal_data_in_title_or_text', (select count(*) from req where (f->>'total')::int > 0),
      'kinds', coalesce((select jsonb_object_agg(k, n) from (select e.key k, count(*) n from req, jsonb_each_text(req.f->'findings') e where e.value::int > 0 group by e.key) x), '{}'::jsonb),
      'with_possible_secret', (select count(*) from req where secret)),
    'messages', jsonb_build_object(
      'total', (select count(*) from msg),
      'author_account_deleted', (select count(*) from msg where author_gone),
      'with_personal_data', (select count(*) from msg where (f->>'total')::int > 0),
      'kinds', coalesce((select jsonb_object_agg(k, n) from (select e.key k, count(*) n from msg, jsonb_each_text(msg.f->'findings') e where e.value::int > 0 group by e.key) x), '{}'::jsonb),
      'with_possible_secret', (select count(*) from msg where secret)),
    'internal_notes', jsonb_build_object(
      'total', (select count(*) from note),
      'author_account_deleted', (select count(*) from note where author_gone),
      'with_personal_data', (select count(*) from note where (f->>'total')::int > 0),
      'with_possible_secret', (select count(*) from note where secret)),
    'files', jsonb_build_object(
      'total', (select count(*) from sfile),
      'uploader_account_deleted', (select count(*) from sfile where uploader_gone),
      'name_with_personal_data', (select count(*) from sfile where (f->>'total')::int > 0),
      'unattached_older_than_24h', (select count(*) from sfile, p where attached_at is null and created_at < p.at - interval '24 hours'),
      'request_closed_over_90_days_not_held', (select count(*) from sfile, p where closed_at is not null and closed_at < p.at - interval '90 days' and not held)),
    'storage_queue_waiting_over_1_day', (select count(*) from public.support_file_deletions, p where queued_at < p.at - interval '1 day'),
    'signals', (select count(*) from public.support_signals),
    'notification_events', (
      select jsonb_build_object(
        'total', count(*),
        'older_than_12_months', count(*) filter (where e.created_at < p.at - interval '12 months'),
        'request_no_longer_exists', count(*) filter (where not exists (select 1 from public.suggestions s where s.id::text = e.params->>'request_id')),
        'title_with_personal_data', count(*) filter (where (public.suggestion_text_findings(coalesce(e.params->>'title', ''))->>'total')::int > 0))
      from public.notification_events e, p where e.event like 'support\_%'),
    'anonymous_suggestions', (
      select jsonb_build_object(
        'total', count(*),
        'by_state', coalesce(jsonb_object_agg(text_state, n) filter (where text_state is not null), '{}'::jsonb),
        'pending_text_past_30_days', sum(late))
      from (select a.text_state, count(*) n, count(*) filter (where a.pending_text is not null and a.review_due_at < p.at) late
            from public.suggestions_anonymous a, p group by a.text_state) x),
    'retention_preview', jsonb_build_object(
      'support_requests', public.retention_counts('support_requests', (select at from p)),
      'suggestions', public.retention_counts('suggestions', (select at from p)))
  ) as j
),

-- ===================================================================== B. admin / security / legal log
lg as (
  select l.id, l.action, l.entity_type, l.entity_id, l.admin_id, l.created_at, l.reason,
         public.audit_class(l.action) as class,
         exists (select 1 from public.audit_action_classes c where c.action = l.action) as classified,
         l.created_at < p.cutoff as legacy,
         l.redacted is not null as redacted,
         public.audit_due_at(l.action, l.entity_type, l.entity_id, l.created_at) as due_at,
         public.audit_row_held(l.entity_type, l.entity_id) as held,
         coalesce(l.before, '{}'::jsonb) as b, coalesce(l.after, '{}'::jsonb) as a
  from public.admin_audit_log l, p
),
lg_leaf as (
  select g.id, x.key, x.value
  from lg g, lateral (
    select * from public.jsonb_string_leaves(g.b) union all select * from public.jsonb_string_leaves(g.a)
    union all select 'reason', g.reason where g.reason is not null) x
  -- the search word is counted under C, not here
  where not (g.action = 'support_search' and x.key = 'q')
),
lg_leaf_f as (
  select l.id, l.key, public.suggestion_text_findings(l.value)->'findings' as f, public.text_has_secret(l.value) as secret
  from lg_leaf l
),
lg_row as (
  select g.*,
    exists (select 1 from lg_leaf f where f.id = g.id and f.key in ('name', 'admin_name', 'shop_name', 'owner_name', 'client_name', 'legal_name')) as names,
    exists (select 1 from lg_leaf_f f where f.id = g.id and (f.f->>'email')::int > 0) as emails,
    exists (select 1 from lg_leaf_f f where f.id = g.id and ((f.f->>'phone')::int > 0 or f.key in ('phone', 'phone_e164'))) as phones,
    exists (select 1 from lg_leaf_f f where f.id = g.id and ((f.f->>'iban')::int > 0 or f.key = 'iban')) as ibans,
    exists (select 1 from lg_leaf_f f where f.id = g.id and (f.f->>'cnp')::int > 0) as cnps,
    exists (select 1 from lg_leaf_f f where f.id = g.id and ((f.f->>'plate')::int > 0 or (f.f->>'vin')::int > 0)) as vehicles,
    exists (select 1 from lg_leaf f where f.id = g.id and f.key in ('address', 'street', 'zip', 'cui', 'reg_com', 'lat', 'lng')) as addresses_fiscal,
    (g.a ? 'billing' or g.b ? 'billing') as billing,
    (g.a ? 'file_name' or g.b ? 'file_name') as file_names,
    exists (select 1 from lg_leaf_f f where f.id = g.id and (f.secret or (f.f->>'card')::int > 0))
      or exists (select 1 from jsonb_object_keys(g.a || g.b) k where public.audit_secret_key(k)) as secrets,
    (g.entity_type in ('profile', 'shop') and g.entity_id ~ '^[0-9a-f-]{36}$'
     and not exists (select 1 from public.profiles pr where pr.id::text = g.entity_id and pr.deleted_at is null)
     and not exists (select 1 from public.shops s join public.profiles pr on pr.id = s.owner_id
                     where s.id::text = g.entity_id and pr.deleted_at is null)) as deleted_account,
    (g.admin_id is not null and not exists (select 1 from public.profiles pr where pr.id = g.admin_id)) as actor_gone
  from lg g
),
lg_class as (
  select r.class,
    count(*) as rows,
    count(*) filter (where r.legacy) as legacy_rows,
    count(*) filter (where r.redacted) as redacted_rows,
    count(*) filter (where r.held) as held_rows,
    count(*) filter (where r.due_at is not null and r.due_at <= p.at) as past_retention,
    count(*) filter (where r.due_at is not null and r.due_at <= p.at and r.held) as past_retention_held,
    count(*) filter (where r.due_at is null) as no_end_yet_hold_active,
    count(*) filter (where r.names) as names, count(*) filter (where r.emails) as emails,
    count(*) filter (where r.phones) as phones, count(*) filter (where r.ibans) as ibans,
    count(*) filter (where r.cnps) as cnps, count(*) filter (where r.vehicles) as plates_or_vins,
    count(*) filter (where r.addresses_fiscal or r.billing) as address_or_fiscal,
    count(*) filter (where r.file_names) as file_names, count(*) filter (where r.secrets) as possible_secrets,
    count(*) filter (where r.deleted_account) as about_deleted_accounts,
    count(*) filter (where r.deleted_account and (r.names or r.emails or r.phones)) as deleted_accounts_with_identifiers,
    count(*) filter (where r.actor_gone) as actor_account_deleted,
    to_char(min(r.created_at), 'YYYY-MM') as oldest_month,
    to_char(max(r.created_at), 'YYYY-MM') as newest_month
  from lg_row r, p group by r.class
),
lg_action as (
  select r.action, r.class, count(*) as rows, count(*) filter (where r.legacy) as legacy_rows,
    count(*) filter (where r.names) as names, count(*) filter (where r.emails) as emails,
    count(*) filter (where r.phones) as phones, count(*) filter (where r.ibans) as ibans,
    count(*) filter (where r.vehicles) as plates_or_vins,
    count(*) filter (where r.addresses_fiscal or r.billing) as address_or_fiscal,
    count(*) filter (where r.file_names) as file_names, count(*) filter (where r.secrets) as possible_secrets,
    count(*) filter (where r.deleted_account) as about_deleted_accounts
  from lg_row r group by r.action, r.class
),
adminlog as (
  select jsonb_build_object(
    'rows', (select count(*) from lg),
    'legacy_rows_before_cutoff', (select count(*) from lg where legacy),
    'unclassified_actions', (select count(distinct action) from lg where not classified),
    'unclassified_rows', (select count(*) from lg where not classified),
    'by_class', coalesce((select jsonb_object_agg(class, to_jsonb(c) - 'class') from lg_class c), '{}'::jsonb),
    'by_action_with_findings', coalesce((select jsonb_agg(to_jsonb(a) order by a.rows desc, a.action) from lg_action a
        where a.names + a.emails + a.phones + a.ibans + a.plates_or_vins + a.address_or_fiscal + a.file_names + a.possible_secrets + a.about_deleted_accounts > 0), '[]'::jsonb),
    -- Contradictions with A3c2b2 (each should be 0): rows written after the cutoff that still hold
    -- what the scrub trigger or the account-deletion correction removes.
    'after_cutoff_contradictions', jsonb_build_object(
      'delete_account_with_name_email_or_shop_name', (select count(*) from lg where not legacy and action = 'delete_account'
          and (a ? 'name' or a ? 'email' or a ? 'shop_name' or b ? 'name' or b ? 'email' or b ? 'shop_name')),
      'open_request_file_with_file_name', (select count(*) from lg where not legacy and action = 'open_request_file' and (a ? 'file_name' or b ? 'file_name')),
      'secret_named_keys', (select count(*) from lg where not legacy and exists (select 1 from jsonb_object_keys(a || b) k where public.audit_secret_key(k))),
      'deleted_account_rows_with_identifiers_not_held', (select count(*) from lg_row r where not r.legacy and r.deleted_account and not r.held and (r.names or r.emails or r.phones))),
    'privacy_report_a3c2b2_totals', public.audit_privacy_report()->'totals',
    'retention_preview', jsonb_build_object(
      'support_log', public.retention_counts('support_log', (select at from p)),
      'admin_log', public.retention_counts('admin_log', (select at from p)))
  ) as j
),

-- ===================================================================== C. search words
srch as (
  select g.legacy, g.held, g.created_at, g.a->>'q' as q,
         public.suggestion_text_findings(coalesce(g.a->>'q', ''))->'findings' as f
  from lg g where g.action = 'support_search'
),
search as (
  select jsonb_build_object(
    'search_rows', count(*),
    'with_words', count(*) filter (where q is not null),
    'words_older_than_90_days', count(*) filter (where q is not null and created_at + interval '90 days' <= p.at),
    'words_older_than_90_days_legacy', count(*) filter (where q is not null and legacy and created_at + interval '90 days' <= p.at),
    'words_older_than_90_days_held', count(*) filter (where q is not null and held and created_at + interval '90 days' <= p.at),
    'words_legacy_total', count(*) filter (where q is not null and legacy),
    'words_look_like_email', count(*) filter (where (f->>'email')::int > 0),
    'words_look_like_phone', count(*) filter (where (f->>'phone')::int > 0),
    'words_look_like_plate_or_vin', count(*) filter (where (f->>'plate')::int > 0 or (f->>'vin')::int > 0),
    'words_look_like_account_or_booking_code', count(*) filter (where (f->>'account_code')::int > 0 or (f->>'booking_code')::int > 0),
    'words_other_possibly_names', count(*) filter (where q is not null and coalesce((public.suggestion_text_findings(q)->>'total')::int, 0) = 0),
    'words_matching_a_held_deleted_subject', count(*) filter (where q is not null and exists (
        select 1 from public.legal_hold_subjects s
        where s.account_deleted_at is not null and (lower(q) = lower(s.email) or lower(q) = lower(s.name)))),
    'oldest_month_with_words', to_char(min(created_at) filter (where q is not null), 'YYYY-MM'),
    'rate_events_search_older_than_2_days', (select count(*) from public.rate_events r where r.kind = 'support_search' and r.at < p.at - interval '2 days')
  ) as j
  from srch, p group by p.at
),

-- ===================================================================== D. legal hold
legal as (
  select jsonb_build_object(
    'holds', (select count(*) from public.legal_holds),
    'active', (select count(*) from public.legal_holds where released_at is null),
    'active_on_request', (select count(*) from public.legal_holds where released_at is null and suggestion_id is not null),
    'active_on_account', (select count(*) from public.legal_holds where released_at is null and suggestion_id is null),
    'released', (select count(*) from public.legal_holds where released_at is not null),
    'released_over_3_years_ago', (select count(*) from public.legal_holds, p where released_at < p.at - interval '3 years'),
    'review_overdue', (select count(*) from public.legal_holds, p where released_at is null and review_due_at < p.at),
    'oldest_active_month', (select to_char(min(created_at), 'YYYY-MM') from public.legal_holds where released_at is null),
    'texts_with_personal_data', (select count(*) from public.legal_holds h
        where (public.suggestion_text_findings(coalesce(h.reason, '') || E'\n' || coalesce(h.reference, '') || E'\n' || coalesce(h.release_reason, ''))->>'total')::int > 0),
    'reviews', (select count(*) from public.legal_hold_reviews),
    'review_notes_with_personal_data', (select count(*) from public.legal_hold_reviews r where (public.suggestion_text_findings(coalesce(r.note, ''))->>'total')::int > 0),
    'subjects', (select count(*) from public.legal_hold_subjects),
    'subjects_account_deleted', (select count(*) from public.legal_hold_subjects where account_deleted_at is not null),
    'subjects_without_active_hold', (select count(*) from public.legal_hold_subjects s where not public.legal_hold_has_subject(s.user_id)),
    'held_requests', (select count(*) from req where held),
    'held_requests_author_deleted', (select count(*) from req where held and author_id is null),
    'legal_log_rows', (select count(*) from lg where class = 'legal'),
    'legal_log_rows_hold_active', (select count(*) from lg where class = 'legal' and due_at is null),
    'log_rows_protected_by_hold', (select count(*) from lg where held)
  ) as j
),

-- ===================================================================== E. other sources
ev as (
  select e.event, e.created_at, e.processed_at, e.user_id,
         public.suggestion_text_findings(e.params::text)->'findings' as f
  from public.notification_events e
),
other as (
  select jsonb_build_object(
    'notification_events', (select jsonb_build_object(
        'total', count(*), 'unprocessed', count(*) filter (where processed_at is null),
        'older_than_12_months', count(*) filter (where created_at < p.at - interval '12 months'),
        'oldest_month', to_char(min(created_at), 'YYYY-MM'),
        'params_with_email', count(*) filter (where (f->>'email')::int > 0),
        'params_with_phone', count(*) filter (where (f->>'phone')::int > 0),
        'params_with_plate_or_vin', count(*) filter (where (f->>'plate')::int > 0 or (f->>'vin')::int > 0),
        'of_anonymised_accounts', count(*) filter (where exists (select 1 from public.profiles pr where pr.id = ev.user_id and pr.deleted_at is not null)))
      from ev, p),
    'notifications_log', (select jsonb_build_object(
        'total', count(*), 'older_than_12_months', count(*) filter (where n.sent_at < p.at - interval '12 months'),
        'error_with_email_or_phone', count(*) filter (where n.error ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' or n.error ~ '(\+?40|\m0)[ .-]?7[0-9]{2}[ .-]?[0-9]{3}[ .-]?[0-9]{3}'),
        'event_gone', count(*) filter (where n.event_id is null))
      from public.notifications_log n, p),
    'company_audit_log', (select jsonb_build_object(
        'total', count(*), 'oldest_month', to_char(min(c.created_at), 'YYYY-MM'),
        'older_than_3_years', count(*) filter (where c.created_at < p.at - interval '3 years'),
        'with_email', count(*) filter (where (public.suggestion_text_findings(coalesce(c.before::text, '') || coalesce(c.after::text, ''))->'findings'->>'email')::int > 0),
        'with_plate_or_vin', count(*) filter (where (public.suggestion_text_findings(coalesce(c.before::text, '') || coalesce(c.after::text, ''))->'findings'->>'plate')::int > 0
                                             or (public.suggestion_text_findings(coalesce(c.before::text, '') || coalesce(c.after::text, ''))->'findings'->>'vin')::int > 0),
        'actor_account_deleted', count(*) filter (where c.actor_id is null))
      from public.company_audit_log c, p),
    'request_log_older_than_7_days', (select count(*) from public.request_log r, p where r.created_at < p.at - interval '7 days'),
    'rate_events_older_than_2_days', (select count(*) from public.rate_events r, p where r.at < p.at - interval '2 days'),
    'stripe_events', (select jsonb_build_object(
        'total', count(*), 'older_than_12_months', count(*) filter (where s.created_at < p.at - interval '12 months'),
        'payload_with_email', count(*) filter (where s.payload::text ~* '"email"\s*:\s*"[^"]+@'),
        'payload_with_phone', count(*) filter (where s.payload::text ~* '"phone"\s*:\s*"[^"]+"'))
      from public.stripe_events s, p),
    'fleet_events_processed_over_90_days', (select count(*) from public.fleet_events e, p
        where e.processed_at < p.at - interval '90 days'
          and not exists (select 1 from public.fleet_notices n where n.fleet_event_id = e.id)),
    'phone_verifications', (select jsonb_build_object(
        'total', count(*), 'unverified_expired_over_1_day', count(*) filter (where v.verified_at is null and v.expires_at < p.at - interval '1 day'))
      from public.phone_verifications v, p),
    'signup_completions', (select jsonb_build_object(
        'total', count(*),
        'of_anonymised_accounts', count(*) filter (where exists (select 1 from public.profiles pr where pr.id = sc.id and pr.deleted_at is not null)),
        'of_anonymised_accounts_with_email', count(*) filter (where sc.email is not null and exists (select 1 from public.profiles pr where pr.id = sc.id and pr.deleted_at is not null)))
      from public.signup_completions sc),
    'auth_identities_of_anonymised_accounts', (select count(*) from auth.identities i
        where exists (select 1 from public.profiles pr where pr.id = i.user_id and pr.deleted_at is not null)),
    'auth_identities_of_anonymised_accounts_with_email', (select count(*) from auth.identities i
        where i.identity_data::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' and i.identity_data::text !~* '@deleted\.invalid'
          and exists (select 1 from public.profiles pr where pr.id = i.user_id and pr.deleted_at is not null)),
    'profiles_marked_deleted', (select count(*) from public.profiles where deleted_at is not null),
    'profiles_marked_deleted_login_not_closed', (select count(*) from public.profiles pr join auth.users u on u.id = pr.id
        where pr.deleted_at is not null and u.email not like 'deleted-%@deleted.invalid'),
    'account_fingerprints', (select jsonb_build_object(
        'total', count(*), 'released', count(*) filter (where f.released_at is not null),
        'released_over_3_years', count(*) filter (where f.released_at < p.at - interval '3 years'),
        'account_deleted', count(*) filter (where f.user_id is null))
      from public.account_fingerprints f, p),
    'engagement_log', (select count(*) from public.engagement_log),
    'history_reports_client_deleted', (select count(*) from public.history_reports where client_id is null),
    'car_merges', (select count(*) from public.car_merges),
    'push_subscriptions_silent_over_12_months', (select count(*) from public.push_subscriptions s, p
        where coalesce(s.last_success_at, s.created_at) < p.at - interval '12 months'),
    'retention_jobs', (select jsonb_object_agg(key, jsonb_build_object('enabled', enabled, 'locked', locked_reason is not null)) from public.retention_jobs),
    'retention_runs', (select count(*) from public.retention_runs)
  ) as j
  from p
),

-- ===================================================================== optional sources
opt as (
  select jsonb_build_object(
    'auth_audit_log_entries', case when to_regclass('auth.audit_log_entries') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(jsonb_build_object(
          'total', count(*),
          'oldest_month', to_char(min(created_at), 'YYYY-MM'),
          'older_than_12_months', count(*) filter (where created_at < now() - interval '12 months'),
          'older_than_3_years', count(*) filter (where created_at < now() - interval '3 years'),
          'with_ip_address', count(*) filter (where nullif(ip_address, '') is not null),
          'payload_with_email', count(*) filter (where payload::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'),
          'actor_account_deleted', count(*) filter (where payload->>'actor_id' is not null
              and not exists (select 1 from auth.users u where u.id::text = payload->>'actor_id')))::text, 'UTF8'), 'hex') as j
        from auth.audit_log_entries $q$, false, true, '')))[1]::text, 'hex'), 'UTF8')::jsonb end,
    'storage_support_files', case when to_regclass('storage.objects') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(jsonb_build_object(
          'objects', count(*),
          'without_file_row_over_24h', count(*) filter (where o.created_at < now() - interval '24 hours'
              and not exists (select 1 from public.suggestion_files f where f.path = o.name)
              and not exists (select 1 from public.support_file_deletions d where d.path = o.name)))::text, 'UTF8'), 'hex') as j
        from storage.objects o where o.bucket_id = 'support-files' $q$, false, true, '')))[1]::text, 'hex'), 'UTF8')::jsonb end,
    'cron_jobs_active', case when to_regclass('cron.job') is not null then
      convert_from(decode((xpath('/row/j/text()', query_to_xml($q$
        select encode(convert_to(coalesce(jsonb_object_agg(jobname, active), '{}'::jsonb)::text, 'UTF8'), 'hex') as j
        from cron.job where jobname in ('sh_support_retention', 'sh_suggestion_anonymization', 'sh_support_log_retention',
          'sh_admin_log_retention', 'sh_support_files_cleanup', 'sh_close_support_requests', 'sh_purge_fingerprints', 'sh_hourly_jobs') $q$,
        false, true, '')))[1]::text, 'hex'), 'UTF8')::jsonb end
  ) as j
)

select jsonb_pretty(jsonb_build_object(
  'generated_month', to_char(p.at, 'YYYY-MM'),
  'schema_version', p.schema_version,
  'cutoff_month', to_char(p.cutoff, 'YYYY-MM'),
  'A_support', (select j from support),
  'B_admin_security_legal_log', (select j from adminlog),
  'C_search_words', coalesce((select j from search), '{"search_rows": 0}'::jsonb),
  'D_legal_hold', (select j from legal),
  'E_other_sources', (select j from other),
  'F_optional_sources', (select j from opt)
)) as audit_a3c2b3
from p;
