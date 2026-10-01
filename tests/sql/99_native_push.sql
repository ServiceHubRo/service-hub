-- Notifications in the phone app (T20b): the app's FCM token is a device like a browser's, owned
-- by whoever is signed in on the phone, and the dispatcher gets it with the other devices.
begin;
select test.make_world();
select set_config('test.token', 'dQw4w9WgXcQ:APA91b' || repeat('Zx_-9', 30), true);

-- ------------------------------------------------------------------ saving the token
select test.login(test.id('client_a'));
select public.save_native_push_token(current_setting('test.token'), 'android', 'Service-Hub Android');
select public.save_native_push_token(current_setting('test.token'), 'android', 'Service-Hub Android 2');
select test.eq(count(*), 1::bigint, 'one row per phone, saved again harmlessly'),
       test.eq(min(subscription->>'fcm_token'), current_setting('test.token'), 'with its token'),
       test.eq(min(subscription->>'platform'), 'android', 'and the platform'),
       test.eq(min(user_agent), 'Service-Hub Android 2', 'updated')
from public.push_subscriptions where endpoint = 'fcm:' || current_setting('test.token');
select test.fails($$select public.save_native_push_token('short', 'android')$$, 'push_subscription_invalid', 'a real token only');
select test.fails($$select public.save_native_push_token('abc def ghi jkl mno pqr stu', 'android')$$, 'push_subscription_invalid', 'no spaces');
select test.fails(format($$select public.save_native_push_token(%L, 'web')$$, current_setting('test.token')),
  'push_subscription_invalid', 'Android only for now');
select test.fails($$select public.save_native_push_token(null, 'android')$$, 'push_subscription_invalid', 'a token is required');
-- The browser's own path does not accept an app token as an address.
select test.fails(format($$select public.save_push_subscription(%L, '{}')$$, 'fcm:' || current_setting('test.token')),
  'push_endpoint_invalid', 'an fcm: key is not a push address');
select test.logout();

-- Another account signs in on the same phone: the phone is theirs from now on.
select test.login(test.id('owner1'));
select public.save_native_push_token(current_setting('test.token'), 'android');
select test.eq(user_id, test.id('owner1'), 'the phone moves to whoever is signed in')
from public.push_subscriptions where endpoint = 'fcm:' || current_setting('test.token');
select test.logout();
select test.login(test.id('client_a'));
select test.eq(test.count($$select 1 from public.push_subscriptions where endpoint like 'fcm:%'$$), 0::bigint,
  'and the client no longer sees it');
select test.logout();

-- Neither an admin nor someone signed out.
select test.login(test.id('admin'));
select test.fails(format($$select public.save_native_push_token(%L, 'android')$$, current_setting('test.token')),
  'not_allowed', 'an admin has no notifications');
select test.logout();
select test.login_anon();
select test.fails(format($$select public.save_native_push_token(%L, 'android')$$, current_setting('test.token')),
  'permission denied', 'signed in only');
select test.logout();

-- ------------------------------------------------------------------ the dispatcher gets it
delete from public.notification_events;
insert into public.notification_events (user_id, event, params, channels)
values (test.id('owner1'), 'daily_digest', '{"today": 1}', array['push']);
select test.eq(d->>'fcm_token', current_setting('test.token'), 'the device carries the token'),
       test.eq(d->>'endpoint', 'fcm:' || current_setting('test.token'), 'and its key')
from jsonb_array_elements(public.claim_notifications(10)->'events'->0->'devices') d;

-- A token Firebase no longer knows is deleted like a dead browser.
select public.finish_notifications(jsonb_build_array(jsonb_build_object(
  'id', (select id from public.notification_events limit 1), 'done', true, 'channels_done', '["push"]'::jsonb, 'log', '[]'::jsonb,
  'gone', jsonb_build_array('fcm:' || current_setting('test.token')), 'delivered', '[]'::jsonb)));
select test.eq(test.count($$select 1 from public.push_subscriptions where endpoint like 'fcm:%'$$), 0::bigint, 'a gone token is deleted');

rollback;
