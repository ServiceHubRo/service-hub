-- Notifications in the phone app (T20b): Firebase Cloud Messaging next to Web Push.
-- ARCHITECTURE §9, §11.
--
-- · The app saves its FCM registration token with save_native_push_token(token, platform, agent):
--   a push_subscriptions row like a browser's, keyed `fcm:<token>`, with {fcm_token, platform}.
--   The same rules as for browsers: the caller (client or shop) owns it from now on (a phone used
--   by another account moves to the caller), at most 10 devices per person, the least recently
--   used go. Deleting it (turning push off on the phone, signing out) is the same row delete.
-- · claim_notifications hands each device's fcm_token to dispatch-notifications, which sends
--   those through FCM (FCM_SERVICE_ACCOUNT) and the others through Web Push; a token Firebase no
--   longer knows is deleted like a dead browser endpoint.

create function public.save_native_push_token(p_token text, p_platform text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_endpoint text;
begin
  v_me := public.require_caller();
  if v_me.role not in ('client', 'shop') then
    perform public.fail('not_allowed');
  end if;
  if coalesce(p_token, '') !~ '^[A-Za-z0-9_:-]+$' or char_length(p_token) not between 20 and 4096
     or p_platform is distinct from 'android' then
    perform public.fail('push_subscription_invalid');
  end if;
  v_endpoint := 'fcm:' || p_token;

  delete from public.push_subscriptions where endpoint = v_endpoint and user_id <> v_me.id;
  insert into public.push_subscriptions (endpoint, user_id, subscription, user_agent)
  values (v_endpoint, v_me.id, jsonb_build_object('fcm_token', p_token, 'platform', p_platform), left(p_user_agent, 500))
  on conflict (endpoint) do update
    set subscription = excluded.subscription, user_agent = excluded.user_agent;

  delete from public.push_subscriptions
  where user_id = v_me.id
    and endpoint in (
      select ps.endpoint from public.push_subscriptions ps
      where ps.user_id = v_me.id
      order by coalesce(ps.last_success_at, ps.updated_at) desc
      offset 10);
end
$$;
revoke execute on function public.save_native_push_token(text, text, text) from public, anon;
grant execute on function public.save_native_push_token(text, text, text) to authenticated;

-- The devices now carry the app's token (null for a browser).
create or replace function public.claim_notifications(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  update public.notification_events
    set processed_at = now(), locked_until = null,
        last_error = case when attempts >= 5 then coalesce(last_error, 'gave_up') else 'stale' end
  where processed_at is null
    and (locked_until is null or locked_until < now())
    and (attempts >= 5 or created_at < now() - interval '12 hours');

  with picked as (
    select e.id from public.notification_events e
    where e.processed_at is null and (e.locked_until is null or e.locked_until < now())
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  ), claimed as (
    update public.notification_events e
      set attempts = e.attempts + 1, locked_until = now() + interval '2 minutes'
    from picked where e.id = picked.id
    returning e.id
  )
  select array_agg(id) into v_ids from claimed;

  return jsonb_build_object(
    'texts', coalesce((select ps.notification_texts from public.platform_settings ps where ps.id = 1), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'user_id', e.user_id,
        'event', e.event,
        'params', e.params,
        'booking_id', e.booking_id,
        'channels', to_jsonb(array(select c from unnest(e.channels) c where not (c = any (e.channels_done)))),
        'created_at', e.created_at,
        'attempts', e.attempts,
        'lang', coalesce(p.lang, 'ro'),
        'role', coalesce(p.role, 'admin'),
        'email', case when 'email' = any (e.channels) and p.deleted_at is null
                      then (select u.email from auth.users u where u.id = e.user_id) end,
        'phone', case when 'sms' = any (e.channels) and p.deleted_at is null
                           and (p.phone_verified_at is not null or p.phone_verified_by_admin)
                      then p.phone end,
        'service', (select jsonb_build_object('ro', s.name_ro, 'en', s.name_en)
                    from public.services s where s.id = e.params->>'service_id'),
        'devices', coalesce((
          select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', ps.subscription->'keys',
                                              'fcm_token', ps.subscription->>'fcm_token'))
          from public.push_subscriptions ps where ps.user_id = e.user_id), '[]'::jsonb)
      ) order by e.created_at)
      from public.notification_events e
      left join public.profiles p on p.id = e.user_id
      where e.id = any (v_ids)), '[]'::jsonb));
end
$$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;

update public.schema_version set version = 41;
