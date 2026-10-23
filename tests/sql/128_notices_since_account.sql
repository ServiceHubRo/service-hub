-- A notice reaches the accounts that existed when it was sent (19 Oct): a new account does not get
-- the old ones; the admin sees them all.
begin;
select test.make_world();

select test.login(test.id('admin'));
select set_config('test.notice', (public.admin_send_notice('all', null, 'Anunț vechi', 'Trimis înainte.',
  null, null, false, test.rid()))->>'id', true);
select test.logout();
-- Sent an hour ago (in a test everything happens at the same instant).
update public.notices set created_at = now() - interval '1 hour' where id = current_setting('test.notice')::uuid;
update public.profiles set created_at = now() - interval '1 day' where id = test.id('client_a');

select test.login(test.id('client_a'));
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 1::bigint,
  'an account older than the notice sees it');

select test.logout();
select set_config('test.new', test.sign_up('nou@test.local', '{"role":"client","name":"Cont Nou"}')::text, true);
select test.login(current_setting('test.new')::uuid);
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 0::bigint,
  'a new account does not see a notice sent before it existed');

select test.login(test.id('admin'));
select test.eq(test.count(format($$select 1 from public.notices where id = '%s'$$, current_setting('test.notice'))), 1::bigint,
  'the admin sees it');

select test.logout();
rollback;
