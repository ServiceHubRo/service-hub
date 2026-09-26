-- Account fingerprints (Eduard, 26 Sep 2026): the free period once per person, and no way around a
-- suspension by making a new account. ARCHITECTURE §15.
--
-- What is kept is not the email or the phone number but a fingerprint of each: SHA-256 of a secret
-- that never leaves the database + the value (lower-case email; phone digits with the country code).
-- It cannot be read back, and it matches only the same value typed again.
--
-- · trial_used — every shop owner (the person who signed the shop up). A new shop signed up later
--   with the same email or the same phone gets no free period and no launch price: its subscription
--   starts inactive (ended_reason 'trial_used') and the owner pays from the first day.
-- · suspended_account / suspended_shop — while an account (or its owner's shop) is suspended. A new
--   account with the same email or phone is created suspended too; the admin sees it in the audit
--   log ("Suspendat automat") and can lift it, which also forgets the fingerprints behind it.
-- · Kept while the account exists, then 3 years after it is deleted (released_at), then purged
--   (daily, purge_account_fingerprints). The Privacy Policy says so.
-- Nobody reads the table through the API: only the database's own functions.

create table public.account_fingerprint_secret (
  id int primary key default 1 check (id = 1),
  secret text not null
);
insert into public.account_fingerprint_secret (secret)
values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
alter table public.account_fingerprint_secret enable row level security;
revoke all on public.account_fingerprint_secret from public, anon, authenticated;

create table public.account_fingerprints (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('email', 'phone')),
  hash text not null,
  reason text not null check (reason in ('trial_used', 'suspended_account', 'suspended_shop')),
  user_id uuid references auth.users (id) on delete set null,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index account_fingerprints_user_idx on public.account_fingerprints (user_id, reason, kind, hash)
  where user_id is not null;
create index account_fingerprints_hash_idx on public.account_fingerprints (hash, reason);
alter table public.account_fingerprints enable row level security;
revoke all on public.account_fingerprints from public, anon, authenticated;

alter table public.subscriptions drop constraint subscriptions_ended_reason_check;
alter table public.subscriptions
  add constraint subscriptions_ended_reason_check
  check (ended_reason in ('trial_ended', 'payment_failed', 'cancelled', 'admin', 'trial_used'));

-- ---------------------------------------------------------------------------------------------
-- The fingerprint of one value
-- ---------------------------------------------------------------------------------------------

-- Email: lower-case, trimmed. Phone: its digits with the country code (a Romanian number written
-- 07… counts as 407…). Null for an empty value.
create function public.account_fingerprint(p_kind text, p_value text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  if p_kind = 'email' then
    v := lower(btrim(coalesce(p_value, '')));
  else
    v := regexp_replace(coalesce(p_value, ''), '\D', '', 'g');
    if v ~ '^0[237][0-9]{8}$' then
      v := '4' || v;
    elsif v ~ '^00' then
      v := substr(v, 3);
    end if;
  end if;
  if v = '' then
    return null;
  end if;
  return encode(sha256(convert_to(
    (select s.secret from public.account_fingerprint_secret s where s.id = 1) || ':' || p_kind || ':' || v, 'UTF8')), 'hex');
end
$$;

-- The person's current email and phone, as fingerprints: rows (kind, hash).
create function public.account_fingerprints_of(p_user_id uuid)
returns table (kind text, hash text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'email', public.account_fingerprint('email', u.email)
  from auth.users u
  where u.id = p_user_id and u.email is not null and u.email not like '%@deleted.invalid'
  union all
  select 'phone', public.account_fingerprint('phone', p.phone)
  from public.profiles p
  where p.id = p_user_id and p.phone is not null
$$;

-- Records the person's current email and phone for one reason (again after a change: new values
-- are added, the old ones stay).
create function public.add_account_fingerprints(p_user_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.account_fingerprints (kind, hash, reason, user_id)
  select f.kind, f.hash, p_reason, p_user_id
  from public.account_fingerprints_of(p_user_id) f
  where f.hash is not null
  on conflict (user_id, reason, kind, hash) where user_id is not null do nothing
$$;

-- A suspension lifted: this person's fingerprints for it go, and so do the ones their email or
-- phone matched (the account they were suspended because of), so the admin's decision holds.
create function public.remove_account_fingerprints(p_user_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.account_fingerprints fp
  where fp.reason = p_reason
    and (fp.user_id = p_user_id
         or fp.hash in (select f.hash from public.account_fingerprints_of(p_user_id) f where f.hash is not null))
$$;

-- Everything that applies to this person now, for their current email and phone.
create function public.refresh_account_fingerprints(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.shops s join public.subscriptions sub on sub.shop_id = s.id
             where s.owner_id = p_user_id) then
    perform public.add_account_fingerprints(p_user_id, 'trial_used');
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id and p.suspended) then
    perform public.add_account_fingerprints(p_user_id, 'suspended_account');
  end if;
  if exists (select 1 from public.shops s where s.owner_id = p_user_id and s.suspended) then
    perform public.add_account_fingerprints(p_user_id, 'suspended_shop');
  end if;
end
$$;

revoke execute on function public.account_fingerprint(text, text), public.account_fingerprints_of(uuid),
  public.add_account_fingerprints(uuid, text), public.remove_account_fingerprints(uuid, text),
  public.refresh_account_fingerprints(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Kept in step: suspensions, a changed phone or email, a deleted account
-- ---------------------------------------------------------------------------------------------

create function public.profiles_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.suspended is distinct from old.suspended then
    if new.suspended then
      perform public.add_account_fingerprints(new.id, 'suspended_account');
    else
      perform public.remove_account_fingerprints(new.id, 'suspended_account');
    end if;
  end if;
  if new.phone is distinct from old.phone and new.deleted_at is null then
    perform public.refresh_account_fingerprints(new.id);
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    update public.account_fingerprints set released_at = now() where user_id = new.id and released_at is null;
  end if;
  return null;
end
$$;
create trigger profiles_fingerprints after update of suspended, phone, deleted_at on public.profiles
  for each row execute function public.profiles_fingerprints();

create function public.shops_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.suspended then
    perform public.add_account_fingerprints(new.owner_id, 'suspended_shop');
  else
    perform public.remove_account_fingerprints(new.owner_id, 'suspended_shop');
  end if;
  return null;
end
$$;
create trigger shops_fingerprints after update of suspended on public.shops
  for each row when (new.suspended is distinct from old.suspended)
  execute function public.shops_fingerprints();

create function public.auth_users_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.account_fingerprints set released_at = now() where user_id = old.id and released_at is null;
    return old;
  end if;
  perform public.refresh_account_fingerprints(new.id);
  return new;
end
$$;
create trigger auth_users_fingerprints_email after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.auth_users_fingerprints();
create trigger auth_users_fingerprints_delete before delete on auth.users
  for each row execute function public.auth_users_fingerprints();

-- ---------------------------------------------------------------------------------------------
-- Sign-up: after handle_new_user (triggers run in name order), the new account is checked
-- ---------------------------------------------------------------------------------------------

create function public.signup_fingerprints()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matched text[];
  v_shop_id uuid;
  v_sub public.subscriptions%rowtype;
  v_price numeric;
begin
  -- The same email or phone as a suspended account or shop: created suspended.
  select array_agg(distinct f.kind order by f.kind) into v_matched
  from public.account_fingerprints_of(new.id) f
  join public.account_fingerprints fp on fp.hash = f.hash
  where fp.reason in ('suspended_account', 'suspended_shop')
    and fp.user_id is distinct from new.id;
  if v_matched is not null then
    update public.profiles set suspended = true where id = new.id;
    insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
    values (null, 'auto_suspend_account', 'profile', new.id::text, null, jsonb_build_object('matched', to_jsonb(v_matched)));
  end if;

  -- A shop owner whose email or phone already had a free period: none this time, and no launch price.
  select s.id into v_shop_id from public.shops s where s.owner_id = new.id;
  if v_shop_id is not null then
    select array_agg(distinct f.kind order by f.kind) into v_matched
    from public.account_fingerprints_of(new.id) f
    join public.account_fingerprints fp on fp.hash = f.hash
    where fp.reason = 'trial_used' and fp.user_id is distinct from new.id;
    if v_matched is not null then
      select * into v_sub from public.subscriptions where shop_id = v_shop_id for update;
      select ps.subscription_price_ron into v_price from public.platform_settings ps where ps.id = 1;
      update public.subscriptions
        set status = 'inactive',
            ended_reason = 'trial_used',
            trial_ends_at = now(),
            status_changed_at = now(),
            price_ron = case when v_sub.launch_offer then v_price else v_sub.price_ron end,
            launch_offer = false
      where shop_id = v_shop_id;
      update public.shops set active = false where id = v_shop_id;
      insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
      values (null, 'auto_no_trial', 'shop', v_shop_id::text, null, jsonb_build_object('matched', to_jsonb(v_matched)));
    end if;
  end if;

  perform public.refresh_account_fingerprints(new.id);
  return new;
end
$$;
create trigger on_auth_user_created_zz_fingerprints after insert on auth.users
  for each row execute function public.signup_fingerprints();

revoke execute on function public.profiles_fingerprints(), public.shops_fingerprints(),
  public.auth_users_fingerprints(), public.signup_fingerprints() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Purge after 3 years, and what exists already
-- ---------------------------------------------------------------------------------------------

create function public.purge_account_fingerprints(p_now timestamptz default now())
returns int
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.account_fingerprints
    where released_at is not null and released_at < p_now - interval '3 years'
    returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function public.purge_account_fingerprints(timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('sh_purge_fingerprints', '41 2 * * *', 'select public.purge_account_fingerprints()');
  end if;
end
$$;

-- Shops that exist, accounts and shops suspended now.
select public.refresh_account_fingerprints(p.id)
from public.profiles p
where p.deleted_at is null
  and (p.suspended or exists (select 1 from public.shops s where s.owner_id = p.id));

update public.schema_version set version = 32;
