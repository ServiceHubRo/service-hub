-- list_threads and booking_thread (T11): each side sees only its own conversations, the last
-- message, and the other side's messages after its read marker as unread.
begin;
select test.make_world();

-- Everything in one transaction shares one now(): this moves what exists so far a minute back, as
-- if time passed before the next step.
create function pg_temp.tick() returns void language sql as $$
  update public.messages set created_at = created_at - interval '1 minute';
  update public.threads set last_message_at = last_message_at - interval '1 minute',
                            client_last_read_at = client_last_read_at - interval '1 minute',
                            shop_last_read_at = shop_last_read_at - interval '1 minute';
$$;
-- The fixture writes both messages of thread A at the same instant; the client's came second.
update public.messages set created_at = created_at + interval '1 second'
where thread_id = test.id('thread_a') and kind = 'user';
select pg_temp.tick();

-- Fixture: thread_a (shop1 ↔ client_a) holds an automatic message with no author and the client's
-- "Mulțumesc"; thread_b (shop2 ↔ client_b) holds the client's "Hello". No read markers yet.

-- ------------------------------------------------------------------ list_threads: who sees what
select test.login(test.id('client_a'));
select test.eq(count(*), 1::bigint, 'client A sees only their thread'),
       test.eq(min(thread_id::text), test.id('thread_a')::text, 'thread A'),
       test.eq(min(shop_name), 'Atelier Unu', 'named after the shop')
from public.list_threads();
select test.eq(last_body, 'Mulțumesc', 'last message'), test.eq(last_kind, 'user', 'a user message'),
       test.ok(last_own, 'written by the reader'),
       test.eq(unread, 1, 'the automatic message counts, the own one does not')
from public.list_threads();
select test.logout();

select test.login(test.id('staff1'));
select test.eq(count(*), 1::bigint, 'a staff member sees the shop''s threads'),
       test.eq(min(client_name), 'Ana Marin', 'named after the client'),
       test.eq(min(unread), 2, 'the client''s message and the automatic one are unread'),
       test.ok(not bool_or(last_own), 'the client''s message is not the shop''s')
from public.list_threads();
select test.logout();

select test.login(test.id('owner2'));
select test.eq(count(*), 1::bigint, 'shop 2 sees only its thread'),
       test.eq(min(thread_id::text), test.id('thread_b')::text, 'thread B')
from public.list_threads();
select test.logout();

select test.login(test.id('admin'));
select test.eq(count(*), 0::bigint, 'admin gets no list here (admin tools are T16a)') from public.list_threads();
select test.logout();

select test.login_anon();
select test.fails($$select * from public.list_threads()$$, 'permission denied', 'not callable signed out');
select test.logout();

-- ------------------------------------------------------------------ unread and read markers
select test.login(test.id('owner1'));
select public.mark_thread_read(test.id('thread_a'));
select test.eq(unread, 0, 'read after opening') from public.list_threads();
select test.logout();
select pg_temp.tick();
select test.login(test.id('client_a'));
select test.eq(unread, 1, 'the shop reading does not change the client''s count') from public.list_threads();
select public.send_message(test.id('thread_a'), 'Vin la 10.', gen_random_uuid());
select test.eq(unread, 0, 'sending marks the thread read for the sender') from public.list_threads();
select test.logout();
select pg_temp.tick();
select test.login(test.id('staff1'));
select test.eq(unread, 1, 'the new client message is unread for the shop'),
       test.eq(last_body, 'Vin la 10.', 'and is the preview')
from public.list_threads();
select public.send_message(test.id('thread_a'), 'Vă așteptăm.', gen_random_uuid());
select test.logout();
select test.login(test.id('owner1'));
select test.eq(unread, 0, 'a colleague''s reply is the shop''s own message'),
       test.ok(last_own, 'shown as the shop''s') from public.list_threads();
select test.logout();
select test.login(test.id('client_a'));
select test.eq(unread, 1, 'the shop''s reply is unread for the client'), test.ok(not last_own, 'and not the client''s')
from public.list_threads();
select test.logout();

select pg_temp.tick();

-- Automatic messages the reader caused are not unread for them; the other side's are.
select set_config('test.bk', test.book(test.id('client_b'), test.id('shop1'), test.workday(1), '10:00')::text, true);
select test.login(test.id('client_b'));
select test.eq(count(*), 1::bigint, 'the booking opened a thread with shop 1'),
       test.eq(min(last_event), 'booking_requested', 'with the automatic message'),
       test.eq(min(last_params->>'by'), 'client', 'caused by the client'),
       test.eq(min(unread), 0, 'not unread for the client who booked')
from public.list_threads() where shop_id = test.id('shop1');
select test.logout();
select test.login(test.id('owner1'));
select test.eq(unread, 1, 'a new request is unread for the shop') from public.list_threads() where client_name = 'Bogdan Pop';
select test.logout();
select pg_temp.tick();
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.bk')::uuid, gen_random_uuid());
select test.eq(unread, 1, 'the shop''s own confirmation adds nothing') from public.list_threads() where client_name = 'Bogdan Pop';
select test.eq(thread_id, (select t.id from public.threads t where t.shop_id = test.id('shop1') and t.client_id = test.id('client_b')),
  'newest thread first') from public.list_threads() limit 1;
select test.logout();
select test.login(test.id('client_b'));
select test.eq(unread, 1, 'the confirmation is unread for the client'), test.eq(last_event, 'booking_confirmed', 'as the last message')
from public.list_threads() where shop_id = test.id('shop1');
select test.logout();

-- ------------------------------------------------------------------ booking_thread
select test.login(test.id('client_a'));
select test.eq(public.booking_thread(test.id('booking_a')), test.id('thread_a'), 'client: the booking''s thread');
select test.fails(format($$select public.booking_thread(%L)$$, test.id('booking_b')), 'booking_not_found', 'not another client''s booking');
select test.logout();
select test.login(test.id('staff1'));
select test.eq(public.booking_thread(test.id('booking_a')), test.id('thread_a'), 'shop member: the booking''s thread');
select test.fails(format($$select public.booking_thread(%L)$$, test.id('booking_b')), 'booking_not_found', 'not another shop''s booking');
select test.fails(format($$select public.booking_thread(%L)$$, gen_random_uuid()), 'booking_not_found', 'unknown booking');
select test.logout();

-- A deleted client leaves the booking without a thread.
update public.bookings set client_id = null where id = test.id('booking_a');
select test.login(test.id('owner1'));
select test.fails(format($$select public.booking_thread(%L)$$, test.id('booking_a')), 'thread_not_found', 'no thread without the client');
select test.logout();

rollback;
