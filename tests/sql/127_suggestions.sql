-- Sugestii (T26): clients and shops write ideas, at most 5 a day; the author reads only their own;
-- the admin lists them all and sets their state (in the audit log); nobody writes the table directly.
begin;
select test.make_world();

-- ------------------------------------------------------------------ writing
select test.login(test.id('client_a'));
select test.fails($$select public.submit_suggestion('   ', test.rid())$$, 'suggestion_empty', 'not empty');
select test.fails($$select public.submit_suggestion(repeat('a', 1001), test.rid())$$, 'suggestion_too_long',
  'at most 1,000 characters');
select test.eq(public.submit_suggestion('  Filtru după marca mașinii  ', '00000000-0000-4000-8000-000000000127')->>'status',
  'new', 'client_a writes one: new');
select test.eq(public.submit_suggestion('  Filtru după marca mașinii  ', '00000000-0000-4000-8000-000000000127')->>'status',
  'new', 'the same request twice is one');
select test.eq((select count(*) from public.suggestions), 1::bigint, 'the author reads it');
select test.eq((select body from public.suggestions), 'Filtru după marca mașinii', 'trimmed');
select test.fails(format($$insert into public.suggestions (author_id, author_role, body) values (%L, 'client', 'x')$$,
  test.id('client_a')), 'permission denied', 'not written from the browser');
select test.fails($$update public.suggestions set status = 'done'$$, 'permission denied', 'the author cannot set the state');

-- At most 5 a day (the repeated request above counted once).
select public.submit_suggestion('Idee ' || n, test.rid()) from generate_series(2, 5) n;
select test.fails($$select public.submit_suggestion('A șasea', test.rid())$$, 'limit_suggestions', 'at most 5 a day');
select test.eq((select count(*) from public.suggestions), 5::bigint, 'five written');
select test.ok(jsonb_array_length(public.export_my_data()->'suggestions') = 5, 'in "Datele mele"');
select test.ok(public.export_my_data() ? 'slot_waitlist', 'with what was there before');

select test.login(test.id('client_b'));
select test.eq((select count(*) from public.suggestions), 0::bigint, 'another client does not see them');
select test.fails($$select public.admin_list_suggestions()$$, 'not_allowed', 'a client does not list them all');

-- A colleague of a shop writes for the shop.
select test.login(test.id('staff1'));
select public.submit_suggestion('Export lunar în PDF', test.rid());
select test.eq((select count(*) from public.suggestions), 1::bigint, 'the colleague sees only their own');
select test.fails(format($$select public.admin_set_suggestion_status(%L, 'done', test.rid())$$,
  (select id from public.suggestions limit 1)), 'not_allowed', 'a shop does not set the state');

select test.login(test.id('admin'));
select test.fails($$select public.submit_suggestion('Din partea echipei', test.rid())$$, 'not_allowed',
  'the admin is the team: no suggestions from that side');

-- ------------------------------------------------------------------ the admin
select test.eq((public.admin_list_suggestions()->>'new')::int, 6, 'six new');
select test.eq(jsonb_array_length(public.admin_list_suggestions()->'items'), 6, 'all of them');
select test.eq((select x->>'shop_name' from jsonb_array_elements(public.admin_list_suggestions()->'items') x
  where x->>'body' = 'Export lunar în PDF'), 'Atelier Unu', 'with the shop of the colleague');
select test.eq((select x->>'role' from jsonb_array_elements(public.admin_list_suggestions()->'items') x
  where x->>'body' = 'Filtru după marca mașinii'), 'client', 'and who wrote it');
select test.eq((select count(*) from public.suggestions), 0::bigint, 'the table itself stays closed to the admin too');
select set_config('test.s', (select x->>'id' from jsonb_array_elements(public.admin_list_suggestions()->'items') x
  where x->>'body' = 'Filtru după marca mașinii'), true);

select test.fails(format($$select public.admin_set_suggestion_status(%L, 'maybe', test.rid())$$, current_setting('test.s')),
  'status_invalid', 'only the four states');
select test.fails($$select public.admin_set_suggestion_status(gen_random_uuid(), 'done', test.rid())$$,
  'suggestion_not_found', 'an unknown suggestion');
select test.eq(public.admin_set_suggestion_status(current_setting('test.s')::uuid, 'planned', test.rid())->>'status',
  'planned', 'planned');
select test.eq((select count(*) from public.admin_audit_log where action = 'update_suggestion'
  and entity_id = current_setting('test.s') and after->>'suggestion_status' = 'planned'), 1::bigint, 'in the audit log');
select test.eq((public.admin_list_suggestions()->>'new')::int, 5, 'one fewer new');

-- Without the second step (aal1) the admin cannot.
select test.login(test.id('admin'), 'aal1');
select test.fails($$select public.admin_list_suggestions()$$, 'mfa_required', 'the code from the phone first');

-- The author sees the new state.
select test.login(test.id('client_a'));
select test.eq((select status from public.suggestions where id = current_setting('test.s')::uuid), 'planned',
  'the author sees it planned');

select test.logout();
rollback;
