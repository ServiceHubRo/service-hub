-- T25 — Fewer ways to cheat (ARCHITECTURE §6, §15).
--
-- · The company behind a shop, checked at ANAF: the verify-company Edge Function asks ANAF's public
--   register about the CUI in shop_billing and records what it says (name, active or not, VAT payer)
--   through record_company_check. A new CUI or legal name forgets the old answer. The owner sees it
--   in Date de facturare, the admin on the shop. Nothing is blocked automatically: the admin decides.
-- · Suspicious reviews: review_signals() marks a review whose client used the phone number of the
--   shop or of someone working there, whose job was finished within 3 hours of the booking, whose
--   shop received 5 or more reviews in 24 hours, or whose client's account was under 7 days old.
--   Moderare lists the reviews with a strong sign (or two weaker ones); the admin removes the review
--   or marks it as fine (signals_cleared_at).
-- · A client with no_shows_before_phone no-shows in 90 days books again only with a phone number
--   confirmed by SMS (the same code as for shops).
-- · The admin works only after the second step of sign-in (a code from an authenticator app, aal2):
--   is_admin() and require_admin() look at the session's level, so a stolen password alone opens
--   nothing. The app asks for the code (or sets the app up the first time).

-- ---------------------------------------------------------------------------------------------
-- 1. The company at ANAF
-- ---------------------------------------------------------------------------------------------
alter table public.shop_billing
  add column anaf_cui text,
  add column anaf_status text check (anaf_status in ('active', 'inactive', 'deregistered', 'not_found')),
  add column anaf_name text check (char_length(anaf_name) <= 300),
  add column anaf_address text check (char_length(anaf_address) <= 500),
  add column anaf_vat_payer boolean,
  add column anaf_name_match boolean,
  add column anaf_checked_at timestamptz;
-- No update grant on these: only record_company_check writes them.

-- A new CUI or legal name: the old answer no longer says anything.
create function public.shop_billing_anaf_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.vat_id is distinct from old.vat_id or new.legal_name is distinct from old.legal_name then
    new.anaf_cui := null;
    new.anaf_status := null;
    new.anaf_name := null;
    new.anaf_address := null;
    new.anaf_vat_payer := null;
    new.anaf_name_match := null;
    new.anaf_checked_at := null;
  end if;
  return new;
end
$$;
create trigger shop_billing_anaf_reset before update on public.shop_billing
  for each row execute function public.shop_billing_anaf_reset();

-- For verify-company (service role): whose company to check. Without a shop: the caller's own (the
-- owner). With a shop: only an admin, after the second step (p_aal).
create function public.company_check_target(p_user_id uuid, p_shop_id uuid, p_aal text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_shop uuid;
  b public.shop_billing%rowtype;
begin
  select * into v_me from public.profiles where id = p_user_id;
  if not found or v_me.deleted_at is not null or v_me.suspended then
    perform public.fail('not_allowed');
  end if;
  if p_shop_id is null then
    select s.id into v_shop from public.shops s where s.owner_id = p_user_id;
  elsif v_me.role = 'admin' and p_aal = 'aal2' then
    v_shop := p_shop_id;
  end if;
  if v_shop is null then
    perform public.fail('not_allowed');
  end if;
  select * into b from public.shop_billing where shop_id = v_shop;
  if not found or b.vat_id is null then
    perform public.fail('no_vat_id');
  end if;
  return jsonb_build_object('shop_id', v_shop, 'vat_id', b.vat_id, 'legal_name', b.legal_name,
                            'anaf_cui', b.anaf_cui, 'anaf_checked_at', b.anaf_checked_at);
end
$$;
revoke execute on function public.company_check_target(uuid, uuid, text) from public, anon, authenticated;

-- Records ANAF's answer for the CUI that was asked, unless the CUI changed meanwhile.
create function public.record_company_check(p_shop_id uuid, p_cui text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.shop_billing%rowtype;
begin
  if p_result->>'status' not in ('active', 'inactive', 'deregistered', 'not_found') then
    raise exception 'record_company_check: unknown status %', p_result->>'status';
  end if;
  update public.shop_billing
    set anaf_cui = p_cui,
        anaf_status = p_result->>'status',
        anaf_name = left(nullif(btrim(p_result->>'name'), ''), 300),
        anaf_address = left(nullif(btrim(p_result->>'address'), ''), 500),
        anaf_vat_payer = (p_result->>'vat_payer')::boolean,
        anaf_name_match = (p_result->>'name_match')::boolean,
        anaf_checked_at = now()
  where shop_id = p_shop_id and vat_id = p_cui
  returning * into b;
  if not found then
    return null;
  end if;
  return to_jsonb(b);
end
$$;
revoke execute on function public.record_company_check(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Suspicious reviews
-- ---------------------------------------------------------------------------------------------
alter table public.reviews add column signals_cleared_at timestamptz;

-- What looks wrong about a review (strongest first):
--   same_phone  — the client's phone is the shop's, or that of someone with an account there
--   quick_job   — finished less than 3 hours after the booking was made
--   burst       — the shop got 5 or more reviews in the 24 hours up to this one
--   new_account — the client's account was under 7 days old when the review was written
create function public.review_signals(p_review public.reviews)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with b as (select * from public.bookings where id = p_review.booking_id),
  phones as (
    select public.account_fingerprint('phone', x) as fp
    from public.shops s,
         lateral (values (s.phone), (s.phone2)) v(x)
    where s.id = p_review.shop_id and x is not null
    union
    select public.account_fingerprint('phone', p.phone)
    from public.shop_staff st join public.profiles p on p.id = st.user_id
    where st.shop_id = p_review.shop_id and p.phone is not null
  )
  select array_remove(array[
    case when exists (select 1 from b, phones
                      where phones.fp is not null
                        and phones.fp = public.account_fingerprint('phone', coalesce(b.client_phone,
                          (select p.phone from public.profiles p where p.id = p_review.client_id))))
         then 'same_phone' end,
    case when exists (select 1 from b where b.done_at is not null and b.done_at - b.created_at < interval '3 hours')
         then 'quick_job' end,
    case when (select count(*) from public.reviews r
               where r.shop_id = p_review.shop_id
                 and r.created_at > p_review.created_at - interval '24 hours'
                 and r.created_at <= p_review.created_at) >= 5
         then 'burst' end,
    case when exists (select 1 from public.profiles p
                      where p.id = p_review.client_id and p.created_at > p_review.created_at - interval '7 days')
         then 'new_account' end
  ], null)
$$;
revoke execute on function public.review_signals(public.reviews) from public, anon, authenticated;

-- A strong sign, or two weaker ones.
create function public.is_suspect_review(p_signals text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select 'same_phone' = any (p_signals) or 'quick_job' = any (p_signals) or cardinality(p_signals) >= 2
$$;

-- Moderare: the reviews of the last 180 days that look wrong, still shown and not marked as fine,
-- newest first (at most 100).
create function public.admin_list_suspect_reviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(public.admin_review_json(x.r) || jsonb_build_object('signals', to_jsonb(x.signals))
                     order by (x.r).created_at desc)
    from (
      select r, public.review_signals(r) as signals
      from public.reviews r
      where r.removed_at is null and r.signals_cleared_at is null
        and r.created_at > now() - interval '180 days'
    ) x
    where public.is_suspect_review(x.signals)
    limit 100), '[]'::jsonb);
end
$$;
revoke execute on function public.admin_list_suspect_reviews() from public, anon;
grant execute on function public.admin_list_suspect_reviews() to authenticated;

-- "E în regulă" (clear: it leaves the list) or "Șterge recenzia" (remove: it no longer shows or
-- counts; the client is told, as when a reported review is removed). Logged.
create function public.admin_decide_suspect_review(p_review_id uuid, p_decision text, p_note text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.reviews%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_decide_suspect_review');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_decision is null or p_decision not in ('clear', 'remove') then
    perform public.fail('decision_invalid');
  end if;
  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;
  select * into v from public.reviews where id = p_review_id for update;
  if not found then
    perform public.fail('review_not_found');
  end if;
  if v.removed_at is not null then
    perform public.fail('wrong_status', jsonb_build_object('status', 'removed'));
  end if;

  if p_decision = 'clear' then
    update public.reviews set signals_cleared_at = now() where id = v.id returning * into v;
    perform public.admin_audit('clear_review_signals', 'review', v.id, '{}'::jsonb,
      jsonb_build_object('signals_cleared_at', v.signals_cleared_at)
        || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
  else
    update public.reviews
      set removed_at = now(), report_status = 'removed', report_decided_at = now(),
          report_note = coalesce(v_note, report_note)
    where id = v.id returning * into v;
    perform public.notify_user(v.client_id, 'review_report_decided', jsonb_build_object(
        'review_id', v.id, 'booking_id', v.booking_id, 'rating', v.rating, 'decision', 'removed', 'shop_id', v.shop_id,
        'ref', (select b.ref from public.bookings b where b.id = v.booking_id),
        'shop_name', (select s.name from public.shops s where s.id = v.shop_id)), v.booking_id);
    perform public.admin_audit('remove_review', 'review', v.id, jsonb_build_object('removed_at', null),
      jsonb_build_object('removed_at', v.removed_at, 'signals', to_jsonb(public.review_signals(v)))
        || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end);
  end if;
  v_result := public.admin_review_json(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_decide_suspect_review(uuid, text, text, uuid) from public, anon;
grant execute on function public.admin_decide_suspect_review(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. A confirmed phone after repeated no-shows
-- ---------------------------------------------------------------------------------------------
update public.platform_settings set limits = limits || '{"no_shows_before_phone": 2}'::jsonb where id = 1;
alter table public.platform_settings alter column limits set default '{
    "active_bookings_per_shop": 3,
    "active_bookings_total": 10,
    "new_bookings_per_24h": 5,
    "messages_per_thread_per_hour": 30,
    "review_window_days": 60,
    "quote_versions_max": 20,
    "no_shows_before_phone": 2,
    "quiet_hours_start": 21,
    "quiet_hours_end": 9,
    "promo_per_week": 2,
    "request_reminder_hours": 2
  }'::jsonb;

create or replace function public.limit_range(p_key text)
returns int4range
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'active_bookings_per_shop' then int4range(1, 20, '[]')
    when 'active_bookings_total' then int4range(1, 100, '[]')
    when 'new_bookings_per_24h' then int4range(1, 100, '[]')
    when 'messages_per_thread_per_hour' then int4range(1, 500, '[]')
    when 'review_window_days' then int4range(1, 365, '[]')
    when 'quote_versions_max' then int4range(1, 100, '[]')
    when 'no_shows_before_phone' then int4range(1, 20, '[]')
    when 'quiet_hours_start' then int4range(0, 23, '[]')
    when 'quiet_hours_end' then int4range(0, 23, '[]')
    when 'promo_per_week' then int4range(0, 7, '[]')
    when 'request_reminder_hours' then int4range(1, 24, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

-- A client booking for themselves (create_booking, whatever its version): refused while the phone is
-- not confirmed after too many no-shows in the last 90 days. Rows written by the server itself (the
-- demo data, the admin) are not the client asking.
create function public.bookings_phone_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := coalesce((select (ps.limits->>'no_shows_before_phone')::int from public.platform_settings ps where ps.id = 1), 2);
  v_count int;
begin
  if new.client_id is null or auth.uid() is distinct from new.client_id then
    return new;
  end if;
  if exists (select 1 from public.profiles p
             where p.id = new.client_id and (p.phone_verified_at is not null or p.phone_verified_by_admin)) then
    return new;
  end if;
  select count(*) into v_count from public.bookings b
  where b.client_id = new.client_id and b.status = 'no_show' and b.date > public.bucharest_today() - 90;
  if v_count >= v_limit then
    perform public.fail('phone_verification_required', jsonb_build_object('no_shows', v_count));
  end if;
  return new;
end
$$;
revoke execute on function public.bookings_phone_rule() from public, anon, authenticated;
create trigger bookings_phone_rule before insert on public.bookings
  for each row execute function public.bookings_phone_rule();

-- Clients may confirm their phone too (the same rules: a code a minute, 5 a day).
create or replace function public.phone_verify_begin(p_user_id uuid, p_code text)
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
  if not found or v_me.role not in ('shop', 'client') or v_me.deleted_at is not null or v_me.suspended then
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

-- ---------------------------------------------------------------------------------------------
-- 4. The admin after the second step of sign-in
-- ---------------------------------------------------------------------------------------------
-- The session's assurance level: aal2 after a code from the authenticator app.
create function public.caller_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt()->>'aal', 'aal1')
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.caller_aal() = 'aal2' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  )
$$;

create or replace function public.require_admin()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  if public.caller_aal() <> 'aal2' then
    perform public.fail('mfa_required');
  end if;
  return v;
end
$$;

-- The Edge Functions that read reports pass the session's level: an admin reads anyone's report
-- only after the second step.
drop function public.history_report_for(uuid, uuid);
create function public.history_report_for(p_user_id uuid, p_report_id uuid, p_aal text default 'aal1')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.history_reports%rowtype;
  v_admin boolean := p_aal = 'aal2' and exists (select 1 from public.profiles p where p.id = p_user_id and p.role = 'admin');
begin
  select * into v from public.history_reports
  where id = p_report_id and (client_id = p_user_id or v_admin);
  if not found then
    perform public.fail('not_found');
  end if;
  if v.status = 'void' and not v_admin then
    perform public.fail('report_void');
  end if;
  return to_jsonb(v);
end
$$;
revoke execute on function public.history_report_for(uuid, uuid, text) from public, anon, authenticated;

update public.schema_version set version = 44;
