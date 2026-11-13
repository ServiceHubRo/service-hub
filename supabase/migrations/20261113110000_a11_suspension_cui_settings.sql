-- A11 — the rest of the master audit of 13 Nov 2026 (rules approved by Eduard the same day), on
-- schema 121. Nothing existing is deleted or rewritten: functions keep their inner code (renamed
-- `*_a10`, revoked, wrapped), one table loses column read grants.
--
-- 1. A suspended shop's bookings (P2-2). Suspending a shop left its waiting and confirmed bookings
--    active and told their clients nothing: a client would arrive at a shop the platform had
--    stopped. Now, in the same transaction as the suspension, every booking of the shop that has
--    not started (`pending`, `confirmed`) is cancelled by the platform, with the automatic thread
--    message and the client's notification (`booking_cancelled_admin`, the event the admin's
--    "Anulează" already uses). Jobs already begun (inspection, quote, work) go on to their end, as
--    before. No new booking reaches a suspended shop (create_booking and shop_create_booking
--    already refuse: the shop is not public).
-- 2. One company per tax ID (P2-3). Two companies could be created with the same CUI, with or
--    without the RO prefix. create_company and update_company now refuse a CUI another company
--    that is not archived already has: `company_vat_taken`. Compared without spaces, case and the
--    RO prefix. Companies that already share a CUI are left as they are.
-- 3. Platform settings (P3). Every signed-in user could read the whole row, the abuse limits
--    included. `authenticated` now reads from the table only `report_price_ron`, `vat_rate`
--    and `fleet_enabled` (which the app shows or needs) and the two ranking columns the
--    `shop_ratings` view needs; the client's one limit comes from
--    `review_window_days()`, the admin's screen from `admin_get_settings()`.

-- ---------------------------------------------------------------------------------------------
-- 1. A suspended shop's bookings
-- ---------------------------------------------------------------------------------------------

-- Cancels the bookings of a suspended shop that have not started. Server only. The reason the
-- client reads is the platform's own sentence, in the language the booking was made in — never
-- the admin's reason for the suspension, which stays in the audit log.
create function public.cancel_unstarted_bookings_of_suspended_shop(p_shop_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.bookings%rowtype;
  v_reason text;
  v_n integer := 0;
begin
  if not exists (select 1 from public.shops s where s.id = p_shop_id and s.suspended) then
    return 0;
  end if;
  for v in
    select * from public.bookings b
    where b.shop_id = p_shop_id and b.status in ('pending', 'confirmed')
    order by b.date, b.slot, b.id
    for no key update
  loop
    v_reason := case when v.client_lang = 'en' then 'The shop is no longer available on Service-Hub.'
                     else 'Service-ul nu mai este disponibil pe Service-Hub.' end;
    update public.bookings
      set status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(), cancel_reason = v_reason
    where id = v.id returning * into v;
    perform public.post_booking_event(v, 'booking_cancelled_admin', 'admin', jsonb_build_object('reason', v_reason));
    perform public.notify_user(v.client_id, 'booking_cancelled_admin',
      public.booking_event_params(v) || jsonb_build_object('reason', v_reason), v.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.cancel_unstarted_bookings_of_suspended_shop(uuid) from public, anon, authenticated;

alter function public.admin_set_shop_suspended(uuid, boolean, text, uuid) rename to admin_set_shop_suspended_a10;
revoke execute on function public.admin_set_shop_suspended_a10(uuid, boolean, text, uuid) from public, anon, authenticated;

create function public.admin_set_shop_suspended(p_shop_id uuid, p_suspended boolean, p_reason text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  -- The inner function checks the admin, the reason and the state, and suspends. Then the
  -- bookings: the same request sent again finds none left.
  v := public.admin_set_shop_suspended_a10(p_shop_id, p_suspended, p_reason, p_request_id);
  if p_suspended then
    perform public.cancel_unstarted_bookings_of_suspended_shop(p_shop_id);
  end if;
  return v;
end
$$;
revoke execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. One company per tax ID
-- ---------------------------------------------------------------------------------------------

-- What two spellings of one CUI share: no spaces or punctuation, upper case, no RO prefix.
create function public.company_vat_key(p_vat text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(upper(regexp_replace(coalesce(p_vat, ''), '[^A-Za-z0-9]', '', 'g')), '^RO', ''), '')
$$;
revoke execute on function public.company_vat_key(text) from public, anon, authenticated;

-- Refuses when another company that is not archived has this CUI. Called after the write, under a
-- lock on the CUI itself, so two requests with the same CUI cannot both pass.
create function public.require_company_vat_free(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select public.company_vat_key(c.vat_id) into v_key from public.companies c where c.id = p_company;
  if v_key is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('company_vat:' || v_key, 0));
  if exists (select 1 from public.companies c
             where c.id <> p_company and c.archived_at is null and public.company_vat_key(c.vat_id) = v_key) then
    perform public.fail('company_vat_taken');
  end if;
end
$$;
revoke execute on function public.require_company_vat_free(uuid) from public, anon, authenticated;

alter function public.create_company(text, text, text, text, uuid) rename to create_company_a10;
revoke execute on function public.create_company_a10(text, text, text, text, uuid) from public, anon, authenticated;

create function public.create_company(p_name text, p_vat_id text, p_reg_com text, p_address text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  -- A refusal undoes the whole request, the company just written included.
  v := public.create_company_a10(p_name, p_vat_id, p_reg_com, p_address, p_request_id);
  perform public.require_company_vat_free((v->>'id')::uuid);
  return v;
end
$$;
revoke execute on function public.create_company(text, text, text, text, uuid) from public, anon;
grant execute on function public.create_company(text, text, text, text, uuid) to authenticated;

alter function public.update_company(uuid, text, text, text, text, uuid) rename to update_company_a10;
revoke execute on function public.update_company_a10(uuid, text, text, text, text, uuid) from public, anon, authenticated;

create function public.update_company(p_company uuid, p_name text, p_vat_id text, p_reg_com text, p_address text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v jsonb;
begin
  select public.company_vat_key(c.vat_id) into v_before from public.companies c where c.id = p_company;
  v := public.update_company_a10(p_company, p_name, p_vat_id, p_reg_com, p_address, p_request_id);
  -- Only a CUI that changes is checked: companies that shared one before this rule keep saving
  -- their other details.
  if public.company_vat_key(v->>'vat_id') is distinct from v_before then
    perform public.require_company_vat_free(p_company);
  end if;
  return v;
end
$$;
revoke execute on function public.update_company(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.update_company(uuid, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Platform settings
-- ---------------------------------------------------------------------------------------------
revoke select on public.platform_settings from authenticated;
-- ranking_prior_*: the shop_ratings view runs with its reader's rights and needs both.
grant select (id, report_price_ron, vat_rate, fleet_enabled, ranking_prior_avg, ranking_prior_weight)
  on public.platform_settings to authenticated;

-- For how many days after a finished job its review can still be left (the client's Programări).
create function public.review_window_days()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_limit('review_window_days', 60)
$$;
revoke execute on function public.review_window_days() from public, anon;
grant execute on function public.review_window_days() to authenticated;

-- The whole settings row, for the admin's Setări platformă (it read the table with `*`).
create function public.admin_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return (select to_jsonb(s) from public.platform_settings s where s.id = 1);
end
$$;
revoke execute on function public.admin_get_settings() from public, anon;
grant execute on function public.admin_get_settings() to authenticated;

update public.schema_version set version = 122;
