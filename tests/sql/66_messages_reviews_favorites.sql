-- send_message, mark_thread_read, submit_review, reply_review, report_review, toggle_favorite
-- (ARCHITECTURE §2, §6). Message rate limit and "only with a booking": 65_limits.sql.
begin;
select test.make_world();

-- ------------------------------------------------------------------ messages
select set_config('test.rid', test.rid()::text, true);
select test.login(test.id('client_a'));
select set_config('test.m1', (public.send_message(test.id('thread_a'), '  Bună ziua, pot veni mai devreme?  ', current_setting('test.rid')::uuid)).id::text, true);
select test.eq((public.send_message(test.id('thread_a'), 'altceva', current_setting('test.rid')::uuid)).id::text, current_setting('test.m1'),
  'same request id returns the first message');
select test.logout();
select test.eq(count(*), 1::bigint, 'replay stored one message') from public.messages
where thread_id = test.id('thread_a') and sender_id = test.id('client_a') and body like 'Bună ziua%';
select test.eq(m.kind, 'user', 'user message'), test.eq(m.body, 'Bună ziua, pot veni mai devreme?', 'body trimmed'),
       test.eq(t.last_message_at, m.created_at, 'thread moves to the top'),
       test.eq(t.client_last_read_at, m.created_at, 'the sender has read their own message')
from public.messages m join public.threads t on t.id = m.thread_id where m.id = current_setting('test.m1')::uuid;
select test.eq(count(*), 2::bigint, 'owner and staff notified'),
       test.eq(min(params->>'preview'), 'Bună ziua, pot veni mai devreme?', 'with a preview'),
       test.eq(min(params->>'sender_name'), 'Ana Marin', 'and the sender''s name')
from public.notification_events where event = 'new_message' and params->>'thread_id' = test.id('thread_a')::text;

select test.login(test.id('staff1'));
select public.send_message(test.id('thread_a'), 'Sigur, vă așteptăm.', gen_random_uuid());
select test.logout();
select test.eq(count(*), 1::bigint, 'shop reply notifies only the client')
from public.notification_events where event = 'new_message' and user_id = test.id('client_a');
select test.eq(params->>'sender_name', 'Atelier Unu', 'shop replies under the shop name')
from public.notification_events where event = 'new_message' and user_id = test.id('client_a');
select test.ok(shop_last_read_at is not null, 'shop side marked read by its reply') from public.threads where id = test.id('thread_a');

select test.login(test.id('client_a'));
select test.fails(format($$select public.send_message(%L, '   ', gen_random_uuid())$$, test.id('thread_a')), 'message_empty', 'empty message refused');
select test.fails(format($$select public.send_message(%L, repeat('x', 4001), gen_random_uuid())$$, test.id('thread_a')), 'message_too_long', 'at most 4000 characters');
select test.fails(format($$select public.send_message(%L, 'hi', gen_random_uuid())$$, test.id('thread_b')), 'not_allowed', 'cannot write in another client''s thread');
select test.fails(format($$select public.send_message(%L, 'hi', gen_random_uuid())$$, gen_random_uuid()), 'thread_not_found', 'unknown thread');
select test.logout();
select test.login(test.id('owner2'));
select test.fails(format($$select public.send_message(%L, 'hi', gen_random_uuid())$$, test.id('thread_a')), 'not_allowed', 'another shop cannot write in the thread');
select test.logout();

-- Read markers.
update public.threads set client_last_read_at = null, shop_last_read_at = null where id = test.id('thread_a');
select test.login(test.id('client_a'));
select public.mark_thread_read(test.id('thread_a'));
select test.logout();
select test.ok(client_last_read_at is not null and shop_last_read_at is null, 'client marker only')
from public.threads where id = test.id('thread_a');
select test.login(test.id('owner1'));
select public.mark_thread_read(test.id('thread_a'));
select test.logout();
select test.ok(shop_last_read_at is not null, 'shop marker') from public.threads where id = test.id('thread_a');
select test.login(test.id('client_b'));
select test.fails(format($$select public.mark_thread_read(%L)$$, test.id('thread_a')), 'not_allowed', 'cannot mark someone else''s thread');
select test.logout();

-- The first booking between a pair opens their thread, named after the client.
select test.book(test.id('client_b'), test.id('shop1'), test.workday(1), '10:00');
select test.eq(client_name, 'Bogdan Pop', 'new thread carries the client''s name')
from public.threads where shop_id = test.id('shop1') and client_id = test.id('client_b');

-- ------------------------------------------------------------------ reviews
select test.eq(public.review_display_name('Andrei Marin'), 'Andrei M.', 'display name: first name + initial');
select test.eq(public.review_display_name('Maria del carmen'), 'Maria C.', 'display name: last word''s initial');
select test.eq(public.review_display_name('Ion'), 'Ion', 'display name: one word');
select test.eq(public.review_display_name('  '), 'Client', 'display name: none');

select set_config('test.done', test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', test.today() - 1, '10:00')::text, true);
select set_config('test.old', test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', test.today() - 61, '10:00')::text, true);
select set_config('test.edge', test.raw_booking(test.id('shop1'), test.id('client_a'), 'done', test.today() - 59, '10:00')::text, true);
select set_config('test.open', test.raw_booking(test.id('shop1'), test.id('client_a'), 'confirmed', test.workday(2), '10:00')::text, true);

select test.login(test.id('client_a'));
select test.fails(format($$select public.submit_review(%L, 0, gen_random_uuid())$$, current_setting('test.done')), 'rating_invalid', 'rating below 1 refused');
select test.fails(format($$select public.submit_review(%L, 6, gen_random_uuid())$$, current_setting('test.done')), 'rating_invalid', 'rating above 5 refused');
select test.fails(format($$select public.submit_review(%L, 5, gen_random_uuid(), repeat('x', 2001))$$, current_setting('test.done')), 'review_too_long', 'text up to 2000 characters');
select test.fails(format($$select public.submit_review(%L, 5, gen_random_uuid())$$, current_setting('test.open')), 'wrong_status', 'only a done job can be reviewed');
select test.fails(format($$select public.submit_review(%L, 5, gen_random_uuid())$$, current_setting('test.old')), 'review_window_closed', 'more than 60 days after completion refused');
select test.eq(test.error_params(format($$select public.submit_review(%L, 5, gen_random_uuid())$$, current_setting('test.old')))->>'days', '60',
  'the refusal names the window');
select test.eq((public.submit_review(current_setting('test.edge')::uuid, 4, gen_random_uuid())).rating, 4, 'inside the window accepted');
select set_config('test.rv', (public.submit_review(current_setting('test.done')::uuid, 5, gen_random_uuid(), '  Treabă bună.  ')).id::text, true);
select test.fails(format($$select public.submit_review(%L, 1, gen_random_uuid())$$, current_setting('test.done')), 'review_exists', 'one review per booking');
select test.fails($$update public.reviews set rating = 1$$, 'permission denied', 'rating is immutable');
select test.fails($$update public.reviews set text = 'altceva'$$, 'permission denied', 'text is immutable');
select test.logout();
select test.eq(client_display_name, 'Ana M.', 'shown as Ana M.'), test.eq(text, 'Treabă bună.', 'text trimmed'),
       test.eq(shop_id, test.id('shop1'), 'for the booking''s shop')
from public.reviews where id = current_setting('test.rv')::uuid;
select test.eq(count(*), 2::bigint, 'shop members told about the review') from public.notification_events
where event = 'new_review' and booking_id = current_setting('test.done')::uuid;
select test.login(test.id('client_b'));
select test.fails(format($$select public.submit_review(%L, 1, gen_random_uuid())$$, current_setting('test.edge')), 'not_allowed', 'only the booking''s client reviews');
select test.logout();

-- Reply: public, editable, removable; the client hears about the first one.
select test.login(test.id('owner1'));
select public.reply_review(current_setting('test.rv')::uuid, 'Mulțumim!', gen_random_uuid());
select public.reply_review(current_setting('test.rv')::uuid, 'Mulțumim, vă mai așteptăm.', gen_random_uuid());
select test.fails(format($$select public.reply_review(%L, repeat('x', 2001), gen_random_uuid())$$, current_setting('test.rv')), 'reply_too_long', 'reply up to 2000 characters');
select test.fails(format($$select public.reply_review(%L, 'x', gen_random_uuid())$$, test.id('booking_b1')), 'review_not_found', 'unknown review');
select test.fails(format($$select public.reply_review(r.id, 'x', gen_random_uuid()) from public.reviews r where r.booking_id = %L$$, test.id('booking_b1')),
  'review_not_found', 'a removed review takes no reply');
select test.logout();
select test.eq(reply, 'Mulțumim, vă mai așteptăm.', 'reply edited'), test.ok(reply_at is not null, 'reply_at set')
from public.reviews where id = current_setting('test.rv')::uuid;
select test.eq(count(*), 1::bigint, 'client notified once, not on every edit') from public.notification_events
where event = 'review_reply' and user_id = test.id('client_a');
select test.login(test.id('client_a'));
select test.fails(format($$select public.reply_review(%L, 'Eu răspund', gen_random_uuid())$$, current_setting('test.rv')), 'not_allowed', 'the client cannot reply as the shop');
select test.logout();
select test.login(test.id('owner2'));
select test.fails(format($$select public.reply_review(%L, 'x', gen_random_uuid())$$, current_setting('test.rv')), 'not_allowed', 'another shop cannot reply');
select test.fails(format($$select public.report_review(%L, 'fake', gen_random_uuid())$$, current_setting('test.rv')), 'not_allowed', 'another shop cannot report');
select test.logout();
select test.login(test.id('staff1'));
select test.fails(format($$select public.reply_review(%L, 'Coleg', gen_random_uuid())$$, current_setting('test.rv')), 'not_allowed',
  'a colleague cannot reply (the shop''s public voice is the owner''s)');
select test.fails(format($$select public.report_review(%L, 'fake', gen_random_uuid())$$, current_setting('test.rv')), 'not_allowed',
  'nor report');
select test.eq(test.count(format('select 1 from public.reviews where id = %L', current_setting('test.rv'))), 1::bigint,
  'but reads the review');
select test.logout();
select test.login(test.id('owner1'));
select public.reply_review(current_setting('test.rv')::uuid, '', gen_random_uuid());
select test.logout();
select test.eq(reply, null, 'empty reply removes it'), test.eq(reply_at, null, 'and its time')
from public.reviews where id = current_setting('test.rv')::uuid;

-- Report: goes to the admin queue, the review stays visible and keeps counting.
select test.eq(review_count, 3, 'three visible reviews before the report') from public.shop_ratings where shop_id = test.id('shop1');
select test.login(test.id('owner1'));
select test.fails(format($$select public.report_review(%L, 'rude', gen_random_uuid())$$, current_setting('test.rv')), 'report_reason_invalid', 'unknown reason refused');
select public.report_review(current_setting('test.rv')::uuid, 'abusive', gen_random_uuid());
select test.fails(format($$select public.report_review(%L, 'fake', gen_random_uuid())$$, current_setting('test.rv')), 'already_reported', 'one report per review');
select test.fails($$update public.reviews set removed_at = now()$$, 'permission denied', 'the shop cannot remove it');
select test.logout();
select test.eq(report_reason, 'abusive', 'reason stored'), test.eq(report_status, 'pending', 'waiting for admin'),
       test.ok(reported_at is not null, 'reported_at set'), test.eq(removed_at, null, 'not removed')
from public.reviews where id = current_setting('test.rv')::uuid;
select test.login(test.id('client_b'));
select test.eq(test.count(format('select 1 from public.reviews where id = %L', current_setting('test.rv'))), 1::bigint,
  'a reported review stays publicly visible');
select test.logout();
select test.eq(review_count, 3, 'and still counts in the rating') from public.shop_ratings where shop_id = test.id('shop1');

-- ------------------------------------------------------------------ favorites
select set_config('test.fav', test.rid()::text, true);
select test.login(test.id('client_a'));
select test.eq(public.toggle_favorite(test.id('shop1'), current_setting('test.fav')::uuid), true, 'added');
select test.eq(public.toggle_favorite(test.id('shop1'), current_setting('test.fav')::uuid), true, 'replaying the same tap does not flip it back');
select test.eq(test.count(format('select 1 from public.favorites where shop_id = %L', test.id('shop1'))), 1::bigint, 'one favorite row');
select test.eq(public.toggle_favorite(test.id('shop1'), gen_random_uuid()), false, 'a new tap removes it');
select test.eq(test.count('select 1 from public.favorites'), 0::bigint, 'favorite removed');
select test.fails(format($$select public.toggle_favorite(%L, gen_random_uuid())$$, test.id('shop2')), 'shop_not_found', 'a hidden shop cannot be favorited');
select test.logout();
select test.login(test.id('owner1'));
select test.fails(format($$select public.toggle_favorite(%L, gen_random_uuid())$$, test.id('shop1')), 'not_allowed', 'favorites are for clients');
select test.logout();

rollback;
