-- A free report given by the admin (Eduard, 15 Oct 2026). ARCHITECTURE §12.
--
-- · admin → Clienți → a client → "Dă un raport gratuit": one report credit (report_credits), used
--   like the one from inviting friends (report-checkout, use_credit), at 0 lei.
-- · report_credits.source tells the two apart: 'referral' (inviting friends) or 'admin'. A credit
--   given by the admin does not count towards `referral_credits_per_year`, nor as a reward in the
--   client's invitation card.
-- · The client is told (push + email, `report_credit` with source 'admin': a text without the friend).
-- · Idempotent; the audit log keeps the credits available before and after.

alter table public.report_credits
  add column source text not null default 'referral' check (source in ('referral', 'admin'));

create or replace function public.admin_grant_report_credit(p_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.profiles%rowtype;
  v_before int;
  v_credit uuid;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_grant_report_credit');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or v.role <> 'client' or v.deleted_at is not null then
    perform public.fail('not_found');
  end if;

  select count(*) into v_before from public.report_credits c where c.client_id = v.id and c.used_at is null;
  insert into public.report_credits (client_id, source) values (v.id, 'admin') returning id into v_credit;
  perform public.admin_audit('grant_report_credit', 'profile', v.id,
    jsonb_build_object('credits_available', v_before),
    jsonb_build_object('credits_available', v_before + 1));
  perform public.notify_user(v.id, 'report_credit', jsonb_build_object('source', 'admin'), null, array['push', 'email']);

  v_result := jsonb_build_object('id', v_credit, 'client_id', v.id, 'credits_available', v_before + 1);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_grant_report_credit(uuid, uuid) from public, anon;
grant execute on function public.admin_grant_report_credit(uuid, uuid) to authenticated;

-- The client page shows the free reports: available, used.
create or replace function public.admin_get_client(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  perform public.require_admin();
  select * into v from public.profiles where id = p_user_id and role = 'client';
  if not found then
    perform public.fail('not_found');
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v.id,
      'display_id', v.display_id,
      'name', v.name,
      'phone', v.phone,
      'email', public.account_email(v.id),
      'lang', v.lang,
      'email_verified_at', v.email_verified_at,
      'suspended', v.suspended,
      'deleted_at', v.deleted_at,
      'created_at', v.created_at,
      'terms_version', v.terms_version,
      'last_active_at', public.last_seen(v.id)),
    'no_shows', public.client_no_show_count(v.id, 90),
    'cars', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'make', c.make, 'model', c.model, 'year', c.year,
               'plate', c.plate, 'vin', c.vin, 'itp_expiry', c.itp_expiry, 'rca_expiry', c.rca_expiry,
               'vignette_expiry', c.vignette_expiry)
             order by c.created_at)
      from public.cars c where c.owner_id = v.id), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'ref', b.ref, 'status', b.status, 'date', b.date,
               'slot', to_char(b.slot, 'HH24:MI'), 'shop_id', b.shop_id, 'shop_name', s.name,
               'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
               'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'), 'car_snapshot', b.car_snapshot, 'cost', b.cost)
             order by b.created_at desc)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.services sv on sv.id = b.service_id
      where b.client_id = v.id), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'text', r.text, 'shop_name', s.name,
               'report_status', r.report_status, 'removed_at', r.removed_at, 'created_at', r.created_at)
             order by r.created_at desc)
      from public.reviews r join public.shops s on s.id = r.shop_id
      where r.client_id = v.id), '[]'::jsonb),
    'threads', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'shop_id', t.shop_id, 'shop_name', s.name,
               'last_message_at', t.last_message_at,
               'messages', (select count(*) from public.messages m where m.thread_id = t.id))
             order by t.last_message_at desc nulls last)
      from public.threads t join public.shops s on s.id = t.shop_id
      where t.client_id = v.id), '[]'::jsonb),
    'report_credits', jsonb_build_object(
      'available', (select count(*) from public.report_credits c where c.client_id = v.id and c.used_at is null),
      'used', (select count(*) from public.report_credits c where c.client_id = v.id and c.used_at is not null)),
    'audit', public.audit_entries(array[v.id::text]));
end
$$;

-- Only the friends' credits count towards the yearly limit of the invitations.
create or replace function public.grant_client_referral_credit(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bookings%rowtype;
  r public.client_referrals%rowtype;
  v_owner uuid;
  v_reason text;
  v_given int;
  v_needed int := public.app_limit('referral_friends_per_report', 2);
  v_credit uuid;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.status <> 'done' or b.client_id is null or b.source <> 'app' or coalesce(b.cost, 0) <= 0 then
    return null;
  end if;
  select * into r from public.client_referrals where client_id = b.client_id and status = 'signed_up' for update;
  if not found then
    return null;
  end if;

  -- The inviter's row is the lock: two friends finishing at the same moment are counted in turn.
  perform 1 from public.profiles p
  where p.id = r.referrer_id and p.deleted_at is null and not p.suspended and p.role = 'client'
  for update;
  if not found then
    v_reason := 'referrer_gone';
  else
    select s.owner_id into v_owner from public.shops s where s.id = b.shop_id;
    if v_owner is not null and public.same_person(v_owner, r.referrer_id) then
      v_reason := 'same_person';
    elsif exists (select 1 from public.client_referrals x
                  where x.status in ('qualified', 'rewarded') and x.client_id <> r.client_id
                    and x.fingerprints && r.fingerprints) then
      v_reason := 'same_friend';
    else
      select count(*) into v_given from public.report_credits c
      where c.client_id = r.referrer_id and c.source = 'referral' and c.created_at > now() - interval '365 days';
      if v_given >= public.app_limit('referral_credits_per_year', 3) then
        v_reason := 'limit';
      end if;
    end if;
  end if;

  if v_reason is not null then
    update public.client_referrals
      set status = 'refused', refused_reason = v_reason, booking_id = b.id, decided_at = now()
    where client_id = r.client_id;
    return v_reason;
  end if;

  update public.client_referrals
    set status = 'qualified', booking_id = b.id, decided_at = now()
  where client_id = r.client_id;

  if (select count(*) from public.client_referrals x
      where x.referrer_id = r.referrer_id and x.status = 'qualified') < greatest(v_needed, 1) then
    return 'qualified';
  end if;

  insert into public.report_credits (client_id, referral_client_id) values (r.referrer_id, r.client_id)
  returning id into v_credit;
  update public.client_referrals
    set status = 'rewarded', credit_id = v_credit
  where client_id in (
    select x.client_id from public.client_referrals x
    where x.referrer_id = r.referrer_id and x.status = 'qualified'
    order by x.decided_at, x.client_id
    limit greatest(v_needed, 1));
  perform public.notify_user(r.referrer_id, 'report_credit', '{}'::jsonb, null, array['push', 'email']);
  return 'rewarded';
end
$$;


create or replace function public.my_client_referrals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', p.display_id,
    'invited', (select count(*) from public.client_referrals r where r.referrer_id = p.id),
    'rewarded', (select count(*) from public.report_credits c where c.client_id = p.id and c.source = 'referral'),
    'credits_available', (select count(*) from public.report_credits c where c.client_id = p.id and c.used_at is null),
    'credits_per_year', public.app_limit('referral_credits_per_year', 3),
    'friends_per_report', greatest(public.app_limit('referral_friends_per_report', 2), 1),
    'progress', (select count(*) from public.client_referrals r where r.referrer_id = p.id and r.status = 'qualified'))
  from public.profiles p
  where p.id = auth.uid() and p.role = 'client' and p.deleted_at is null
$$;

update public.schema_version set version = 74;
