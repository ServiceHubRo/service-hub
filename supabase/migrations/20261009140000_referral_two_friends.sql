-- Invite a friend: one free report for every N friends, not for each one (Eduard, 9 Oct 2026).
-- N is the admin setting `referral_friends_per_report` (2; 1–10).
--
-- · A friend whose first job counts (booked in the app, finished with an amount above 0, the
--   checks of T35 passed) is now `qualified`. When the inviter has N qualified friends not yet
--   turned into a report, the oldest N become `rewarded` and one report credit is given
--   (report_credit, push + email), as before.
-- · Over `referral_credits_per_year` credits in 365 days a friend is refused `limit`, as before.
-- · The same person brings one qualification only: `same_friend` also looks at qualified friends.
-- · my_client_referrals() also answers friends_per_report and progress (qualified friends
--   waiting for the next report).

update public.platform_settings
  set limits = limits || '{"referral_friends_per_report": 2}'::jsonb
where id = 1 and not (limits ? 'referral_friends_per_report');

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
    when 'company_fix_days' then int4range(1, 90, '[]')
    when 'company_recheck_days' then int4range(7, 365, '[]')
    when 'referral_credits_per_year' then int4range(0, 12, '[]')
    when 'referral_friends_per_report' then int4range(1, 10, '[]')
  end
$$;
revoke execute on function public.limit_range(text) from public, anon, authenticated;

alter table public.client_referrals drop constraint client_referrals_status_check;
alter table public.client_referrals
  add constraint client_referrals_status_check check (status in ('signed_up', 'qualified', 'rewarded', 'refused'));
-- The report a rewarded friend counted towards.
alter table public.client_referrals add column credit_id uuid references public.report_credits (id) on delete set null;
create index client_referrals_waiting_idx on public.client_referrals (referrer_id, decided_at) where status = 'qualified';

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
      where c.client_id = r.referrer_id and c.created_at > now() - interval '365 days';
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
revoke execute on function public.grant_client_referral_credit(uuid) from public, anon, authenticated;

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
    'rewarded', (select count(*) from public.report_credits c where c.client_id = p.id),
    'credits_available', (select count(*) from public.report_credits c where c.client_id = p.id and c.used_at is null),
    'credits_per_year', public.app_limit('referral_credits_per_year', 3),
    'friends_per_report', greatest(public.app_limit('referral_friends_per_report', 2), 1),
    'progress', (select count(*) from public.client_referrals r where r.referrer_id = p.id and r.status = 'qualified'))
  from public.profiles p
  where p.id = auth.uid() and p.role = 'client' and p.deleted_at is null
$$;
revoke execute on function public.my_client_referrals() from public, anon;
grant execute on function public.my_client_referrals() to authenticated;

update public.schema_version set version = 71;
