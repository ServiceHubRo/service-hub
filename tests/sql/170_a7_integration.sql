-- A7 — the platform as one product: flows that cross modules, checked on the data they leave
-- behind (never on a success message), and the regressions of the bugs A7 found.
--   · client ↔ shop, from the request to the review: states, automatic messages, notifications,
--     history, the quote's figures, everything once even when a button is pressed twice;
--   · capacity: a full day, a reschedule inside it, a cancellation that frees the place;
--   · companies: a removed driver, expired or foreign invitations, a shop account;
--   · notifications that waited (quiet hours, retries) and are no longer true when they would go;
--   · the last administrator of a company on every deletion path.
begin;
select test.make_fleet();
select set_config('test.day', test.workday(2)::text, true);
-- No leftovers from the fixtures in the outbox: every count below is about this file's actions.
update public.notification_events set processed_at = now() where processed_at is null;
-- This file books many times for the same two clients: room for it under the abuse limits.
update public.platform_settings
  set limits = limits || '{"active_bookings_per_shop": 10, "new_bookings_per_24h": 30}'::jsonb where id = 1;

-- ======================================================================= 1. the whole job, client ↔ shop
select set_config('test.b', test.book(test.id('client_a'), test.id('shop1'), current_setting('test.day')::date, '10:00', 'ulei',
                                       null, test.id('car_a'))::text, true);

select test.login(test.id('owner1'));
select set_config('test.rid_confirm', test.rid()::text, true);
select public.confirm_booking(current_setting('test.b')::uuid, current_setting('test.rid_confirm')::uuid);
-- The same tap again (double click, a retry after a timeout): the first answer, nothing new.
select test.eq((public.confirm_booking(current_setting('test.b')::uuid, current_setting('test.rid_confirm')::uuid)).status,
               'confirmed', 'a repeated request answers the first result');
-- Another colleague's tap, with its own request id: refused, nothing written twice.
select test.eq(test.error_of($$select public.confirm_booking(current_setting('test.b')::uuid, test.rid())$$), 'wrong_status',
               'confirming twice is refused');
select public.start_inspection(current_setting('test.b')::uuid, test.rid());
select public.send_quote(current_setting('test.b')::uuid, '[{"name":"Ulei 5W30","price":200},{"name":"Filtru","price":50}]', test.rid(), null, null);
select test.logout();

select set_config('test.q', (select id::text from public.quotes where booking_id = current_setting('test.b')::uuid and status = 'sent'), true);
select test.login(test.id('client_a'));
-- What the client reads is what the shop sent.
select test.eq((select total_sent from public.quotes where id = current_setting('test.q')::uuid), 250.00::numeric(10,2),
               'the client reads the total the shop sent');
select test.eq(test.count($$select 1 from public.quote_items where quote_id = current_setting('test.q')::uuid$$), 2::bigint,
               'the client reads both lines');
select public.decide_quote(current_setting('test.b')::uuid, current_setting('test.q')::uuid,
                           array[(select id from public.quote_items where quote_id = current_setting('test.q')::uuid and position = 1)],
                           test.rid());
select test.eq(test.error_of($$select public.decide_quote(current_setting('test.b')::uuid, current_setting('test.q')::uuid,
                                (select array_agg(id) from public.quote_items where quote_id = current_setting('test.q')::uuid), test.rid())$$),
               'wrong_status', 'a quote is decided once');
select test.logout();

select test.eq((select status from public.quotes where id = current_setting('test.q')::uuid), 'partially_accepted', 'one of two lines: partial');
select test.eq((select total_approved from public.quotes where id = current_setting('test.q')::uuid), 200.00::numeric(10,2),
               'the approved total is the approved line');

select test.login(test.id('owner1'));
select public.start_work(current_setting('test.b')::uuid, test.rid());
select test.eq((public.complete_job(current_setting('test.b')::uuid, 106000, test.rid(), null, null, false, null, null, null)).cost,
               200.00::numeric(10,2), 'the job costs what the client approved');
-- The shop's history has the job, with the cost and the accepted quote.
select test.eq((select (j->>'cost')::numeric from jsonb_array_elements(public.list_shop_history()->'bookings') j
                where (j->>'id')::uuid = current_setting('test.b')::uuid), 200.00, 'the job is in the shop''s history with its cost');
select test.logout();

select test.login(test.id('client_a'));
select test.eq((select status from public.bookings where id = current_setting('test.b')::uuid), 'done', 'the client sees the car ready');
select test.eq((select odometer from public.bookings where id = current_setting('test.b')::uuid), 106000, 'and the odometer read at the end');
select public.submit_review(current_setting('test.b')::uuid, 4, test.rid(), 'Lucrare făcută la timp');
select test.eq(test.error_of($$select public.submit_review(current_setting('test.b')::uuid, 5, test.rid(), 'Din nou')$$),
               'review_exists', 'one review per job');
select test.logout();

-- One automatic message per step, one notification per recipient and step: nothing twice.
select test.eq((select count(*) from public.messages where booking_id = current_setting('test.b')::uuid and kind = 'system'
                group by booking_id), 7::bigint, 'seven automatic messages: request, confirmed, inspection, quote, answer, work, done');
select test.eq((select count(*) from (select event, user_id from public.notification_events
                                      where booking_id = current_setting('test.b')::uuid
                                      group by event, user_id having count(*) > 1) d), 0::bigint,
               'no notification twice for the same person and step');
select test.eq((select string_agg(distinct event, ',' order by event) from public.notification_events
                where booking_id = current_setting('test.b')::uuid and user_id = test.id('client_a')),
               'booking_confirmed,inspection_started,job_done,quote_sent,work_started', 'the client is told each step the shop takes');
select test.eq((select count(distinct user_id) from public.notification_events
                where booking_id = current_setting('test.b')::uuid and event = 'booking_requested'), 2::bigint,
               'both members of the shop hear of the request');

-- ======================================================================= 2. capacity across modules
update public.shops set daily_capacity = 1 where id = test.id('shop1');
select set_config('test.c1', test.book(test.id('client_b'), test.id('shop1'), test.workday(2 + 1), '10:00', 'ulei',
                                        'CJ 01 AAA')::text, true);
select test.eq(test.error_of($$select test.book(test.id('client_a'), test.id('shop1'), test.workday(2 + 1), '12:00', 'ulei', 'CJ 02 BBB')$$),
               'day_full', 'the last place of the day is taken');
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.c1')::uuid, test.rid());
-- Moving it inside its own full day counts its own place as free.
select test.eq((public.reschedule_booking(current_setting('test.c1')::uuid, test.workday(2 + 1), '13:00', test.rid())).slot,
               '13:00'::time, 'a booking moves inside its own full day');
select test.logout();
select test.login(test.id('client_b'));
select public.cancel_booking(current_setting('test.c1')::uuid, test.rid());
select test.logout();
select test.ok(test.book(test.id('client_a'), test.id('shop1'), test.workday(2 + 1), '12:00', 'ulei', 'CJ 02 BBB') is not null,
               'a cancellation frees the place at once');
select test.eq((select count(*) from public.bookings where shop_id = test.id('shop1') and date = test.workday(2 + 1)
                and public.is_active_status(status)), 1::bigint, 'never more active bookings than the capacity');

update public.shops set daily_capacity = 8 where id = test.id('shop1');

-- ======================================================================= 3. companies
select test.login(test.id('client_a'));
select public.remove_company_member(test.id('m_drv'), test.rid());
select test.logout();
select test.login(test.id('client_b'));
select test.eq(test.count(format('select 1 from public.company_vehicles where company_id = %L', test.id('co'))), 0::bigint,
               'a removed driver no longer reads the company''s vehicles');
select test.eq(test.count(format('select 1 from public.companies where id = %L', test.id('co'))), 0::bigint,
               'nor the company');
select test.eq(test.error_of(format($$select public.create_booking(p_shop_id => %L, p_service_id => 'ulei', p_date => %L, p_slot => '14:00',
                                      p_request_id => test.rid(), p_company_vehicle_id => %L)$$,
                                    test.id('shop1'), test.workday(2 + 2), test.id('v1'))),
               'vehicle_not_found', 'nor books the vehicle he used to drive');
select test.logout();

select test.login(test.id('client_a'));
select public.invite_company_member(test.id('co'), 'late@test.local', 'driver', repeat('a9', 32), test.rid());
select public.invite_company_member(test.id('co'), 'who@test.local', 'driver', repeat('b8', 32), test.rid());
select test.logout();
update public.company_members set invited_at = now() - interval '30 days' where lower(invited_email) = 'late@test.local';
select set_config('test.late', test.sign_up('late@test.local', '{"role":"client","name":"Late Driver"}')::text, true);
select set_config('test.other', test.sign_up('other@test.local', '{"role":"client","name":"Other Person"}')::text, true);
select test.login(current_setting('test.late')::uuid);
select test.eq(test.error_of($$select public.accept_company_invite(repeat('a9', 32), test.rid())$$), 'invite_invalid', 'an expired invitation');
select test.login(current_setting('test.other')::uuid);
select test.eq(test.error_of($$select public.accept_company_invite(repeat('b8', 32), test.rid())$$), 'invite_other_email',
               'an invitation for someone else');
select test.login(test.id('owner2'));
select test.eq(test.error_of($$select public.accept_company_invite(repeat('b8', 32), test.rid())$$), 'company_clients_only',
               'a shop account never joins a company');
select test.logout();
select test.eq((select count(*) from public.company_members where company_id = test.id('co') and accepted_at is null), 2::bigint,
               'the refused invitations are still waiting, unused');

-- ======================================================================= 4. notifications that waited
-- Quiet hours over this very hour: what a job writes now waits for "morning".
do $$ declare h int := extract(hour from now() at time zone 'Europe/Bucharest')::int; begin
  update public.platform_settings
    set limits = limits || jsonb_build_object('quiet_hours_start', h, 'quiet_hours_end', (h + 2) % 24) where id = 1;
end $$;
update public.notification_events set processed_at = now() where processed_at is null;

-- (a) A request still waiting after hours, answered during the night.
select set_config('test.n1', test.book(test.id('client_a'), test.id('shop1'), test.workday(2 + 3), '10:00', 'ulei',
                                        'CJ 03 CCC')::text, true);
-- (b) Another request, still unanswered in the morning: its reminder must go.
select set_config('test.n2', test.book(test.id('client_b'), test.id('shop1'), test.workday(2 + 3), '11:00', 'ulei',
                                        'CJ 04 DDD')::text, true);
update public.bookings set created_at = now() - interval '3 hours'
where id in (current_setting('test.n1')::uuid, current_setting('test.n2')::uuid);
select test.eq(public.send_request_waiting_reminders(), 2, 'two requests waiting');
select test.eq((select count(*) from public.notification_events where event = 'booking_request_waiting' and not_before > now()),
               4::bigint, 'their reminders wait for the end of the quiet hours (two members each)');
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.n1')::uuid, test.rid());
select test.logout();

-- (c) The appointment reminder of a booking cancelled during the night, and of one moved.
select set_config('test.n3', test.book(test.id('client_a'), test.id('shop1'), test.workday(2 + 4), '10:00', 'ulei',
                                        'CJ 05 EEE')::text, true);
select set_config('test.n4', test.book(test.id('client_b'), test.id('shop1'), test.workday(2 + 4), '11:00', 'ulei',
                                        'CJ 06 FFF')::text, true);
select set_config('test.n5', test.book(test.id('client_a'), test.id('shop1'), test.workday(2 + 4), '12:00', 'ulei',
                                        'CJ 07 GGG')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.n3')::uuid, test.rid());
select public.confirm_booking(current_setting('test.n4')::uuid, test.rid());
select public.confirm_booking(current_setting('test.n5')::uuid, test.rid());
select test.logout();
select public.notify_user(b.client_id, 'appointment_reminder', public.booking_event_params(b) || '{"day":"tomorrow"}', b.id)
from public.bookings b where b.id in (current_setting('test.n3')::uuid, current_setting('test.n4')::uuid, current_setting('test.n5')::uuid);
select test.login(test.id('client_a'));
select public.cancel_booking(current_setting('test.n3')::uuid, test.rid());
select test.logout();
select test.login(test.id('owner1'));
select public.reschedule_booking(current_setting('test.n4')::uuid, test.workday(2 + 5), '09:00', test.rid());
select test.logout();

-- (d) "Quote expiring" for a quote the client approved during the night.
select set_config('test.n6', test.book(test.id('client_b'), test.id('shop1'), test.workday(2 + 6), '10:00', 'ulei',
                                        'CJ 08 HHH')::text, true);
select test.login(test.id('owner1'));
select public.confirm_booking(current_setting('test.n6')::uuid, test.rid());
select public.start_inspection(current_setting('test.n6')::uuid, test.rid());
select public.send_quote(current_setting('test.n6')::uuid, '[{"name":"Plăcuțe","price":300}]', test.rid(), null, null);
select test.logout();
update public.quotes set expires_at = now() + interval '20 hours' where booking_id = current_setting('test.n6')::uuid;
select test.eq(public.remind_expiring_quotes(), 1, 'the quote is about to expire');
select test.login(test.id('client_b'));
select public.decide_quote(current_setting('test.n6')::uuid, q.id, array(select i.id from public.quote_items i where i.quote_id = q.id), test.rid())
from public.quotes q where q.booking_id = current_setting('test.n6')::uuid and q.status = 'sent';
select test.logout();

-- (e) A colleague removed during the night: the morning's events about the shop's bookings are not his.
select test.login(test.id('owner1'));
delete from public.shop_staff where user_id = test.id('staff1');
select test.logout();

-- Morning: everything that waited is due.
update public.notification_events set not_before = now() - interval '1 second' where not_before > now();
create temp table claimed as
  select e->>'event' as event, (e->>'booking_id')::uuid as booking_id, (e->>'user_id')::uuid as user_id
  from jsonb_array_elements(public.claim_notifications(200)->'events') e;

select test.eq((select count(*) from claimed where booking_id = current_setting('test.n1')::uuid and event = 'booking_request_waiting'),
               0::bigint, 'no "request waiting" for a request answered in the night');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n2')::uuid and event = 'booking_request_waiting'),
               1::bigint, 'the request still waiting is reminded, to the owner only');
select test.eq((select count(*) from claimed where user_id = test.id('staff1')), 0::bigint,
               'nothing reaches the colleague removed in the night');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n3')::uuid and event = 'appointment_reminder'),
               0::bigint, 'no reminder for an appointment cancelled in the night');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n4')::uuid and event = 'appointment_reminder'),
               0::bigint, 'nor for the old day and hour of a moved appointment');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n5')::uuid and event = 'appointment_reminder'),
               1::bigint, 'the appointment still on is reminded');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n6')::uuid and event = 'quote_expiring'),
               0::bigint, 'no "quote expiring" for a quote already approved');
select test.eq((select count(*) from claimed where booking_id = current_setting('test.n4')::uuid and event = 'booking_rescheduled'),
               1::bigint, 'what happened during the night is still told (the move)');
select test.eq((select count(*) from public.notification_events where last_error = 'obsolete' and processed_at is not null
                and event in ('booking_request_waiting', 'appointment_reminder', 'quote_expiring')), 8::bigint,
               'the obsolete ones are closed, never left to retry (3 waiting, 2 reminders, 3 quote copies)');
-- The main operation never depends on the notification: the bookings are as their people left them.
select test.eq((select string_agg(status, ',' order by date, slot) from public.bookings
                where id in (current_setting('test.n1')::uuid, current_setting('test.n3')::uuid, current_setting('test.n4')::uuid,
                             current_setting('test.n6')::uuid)),
               'confirmed,cancelled,confirmed,approved', 'the bookings keep the states their people gave them');
select test.ok(public.notification_still_due(null, 'admin_digest', '{}', null), 'a platform event always goes');

-- ======================================================================= 5. the last administrator of a company
-- client_a is the only admin of „Flota SRL”, which has other members.
select test.eq(test.error_of(format('select public.prepare_account_deletion(%L)', test.id('client_a'))), 'company_last_admin',
               'the account cannot be deleted while the company needs it');
select test.eq(test.error_params(format('select public.prepare_account_deletion(%L)', test.id('client_a')))->'companies',
               '["Flota SRL"]'::jsonb, 'the refusal names the company');
select test.eq(test.error_of(format($$select public.admin_account_deletion(%L, %L, 'Cerere de ștergere', test.admin_session(%L))$$,
                                    test.id('admin'), test.id('client_a'), test.id('admin'))),
               'company_last_admin', 'not by the platform admin either');
select test.eq((select count(*) from public.company_members where company_id = test.id('co') and role = 'admin' and accepted_at is not null),
               1::bigint, 'the company keeps its administrator');
select test.ok((select deleted_at is null from public.profiles where id = test.id('client_a')), 'nothing of the account was touched');
-- After handing the administration over, the account goes (it has no active booking left).
select test.login(test.id('client_a'));
select public.transfer_company_admin(test.id('m_mgr'), test.rid());
select test.logout();
update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin', cancel_reason = 'Test A7'
where client_id = test.id('client_a') and public.is_active_status(status);
select test.ok(public.prepare_account_deletion(test.id('client_a')) in ('delete', 'anonymize'), 'then the account can be deleted');
-- A member who is not the last admin was never blocked.
select test.eq(test.error_of(format('select public.prepare_account_deletion(%L)',
                                    (select user_id from public.company_members where id = test.id('m_acc')))), 'ok',
               'nothing changes for other members');

-- Nobody but the server calls these.
select test.login(test.id('client_b'));
select test.fails($$select public.notification_still_due(test.id('client_b'), 'x', '{}', null)$$, 'permission denied', 'not callable by a user');
select test.fails($$select public.prepare_account_deletion_a6(test.id('client_b'))$$, 'permission denied', 'the inner function is closed');
select test.fails($$select public.claim_notifications_a6(10)$$, 'permission denied', 'the inner claim is closed');
select test.logout();

rollback;
