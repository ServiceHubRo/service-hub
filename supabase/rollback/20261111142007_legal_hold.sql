-- Rollback of A3c2a (supabase/migrations/20261111142007_legal_hold.sql), schema 114 → 113.
--
-- Refuses to run while anything the legal hold made exists — a hold (active or released: its history),
-- a review, the identifiers of an account, or a request kept after its author's account went — and
-- says how many, so nothing kept for a legal reason can be lost and no request is joined to an
-- account again by guess. With none of these, nothing is lost: the requests are linked to their
-- authors as before and the deletion of an account deletes its requests again through the foreign key.

do $$
declare
  v_holds bigint := (select count(*) from public.legal_holds);
  v_reviews bigint := (select count(*) from public.legal_hold_reviews);
  v_subjects bigint := (select count(*) from public.legal_hold_subjects);
  v_kept bigint := (select count(*) from public.suggestions where author_id is null or former_author_id is not null);
begin
  if v_holds + v_reviews + v_subjects + v_kept > 0 then
    raise exception 'Refused: % legal holds, % reviews, % kept account identifiers and % requests kept after their account was deleted exist. Release the holds and let their rules run first; the history of the holds is never deleted by a rollback.',
      v_holds, v_reviews, v_subjects, v_kept;
  end if;
end
$$;

-- ------------------------------------------------------------------ the support functions as before
create or replace function public.support_guard(p_me profiles, s suggestions)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if s.escalated_at is not null and p_me.role <> 'admin' then
    perform public.fail('request_escalated');
  end if;
  if s.status = 'closed' then
    perform public.fail('request_closed');
  end if;
end
$function$;

create or replace function public.support_add_note(p_id uuid, p_body text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  s public.suggestions%rowtype;
  n public.suggestion_notes%rowtype;
  v_result jsonb;
begin
  v_me := public.require_staff();
  v_seen := public.request_begin(p_request_id, 'support_add_note');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  -- An escalated request stays read-only for an agent; a closed one keeps taking notes (follow-up).
  if s.escalated_at is not null and v_me.role <> 'admin' then
    perform public.fail('request_escalated');
  end if;
  if v_body = '' or char_length(v_body) > 4000 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'body'));
  end if;
  insert into public.suggestion_notes (suggestion_id, author_id, author_display_id, body)
  values (s.id, v_me.id, v_me.display_id, v_body)
  returning * into n;
  update public.suggestions set updated_at = now() where id = s.id;
  perform public.staff_audit('add_request_note', 'suggestion', s.id::text, null, jsonb_build_object('note_id', n.id));
  v_result := jsonb_build_object('id', n.id, 'created_at', n.created_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$function$;

create or replace function public.support_get_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  v := public.support_get_request_a3a(p_id);
  return v || jsonb_build_object('files',
    public.support_request_files(p_id, exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')));
end
$function$;

create or replace function public.support_inbox(p_owner text DEFAULT 'all'::text, p_status text DEFAULT 'open'::text, p_category text DEFAULT 'all'::text, p_age integer DEFAULT NULL::integer, p_after_open boolean DEFAULT NULL::boolean, p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_owner uuid;
  v_limit int := coalesce(p_limit, 30);
  v_items jsonb;
  v_next jsonb;
begin
  v_me := public.require_staff();
  if p_owner is null or (p_owner not in ('all', 'mine', 'none', 'escalated')
                         and p_owner !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
    perform public.fail('request_invalid', jsonb_build_object('field', 'owner'));
  end if;
  if p_status is null or p_status not in ('open', 'all', 'new', 'in_progress', 'waiting_user', 'resolved', 'closed',
                                          'planned', 'done', 'declined') then
    perform public.fail('request_invalid', jsonb_build_object('field', 'status'));
  end if;
  if p_category is null or (p_category <> 'all' and not exists (select 1 from public.support_categories c where c.key = p_category)) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'category'));
  end if;
  if p_age is not null and p_age not in (24, 48) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'age'));
  end if;
  if v_limit < 1 or v_limit > 100 then
    perform public.fail('request_invalid', jsonb_build_object('field', 'limit'));
  end if;
  if (p_after_open is null) <> (p_after_at is null) or (p_after_at is null) <> (p_after_id is null) then
    perform public.fail('request_invalid', jsonb_build_object('field', 'after'));
  end if;
  v_owner := case when p_owner ~ '^[0-9a-fA-F-]{36}$' then p_owner::uuid end;

  with page as (
    select s, public.support_request_open(s.status) as open, coalesce(s.last_user_message_at, s.created_at) as at
    from public.suggestions s
    where (p_owner = 'all'
           or (p_owner = 'mine' and s.assigned_to = v_me.id)
           or (p_owner = 'none' and s.assigned_to is null and s.escalated_at is null)
           or (p_owner = 'escalated' and s.escalated_at is not null)
           or (v_owner is not null and s.assigned_to = v_owner))
      and (p_status = 'all' or (p_status = 'open' and public.support_request_open(s.status)) or s.status = p_status)
      and (p_category = 'all' or s.category = p_category)
      and (p_age is null or public.support_waiting_since(s) <= now() - make_interval(hours => p_age))
      and (p_after_id is null
           or (public.support_request_open(s.status), coalesce(s.last_user_message_at, s.created_at), s.id)
              < (p_after_open, p_after_at, p_after_id))
    order by public.support_request_open(s.status) desc, coalesce(s.last_user_message_at, s.created_at) desc, s.id desc
    limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.open desc, p.at desc, (p.s).id desc) as n from page p
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
        'id', (x.s).id, 'title', public.support_request_label(x.s), 'category', (x.s).category, 'status', (x.s).status,
        'created_at', (x.s).created_at, 'updated_at', (x.s).updated_at,
        'author', jsonb_build_object('id', (x.s).author_id, 'display_id', pr.display_id, 'name', pr.name, 'role', (x.s).author_role),
        'shop_name', sh.name,
        'assigned', case when (x.s).assigned_to is not null then public.support_staff_ref((x.s).assigned_to) end,
        'escalated', (x.s).escalated_at is not null, 'escalated_at', (x.s).escalated_at,
        'first_response_at', (x.s).first_response_at,
        'last_user_message_at', x.at,
        'last_staff_message_at', (x.s).last_staff_message_at,
        'waiting_since', public.support_waiting_since(x.s)) order by x.n) filter (where x.n <= v_limit), '[]'::jsonb),
    (select jsonb_build_object('open', y.open, 'at', y.at, 'id', (y.s).id)
       from numbered y where y.n = v_limit and exists (select 1 from numbered z where z.n = v_limit + 1))
  into v_items, v_next
  from numbered x
  left join public.profiles pr on pr.id = (x.s).author_id
  left join public.shops sh on sh.id = (x.s).shop_id;

  return jsonb_build_object('me', v_me.id, 'items', coalesce(v_items, '[]'::jsonb), 'next', v_next);
end
$function$;

create or replace function public.support_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
  v_counts jsonb;
  v_oldest jsonb;
begin
  v_me := public.require_staff();
  select jsonb_build_object(
      'new', count(*) filter (where s.status = 'new'),
      'in_progress', count(*) filter (where s.status = 'in_progress'),
      'waiting_user', count(*) filter (where s.status = 'waiting_user'),
      'resolved', count(*) filter (where s.status = 'resolved'),
      'closed', count(*) filter (where s.status = 'closed'),
      'escalated', count(*) filter (where s.escalated_at is not null and public.support_request_open(s.status)),
      'unassigned', count(*) filter (where s.assigned_to is null and s.escalated_at is null and public.support_request_open(s.status)),
      'mine', count(*) filter (where s.assigned_to = v_me.id and public.support_request_open(s.status)),
      'over_24', count(*) filter (where public.support_waiting_since(s) <= now() - interval '24 hours'),
      'over_48', count(*) filter (where public.support_waiting_since(s) <= now() - interval '48 hours'))
  into v_counts
  from public.suggestions s;

  select jsonb_build_object(
      'id', s.id, 'title', public.support_request_label(s), 'waiting_since', public.support_waiting_since(s),
      'escalated', s.escalated_at is not null,
      'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end)
  into v_oldest
  from public.suggestions s
  where public.support_waiting_since(s) is not null
  order by public.support_waiting_since(s), s.id
  limit 1;

  return jsonb_build_object('me', v_me.id, 'now', now(), 'counts', v_counts, 'oldest', v_oldest);
end
$function$;

create or replace function public.support_list_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me public.profiles%rowtype;
begin
  v_me := public.require_staff();
  return jsonb_build_object(
    'me', v_me.id,
    'items', coalesce((
      select jsonb_agg(x.item order by x.open desc, x.at desc)
      from (
        select public.support_request_open(s.status) as open, coalesce(s.last_user_message_at, s.created_at) as at,
          jsonb_build_object(
            'id', s.id, 'title', public.support_request_label(s), 'category', s.category, 'status', s.status,
            'created_at', s.created_at, 'updated_at', s.updated_at,
            'author', jsonb_build_object('id', s.author_id, 'display_id', p.display_id, 'name', p.name, 'role', s.author_role),
            'shop_name', sh.name,
            'assigned', case when s.assigned_to is not null then public.support_staff_ref(s.assigned_to) end,
            'escalated', s.escalated_at is not null, 'escalated_at', s.escalated_at,
            'first_response_at', s.first_response_at,
            'last_user_message_at', coalesce(s.last_user_message_at, s.created_at),
            'last_staff_message_at', s.last_staff_message_at,
            -- The author waits: its last message is newer than the team's last answer.
            'waiting_since', case when public.support_request_open(s.status) and s.status <> 'waiting_user'
                                   and coalesce(s.last_user_message_at, s.created_at) > coalesce(s.last_staff_message_at, '-infinity'::timestamptz)
                                  then coalesce(s.last_user_message_at, s.created_at) end) as item
        from public.suggestions s
        left join public.profiles p on p.id = s.author_id
        left join public.shops sh on sh.id = s.shop_id
        order by public.support_request_open(s.status) desc, coalesce(s.last_user_message_at, s.created_at) desc
        limit 1000
      ) x), '[]'::jsonb));
end
$function$;

create or replace function public.support_list_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.admin_list_suggestions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.require_admin();
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
$function$;

create or replace function public.support_set_suggestion_status(p_id uuid, p_status text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.support_get_account(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create or replace function public.support_file_open(p_user uuid, p_aal text, p_session uuid, p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.profiles%rowtype;
  f public.suggestion_files%rowtype;
  s public.suggestions%rowtype;
begin
  v := public.support_file_caller(p_user, p_aal, p_session);
  select * into f from public.suggestion_files where id = p_file;
  if not found or f.suggestion_id is null then
    perform public.fail('file_not_found');
  end if;
  select * into s from public.suggestions where id = f.suggestion_id;
  if v.role in ('client', 'shop') and s.author_id is distinct from v.id then
    perform public.fail('file_not_found');
  end if;
  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after, created_at)
  values (v.id, 'open_request_file', 'suggestion', s.id::text, null,
          jsonb_build_object('file_id', f.id, 'file_name', f.name), clock_timestamp());
  return jsonb_build_object('path', f.path, 'mime', f.mime, 'name', f.name);
end
$function$;

create or replace function public.admin_return_request(p_id uuid, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seen jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  s public.suggestions%rowtype;
  v_to uuid;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_return_request');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into s from public.suggestions where id = p_id for update;
  if not found then
    perform public.fail('request_not_found');
  end if;
  if s.escalated_at is null then
    perform public.fail('wrong_status', jsonb_build_object('escalated', false));
  end if;
  if v_reason is null then
    perform public.fail('reason_required');
  end if;
  if char_length(v_reason) > 500 then
    perform public.fail('reason_too_long');
  end if;
  select p.id into v_to from public.profiles p
  where p.id = s.escalated_by and p.role = 'support' and not p.suspended and p.deleted_at is null;
  update public.suggestions
  set escalated_at = null, escalated_by = null, escalation_reason = null, assigned_to = v_to,
      assigned_at = case when v_to is not null then now() end, updated_at = now()
  where id = s.id;
  perform public.staff_audit('return_request', 'suggestion', s.id::text,
    jsonb_build_object('escalated', true, 'escalation_reason', s.escalation_reason),
    jsonb_build_object('escalated', false, 'assigned_to', (select display_id from public.profiles where id = v_to)), v_reason);
  v_result := jsonb_build_object('id', s.id, 'escalated', false, 'assigned_to', v_to);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$function$;

create or replace function public.support_signal(p_suggestion uuid, p_author boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.support_signals (suggestion_id, audience, author_id)
  select s.id, a.audience, case when a.audience = 'author' then s.author_id end
  from public.suggestions s
  cross join (values ('team'), ('author')) a (audience)
  where s.id = p_suggestion and (a.audience = 'team' or p_author)
    and auth.uid() is not null
  on conflict (suggestion_id, audience) do update set changed_at = clock_timestamp()
$function$;

create or replace function public.support_files_collect(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gone as (
    delete from public.suggestion_files f
    where (f.suggestion_id is null and f.created_at <= p_now - interval '24 hours')
       or exists (select 1 from public.suggestions s
                  where s.id = f.suggestion_id and s.status = 'closed' and s.closed_at <= p_now - interval '90 days')
    returning 1
  )
  select count(*)::int from gone
$function$;

create or replace function public.prepare_account_deletion(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ------------------------------------------------------------------ Realtime as before
drop policy support_signals_team on public.support_signals;
create policy support_signals_team on public.support_signals for select to authenticated
  using (audience = 'team' and public.support_signal_reader());
drop function public.support_signal_team_visible(uuid);

-- ------------------------------------------------------------------ the holds go
drop trigger legal_holds_signal on public.legal_holds;
drop function public.legal_holds_signal();
drop function public.legal_holds_for_request(uuid);
drop function public.admin_list_admins();
drop function public.admin_get_legal_hold(uuid);
drop function public.admin_list_legal_holds(text);
drop function public.legal_hold_item(public.legal_holds);
drop function public.admin_release_legal_hold(uuid, text, uuid);
drop function public.admin_review_legal_hold(uuid, text, uuid, uuid);
drop function public.admin_place_legal_hold(uuid, text, text, text, text, uuid, uuid);
drop function public.legal_hold_responsible(uuid, uuid);
drop function public.legal_hold_check_text(text, text, int, int);
drop function public.legal_hold_apply_rules(uuid, timestamptz);

drop trigger profiles_support_on_delete on public.profiles;
drop function public.profiles_support_on_delete();
drop function public.legal_hold_has_subject(uuid);
drop function public.legal_hold_capture_subject(uuid);

drop trigger suggestions_legal_hold_delete on public.suggestions;
drop trigger suggestion_messages_legal_hold_delete on public.suggestion_messages;
drop trigger suggestion_notes_legal_hold_delete on public.suggestion_notes;
drop trigger suggestion_files_legal_hold_delete on public.suggestion_files;
drop trigger suggestions_legal_hold_update on public.suggestions;
drop trigger suggestion_messages_legal_hold_update on public.suggestion_messages;
drop trigger suggestion_notes_legal_hold_update on public.suggestion_notes;
drop trigger suggestion_files_legal_hold_update on public.suggestion_files;
drop trigger suggestions_legal_hold_truncate on public.suggestions;
drop trigger suggestion_messages_legal_hold_truncate on public.suggestion_messages;
drop trigger suggestion_notes_legal_hold_truncate on public.suggestion_notes;
drop trigger suggestion_files_legal_hold_truncate on public.suggestion_files;
drop function public.legal_hold_block_delete();
drop function public.legal_hold_block_update();

-- The tables are empty (checked above); their own guards go with them.
drop table public.legal_hold_reviews;
drop table public.legal_holds;
drop table public.legal_hold_subjects;
drop function public.legal_hold_block_truncate();
drop function public.legal_hold_history_kept();
drop function public.text_has_secret(text);
drop function public.legal_hold_covers_request(uuid);
drop function public.legal_hold_covers(uuid, uuid);

-- ------------------------------------------------------------------ requests follow their author again
drop index public.suggestions_former_author_idx;
alter table public.suggestions drop constraint suggestions_has_author;
alter table public.suggestions drop constraint suggestions_author_id_fkey;
alter table public.suggestions
  add constraint suggestions_author_id_fkey foreign key (author_id) references public.profiles (id) on delete cascade;
alter table public.suggestions alter column author_id set not null;
alter table public.suggestions drop column former_author_id;

-- TRUNCATE as before (service_role had it through Supabase's default privileges).
grant truncate on public.suggestions, public.suggestion_messages, public.suggestion_notes, public.suggestion_files,
  public.support_signals, public.support_file_deletions to service_role;

update public.schema_version set version = 113;
