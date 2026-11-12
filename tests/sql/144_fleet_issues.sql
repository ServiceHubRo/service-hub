-- M3 — issues and incidents: who reports on which vehicle, who follows up, who reads; the photos
-- (attached by their uploader only, at most 23 hours old; unattached ones listed for cleanup after 48
-- hours, receipts never); isolation between companies; the same request twice; the history.
begin;
select test.make_fleet();

-- The photo as the fleet-files Edge Function stores it with the person's token (storage policies
-- apply; A6: after it checked the file and asked for a ticket), and its age changed by the server.
create function pg_temp.ticket(p_name text) returns void
language sql security definer as $$ select public.fleet_file_ticket(auth.uid(), p_name) $$;
create function pg_temp.upload(p_name text) returns void
language sql as $$ select pg_temp.ticket(p_name); insert into storage.objects (bucket_id, name, owner) values ('fleet-files', p_name, auth.uid()) $$;
create function pg_temp.age(p_name text, p_age interval) returns void
language sql security definer as $$ update storage.objects set created_at = now() - p_age where name = p_name $$;
create function pg_temp.exists(p_name text) returns boolean
language sql security definer as $$ select exists (select 1 from storage.objects where name = p_name) $$;
create function pg_temp.readable(p_name text) returns boolean
language sql as $$ select exists (select 1 from storage.objects where bucket_id = 'fleet-files' and name = p_name) $$;
create function pg_temp.orphans() returns text[]
language sql security definer as $$ select coalesce(array_agg(x), '{}') from public.fleet_issue_photo_orphans(1000) x $$;
create function pg_temp.path(p_vehicle text, p_issue uuid, p_file text default 'a.jpg') returns text
language sql as $$ select test.id('co')::text || '/' || test.id(p_vehicle)::text || '/issues/' || p_issue::text || '/' || p_file $$;
create function pg_temp.report(p_issue uuid, p_vehicle text, p_extra jsonb default '{}', p_rid uuid default gen_random_uuid()) returns jsonb
language sql as $$
  select public.fleet_report_issue(test.id('co'), p_issue,
    jsonb_build_object('vehicle_id', test.id(p_vehicle), 'kind', 'defect', 'title', 'Bec far stânga ars',
                       'description', 'Nu se aprinde', 'happened_on', test.today()) || p_extra, p_rid)
$$;
create function pg_temp.issue(p_id uuid) returns public.fleet_issues
language sql security definer as $$ select * from public.fleet_issues where id = p_id $$;
create function pg_temp.audits(p_id uuid) returns bigint
language sql security definer as $$ select count(*) from public.company_audit_log where entity_id = p_id $$;
create function pg_temp.events(p_id uuid) returns bigint
language sql security definer as $$ select count(*) from public.fleet_issue_events where issue_id = p_id $$;
grant execute on all functions in schema pg_temp to public;

select set_config('test.i1', gen_random_uuid()::text, true);
select set_config('test.i2', gen_random_uuid()::text, true);
select set_config('test.i3', gen_random_uuid()::text, true);

-- ------------------------------------------------------------------ 1–2: the driver reports, with photos
select test.login(test.id('client_b'));
select pg_temp.upload(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'));
select pg_temp.upload(pg_temp.path('v1', current_setting('test.i1')::uuid, 'b.jpg'));
select test.logout();
select pg_temp.age(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'), interval '22 hours 59 minutes');
select pg_temp.age(pg_temp.path('v1', current_setting('test.i1')::uuid, 'b.jpg'), interval '23 hours 1 minute');
select test.login(test.id('client_b'));
select test.ok(pg_temp.readable(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg')), 'the uploader sees an unattached photo');
select test.fails(format($$select pg_temp.report(%L, 'v1', jsonb_build_object('photos', jsonb_build_array(%L, %L)))$$,
  current_setting('test.i1'), pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'), pg_temp.path('v1', current_setting('test.i1')::uuid, 'b.jpg')),
  'photo_expired', '2: a photo uploaded 23h01 ago cannot be attached');
select test.ok(pg_temp.exists(pg_temp.path('v1', current_setting('test.i1')::uuid, 'b.jpg')), '2: and stays in storage');
select set_config('test.rid', gen_random_uuid()::text, true);
select test.eq(pg_temp.report(current_setting('test.i1')::uuid, 'v1',
  jsonb_build_object('photos', jsonb_build_array(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'))), current_setting('test.rid')::uuid)->>'status',
  'new', '1: a photo uploaded 22h59 ago is attached; the report starts as new');
-- 12: the same request twice: the first answer, nothing written twice.
select test.eq(pg_temp.report(current_setting('test.i1')::uuid, 'v1',
  jsonb_build_object('photos', jsonb_build_array(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'))), current_setting('test.rid')::uuid)->>'id',
  current_setting('test.i1'), '12: the same request again answers the first result');
select test.eq(pg_temp.events(current_setting('test.i1')::uuid), 1::bigint, '12: one history row');
select test.eq(cardinality((pg_temp.issue(current_setting('test.i1')::uuid)).photos), 1, '12: the photo once');
select test.eq((pg_temp.issue(current_setting('test.i1')::uuid)).vehicle_label->>'plate', 'B 401 FLT', 'the plate at report time is kept');

-- Driver rules.
select test.fails(format($$select pg_temp.report(%L, 'v2')$$, gen_random_uuid()), 'not_allowed', 'a driver reports only on the vehicle assigned to them');
select test.fails(format($$select pg_temp.report(%L, 'v1', '{"happened_on":"%s"}')$$, gen_random_uuid(), test.today() + 1),
  'issue_invalid', 'a day in the future is refused');
select test.fails(format($$select pg_temp.report(%L, 'v1', '{"title":"ab"}')$$, gen_random_uuid()), 'issue_invalid', 'a title under 3 characters');
select test.fails(format($$select pg_temp.report(%L, 'v1', '{"kind":"theft"}')$$, gen_random_uuid()), 'issue_invalid', 'an unknown kind');
select test.fails(format($$select public.fleet_update_issue(%L, '{"status":"closed"}', gen_random_uuid())$$, current_setting('test.i1')),
  'not_allowed', 'the driver cannot change the status');
-- 9: never into another report's folder.
select test.fails(format($$select pg_temp.upload(%L)$$, pg_temp.path('v1', current_setting('test.i1')::uuid, 'c.jpg')),
  'row-level security', '9: a driver cannot add photos to an existing report');

-- A booking of another vehicle or company cannot be linked.
select set_config('test.b_v2', test.fleet_booking('v2', test.id('drv2'), 'confirmed', test.today() + 3)::text, true);
select set_config('test.b_v1', test.fleet_booking('v1', test.id('client_b'), 'confirmed', test.today() + 4)::text, true);
select test.fails(format($$select pg_temp.report(%L, 'v1', jsonb_build_object('booking_id', %L))$$, gen_random_uuid(), current_setting('test.b_v2')),
  'issue_invalid', 'a booking of another vehicle is refused');

-- ------------------------------------------------------------------ the second driver, the archived vehicle, the other company
select test.login(test.id('drv2'));
select pg_temp.upload(pg_temp.path('v2', current_setting('test.i2')::uuid, 'x.jpg'));
-- 9: a pending folder of another member.
select test.login(test.id('mgr'));
select test.fails(format($$select pg_temp.upload(%L)$$, pg_temp.path('v2', current_setting('test.i2')::uuid, 'y.jpg')),
  'row-level security', '9: nobody uploads into a folder another member already uses');
select test.ok(not pg_temp.readable(pg_temp.path('v2', current_setting('test.i2')::uuid, 'x.jpg')), 'an unattached photo is the uploader''s only');
select test.fails(format($$select pg_temp.report(%L, 'v3')$$, gen_random_uuid()), 'vehicle_archived', 'an archived vehicle takes no report');
select test.login(test.id('out'));
select test.fails(format($$select public.fleet_report_issue(%L, %L, jsonb_build_object('vehicle_id', %L, 'kind', 'damage', 'title', 'Zgârietură', 'happened_on', %L), gen_random_uuid())$$,
  test.id('co2'), gen_random_uuid(), test.id('v1'), test.today()), 'vehicle_not_found', 'a vehicle of another company cannot be used');
select test.fails(format($$select public.fleet_issue_detail(%L)$$, current_setting('test.i1')), 'issue_not_found', 'another company reads nothing');
select test.ok(not pg_temp.readable(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg')), 'nor the photo');
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co2'))->'issues'), 0, 'its own list is empty');

-- 10: the same issue id used by two members.
select test.login(test.id('drv2'));
select pg_temp.report(current_setting('test.i2')::uuid, 'v2', jsonb_build_object('photos', jsonb_build_array(pg_temp.path('v2', current_setting('test.i2')::uuid, 'x.jpg'))));
select test.login(test.id('client_b'));
select test.fails(format($$select pg_temp.report(%L, 'v1')$$, current_setting('test.i2')), 'issue_invalid', '10: the second report with the same id is refused');

-- ------------------------------------------------------------------ who reads what
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'issues'), 1, 'a driver lists only the reports of their vehicle');
select test.fails(format($$select public.fleet_issue_detail(%L)$$, current_setting('test.i2')), 'issue_not_found', 'and opens no other');
select test.ok(not pg_temp.readable(pg_temp.path('v2', current_setting('test.i2')::uuid, 'x.jpg')), 'nor sees its photos');
select test.login(test.id('acc'));
select test.eq(jsonb_array_length(public.fleet_overview(test.id('co'))->'issues'), 2, 'the accountant reads every report');
select test.ok(pg_temp.readable(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg')), 'and the attached photos');
select test.fails(format($$select public.fleet_update_issue(%L, '{"status":"in_review"}', gen_random_uuid())$$, current_setting('test.i1')),
  'not_allowed', 'the accountant does not change reports');
select test.fails(format($$select pg_temp.report(%L, 'v1')$$, gen_random_uuid()), 'not_allowed', 'nor reports (no issues.report)');

-- ------------------------------------------------------------------ the manager follows up
select test.login(test.id('mgr'));
select set_config('test.rid2', gen_random_uuid()::text, true);
select test.eq(public.fleet_update_issue(current_setting('test.i1')::uuid,
  jsonb_build_object('status', 'scheduled', 'booking_id', current_setting('test.b_v1'), 'note', 'Programat la Atelier Unu'), current_setting('test.rid2')::uuid)->>'status',
  'scheduled', 'the manager schedules it and links the booking');
select public.fleet_update_issue(current_setting('test.i1')::uuid, '{"status":"scheduled"}', current_setting('test.rid2')::uuid);
select test.eq(pg_temp.events(current_setting('test.i1')::uuid), 2::bigint, 'the same request twice: one history row');
select test.fails(format($$select public.fleet_update_issue(%L, '{"status":"scheduled"}', gen_random_uuid())$$, current_setting('test.i1')),
  'issue_invalid', 'a change that changes nothing is refused');
select test.fails(format($$select public.fleet_update_issue(%L, jsonb_build_object('booking_id', %L), gen_random_uuid())$$,
  current_setting('test.i1'), current_setting('test.b_v2')), 'issue_invalid', 'a booking of another vehicle cannot be linked');
-- Photos added later by the manager.
select pg_temp.upload(pg_temp.path('v1', current_setting('test.i1')::uuid, 'm.jpg'));
select test.eq(jsonb_array_length((public.fleet_update_issue(current_setting('test.i1')::uuid,
  jsonb_build_object('add_photos', jsonb_build_array(pg_temp.path('v1', current_setting('test.i1')::uuid, 'm.jpg'))), gen_random_uuid())->'photos')), 2,
  'the manager adds a photo');
select test.ok((select count(*) = 3 from jsonb_array_elements(public.fleet_issue_detail(current_setting('test.i1')::uuid)->'events')), 'every change in the history');
select test.eq(pg_temp.audits(current_setting('test.i1')::uuid), 3::bigint, 'and in the company log');
select test.eq((pg_temp.issue(current_setting('test.i1')::uuid)).title, 'Bec far stânga ars', 'the title stays as reported');

-- The driver of the vehicle still reads the report and its photos; delete of an attached photo is the manager's only.
select test.login(test.id('client_b'));
select test.ok(pg_temp.readable(pg_temp.path('v1', current_setting('test.i1')::uuid, 'm.jpg')), 'the vehicle''s driver sees the photos');
-- (Supabase refuses direct deletes in SQL; the delete policy's function is checked as the Storage API would.)
select test.ok(not public.fleet_issue_photo_can_delete(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'), test.id('client_b')),
  'the reporter cannot delete an attached photo');
select test.login(test.id('mgr'));
select test.ok(public.fleet_issue_photo_can_delete(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'), test.id('client_b')),
  'issues.manage can');
select test.login(test.id('client_b'));
-- A plate change keeps the label.
select test.login(test.id('client_a'));
select public.fleet_save_vehicle(test.id('co'), test.id('v1'), '{"make":"Dacia","model":"Logan","plate":"B 999 NEW"}', gen_random_uuid());
select test.eq((public.fleet_issue_detail(current_setting('test.i1')::uuid)->'vehicle_label')->>'plate', 'B 401 FLT', 'the label keeps the plate at report time');

-- ------------------------------------------------------------------ receipts keep the M1 rules
select test.login(test.id('acc'));
select pg_temp.upload(test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg');
select test.ok(pg_temp.readable(test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg'), 'a receipt: costs.manage uploads and reads it');
select test.login(test.id('client_b'));
select test.ok(not pg_temp.readable(test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg'), 'a driver without costs.view does not');
select test.login(test.id('appr'));
select test.ok(pg_temp.readable(test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg'), 'costs.view (from quotes.approve) does');

-- ------------------------------------------------------------------ 3, 4, 6, 7, 8, 11: the cleanup's list
select test.login(test.id('client_b'));
select pg_temp.upload(pg_temp.path('v1', current_setting('test.i3')::uuid, 'early.jpg'));
select pg_temp.upload(pg_temp.path('v1', current_setting('test.i3')::uuid, 'late.jpg'));
select test.logout();
select pg_temp.age(pg_temp.path('v1', current_setting('test.i3')::uuid, 'early.jpg'), interval '47 hours 59 minutes');
select pg_temp.age(pg_temp.path('v1', current_setting('test.i3')::uuid, 'late.jpg'), interval '48 hours 1 minute');
select pg_temp.age(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg'), interval '1 year');
select pg_temp.age(test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg', interval '1 year');
select test.ok(not (pg_temp.path('v1', current_setting('test.i3')::uuid, 'early.jpg') = any (pg_temp.orphans())), '3: unattached, 47h59: kept');
select test.ok(pg_temp.path('v1', current_setting('test.i3')::uuid, 'late.jpg') = any (pg_temp.orphans()), '4: unattached, 48h01: listed');
select test.ok(not (pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg') = any (pg_temp.orphans())), '7: attached, one year old: never listed');
select test.ok(not (test.id('co')::text || '/' || test.id('v1')::text || '/receipt.jpg' = any (pg_temp.orphans())), '8: a receipt, one year old: never listed');
select test.ok((select bool_and(public.fleet_issue_path(x)) from unnest(pg_temp.orphans()) x), 'only exact issue paths are ever listed');
select test.login(test.id('client_b'));
select test.fails(format($$select pg_temp.report(%L, 'v1', jsonb_build_object('photos', jsonb_build_array(%L)))$$,
  current_setting('test.i3'), pg_temp.path('v1', current_setting('test.i3')::uuid, 'late.jpg')), 'photo_expired', '6: a listed photo cannot be attached');
select test.fails(format($$select pg_temp.report(%L, 'v1', jsonb_build_object('photos', jsonb_build_array(%L)))$$,
  current_setting('test.i3'), pg_temp.path('v1', current_setting('test.i3')::uuid, 'early.jpg')), 'photo_expired', '5: nor one 24–47 hours old');
-- 11: removed from the company after the upload.
select set_config('test.i4', gen_random_uuid()::text, true);
select test.login(test.id('drv2'));
select pg_temp.upload(pg_temp.path('v2', current_setting('test.i4')::uuid, 'gone.jpg'));
select test.login(test.id('client_a'));
select public.remove_company_member(test.id('m_drv2'), gen_random_uuid());
select test.login(test.id('drv2'));
select test.ok(not pg_temp.readable(pg_temp.path('v2', current_setting('test.i4')::uuid, 'gone.jpg')), '11: a removed member cannot read their own photo');
select test.fails(format($$select public.fleet_issue_detail(%L)$$, current_setting('test.i2')), 'issue_not_found', '11: nor their report');
select test.logout();
select pg_temp.age(pg_temp.path('v2', current_setting('test.i4')::uuid, 'gone.jpg'), interval '49 hours');
select test.ok(pg_temp.path('v2', current_setting('test.i4')::uuid, 'gone.jpg') = any (pg_temp.orphans()), '11: listed after 48 hours');
select test.ok(not public.fleet_issue_photo_orphan(pg_temp.path('v1', current_setting('test.i1')::uuid, 'a.jpg')), 'the re-check before delete: attached is never an orphan');
select test.ok(public.fleet_issue_photo_orphan(pg_temp.path('v2', current_setting('test.i4')::uuid, 'gone.jpg')), 'an orphan is confirmed');

-- The browser cannot list orphans nor read the tables.
select test.login(test.id('client_a'));
select test.fails('select public.fleet_issue_photo_orphans(10)', 'permission denied', 'the cleanup list is the service role''s only');
select test.fails('select 1 from public.fleet_issues', 'permission denied', 'the table is closed to the browser');
select test.fails('select 1 from public.fleet_issue_events', 'permission denied', 'the history table too');

rollback;
