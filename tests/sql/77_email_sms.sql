-- Email and SMS (T13, ARCHITECTURE §9, §11): the outbox finishes each channel once, the
-- dispatcher gets the address and the verified phone, reported reviews and suspensions write
-- their emails, the language reaches the Auth metadata, and phone verification by SMS code.
begin;
select test.make_world();

-- ------------------------------------------------------------------ outbox: email and SMS
delete from public.notification_events;
insert into public.notification_events (id, user_id, event, params, channels) values
  ('00000000-0000-0000-0000-0000000000f1', test.id('owner1'), 'booking_requested', '{}', '{push,sms}'),
  ('00000000-0000-0000-0000-0000000000f2', test.id('owner2'), 'booking_requested', '{}', '{push,sms}'),
  ('00000000-0000-0000-0000-0000000000f3', test.id('client_b'), 'account_suspended', '{"kind":"account"}', '{email}');

select set_config('test.claim', public.claim_notifications(10)::text, true);
select test.eq(e->>'phone', '0268312445', 'the SMS goes to the owner''s verified phone'),
       test.ok(e->>'email' is null, 'no address when the event has no email channel'),
       test.eq(e->'channels', '["push", "sms"]'::jsonb, 'both channels to do')
from jsonb_array_elements(current_setting('test.claim')::jsonb->'events') e
where e->>'id' = '00000000-0000-0000-0000-0000000000f1';
select test.ok(e->>'phone' is null, 'an unverified phone gets no SMS')
from jsonb_array_elements(current_setting('test.claim')::jsonb->'events') e
where e->>'id' = '00000000-0000-0000-0000-0000000000f2';
select test.eq(e->>'email', 'bogdan@test.local', 'the email channel carries the address'),
       test.eq(e->>'lang', 'en', 'in the recipient''s language')
from jsonb_array_elements(current_setting('test.claim')::jsonb->'events') e
where e->>'id' = '00000000-0000-0000-0000-0000000000f3';

-- The SMS went out, the push did not: only the push is tried again.
select public.finish_notifications(jsonb_build_array(jsonb_build_object(
  'id', '00000000-0000-0000-0000-0000000000f1', 'done', false, 'error', 'push 503',
  'channels_done', jsonb_build_array('sms', 'fax'),
  'log', jsonb_build_array(jsonb_build_object('channel', 'sms', 'status', 'sent')))));
select test.eq(channels_done, '{sms}'::text[], 'the SMS is recorded as done (unknown channels ignored)')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000f1';
select test.eq((select count(*) from public.notifications_log
                where event_id = '00000000-0000-0000-0000-0000000000f1' and channel = 'sms'), 1::bigint,
  'the SMS is logged in the round that sent it');
update public.notification_events set locked_until = now() - interval '1 second'
where id = '00000000-0000-0000-0000-0000000000f1';
select test.eq(e->'channels', '["push"]'::jsonb, 'the retry only has the push left')
from jsonb_array_elements(public.claim_notifications(10)->'events') e
where e->>'id' = '00000000-0000-0000-0000-0000000000f1';
select public.finish_notifications(jsonb_build_array(jsonb_build_object(
  'id', '00000000-0000-0000-0000-0000000000f1', 'done', true, 'channels_done', jsonb_build_array('push'),
  'log', jsonb_build_array(jsonb_build_object('channel', 'push', 'status', 'sent')))));
select test.eq(channels_done, '{push,sms}'::text[], 'both done'),
       test.ok(processed_at is not null, 'event closed')
from public.notification_events where id = '00000000-0000-0000-0000-0000000000f1';
select test.eq((select count(*) from public.notifications_log where event_id = '00000000-0000-0000-0000-0000000000f1'), 2::bigint,
  'one log row per channel');

-- A deleted account gets no email.
update public.notification_events set locked_until = null, processed_at = null
where id = '00000000-0000-0000-0000-0000000000f3';
update public.profiles set deleted_at = now() where id = test.id('client_b');
select test.ok(e->>'email' is null, 'no email to a deleted account')
from jsonb_array_elements(public.claim_notifications(10)->'events') e
where e->>'id' = '00000000-0000-0000-0000-0000000000f3';
update public.profiles set deleted_at = null where id = test.id('client_b');

-- Only platform events may have no recipient.
select test.fails($$insert into public.notification_events (user_id, event) values (null, 'job_done')$$,
  'notification_events_recipient', 'a user event needs its user');

-- ------------------------------------------------------------------ a reported review
delete from public.notification_events;
select test.login(test.id('staff1'));
select public.report_review((select id from public.reviews where client_display_name = 'Ana M.'), 'abusive', gen_random_uuid());
select test.logout();
select test.ok(user_id is null, 'to the platform''s admin address'),
       test.eq(channels, '{email}'::text[], 'by email'),
       test.eq(params->>'shop_name', 'Atelier Unu', 'with the shop'),
       test.eq(params->>'reason', 'abusive', 'the reason'),
       test.eq(params->>'text', 'Prompt, deviz clar.', 'and the review'),
       test.eq((params->>'rating')::int, 5, 'with its stars')
from public.notification_events where event = 'review_reported';
select set_config('test.claim', public.claim_notifications(10)::text, true);
select test.eq(e->>'role', 'admin', 'claimed as an admin event'),
       test.eq(e->>'lang', 'ro', 'in Romanian')
from jsonb_array_elements(current_setting('test.claim')::jsonb->'events') e where e->>'event' = 'review_reported';
-- Editing the reply does not report it again.
update public.reviews set reply = 'Mulțumim' where client_display_name = 'Ana M.';
select test.eq(test.count($$select 1 from public.notification_events where event = 'review_reported'$$), 1::bigint,
  'one email per report');

-- ------------------------------------------------------------------ suspension
delete from public.notification_events;
update public.profiles set suspended = true where id = test.id('client_a');
update public.profiles set suspended = true where id = test.id('client_a');
update public.shops set suspended = true where id = test.id('shop2');
select test.eq(test.count($$select 1 from public.notification_events
                            where event = 'account_suspended' and user_id = test.id('client_a')
                              and params->>'kind' = 'account' and channels = '{email}'$$), 1::bigint,
  'a suspended account gets one email');
select test.eq(test.count($$select 1 from public.notification_events
                            where event = 'account_suspended' and user_id = test.id('owner2')
                              and params->>'shop_name' = 'Atelier Doi'$$), 1::bigint,
  'a suspended shop: its owner gets the email');
update public.profiles set suspended = false where id = test.id('client_a');
update public.shops set suspended = false where id = test.id('shop2');

-- ------------------------------------------------------------------ language → Auth metadata
select test.login(test.id('client_a'));
update public.profiles set lang = 'en' where id = auth.uid();
select test.logout();
select test.eq(raw_user_meta_data->>'lang', 'en', 'the Auth emails follow the account language'),
       test.eq(raw_user_meta_data->>'name', 'Ana Marin', 'the rest of the metadata stays')
from auth.users where id = test.id('client_a');

-- ------------------------------------------------------------------ phone verification
select test.login(test.id('owner2'));
select test.fails($$select public.phone_verify_begin(auth.uid(), '123456')$$, 'permission denied',
  'the browser cannot start a verification (it would choose its own code)');
select test.fails($$select public.phone_verify_cancel(gen_random_uuid())$$, 'permission denied', 'nor cancel one');
select test.fails($$select * from public.phone_verifications$$, 'permission denied', 'codes stay on the server');
select test.eq(public.check_phone_code('123456', gen_random_uuid())->>'status', 'expired', 'no code sent yet');
select test.eq(public.my_phone_verification()->>'verified', 'false', 'not verified yet');
select test.logout();

select test.fails($$select public.phone_verify_begin(test.id('client_a'), '123456')$$, 'not_allowed', 'shops only');
select test.fails($$select public.phone_verify_begin(test.id('owner1'), '123456')$$, 'phone_already_verified',
  'nothing to do for a verified phone');
select test.fails($$select public.phone_verify_begin(test.id('owner2'), '12a456')$$, 'must be 6 digits', 'six digits');

select set_config('test.v1', public.phone_verify_begin(test.id('owner2'), '482913')::text, true);
select test.eq(current_setting('test.v1')::jsonb->>'status', 'send', 'first code: send it'),
       test.eq(current_setting('test.v1')::jsonb->>'phone', '0268251108', 'to the account''s phone'),
       test.eq(current_setting('test.v1')::jsonb->>'lang', 'ro', 'in its language');
select test.ok(code_hash <> '482913' and code_hash = public.phone_code_hash(id, '482913'), 'only the hash is stored')
from public.phone_verifications where id = (current_setting('test.v1')::jsonb->>'id')::uuid;
select test.eq(public.phone_verify_begin(test.id('owner2'), '111111')->>'status', 'wait', 'a second code within a minute waits');
select test.eq(test.count($$select 1 from public.phone_verifications where user_id = test.id('owner2')$$), 1::bigint,
  'and adds nothing');

select test.login(test.id('owner2'));
select test.ok((public.my_phone_verification()->>'resend_in')::int between 1 and 60, 'the app knows when it may resend'),
       test.ok(public.my_phone_verification()->>'expires_at' is not null, 'and that a code is waiting');
select set_config('test.r1', gen_random_uuid()::text, true);
select test.eq(public.check_phone_code('000000', current_setting('test.r1')::uuid), '{"status":"wrong","attempts_left":4}'::jsonb,
  'a wrong code counts');
select test.eq(public.check_phone_code('000000', current_setting('test.r1')::uuid), '{"status":"wrong","attempts_left":4}'::jsonb,
  'the same request twice counts once');
select test.eq(public.check_phone_code('482 913', gen_random_uuid())->>'status', 'verified', 'the right code (spaces allowed)');
select test.eq(public.my_phone_verification()->>'verified', 'true', 'verified');
select test.eq(public.check_phone_code('482913', gen_random_uuid())->>'status', 'verified', 'checking again is harmless');
select test.logout();
select test.ok(phone_verified_at is not null, 'the profile is verified') from public.profiles where id = test.id('owner2');
select test.ok(verified_at is not null, 'the code is used') from public.phone_verifications
where id = (current_setting('test.v1')::jsonb->>'id')::uuid;

-- A new number must be verified again; the old code no longer works for it.
select test.login(test.id('owner2'));
update public.profiles set phone = '0723111222' where id = auth.uid();
select test.eq(public.my_phone_verification()->>'verified', 'false', 'a new phone is unverified');
select test.logout();

-- Five wrong tries lock the code.
select set_config('test.v2', public.phone_verify_begin(test.id('owner2'), '246810')::text, true);
select test.eq(current_setting('test.v2')::jsonb->>'phone', '0723111222', 'a code for the new number');
select test.login(test.id('owner2'));
select public.check_phone_code('999999', gen_random_uuid()) from generate_series(1, 4);
select test.eq(public.check_phone_code('999999', gen_random_uuid())->>'status', 'locked', 'the fifth wrong try locks it');
select test.eq(public.check_phone_code('246810', gen_random_uuid())->>'status', 'locked', 'even the right code is refused now');
select test.eq(public.my_phone_verification()->>'expires_at', null, 'the app offers a new code');
select test.logout();

-- An expired code.
update public.phone_verifications set created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute'
where user_id = test.id('owner2');
select set_config('test.v3', public.phone_verify_begin(test.id('owner2'), '135790')::text, true);
update public.phone_verifications set expires_at = now() - interval '1 second'
where id = (current_setting('test.v3')::jsonb->>'id')::uuid;
select test.login(test.id('owner2'));
select test.eq(public.check_phone_code('135790', gen_random_uuid())->>'status', 'expired', 'an expired code is refused');
select test.logout();

-- A failed SMS is forgotten: the next try is not held back.
update public.phone_verifications set created_at = now() - interval '2 minutes' where user_id = test.id('owner2');
select set_config('test.v4', public.phone_verify_begin(test.id('owner2'), '112233')::text, true);
select public.phone_verify_cancel((current_setting('test.v4')::jsonb->>'id')::uuid);
select test.eq(public.phone_verify_begin(test.id('owner2'), '445566')->>'status', 'send', 'a cancelled code does not block');

-- At most 5 codes a day per account…
update public.phone_verifications set created_at = now() - interval '2 minutes' where user_id = test.id('owner2');
select public.phone_verify_begin(test.id('owner2'), '000001');
select test.eq(test.count($$select 1 from public.phone_verifications where user_id = test.id('owner2') and created_at > now() - interval '1 day'$$),
  5::bigint, 'five codes today');
update public.phone_verifications set created_at = now() - interval '2 minutes' where user_id = test.id('owner2');
select test.fails($$select public.phone_verify_begin(test.id('owner2'), '000002')$$, 'limit_phone_codes', 'the sixth is refused');
-- …and per number, whoever asks.
insert into public.phone_verifications (user_id, phone, code_hash, expires_at, created_at)
values (test.id('owner1'), '0723111222', 'x', now() - interval '1 hour', now() - interval '2 hours');
update public.profiles set phone = '0723111222' where id = test.id('owner1');
update public.profiles set phone_verified_by_admin = false where id = test.id('owner1');
select test.fails($$select public.phone_verify_begin(test.id('owner1'), '000003')$$, 'limit_phone_codes',
  'another account cannot flood the same number');

rollback;
