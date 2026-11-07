-- Rollback of A2 (supabase/migrations/20261107173549_support_role.sql), schema 109 → 108.
-- Every agent becomes a client account again (its sessions end, its E- ID stays); the support
-- functions, the session check and the audit log's actor and reason columns go; account deletion and
-- the audit list are restored exactly as before. Lost: the agent/admin role and reason written on the
-- audit entries made after A2 (the entries themselves stay, with their author's ID in admin_id).

update public.profiles set role = 'client' where role = 'support';

drop function public.admin_revoke_support(uuid, text, uuid);
drop function public.admin_grant_support(text, text, uuid);
drop function public.admin_list_support_agents();
drop function public.support_set_suggestion_status(uuid, text, uuid);
drop function public.support_list_suggestions();
drop function public.support_get_account(uuid);
drop function public.support_search_accounts(text);
drop function public.support_account_card(uuid);
drop function public.mask_email(text);

drop trigger profiles_end_staff_sessions on public.profiles;
drop function public.end_staff_sessions();
drop function public.require_staff();
drop function public.caller_session_alive();
drop function public.staff_audit(text, text, text, jsonb, jsonb, text);
drop trigger admin_audit_log_actor on public.admin_audit_log;
drop function public.admin_audit_log_actor();

create or replace function public.prepare_account_deletion(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_keep_shop boolean := false;
begin
  select * into v_me from public.profiles where id = p_user_id for update;
  if not found then
    return 'delete';
  end if;
  if v_me.role = 'admin' then
    perform public.fail('not_allowed');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.client_id = p_user_id and public.is_active_status(b.status)
  ) then
    perform public.fail('account_has_active_bookings');
  end if;

  select * into v_shop from public.shops where owner_id = p_user_id for update;
  if found then
    if exists (
      select 1 from public.bookings b
      where b.shop_id = v_shop.id and public.is_active_status(b.status)
    ) then
      perform public.fail('shop_has_active_bookings');
    end if;
    v_keep_shop := exists (select 1 from public.bookings b where b.shop_id = v_shop.id)
                or exists (select 1 from public.invoices i where i.shop_id = v_shop.id);
  end if;

  -- What other people keep about this person loses the name and the phone number.
  update public.bookings set client_name = null, client_phone = null where client_id = p_user_id;
  update public.threads set client_name = null where client_id = p_user_id;
  update public.reviews set client_display_name = '' where client_id = p_user_id;

  -- Their own data goes now, whatever happens to the login.
  delete from public.cars where owner_id = p_user_id;
  delete from public.favorites where client_id = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.phone_verifications where user_id = p_user_id;
  delete from public.notice_reads where user_id = p_user_id;
  delete from public.notification_events where user_id = p_user_id and processed_at is null;

  if v_keep_shop then
    update public.shops set active = false where id = v_shop.id;
    update public.subscriptions set status = 'inactive', cancel_at_period_end = false
    where shop_id = v_shop.id;
    delete from public.shop_staff where shop_id = v_shop.id and role = 'staff';
    update public.shop_staff set invited_email = null where shop_id = v_shop.id and role = 'owner';
    update public.profiles
    set name = null, phone = null, push_prompt_dismissed_at = null, location_prompt_dismissed_at = null,
        deleted_at = coalesce(deleted_at, now())
    where id = p_user_id;
    return 'anonymize';
  end if;

  update public.profiles set deleted_at = coalesce(deleted_at, now()) where id = p_user_id;
  return 'delete';
end
$$;

create or replace function public.admin_list_audit(p_before timestamptz default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(x.entry order by x.created_at desc, x.id desc) from (
      select a.id, a.created_at, jsonb_build_object(
          'id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
          'before', a.before, 'after', a.after, 'created_at', a.created_at,
          'admin_display_id', p.display_id, 'admin_name', p.name,
          'label', case a.entity_type
            when 'shop' then (select s.name from public.shops s where s.id::text = a.entity_id)
            when 'booking' then (select b.ref from public.bookings b where b.id::text = a.entity_id)
            when 'profile' then (select coalesce(pp.display_id, '') from public.profiles pp where pp.id::text = a.entity_id)
            when 'review' then (select s.name from public.reviews r join public.shops s on s.id = r.shop_id
                                where r.id::text = a.entity_id)
            when 'report' then (select hr.code from public.history_reports hr where hr.id::text = a.entity_id)
            when 'notice' then coalesce((select n.title_ro from public.notices n where n.id::text = a.entity_id),
                                        a.after->>'title_ro', a.before->>'title_ro')
            when 'category' then (select c.name_ro from public.service_categories c where c.key = a.entity_id)
            when 'service' then (select sv.name_ro from public.services sv where sv.id = a.entity_id)
            else a.entity_id
          end) as entry
      from public.admin_audit_log a
      left join public.profiles p on p.id = a.admin_id
      where p_before is null or a.created_at < p_before
      order by a.created_at desc, a.id desc
      limit least(greatest(coalesce(p_limit, 100), 1), 200)) x
  ), '[]'::jsonb);
end
$$;

alter table public.admin_audit_log
  drop column reason,
  drop column actor_display_id,
  drop column actor_role;

drop sequence public.display_id_support_seq;

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('client', 'shop', 'admin'));

update public.schema_version set version = 108;
