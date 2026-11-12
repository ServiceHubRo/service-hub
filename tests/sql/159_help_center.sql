-- A4 — Help Center: who reads what (account type, company role, the team), drafts never reach
-- readers, English only where it exists, feedback one vote per account on readable articles only,
-- administration only by the admin after the second step (every write refused to everyone else),
-- content validation (no HTML, scripts or unsafe links), history of every version, the audit log,
-- deletion rules, ordering, and the reader's data export.
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

-- The slugs a reader sees, in one language.
create function test.help_slugs(p_lang text default 'ro') returns text[]
language sql as $$
  select array(select x->>'slug' from jsonb_array_elements(public.help_center(p_lang)->'articles') x order by 1)
$$;
grant execute on function test.help_slugs(text) to public;

create function test.help_id(p_slug text) returns uuid
language sql security definer as $$ select id from public.help_articles where slug = p_slug $$;
grant execute on function test.help_id(text) to public;
create function test.help_cat_id(p_slug text) returns uuid
language sql security definer as $$ select id from public.help_categories where slug = p_slug $$;
grant execute on function test.help_cat_id(text) to public;

select set_config('test.plain', test.sign_up('plain@test.local', '{"role":"client","name":"Paul Simplu","lang":"ro","terms_version":"2026-09"}')::text, true);
select set_config('test.agent', test.sign_up('helpagent@test.local', '{"role":"client","name":"Ioana Suport","lang":"ro","terms_version":"2026-09"}')::text, true);

create function test.article(p jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('category_id', current_setting('test.cat_drivers'), 'slug', 'test-articol', 'kind', 'article',
    'audience', '["client"]'::jsonb, 'title_ro', 'Articol de test', 'body_ro', 'Un text de test pentru articol.') || p
$$;
grant execute on function test.article(jsonb) to public;

-- A refusal naming the field: field_invalid with {"field": …}.
create function test.fails_field(statement text, expected_field text, description text) returns void
language plpgsql as $$
declare
  msg text;
  det text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics msg = message_text, det = pg_exception_detail;
    if msg <> 'field_invalid' or coalesce(det::jsonb->>'field', '') <> expected_field then
      raise exception 'FAILED: % (expected field_invalid %, got "%" %)', description, expected_field, msg, det;
    end if;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded: %)', description, statement;
end
$$;
grant execute on function test.fails_field(text, text, text) to public;

-- ------------------------------------------------------------------ the tables are closed
select test.login(current_setting('test.plain')::uuid);
select test.fails($$select * from public.help_articles$$, 'permission denied', 'a client cannot read the articles table');
select test.fails($$select * from public.help_categories$$, 'permission denied', 'nor the categories');
select test.fails($$select * from public.help_feedback$$, 'permission denied', 'nor the feedback');
select test.fails($$select * from public.help_article_revisions$$, 'permission denied', 'nor the history');
select test.fails($$insert into public.help_feedback (article_id, user_id, helpful) values (test.help_id('autentificare'), auth.uid(), true)$$,
  'permission denied', 'nor write a vote directly');
select test.fails($$update public.help_articles set status = 'published'$$, 'permission denied', 'nor publish directly');
select test.login_anon();
select test.fails($$select public.help_center('ro')$$, 'permission denied', 'signed out: no Help Center (in-app only)');
select test.fails($$select * from public.help_articles$$, 'permission denied', 'signed out: no table');

-- ------------------------------------------------------------------ who reads what
-- A client without a company: driver and general articles; creating a company (fleets are on);
-- never shop, fleet or team articles.
select test.login(current_setting('test.plain')::uuid);
select test.ok('masini-garaj' = any (test.help_slugs()), 'a client reads driver articles');
select test.ok('autentificare' = any (test.help_slugs()), 'and general ones');
select test.ok('cont-firma' = any (test.help_slugs()), 'and how to create a company (fleets on)');
select test.ok(not ('devize-service' = any (test.help_slugs())), 'never a shop article');
select test.ok(not ('administrare-flota' = any (test.help_slugs())), 'never a fleet article without a company');
select test.ok(not ('facturi-plati' = any (test.help_slugs())), 'never shop billing');
select test.eq((public.help_center('ro')->'me'->'types')::text, '["client"]', 'its audiences: client');
select test.ok(not exists (select 1 from jsonb_array_elements(public.help_center('ro')->'categories') c where c->>'slug' = 'service-uri'),
  'the shop category is not listed for a client');

-- Fleets off for everyone: the company article disappears.
select test.logout();
update public.platform_settings set fleet_enabled = false where id = 1;
select test.login(current_setting('test.plain')::uuid);
select test.ok(not ('cont-firma' = any (test.help_slugs())), 'fleets off: no company article');
select test.logout();
update public.platform_settings set fleet_enabled = true where id = 1;

-- Company members: their role decides the fleet articles.
select test.login(test.id('client_a'));  -- company admin
select test.eq((public.help_center('ro')->'me'->'types')::text, '["client", "fleet"]', 'a company member is client and fleet');
select test.ok('invitare-membri' = any (test.help_slugs()), 'the company admin reads how to invite');
select test.ok('costuri-reparatii' = any (test.help_slugs()), 'and costs');
select test.ok('masini-garaj' = any (test.help_slugs()), 'and keeps the driver articles');
select test.login(test.id('acc'));  -- accountant
select test.ok('costuri-reparatii' = any (test.help_slugs()), 'the accountant reads costs');
select test.ok(not ('invitare-membri' = any (test.help_slugs())), 'but not how to invite members');
select test.login(test.id('drv2'));  -- driver
select test.ok('administrare-flota' = any (test.help_slugs()), 'a driver reads the fleet overview');
select test.ok(not ('costuri-reparatii' = any (test.help_slugs())), 'but not costs');
select test.ok(not ('gestionare-soferi' = any (test.help_slugs())), 'nor managing drivers');

-- A shop: shop and general articles, never driver or fleet ones.
select test.login(test.id('owner1'));
select test.ok('devize-service' = any (test.help_slugs()), 'a shop reads shop articles');
select test.ok('recuperare-parola' = any (test.help_slugs()), 'and general ones');
select test.ok(not ('masini-garaj' = any (test.help_slugs())), 'never driver articles');
select test.ok(not ('cont-firma' = any (test.help_slugs())), 'never the company article');
select test.eq((public.help_center('ro')->'me'->'types')::text, '["shop"]', 'its audience: shop');

-- The team: an agent needs the second step and a live session, then reads everything published.
select test.login(test.id('admin'));
select public.admin_grant_support((select display_id from public.profiles where id = current_setting('test.agent')::uuid), 'Echipa suport', test.rid());
select test.logout();
insert into auth.sessions (id, user_id) values ('59000000-0000-4000-8000-000000000001', current_setting('test.agent')::uuid);
select test.login_session(current_setting('test.agent')::uuid, '59000000-0000-4000-8000-000000000001', 'aal1');
select test.fails($$select public.help_center('ro')$$, 'mfa_required', 'an agent before the second step: refused');
select test.login_session(current_setting('test.agent')::uuid, '59000000-0000-4000-8000-000000000001');
select test.ok('devize-service' = any (test.help_slugs()) and 'masini-garaj' = any (test.help_slugs())
  and 'costuri-reparatii' = any (test.help_slugs()), 'the agent reads every audience');
select test.eq((public.help_center('ro')->'me'->>'staff')::boolean, true, 'and is the team');
select test.fails($$select public.admin_help_list()$$, 'not_allowed', 'an agent never manages the Help Center');
select test.fails($$select public.admin_help_save_article(null, '{}', test.rid())$$, 'not_allowed', 'nor writes an article');

select test.login(test.id('client_a'));
select test.fails($$select public.help_center('fr')$$, 'field_invalid', 'only ro and en');

-- ------------------------------------------------------------------ administration: admin only
select test.login(current_setting('test.plain')::uuid);
select test.fails($$select public.admin_help_list()$$, 'not_allowed', 'a client cannot list the admin view');
select test.fails($$select public.admin_help_set_article_status(test.help_id('autentificare'), 'archived', test.rid())$$, 'not_allowed', 'nor withdraw an article');
select test.fails($$select public.admin_help_delete_category(test.help_cat_id('cont'), test.rid())$$, 'not_allowed', 'nor delete a category');
select test.login(test.id('owner1'));
select test.fails($$select public.admin_help_move('article', test.help_id('devize-service'), -1, test.rid())$$, 'not_allowed', 'a shop cannot reorder');
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_help_list()$$, 'mfa_required', 'the admin needs the second step');

select test.login(test.id('admin'));
select test.eq(jsonb_array_length(public.admin_help_list()->'categories'), 5, 'the admin lists the 5 categories');
select set_config('test.cat_drivers', test.help_cat_id('soferi')::text, true);

-- Validation: every field named.
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"title_ro": "<b>X</b> titlu"}'), test.rid())$$, 'help_title_ro', 'raw HTML refused in a title');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"body_ro": "Text <script>alert(1)</script> aici."}'), test.rid())$$, 'help_body_ro', 'a script refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"body_ro": "Deschide [aici](javascript:alert(1)) acum."}'), test.rid())$$, 'help_body_ro', 'a javascript: link refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"body_ro": "Deschide [aici](http://exemplu.ro) acum."}'), test.rid())$$, 'help_body_ro', 'an http link refused (https only)');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"body_ro": "Valoarea {{company}} nu se completează."}'), test.rid())$$, 'help_body_ro', 'placeholders refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"body_ro": "Text <!-- comentariu --> aici."}'), test.rid())$$, 'help_body_ro', 'HTML comments refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"title_en": "Only a title"}'), test.rid())$$, 'help_body_en', 'English title without text refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"slug": "Cu Spatii"}'), test.rid())$$, 'help_slug', 'a bad slug refused');
select test.fails($$select public.admin_help_save_article(null, test.article('{"slug": "autentificare"}'), test.rid())$$, 'slug_taken', 'a slug in use refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"audience": ["everyone"]}'), test.rid())$$, 'help_audience', 'an unknown audience refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article('{"company_roles": ["driver"]}'), test.rid())$$, 'help_company_roles', 'company roles only on fleet articles');
select test.fails($$select public.admin_help_save_article(null, test.article('{"category_id": "00000000-0000-4000-8000-000000000000"}'), test.rid())$$, 'category_not_found', 'an unknown category refused');
select test.fails_field($$select public.admin_help_save_article(null, test.article(jsonb_build_object('keywords_ro', array_fill('cuvant'::text, array[21]))), test.rid())$$, 'help_keywords_ro', 'at most 20 keywords');

-- A safe link and Markdown are kept.
select set_config('test.new_rid', gen_random_uuid()::text, true);
select set_config('test.new', (public.admin_help_save_article(null,
  test.article('{"body_ro": "Vezi [pagina](https://service-hub.ro/verifica) sau scrie la [email](mailto:contact@service-hub.ro). Poți folosi **bold**."}'),
  current_setting('test.new_rid')::uuid))->>'id', true);
select test.eq(public.admin_help_get_article(current_setting('test.new')::uuid)->>'status', 'draft', 'a new article starts as a draft');
select test.eq(public.admin_help_save_article(null, test.article(), current_setting('test.new_rid')::uuid)->>'id', current_setting('test.new'),
  'the same request id twice: the first answer, nothing created twice');
select test.eq((select count(*) from jsonb_array_elements(public.admin_help_list()->'articles') a where a->>'slug' = 'test-articol'), 1::bigint,
  'one article created');

-- A draft never reaches a reader.
select test.login(current_setting('test.plain')::uuid);
select test.ok(not ('test-articol' = any (test.help_slugs())), 'a draft is not shown to readers');
select test.fails(format($$select public.help_send_feedback(%L, true, test.rid())$$, current_setting('test.new')), 'article_not_found',
  'nor can it be rated');

-- Edit, publish: the reader sees it, in Romanian only until English exists.
select test.login(test.id('admin'));
select public.admin_help_save_article(current_setting('test.new')::uuid,
  test.article('{"title_ro": "Articol de test schimbat", "keywords_ro": ["test", "proba"]}'), test.rid());
select public.admin_help_set_article_status(current_setting('test.new')::uuid, 'published', test.rid());
select test.fails(format($$select public.admin_help_set_article_status(%L, 'published', test.rid())$$, current_setting('test.new')), 'wrong_status',
  'publishing twice refused');
select test.login(current_setting('test.plain')::uuid);
select test.ok('test-articol' = any (test.help_slugs('ro')), 'published: readers see it');
select test.ok(not ('test-articol' = any (test.help_slugs('en'))), 'not in English without an English text');
select test.ok((public.help_center('en')->'untranslated') ? 'test-articol', 'listed as untranslated in English');
select test.ok(not ((public.help_center('ro')->'untranslated') ? 'test-articol'), 'never untranslated in Romanian');
select test.ok(not exists (select 1 from jsonb_array_elements(public.help_center('en')->'articles') a where a->>'body' is null),
  'English never shows an article without its English text');

select test.login(test.id('admin'));
select public.admin_help_save_article(current_setting('test.new')::uuid,
  test.article('{"title_ro": "Articol de test schimbat", "keywords_ro": ["test", "proba"], "title_en": "Test article", "body_en": "A test text for the article."}'), test.rid());
select test.login(current_setting('test.plain')::uuid);
select test.ok('test-articol' = any (test.help_slugs('en')), 'with English it is shown in English');
select test.eq((select a->>'title' from jsonb_array_elements(public.help_center('en')->'articles') a where a->>'slug' = 'test-articol'),
  'Test article', 'in the English text only');

-- History and the audit log.
select test.login(test.id('admin'));
select test.eq((select string_agg(r->>'action', ',') from jsonb_array_elements(public.admin_help_get_article(current_setting('test.new')::uuid)->'revisions') r),
  'update,publish,update,create', 'every version is in the history, newest first');
select test.eq((public.admin_help_get_article(current_setting('test.new')::uuid)->>'version')::int, 4, 'the version counts every change');
select test.ok((select bool_and((r->'snapshot') ? 'body_ro') from jsonb_array_elements(public.admin_help_get_article(current_setting('test.new')::uuid)->'revisions') r),
  'each version keeps the text as saved');
select public.admin_help_save_article(current_setting('test.new')::uuid,
  test.article('{"title_ro": "Articol de test schimbat", "keywords_ro": ["test", "proba"], "title_en": "Test article", "body_en": "A test text for the article."}'), test.rid());
select test.eq((public.admin_help_get_article(current_setting('test.new')::uuid)->>'version')::int, 4, 'an unchanged save makes no new version');
select test.logout();
select test.eq((select string_agg(action, ',' order by created_at) from public.admin_audit_log where entity_id = current_setting('test.new')),
  'create_help_article,update_help_article,publish_help_article,update_help_article', 'every admin write is in the audit log');
select test.ok((select bool_and(not (coalesce(before, '{}') ? 'body_ro') and not (coalesce(after, '{}') ? 'body_ro'))
  from public.admin_audit_log where entity_id = current_setting('test.new')), 'the log never keeps the long texts');
select test.eq((select string_agg(distinct public.audit_class(action), ',') from public.admin_audit_log where entity_type like 'help_%'), 'admin',
  'the Help Center actions are administrative in the retention classes');

-- A team-only article is never shown to a client; the agent reads it.
select test.login(test.id('admin'));
select set_config('test.internal', (public.admin_help_save_article(null,
  test.article('{"slug": "intern-echipa", "audience": ["staff"], "title_ro": "Doar pentru echipă"}'), test.rid()))->>'id', true);
select public.admin_help_set_article_status(current_setting('test.internal')::uuid, 'published', test.rid());
select test.login(current_setting('test.plain')::uuid);
select test.ok(not ('intern-echipa' = any (test.help_slugs())), 'a team article is not shown to a client');
select test.login(test.id('owner1'));
select test.ok(not ('intern-echipa' = any (test.help_slugs())), 'nor to a shop');
select test.login_session(current_setting('test.agent')::uuid, '59000000-0000-4000-8000-000000000001');
select test.ok('intern-echipa' = any (test.help_slugs()), 'the agent reads it');

-- ------------------------------------------------------------------ feedback
select test.login(current_setting('test.plain')::uuid);
select set_config('test.vote_rid', gen_random_uuid()::text, true);
select test.eq(public.help_send_feedback(test.help_id('masini-garaj'), true, current_setting('test.vote_rid')::uuid)->>'helpful', 'true', 'a reader votes');
select test.eq(public.help_send_feedback(test.help_id('masini-garaj'), false, current_setting('test.vote_rid')::uuid)->>'helpful', 'true',
  'the same request id again: the first answer, nothing changed');
select public.help_send_feedback(test.help_id('masini-garaj'), false, test.rid());
select test.eq(public.help_center('ro')->'votes'->>(test.help_id('masini-garaj')::text), 'false', 'voting again changes the vote');
select test.fails($$select public.help_send_feedback(test.help_id('devize-service'), true, test.rid())$$, 'article_not_found',
  'a client cannot rate a shop article');
select test.fails($$select public.help_send_feedback(test.help_id('masini-garaj'), null, test.rid())$$, 'field_invalid', 'a vote is yes or no');
select test.ok(public.export_my_data()->'help_feedback' @> '[{"helpful": false}]', 'the vote is in the reader''s data export');
select test.login(test.id('client_a'));
select public.help_send_feedback(test.help_id('masini-garaj'), true, test.rid());
select test.eq(public.help_center('ro')->'votes'->>(test.help_id('masini-garaj')::text), 'true', 'each reader sees only its own vote');
select test.eq(jsonb_array_length(public.export_my_data()->'help_feedback'), 1, 'and exports only its own');
select test.logout();
select test.eq((select count(*) from public.help_feedback where article_id = test.help_id('masini-garaj')), 2::bigint, 'one vote per account');

select test.login(test.id('admin'));
select test.eq((select (a->>'helpful')::int || '/' || (a->>'not_helpful')::int from jsonb_array_elements(public.admin_help_list()->'articles') a
  where a->>'slug' = 'masini-garaj'), '1/1', 'the admin sees only the totals');
select test.ok(not (public.admin_help_list()::text like '%' || test.id('client_a')::text || '%'), 'never who voted');

-- ------------------------------------------------------------------ deletion and order
select test.fails(format($$select public.admin_help_delete_article(%L, test.rid())$$, test.help_id('masini-garaj')), 'article_published',
  'a published article is withdrawn before it is deleted');
select public.admin_help_set_article_status(test.help_id('masini-garaj'), 'archived', test.rid());
select test.login(current_setting('test.plain')::uuid);
select test.ok(not ('masini-garaj' = any (test.help_slugs())), 'a withdrawn article is not shown');
select test.login(test.id('admin'));
select public.admin_help_delete_article(test.help_id('masini-garaj'), test.rid());
select test.logout();
select test.eq((select count(*) from public.help_feedback f where not exists (select 1 from public.help_articles a where a.id = f.article_id)), 0::bigint,
  'its votes go with it');
select test.ok(exists (select 1 from public.admin_audit_log where action = 'delete_help_article'), 'the deletion is logged');

select test.login(test.id('admin'));
select test.fails($$select public.admin_help_delete_category(test.help_cat_id('cont'), test.rid())$$,
  'category_not_empty', 'a category with articles cannot be deleted');
select test.fails($$select public.admin_help_move('category', test.help_cat_id('soferi'), -1, test.rid())$$,
  'cannot_move', 'the first category cannot move up');
select public.admin_help_move('category', test.help_cat_id('cont'), -1, test.rid());
select test.eq((select string_agg(c->>'slug', ',') from jsonb_array_elements(public.admin_help_list()->'categories') c),
  'soferi,service-uri,cont,firme,abonamente', 'a category moves one place');
select public.admin_help_move('article', test.help_id('autentificare'), 1, test.rid());
select test.eq((select (a->>'position')::int from jsonb_array_elements(public.admin_help_list()->'articles') a where a->>'slug' = 'autentificare'), 2,
  'an article moves inside its category');

-- A new, empty, hidden category: never shown to readers; then deleted.
select set_config('test.cat', (public.admin_help_save_category(null, '{"slug": "noua", "name_ro": "Categorie nouă", "name_en": "New category", "active": false}', test.rid()))->>'id', true);
select test.fails_field($$select public.admin_help_save_category(null, '{"slug": "noua2", "name_ro": "<i>X</i>", "name_en": "New"}', test.rid())$$, 'help_name_ro', 'HTML in a category name refused');
select test.fails_field($$select public.admin_help_save_category(null, '{"slug": "noua3", "name_ro": "Categorie", "name_en": "Category", "icon": "rocket"}', test.rid())$$, 'help_icon', 'an unknown icon refused');
select public.admin_help_delete_category(current_setting('test.cat')::uuid, test.rid());
select test.ok(not exists (select 1 from jsonb_array_elements(public.admin_help_list()->'categories') c where c->>'slug' = 'noua'), 'an empty category is deleted');

-- A hidden category hides its articles from readers.
select public.admin_help_save_category(test.help_cat_id('cont'),
  '{"slug": "cont", "icon": "shield", "name_ro": "Cont și securitate", "name_en": "Account and security", "active": false}', test.rid());
select test.login(current_setting('test.plain')::uuid);
select test.ok(not ('autentificare' = any (test.help_slugs())), 'a hidden category hides its articles');

-- The seeded content follows its own rules: everything published has both languages.
select test.logout();
select test.eq((select count(*) from public.help_articles where status = 'published' and slug not in ('test-articol', 'intern-echipa') and title_en is null), 0::bigint,
  'every seeded article has English');
select test.ok((select bool_and(public.help_text_ok(body_ro, 10, 20000) and public.help_text_ok(body_en, 10, 20000)) from public.help_articles where slug not in ('test-articol', 'intern-echipa')), 'and passes the content check');

rollback;
