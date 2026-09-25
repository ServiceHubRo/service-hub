-- T13 — Email and SMS. ARCHITECTURE §9, §11; FR §2, §7.
--
-- · The outbox learns email and SMS: each channel is finished on its own (channels_done), so a
--   retry for a push that did not arrive never sends the SMS or the email a second time.
-- · claim_notifications answers the recipient's email address (email channel) and verified
--   phone (sms channel); events meant for the platform's admin address have no user.
-- · New events: review_reported (to the admin address, when a shop reports a review) and
--   account_suspended (to the person whose account or shop was suspended), written by triggers
--   so every future way of reporting or suspending sends them.
-- · The account's language is copied into the Auth user's metadata, which the Supabase Auth
--   email templates read (confirmation, password reset, email change arrive in that language).
-- · Phone verification by SMS code: phone_verify_begin / phone_verify_cancel (for the
--   phone-verify-start Edge Function), check_phone_code and my_phone_verification (the app).

-- ---------------------------------------------------------------------------------------------
-- Outbox: per-channel progress, platform events without a user
-- ---------------------------------------------------------------------------------------------
alter table public.notification_events
  add column channels_done text[] not null default '{}'::text[];

alter table public.notification_events alter column user_id drop not null;
alter table public.notification_events
  add constraint notification_events_recipient check (user_id is not null or event in ('review_reported'));

-- Takes up to p_limit due events (held 2 minutes) and answers them with what the function needs:
-- the channels still to do, the recipient's language and role, the email address (email
-- channel; none for deleted accounts), the phone number only when it is verified (sms channel),
-- the service names, the devices, and the admin's text overrides. Events older than 12 hours,
-- or tried 5 times, are closed without sending.
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
          select jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'keys', ps.subscription->'keys'))
          from public.push_subscriptions ps where ps.user_id = e.user_id), '[]'::jsonb)
      ) order by e.created_at)
      from public.notification_events e
      left join public.profiles p on p.id = e.user_id
      where e.id = any (v_ids)), '[]'::jsonb));
end
$$;
revoke execute on function public.claim_notifications(int) from public, anon, authenticated;

-- Records what happened to claimed events:
--   [{ "id", "done": true|false, "error", "channels_done": [channels finished this round],
--      "log": [{channel, status, error}], "gone": [dead endpoints], "delivered": [endpoints] }]
-- The log is written every round (a channel is logged once, in the round that finished it).
-- done = false leaves the unfinished channels for a retry, a little later each time.
create or replace function public.finish_notifications(p_results jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_event public.notification_events%rowtype;
  v_done boolean;
  v_n int := 0;
begin
  for r in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    v_done := coalesce((r->>'done')::boolean, true);
    update public.notification_events
      set processed_at = case when v_done then now() end,
          locked_until = case when v_done then null else now() + make_interval(mins => 2 * attempts) end,
          last_error = left(r->>'error', 500),
          channels_done = array(
            select distinct c from unnest(channels_done || array(
              select jsonb_array_elements_text(case when jsonb_typeof(r->'channels_done') = 'array'
                                                    then r->'channels_done' else '[]'::jsonb end))) c
            where c = any (channels))
    where id = public.try_uuid(r->>'id') and processed_at is null
    returning * into v_event;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;

    insert into public.notifications_log (event_id, user_id, channel, status, error)
    select v_event.id, v_event.user_id, l->>'channel', left(coalesce(l->>'status', 'unknown'), 40), left(l->>'error', 500)
    from jsonb_array_elements(coalesce(r->'log', '[]'::jsonb)) l
    where l->>'channel' in ('push', 'email', 'sms');

    if v_event.user_id is not null then
      delete from public.push_subscriptions
      where user_id = v_event.user_id
        and endpoint in (select jsonb_array_elements_text(coalesce(r->'gone', '[]'::jsonb)));
      update public.push_subscriptions set last_success_at = now()
      where user_id = v_event.user_id
        and endpoint in (select jsonb_array_elements_text(coalesce(r->'delivered', '[]'::jsonb)));
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.finish_notifications(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- review_reported — the platform's admin address learns of every report at once (the shop is
-- promised an answer within 5 working days). Sent by email to ADMIN_EMAIL (Edge Function secret).
-- ---------------------------------------------------------------------------------------------
create function public.reviews_after_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop public.shops%rowtype;
  v_ref text;
begin
  select * into v_shop from public.shops where id = new.shop_id;
  select b.ref into v_ref from public.bookings b where b.id = new.booking_id;
  insert into public.notification_events (user_id, event, params, booking_id, channels)
  values (null, 'review_reported', jsonb_build_object(
      'review_id', new.id,
      'shop_id', new.shop_id,
      'shop_name', v_shop.name,
      'shop_city', v_shop.city,
      'shop_display_id', (select p.display_id from public.profiles p where p.id = v_shop.owner_id),
      'client_name', new.client_display_name,
      'rating', new.rating,
      'text', left(coalesce(new.text, ''), 2000),
      'reason', new.report_reason,
      'ref', v_ref,
      'review_at', new.created_at,
      'reported_at', new.reported_at),
    new.booking_id, array['email']);
  return new;
end
$$;
create trigger reviews_after_report after update of reported_at on public.reviews
  for each row
  when (old.reported_at is null and new.reported_at is not null)
  execute function public.reviews_after_report();

-- ---------------------------------------------------------------------------------------------
-- account_suspended — an email to the person whose account (or shop, to its owner) was
-- suspended, whoever did it (admin screens arrive in T16a).
-- ---------------------------------------------------------------------------------------------
create function public.profiles_after_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.id, 'account_suspended', jsonb_build_object('kind', 'account'), null, array['email']);
  return new;
end
$$;
create trigger profiles_after_suspend after update of suspended on public.profiles
  for each row
  when (new.suspended and not old.suspended and new.deleted_at is null)
  execute function public.profiles_after_suspend();

create function public.shops_after_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.owner_id, 'account_suspended',
    jsonb_build_object('kind', 'shop', 'shop_name', new.name), null, array['email']);
  return new;
end
$$;
create trigger shops_after_suspend after update of suspended on public.shops
  for each row
  when (new.suspended and not old.suspended)
  execute function public.shops_after_suspend();

-- ---------------------------------------------------------------------------------------------
-- Staff invitations by email (invite-staff Edge Function): the token hash last mailed and when,
-- so each invitation link is mailed once (a new link — "Retrimite invitația" — gets its own
-- email). Server only.
-- ---------------------------------------------------------------------------------------------
alter table public.shop_staff
  add column invite_emailed_hash text,
  add column invite_emailed_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- The account's language, copied into the Auth user's metadata: the Auth email templates
-- (supabase/templates) pick Romanian or English from `.Data.lang`.
-- ---------------------------------------------------------------------------------------------
create function public.profiles_sync_lang()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('lang', new.lang)
  where id = new.id
    and (raw_user_meta_data->>'lang') is distinct from new.lang;
  return new;
end
$$;
create trigger profiles_sync_lang after update of lang on public.profiles
  for each row
  when (new.lang is distinct from old.lang)
  execute function public.profiles_sync_lang();

-- ---------------------------------------------------------------------------------------------
-- Phone verification by SMS code (FR §2: a shop appears in search only with a verified phone).
-- A code is 6 digits, valid 10 minutes, 5 tries. At most one code a minute and 5 a day per
-- account, and 5 a day per phone number whoever asks (nobody can flood a number with codes).
-- Only the SHA-256 of (verification id, code) is stored.
-- ---------------------------------------------------------------------------------------------
create function public.phone_code_hash(p_id uuid, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_id::text || ':' || p_code, 'UTF8')), 'hex')
$$;

-- Called by phone-verify-start (service role) with a fresh random code. Answers
--   {status: 'send', id, phone, lang}   → the function sends the SMS (or cancels on failure)
--   {status: 'wait', wait_seconds, expires_at}  → a code was sent less than a minute ago
-- or refuses: not_allowed (not a shop account), phone_missing, phone_already_verified,
-- limit_phone_codes.
create function public.phone_verify_begin(p_user_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_last public.phone_verifications%rowtype;
  v_id uuid := gen_random_uuid();
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'phone_verify_begin: the code must be 6 digits';
  end if;
  -- One request at a time per account.
  select * into v_me from public.profiles where id = p_user_id for update;
  if not found or v_me.role <> 'shop' or v_me.deleted_at is not null or v_me.suspended then
    perform public.fail('not_allowed');
  end if;
  if v_me.phone is null or btrim(v_me.phone) = '' then
    perform public.fail('phone_missing');
  end if;
  if v_me.phone_verified_at is not null or v_me.phone_verified_by_admin then
    perform public.fail('phone_already_verified');
  end if;

  select * into v_last from public.phone_verifications
  where user_id = p_user_id and verified_at is null
  order by created_at desc limit 1;
  if found and v_last.phone = v_me.phone and v_last.created_at > now() - interval '60 seconds' then
    return jsonb_build_object(
      'status', 'wait',
      'wait_seconds', greatest(1, ceil(extract(epoch from v_last.created_at + interval '60 seconds' - now()))::int),
      'expires_at', v_last.expires_at);
  end if;

  if (select count(*) from public.phone_verifications
      where user_id = p_user_id and created_at > now() - interval '24 hours') >= 5
     or (select count(*) from public.phone_verifications
         where phone = v_me.phone and created_at > now() - interval '24 hours') >= 5 then
    perform public.fail('limit_phone_codes', jsonb_build_object('limit', 5));
  end if;

  insert into public.phone_verifications (id, user_id, phone, code_hash, expires_at)
  values (v_id, p_user_id, v_me.phone, public.phone_code_hash(v_id, p_code), v_expires);

  return jsonb_build_object('status', 'send', 'id', v_id, 'phone', v_me.phone, 'lang', v_me.lang,
                            'expires_at', v_expires);
end
$$;
revoke execute on function public.phone_verify_begin(uuid, text) from public, anon, authenticated;

-- The SMS could not be sent: forget the code, so it neither blocks a new try nor counts.
create function public.phone_verify_cancel(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.phone_verifications where id = p_id and verified_at is null
$$;
revoke execute on function public.phone_verify_cancel(uuid) from public, anon, authenticated;

-- The caller's phone and where its verification stands, so the app can show the code field
-- again after a reload.
create function public.my_phone_verification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_last public.phone_verifications%rowtype;
begin
  v_me := public.require_caller();
  select * into v_last from public.phone_verifications
  where user_id = v_me.id and verified_at is null and phone = v_me.phone
    and expires_at > now() and attempts < 5
  order by created_at desc limit 1;
  return jsonb_build_object(
    'phone', v_me.phone,
    'verified', v_me.phone_verified_at is not null or v_me.phone_verified_by_admin,
    'code_sent_at', v_last.created_at,
    'expires_at', v_last.expires_at,
    'resend_in', case when v_last.id is null then 0
                      else greatest(0, ceil(extract(epoch from v_last.created_at + interval '60 seconds' - now()))::int) end);
end
$$;

-- Checks a code typed by the caller against their newest code. Answers
--   {status: 'verified'} | {status: 'wrong', attempts_left} | {status: 'locked'} | {status: 'expired'}
-- A wrong code is an answer, not an error, so the counted try is kept.
create function public.check_phone_code(p_code text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_row public.phone_verifications%rowtype;
  v_code text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  v_result jsonb;
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'check_phone_code');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_me from public.profiles where id = v_me.id for update;

  if v_me.phone_verified_at is not null or v_me.phone_verified_by_admin then
    v_result := jsonb_build_object('status', 'verified');
  else
    select * into v_row from public.phone_verifications
    where user_id = v_me.id and verified_at is null
    order by created_at desc limit 1
    for update;
    if not found or v_row.phone is distinct from v_me.phone or v_row.expires_at <= now() then
      v_result := jsonb_build_object('status', 'expired');
    elsif v_row.attempts >= 5 then
      v_result := jsonb_build_object('status', 'locked');
    elsif v_code ~ '^[0-9]{6}$' and public.phone_code_hash(v_row.id, v_code) = v_row.code_hash then
      update public.phone_verifications set verified_at = now(), attempts = attempts + 1 where id = v_row.id;
      update public.profiles set phone_verified_at = now() where id = v_me.id;
      v_result := jsonb_build_object('status', 'verified');
    else
      update public.phone_verifications set attempts = attempts + 1 where id = v_row.id
        returning * into v_row;
      v_result := case when v_row.attempts >= 5 then jsonb_build_object('status', 'locked')
                       else jsonb_build_object('status', 'wrong', 'attempts_left', 5 - v_row.attempts) end;
    end if;
  end if;

  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

revoke execute on function
  public.phone_code_hash(uuid, text),
  public.reviews_after_report(),
  public.profiles_after_suspend(),
  public.shops_after_suspend(),
  public.profiles_sync_lang()
from public, anon, authenticated;
revoke execute on function public.my_phone_verification(), public.check_phone_code(text, uuid) from public, anon;
grant execute on function public.my_phone_verification(), public.check_phone_code(text, uuid) to authenticated;

update public.schema_version set version = 18;
