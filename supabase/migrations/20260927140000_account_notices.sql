-- Suspension and reactivation reach the person on their phone too (Eduard, after a test):
--   account_suspended   email + push (was email only), to the person or to the shop's owner;
--   account_reactivated email + push (new), when an account or a shop is reactivated.
-- Texts: _shared/templates.ts (push, `client.account_*`, `shop.account_*[_shop]`) and
-- _shared/emails.ts (email). A deleted account gets neither.

create or replace function public.profiles_after_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.id, 'account_suspended', jsonb_build_object('kind', 'account'), null, array['email', 'push']);
  return new;
end
$$;

create or replace function public.shops_after_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.owner_id, 'account_suspended',
    jsonb_build_object('kind', 'shop', 'shop_name', new.name), null, array['email', 'push']);
  return new;
end
$$;

create function public.profiles_after_unsuspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.id, 'account_reactivated', jsonb_build_object('kind', 'account'), null, array['email', 'push']);
  return new;
end
$$;
create trigger profiles_after_unsuspend after update of suspended on public.profiles
  for each row
  when (old.suspended and not new.suspended and new.deleted_at is null)
  execute function public.profiles_after_unsuspend();

create function public.shops_after_unsuspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_user(new.owner_id, 'account_reactivated',
    jsonb_build_object('kind', 'shop', 'shop_name', new.name), null, array['email', 'push']);
  return new;
end
$$;
create trigger shops_after_unsuspend after update of suspended on public.shops
  for each row
  when (old.suspended and not new.suspended)
  execute function public.shops_after_unsuspend();

revoke all on function public.profiles_after_unsuspend() from public, anon, authenticated;
revoke all on function public.shops_after_unsuspend() from public, anon, authenticated;

update public.schema_version set version = 34;
