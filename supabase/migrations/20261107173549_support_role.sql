-- A2 — the Support Agent role (Eduard, 7 Nov 2026: plan A2 approved, with the agent's appointment
-- reversible and fully logged, the second step of sign-in before the role works, and access lost at
-- once — sessions and API — when the role is withdrawn or the account suspended, while the history of
-- the agent's actions stays).
--
-- · profiles.role accepts 'support'. Never chosen at sign-up (handle_new_user / complete_signup accept
--   only client and shop): an admin appoints an agent with admin_grant_support, only on a clean client
--   account (confirmed email, no cars, bookings, conversations, companies or shop), reason required,
--   in the audit log; admin_revoke_support turns it back into a client account, reason required, in
--   the audit log. Display IDs E-00001.
-- · require_staff(): an agent or an admin, not suspended, not deleted, after the second step (aal2);
--   for an agent, the session must still exist (auth.sessions), so ending the sessions ends the API
--   access at once, before the access token expires.
-- · Ending access: a trigger on profiles deletes the agent's sessions (and with them the refresh
--   tokens) as soon as the role is withdrawn, the account suspended or deleted.
-- · Every admin_* function already refuses anyone who is not an admin (require_admin); unchanged.
-- · support_* functions answer only what an agent needs: account search and card (masked email and
--   phone, no bookings, cars, companies, billing, messages or reviews), the suggestions and their
--   status. Every search, every opened card and every change goes to the audit log.
-- · admin_audit_log: actor_role and actor_display_id (filled for every new row, so an entry keeps its
--   author after the account is deleted) and reason. admin_list_audit returns them.
-- · prepare_account_deletion refuses an agent like an admin: an agent cannot delete its own account;
--   the admin withdraws the role first.
--
-- No existing row is modified. Rollback: supabase/rollback/20261107173549_support_role.sql.

-- ---------------------------------------------------------------------------------------------
-- The role and its display IDs
-- ---------------------------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('client', 'shop', 'admin', 'support'));

create sequence public.display_id_support_seq;

-- ---------------------------------------------------------------------------------------------
-- The audit log: who acted (role and ID, kept after the account is gone) and why
-- ---------------------------------------------------------------------------------------------
alter table public.admin_audit_log
  add column actor_role text,
  add column actor_display_id text,
  add column reason text check (reason is null or char_length(reason) <= 500);

create function public.admin_audit_log_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.admin_id is not null and (new.actor_role is null or new.actor_display_id is null) then
    select coalesce(new.actor_role, p.role), coalesce(new.actor_display_id, p.display_id)
      into new.actor_role, new.actor_display_id
    from public.profiles p where p.id = new.admin_id;
  end if;
  return new;
end
$$;
revoke execute on function public.admin_audit_log_actor() from public, anon, authenticated;

create trigger admin_audit_log_actor
  before insert on public.admin_audit_log
  for each row execute function public.admin_audit_log_actor();

-- An agent's or an admin's action with its reason (support_* and the team functions).
create function public.staff_audit(p_action text, p_entity_type text, p_entity_id text, p_before jsonb,
  p_after jsonb, p_reason text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, reason, created_at)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason, clock_timestamp())
$$;
revoke execute on function public.staff_audit(text, text, text, jsonb, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Who may do support work
-- ---------------------------------------------------------------------------------------------

-- The caller's session still exists (the session id in the access token). Ending an agent's sessions
-- thus ends its API access at once, not when the token expires.
create function public.caller_session_alive()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sid text := auth.jwt()->>'session_id';
begin
  if v_sid is null or v_sid !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return exists (select 1 from auth.sessions s where s.id = v_sid::uuid and s.user_id = auth.uid());
end
$$;
revoke execute on function public.caller_session_alive() from public, anon, authenticated;

-- An agent or an admin, active, after the second step; an agent's session must still exist.
create function public.require_staff()
returns public.profiles
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
begin
  v := public.require_caller();
  if v.role not in ('support', 'admin') or v.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  if public.caller_aal() <> 'aal2' then
    perform public.fail('mfa_required');
  end if;
  if v.role = 'support' and not public.caller_session_alive() then
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$$;
revoke execute on function public.require_staff() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Access ends at once: the role withdrawn, the account suspended or deleted → its sessions go
-- (their refresh tokens with them, on delete cascade), so no new access token can be made, and
-- require_staff refuses the ones already issued.
-- ---------------------------------------------------------------------------------------------
create function public.end_staff_sessions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    delete from auth.sessions where user_id = new.id;
  exception when insufficient_privilege or undefined_table then
    -- The role or the suspension is already in force in every database function.
    null;
  end;
  return new;
end
$$;
revoke execute on function public.end_staff_sessions() from public, anon, authenticated;

create trigger profiles_end_staff_sessions
  after update of role, suspended, deleted_at on public.profiles
  for each row
  when (old.role = 'support' and (new.role <> 'support' or new.suspended or new.deleted_at is not null))
  execute function public.end_staff_sessions();

-- ---------------------------------------------------------------------------------------------
-- An agent cannot delete its own account (like an admin): the admin withdraws the role first.
-- ---------------------------------------------------------------------------------------------
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
  if v_me.role in ('admin', 'support') then
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

-- ---------------------------------------------------------------------------------------------
-- What an agent may see of an account
-- ---------------------------------------------------------------------------------------------

-- m***@gmail.com
create function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(p_email, 1) || '***' || substr(p_email, position('@' in p_email))
  end
$$;

-- An account as an agent sees it: who it is and in what state, never what it did.
create function public.support_account_card(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_id', p.display_id,
    'role', p.role,
    'name', p.name,
    'state', case when p.deleted_at is not null then 'deleted' when p.suspended then 'suspended' else 'active' end,
    'email_masked', public.mask_email(u.email),
    'email_verified', u.email_confirmed_at is not null or p.email_verified_at is not null,
    'phone_last3', nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 3), ''),
    'lang', p.lang,
    'created_at', p.created_at,
    'last_active_at', public.last_seen(p.id),
    'shop', (select jsonb_build_object('name', s.name, 'city', s.city, 'staff_role', st.role)
             from public.shop_staff st join public.shops s on s.id = st.shop_id
             where st.user_id = p.id and st.accepted_at is not null
             limit 1))
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_id
$$;
revoke execute on function public.support_account_card(uuid) from public, anon, authenticated;

-- Căutare: by account ID (C-00012), exact email, phone (the last 9 digits) or a part of the name or
-- of the shop's name (at least 3 characters). Clients and shops only, at most 20, the exact matches
-- first. Each search is in the audit log; 120 an hour per agent.
create function public.support_search_accounts(p_q text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text;
  v_like text;
  v_ids uuid[];
  v_more boolean;
begin
  v_me := public.require_staff();
  if char_length(v_q) < 3 then
    perform public.fail('query_too_short', jsonb_build_object('min', 3));
  end if;
  if char_length(v_q) > 100 then
    perform public.fail('query_too_long', jsonb_build_object('max', 100));
  end if;
  if not public.rate_take('support_search', v_me.id, 120, interval '1 hour') then
    perform public.fail('limit_searches', jsonb_build_object('limit', 120));
  end if;
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select array_agg(x.id order by x.exact desc, x.created_at desc), count(*) > 20
    into v_ids, v_more
  from (
    select p.id, p.created_at,
           (upper(p.display_id) = upper(v_q) or lower(u.email) = lower(v_q)
             or (char_length(v_digits) >= 9
                 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))) as exact
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.role in ('client', 'shop')
      and (upper(p.display_id) = upper(v_q)
        or lower(u.email) = lower(v_q)
        or (char_length(v_digits) >= 9
            and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 9) = right(v_digits, 9))
        or p.name ilike v_like
        or exists (select 1 from public.shop_staff st join public.shops s on s.id = st.shop_id
                   where st.user_id = p.id and st.accepted_at is not null and s.name ilike v_like))
    order by exact desc, p.created_at desc
    limit 21
  ) x;

  v_ids := coalesce(v_ids[1:20], '{}');
  perform public.staff_audit('support_search', 'search', null, null,
    jsonb_build_object('q', v_q, 'results', cardinality(v_ids)));
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.support_account_card(i.id) order by i.n)
                       from unnest(v_ids) with ordinality as i(id, n)), '[]'::jsonb),
    'more', coalesce(v_more, false));
end
$$;
revoke execute on function public.support_search_accounts(text) from public, anon;
grant execute on function public.support_search_accounts(text) to authenticated;

-- One account's card (from a search or a suggestion), with its suggestions. In the audit log.
create function public.support_get_account(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card jsonb;
begin
  perform public.require_staff();
  if not exists (select 1 from public.profiles p where p.id = p_id and p.role in ('client', 'shop')) then
    perform public.fail('not_found');
  end if;
  v_card := public.support_account_card(p_id);
  perform public.staff_audit('support_view_account', 'profile', p_id::text, null, null);
  return v_card || jsonb_build_object(
    'suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'body', g.body, 'status', g.status, 'created_at', g.created_at)
             order by g.created_at desc)
      from public.suggestions g where g.author_id = p_id), '[]'::jsonb));
end
$$;
revoke execute on function public.support_get_account(uuid) from public, anon;
grant execute on function public.support_get_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Solicitări: the suggestions (T26) — the agent reads them and sets their state
-- ---------------------------------------------------------------------------------------------
create function public.support_list_suggestions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_staff();
  return jsonb_build_object(
    'new', (select count(*) from public.suggestions where status = 'new'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'body', g.body, 'status', g.status, 'role', g.author_role,
        'created_at', g.created_at, 'updated_at', g.updated_at,
        'author_id', g.author_id, 'display_id', p.display_id, 'author_name', p.name,
        'shop_id', g.shop_id, 'shop_name', s.name
      ) order by g.created_at desc)
      from public.suggestions g
      join public.profiles p on p.id = g.author_id
      left join public.shops s on s.id = g.shop_id), '[]'::jsonb));
end
$$;
revoke execute on function public.support_list_suggestions() from public, anon;
grant execute on function public.support_list_suggestions() to authenticated;

create function public.support_set_suggestion_status(p_id uuid, p_status text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old public.suggestions%rowtype;
  v public.suggestions%rowtype;
  v_result jsonb;
begin
  perform public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_set_suggestion_status');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_status is null or p_status not in ('new', 'planned', 'done', 'declined') then
    perform public.fail('status_invalid');
  end if;
  select * into v_old from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('suggestion_not_found');
  end if;
  update public.suggestions set status = p_status, updated_at = now() where id = p_id returning * into v;
  if v.status is distinct from v_old.status then
    perform public.staff_audit('update_suggestion', 'suggestion', v.id::text,
      jsonb_build_object('suggestion_status', v_old.status), jsonb_build_object('suggestion_status', v.status));
  end if;
  v_result := jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.support_set_suggestion_status(uuid, text, uuid) from public, anon;
grant execute on function public.support_set_suggestion_status(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Admin → Platformă → Echipa de suport
-- ---------------------------------------------------------------------------------------------

-- The agents (and whether each set up the second step: until then the role gives no access), and
-- the accounts that had the role, with when and why it was withdrawn.
create function public.admin_list_support_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'display_id', p.display_id, 'name', p.name, 'email', public.account_email(p.id),
          'suspended', p.suspended,
          'mfa_ready', exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
          'granted_at', (select max(a.created_at) from public.admin_audit_log a
                         where a.action = 'grant_support' and a.entity_id = p.id::text),
          'last_active_at', public.last_seen(p.id)
        ) order by p.display_id)
      from public.profiles p
      where p.role = 'support' and p.deleted_at is null), '[]'::jsonb),
    'former', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.entity_id, 'display_id', coalesce(p.display_id, r.before->>'display_id'), 'name', p.name,
          'revoked_at', r.created_at, 'reason', r.reason, 'by', r.actor_display_id
        ) order by r.created_at desc)
      from (
        select distinct on (a.entity_id) a.*
        from public.admin_audit_log a
        where a.action = 'revoke_support'
        order by a.entity_id, a.created_at desc
      ) r
      left join public.profiles p on p.id::text = r.entity_id
      where p.id is null or p.role <> 'support'), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_list_support_agents() from public, anon;
grant execute on function public.admin_list_support_agents() to authenticated;

-- Appoints an agent: a client account given by its ID (C-00012) or email, with a confirmed email,
-- active, with nothing of its own yet (no cars, bookings, conversations, companies or shop), so no
-- client data ends up behind a staff account. Reason required. The role gives access only after the
-- agent sets up the second step of sign-in (require_staff).
create function public.admin_grant_support(p_account text, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_key text := btrim(coalesce(p_account, ''));
  v_reason text := nullif(btrim(p_reason), '');
  v_id uuid;
  v public.profiles%rowtype;
  v_display text;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_grant_support');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  select p.id into v_id
  from public.profiles p left join auth.users u on u.id = p.id
  where v_key <> '' and (upper(p.display_id) = upper(v_key) or lower(u.email) = lower(v_key))
  limit 1;
  if v_id is null then
    perform public.fail('not_found');
  end if;
  select * into v from public.profiles where id = v_id for update;
  if v.role = 'support' then
    perform public.fail('wrong_status', jsonb_build_object('role', v.role));
  end if;
  if v.role <> 'client' then
    perform public.fail('support_not_client');
  end if;
  if v.suspended or v.deleted_at is not null then
    perform public.fail('support_account_inactive');
  end if;
  if not exists (select 1 from auth.users u where u.id = v.id and u.email_confirmed_at is not null) then
    perform public.fail('support_email_unverified');
  end if;
  if exists (select 1 from public.cars c where c.owner_id = v.id)
     or exists (select 1 from public.bookings b where b.client_id = v.id)
     or exists (select 1 from public.threads t where t.client_id = v.id)
     or exists (select 1 from public.company_members m where m.user_id = v.id)
     or exists (select 1 from public.shop_staff st where st.user_id = v.id) then
    perform public.fail('support_account_has_data');
  end if;

  -- The same E- ID if the account was an agent before.
  v_display := case when v.display_id like 'E-%' then v.display_id
                    else public.format_sequence_id('E', nextval('public.display_id_support_seq')) end;
  update public.profiles set role = 'support', display_id = v_display where id = v.id;
  perform public.staff_audit('grant_support', 'profile', v.id::text,
    jsonb_build_object('role', v.role, 'display_id', v.display_id),
    jsonb_build_object('role', 'support', 'display_id', v_display), v_reason);
  v_result := jsonb_build_object('id', v.id, 'display_id', v_display);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_grant_support(text, text, uuid) from public, anon;
grant execute on function public.admin_grant_support(text, text, uuid) to authenticated;

-- Withdraws the role: the account becomes a client account again (its E- ID stays, the audit log
-- keeps every action it took), its sessions end at once (profiles_end_staff_sessions). Reason
-- required. It can be appointed again later if it is still clean.
create function public.admin_revoke_support(p_user_id uuid, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v public.profiles%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_revoke_support');
  if v_seen is not null then
    return v_seen;
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or v.role <> 'support' then
    perform public.fail('not_found');
  end if;
  update public.profiles set role = 'client' where id = v.id;
  perform public.staff_audit('revoke_support', 'profile', v.id::text,
    jsonb_build_object('role', 'support', 'display_id', v.display_id),
    jsonb_build_object('role', 'client'), v_reason);
  v_result := jsonb_build_object('id', v.id, 'role', 'client');
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_revoke_support(uuid, text, uuid) from public, anon;
grant execute on function public.admin_revoke_support(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Jurnal de audit: who acted (an agent or an admin, kept after the account is deleted) and why
-- ---------------------------------------------------------------------------------------------
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
          'admin_display_id', coalesce(p.display_id, a.actor_display_id), 'admin_name', p.name,
          'actor_role', coalesce(a.actor_role, p.role), 'reason', a.reason,
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

update public.schema_version set version = 109;
