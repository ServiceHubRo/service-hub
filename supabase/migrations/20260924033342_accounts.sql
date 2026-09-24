-- T04 — Accounts: data export, cancelling a pending email change, account deletion.
-- ARCHITECTURE §2 (Identity), §11 (delete-account), §15; FR §2.
--
-- Deleting an account is split in two:
--   · prepare_account_deletion(user) — this file, run by the `delete-account` Edge Function with
--     the service role: refuses while bookings are active, removes the person's data from what
--     other people keep (booking snapshots, threads, reviews), and says what to do with the login;
--   · the Edge Function then deletes the login ('delete'), or, when the shop has records that must
--     be kept (bookings, invoices), closes it for good ('anonymize': banned, email replaced).

-- ---------------------------------------------------------------------------------------------
-- profiles.deleted_at — set when the account is deleted. For a shop owner whose shop keeps its
-- records the profile stays (anonymized) so those records keep pointing somewhere. No grants.
-- ---------------------------------------------------------------------------------------------
alter table public.profiles add column deleted_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- export_my_data — everything the caller's account holds about them, as one JSON document
-- ("Descarcă datele mele"). Read-only. Shop accounts also get their shop's settings; the shop's
-- bookings are other people's data and are not part of it.
-- ---------------------------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles%rowtype;
  v_shop_id uuid;
  v_owner boolean;
  v jsonb;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    perform public.fail('not_signed_in');
  end if;

  v := jsonb_build_object(
    'format', 'service-hub-export/1',
    'exported_at', now(),
    'account', jsonb_build_object(
      'account_id', v_me.display_id,
      'role', v_me.role,
      'name', v_me.name,
      'phone', v_me.phone,
      'email', (select u.email from auth.users u where u.id = v_me.id),
      'language', v_me.lang,
      'email_verified_at', v_me.email_verified_at,
      'phone_verified_at', v_me.phone_verified_at,
      'terms_version', v_me.terms_version,
      'terms_accepted_at', v_me.terms_accepted_at,
      'created_at', v_me.created_at
    ),
    'cars', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'make', c.make, 'model', c.model, 'year', c.year, 'plate', c.plate, 'vin', c.vin,
          'itp_expiry', c.itp_expiry, 'rca_expiry', c.rca_expiry, 'vignette_expiry', c.vignette_expiry,
          'created_at', c.created_at
        ) order by c.created_at)
      from public.cars c where c.owner_id = v_me.id
    ), '[]'::jsonb),
    'favorites', coalesce((
      select jsonb_agg(jsonb_build_object('shop', s.name, 'city', s.city, 'added_at', f.created_at)
                       order by f.created_at)
      from public.favorites f join public.shops s on s.id = f.shop_id
      where f.client_id = v_me.id
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(
        (to_jsonb(b) - 'id' - 'client_id' - 'shop_id' - 'car_id' - 'reminder_sent_at')
        || jsonb_build_object(
          'shop', s.name,
          'quotes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'version', q.version, 'status', q.status, 'note', q.note,
                'inspection_fee', q.inspection_fee, 'total_sent', q.total_sent,
                'total_approved', q.total_approved, 'sent_at', q.sent_at,
                'expires_at', q.expires_at, 'decided_at', q.decided_at,
                'items', coalesce((
                  select jsonb_agg(jsonb_build_object('name', qi.name, 'price', qi.price, 'approved', qi.approved)
                                   order by qi.position)
                  from public.quote_items qi where qi.quote_id = q.id
                ), '[]'::jsonb)
              ) order by q.version)
            from public.quotes q where q.booking_id = b.id
          ), '[]'::jsonb)
        ) order by b.created_at)
      from public.bookings b join public.shops s on s.id = b.shop_id
      where b.client_id = v_me.id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'shop', s.name, 'rating', r.rating, 'text', r.text, 'shop_reply', r.reply,
        'created_at', r.created_at, 'removed_at', r.removed_at) order by r.created_at)
      from public.reviews r join public.shops s on s.id = r.shop_id
      where r.client_id = v_me.id
    ), '[]'::jsonb),
    -- A client's conversations in full; a shop member's own messages only.
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_with', case when t.client_id = v_me.id then s.name end,
        'from', case when m.kind = 'system' then 'system' when m.sender_id = v_me.id then 'me' else 'shop' end,
        'text', m.body, 'event', m.event, 'params', case when m.kind = 'system' then m.params end,
        'sent_at', m.created_at) order by m.created_at)
      from public.messages m
      join public.threads t on t.id = m.thread_id
      join public.shops s on s.id = t.shop_id
      where t.client_id = v_me.id or m.sender_id = v_me.id
    ), '[]'::jsonb),
    'history_reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', h.code, 'car', h.car_snapshot, 'status', h.status, 'amount_paid', h.amount_paid,
        'created_at', h.created_at) order by h.created_at)
      from public.history_reports h where h.client_id = v_me.id
    ), '[]'::jsonb)
  );

  v_shop_id := public.my_shop_id();
  if v_shop_id is not null then
    v_owner := public.is_shop_owner(v_shop_id);
    v := v || jsonb_build_object('shop', (
      select (to_jsonb(s) - 'id' - 'owner_id')
        || jsonb_build_object(
          'my_role', case when v_owner then 'owner' else 'staff' end,
          'hours', coalesce((
            select jsonb_agg(jsonb_build_object('weekday', h.weekday, 'closed', h.is_closed,
                                                'open', h.open_time, 'close', h.close_time) order by h.weekday)
            from public.shop_hours h where h.shop_id = s.id
          ), '[]'::jsonb),
          'closures', coalesce((
            select jsonb_agg(jsonb_build_object('from', c.start_date, 'to', c.end_date, 'label', c.label)
                             order by c.start_date)
            from public.shop_closures c where c.shop_id = s.id
          ), '[]'::jsonb),
          'services', coalesce((
            select jsonb_agg(ss.service_id order by ss.service_id)
            from public.shop_services ss where ss.shop_id = s.id
          ), '[]'::jsonb),
          'billing', case when v_owner then (
            select to_jsonb(sb) - 'shop_id' from public.shop_billing sb where sb.shop_id = s.id
          ) end,
          'subscription', case when v_owner then (
            select jsonb_build_object('status', sub.status, 'trial_ends_at', sub.trial_ends_at,
                                      'current_period_end', sub.current_period_end, 'price_ron', sub.price_ron)
            from public.subscriptions sub where sub.shop_id = s.id
          ) end,
          'invoices', case when v_owner then coalesce((
            select jsonb_agg(jsonb_build_object('series', i.series, 'number', i.number, 'amount', i.amount,
                                                'vat_amount', i.vat_amount, 'currency', i.currency,
                                                'issued_at', i.issued_at, 'status', i.status)
                             order by i.issued_at)
            from public.invoices i where i.shop_id = s.id
          ), '[]'::jsonb) end
        )
      from public.shops s where s.id = v_shop_id
    ));
  end if;

  return v;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- cancel_email_change — drops a pending email change ("Anulează schimbarea"): the links already
-- sent stop working and the current address stays. Supabase Auth has no API call for this.
-- ---------------------------------------------------------------------------------------------
create function public.cancel_email_change(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  v_seen := public.request_begin(p_request_id, 'cancel_email_change');
  if v_seen is not null then
    return;
  end if;

  update auth.users
  set email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      email_change_confirm_status = 0
  where id = auth.uid();

  -- Newer Auth versions also keep the tokens here; the links must stop working.
  if to_regclass('auth.one_time_tokens') is not null then
    execute 'delete from auth.one_time_tokens where user_id = $1 and token_type::text like ''email_change%'''
      using auth.uid();
  end if;

  perform public.request_finish(p_request_id, 'null'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- prepare_account_deletion — service role only (the `delete-account` Edge Function, after it has
-- checked the caller's token). Idempotent: a retry after a failed login removal gives the same
-- answer. Returns
--   'delete'    — remove the login; the database cascades the rest (bookings keep their
--                 anonymous snapshots, reviews and messages stay without an author);
--   'anonymize' — a shop owner whose shop has bookings or invoices (kept by law): the shop leaves
--                 search for good, the profile keeps no name or phone, the login must be closed.
-- ---------------------------------------------------------------------------------------------
create function public.prepare_account_deletion(p_user_id uuid)
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

grant execute on function public.export_my_data(), public.cancel_email_change(uuid) to authenticated;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

update public.schema_version set version = 10;
