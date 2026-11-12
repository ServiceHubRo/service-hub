-- Rollback of A6 (supabase/migrations/20261112150000_a6_security.sql), schema 119 → 118.
--
-- Refuses to run (and says how many) once anything A6 recorded exists: security events, audit entries
-- of the A6 actions (views, admin suspensions, sessions ended) or with a session id, fleet files
-- stored through the fleet-files function's tickets still pending. Those would be lost. Otherwise
-- every function, rule and grant goes back to its definition at schema 118 (generated from it).
-- The app must go back with it (git revert of the A6 pull request): the admin screens send reasons
-- the old functions do not take, and fleet files would again be uploaded by the browser.

do $$
declare
  v_events bigint := (select count(*) from public.security_events);
  v_audit bigint := (select count(*) from public.admin_audit_log
                     where session_id is not null
                        or action in ('view_client', 'view_shop', 'view_booking', 'view_client_list', 'view_shop_list',
                                      'search_bookings', 'search_reviews', 'view_company_list', 'view_vehicle_duplicates',
                                      'suspend_admin', 'unsuspend_admin', 'end_admin_sessions', 'end_own_sessions'));
  v_tickets bigint := (select count(*) from public.fleet_file_tickets where expires_at > now());
begin
  if v_events + v_audit + v_tickets > 0 then
    raise exception 'Refused: % security events, % audit entries written by A6 and % pending fleet file tickets exist. They would be lost.',
      v_events, v_audit, v_tickets;
  end if;
end
$$;

-- §10b, §8, §10: new functions and tables.
drop function public.admin_security_events(text, timestamptz, integer);
drop function public.document_limit(uuid, text);
drop policy fleet_files_insert on storage.objects;
drop function public.fleet_file_ticket_ok(text);
drop function public.fleet_file_ticket_done(text);
drop function public.fleet_file_ticket(uuid, text);
drop function public.fleet_file_begin(uuid, uuid, uuid, text, integer);
drop table public.fleet_file_tickets;
drop function public.admin_end_my_other_sessions(text, uuid);
drop function public.admin_end_admin_sessions(uuid, text, uuid);
drop function public.admin_set_admin_suspended(uuid, boolean, text, uuid);
drop function public.lock_admins();
drop function public.end_sessions_of(uuid, uuid);
drop function public.admin_team_admins();
-- The pre-A6 Storage rule for fleet files (the browser uploads again).
create policy fleet_files_insert on storage.objects for insert to authenticated
  with check (((bucket_id = 'fleet-files'::text) AND
CASE
    WHEN fleet_issue_path(name) THEN fleet_issue_photo_can_upload(name)
    ELSE fleet_file_can_write(try_uuid((storage.foldername(name))[1]), try_uuid((storage.foldername(name))[2]))
END));

-- §9: the sessions of an agent only, as before.
drop trigger profiles_end_staff_sessions on public.profiles;
CREATE OR REPLACE FUNCTION public.end_staff_sessions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    delete from auth.sessions where user_id = new.id;
  exception when insufficient_privilege or undefined_table then
    -- The role or the suspension is already in force in every database function.
    null;
  end;
  return new;
end
$function$;
CREATE TRIGGER profiles_end_staff_sessions AFTER UPDATE OF role, suspended, deleted_at ON public.profiles FOR EACH ROW WHEN (((old.role = 'support'::text) AND ((new.role <> 'support'::text) OR new.suspended OR (new.deleted_at IS NOT NULL)))) EXECUTE FUNCTION end_staff_sessions();

-- §7: account deletion and export as before.
drop function public.admin_account_deletion(uuid, uuid, text, uuid);
CREATE OR REPLACE FUNCTION public.admin_account_deletion(p_admin_id uuid, p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_mode text;
begin
  if not exists (select 1 from public.profiles where id = p_admin_id and role = 'admin' and not suspended) then
    perform public.fail('not_allowed');
  end if;
  select * into v from public.profiles where id = p_user_id;
  if not found then
    perform public.fail('not_found');
  end if;
  if v.role = 'admin' then
    perform public.fail('not_allowed');
  end if;
  select * into v_shop from public.shops where owner_id = v.id;

  v_mode := public.prepare_account_deletion(p_user_id);

  insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, before, after)
  values (p_admin_id, 'delete_account', case when v_shop.id is null then 'profile' else 'shop' end,
          coalesce(v_shop.id, v.id)::text,
          jsonb_build_object('display_id', v.display_id, 'role', v.role, 'name', v.name,
                             'email', public.account_email(v.id))
            || case when v_shop.id is null then '{}'::jsonb
                    else jsonb_build_object('shop_name', v_shop.name, 'city', v_shop.city) end,
          jsonb_build_object('mode', v_mode));
  return v_mode;
end
$function$;
revoke all on function public.admin_account_deletion(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_account_deletion(uuid, uuid) to service_role;
drop function public.admin_export(text, jsonb, text);
CREATE OR REPLACE FUNCTION public.admin_export(p_kind text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_statuses text[];
  v_q text;
  v_fold text;
  v_plate text;
  v_rows jsonb;
begin
  perform public.require_admin();
  if p_kind = 'shops' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'street', s.street, 'county', s.county, 'postal_code', s.postal_code,
          'rating', r.average, 'review_count', coalesce(r.review_count, 0),
          'bookings', (select count(*) from public.bookings b where b.shop_id = s.id),
          'price_ron', sub.price_ron)
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_shops()) with ordinality l
      join public.shops s on s.id = (l.value->>'id')::uuid
      left join public.shop_ratings r on r.shop_id = s.id
      left join public.subscriptions sub on sub.shop_id = s.id), '[]'::jsonb);
  elsif p_kind = 'clients' then
    v_rows := coalesce((
      select jsonb_agg(l.value || jsonb_build_object(
          'lang', p.lang,
          'cars', (select count(*) from public.cars c where c.owner_id = p.id))
        order by l.ordinality)
      from jsonb_array_elements(public.admin_list_clients()) with ordinality l
      join public.profiles p on p.id = (l.value->>'id')::uuid), '[]'::jsonb);
  elsif p_kind = 'subscriptions' then
    v_rows := public.admin_subscription_rows();
  elsif p_kind = 'bookings' then
    v_statuses := case when jsonb_typeof(f->'statuses') = 'array'
                       then array(select jsonb_array_elements_text(f->'statuses')) end;
    v_q := public.clean_text(f->>'q');
    v_fold := public.fold_text(v_q);
    v_plate := nullif(regexp_replace(upper(coalesce(v_q, '')), '[^A-Z0-9]', '', 'g'), '');
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'ref', b.ref, 'status', b.status, 'date', b.date, 'slot', to_char(b.slot, 'HH24:MI'),
          'created_at', b.created_at, 'shop_name', s.name, 'shop_city', s.city,
          'client_display_id', cp.display_id, 'client_name', b.client_name, 'client_phone', b.client_phone,
          'service_ro', public.services_label(b.service_id, b.extra_service_ids, 'ro'),
          'service_en', public.services_label(b.service_id, b.extra_service_ids, 'en'),
          'make', b.car_snapshot->>'make', 'model', b.car_snapshot->>'model', 'year', b.car_snapshot->>'year',
          'plate', b.car_snapshot->>'plate', 'vin', b.car_snapshot->>'vin',
          'odometer', b.odometer, 'cost', b.cost, 'cancelled_by', b.cancelled_by,
          'reason', coalesce(b.cancel_reason, b.decline_reason))
        order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      join public.shops s on s.id = b.shop_id
      left join public.profiles cp on cp.id = b.client_id
      left join public.services sv on sv.id = b.service_id
      where (v_statuses is null or cardinality(v_statuses) = 0 or b.status = any (v_statuses))
        and (public.try_uuid(f->>'shop_id') is null or b.shop_id = public.try_uuid(f->>'shop_id'))
        and (public.try_uuid(f->>'client_id') is null or b.client_id = public.try_uuid(f->>'client_id'))
        and (f->>'from' is null or b.date >= (f->>'from')::date)
        and (f->>'to' is null or b.date <= (f->>'to')::date)
        and (v_q is null
             or b.ref ilike '%' || v_q || '%'
             or (v_plate is not null and b.car_snapshot->>'plate_norm' like '%' || v_plate || '%')
             or public.fold_text(coalesce(b.client_name, '')) like '%' || v_fold || '%'
             or public.fold_text(s.name) like '%' || v_fold || '%')), '[]'::jsonb);
  elsif p_kind = 'company_checks' then
    v_rows := public.admin_list_company_checks();
  elsif p_kind = 'reviews' then
    v_q := public.fold_text(public.clean_text(f->>'q'));
    v_rows := coalesce((
      select jsonb_agg(jsonb_build_object(
          'created_at', r.created_at, 'shop_name', s.name, 'shop_city', s.city, 'ref', b.ref,
          'client_display_id', cp.display_id, 'client_display_name', r.client_display_name,
          'rating', r.rating, 'text', r.text, 'reply', r.reply,
          'report_reason', r.report_reason, 'reported_at', r.reported_at, 'report_status', r.report_status,
          'removed_at', r.removed_at)
        order by r.created_at desc, r.id)
      from public.reviews r
      join public.shops s on s.id = r.shop_id
      left join public.bookings b on b.id = r.booking_id
      left join public.profiles cp on cp.id = r.client_id
      where v_q is null
         or public.fold_text(coalesce(r.text, '')) like '%' || v_q || '%'
         or public.fold_text(coalesce(r.reply, '')) like '%' || v_q || '%'
         or public.fold_text(s.name) like '%' || v_q || '%'
         or public.fold_text(r.client_display_name) like '%' || v_q || '%'), '[]'::jsonb);
  else
    perform public.fail('kind_invalid');
  end if;

  perform public.admin_audit_key('export', 'export', p_kind, null,
    jsonb_build_object('kind', p_kind, 'filters', f, 'rows', jsonb_array_length(v_rows)));
  return v_rows;
end
$function$;
revoke all on function public.admin_export(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_export(text, jsonb) to service_role;
grant execute on function public.admin_export(text, jsonb) to authenticated;

-- §7, §6, §5, §2: the wrappers go, the functions they wrapped get their names and grants back.
drop function public.admin_update_shop(uuid, jsonb, jsonb, uuid, text);
alter function public.admin_update_shop_a5(uuid, jsonb, jsonb, uuid) rename to admin_update_shop;
revoke all on function public.admin_update_shop(uuid, jsonb, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_shop(uuid, jsonb, jsonb, uuid) to service_role;
grant execute on function public.admin_update_shop(uuid, jsonb, jsonb, uuid) to authenticated;
drop function public.admin_set_shop_suspended(uuid, boolean, text, uuid);
alter function public.admin_set_shop_suspended_a5(uuid, boolean, text, uuid) rename to admin_set_shop_suspended;
revoke all on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) to service_role;
grant execute on function public.admin_set_shop_suspended(uuid, boolean, text, uuid) to authenticated;
drop function public.admin_set_account_suspended(uuid, boolean, text, uuid);
alter function public.admin_set_account_suspended_a5(uuid, boolean, text, uuid) rename to admin_set_account_suspended;
revoke all on function public.admin_set_account_suspended(uuid, boolean, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) to service_role;
grant execute on function public.admin_set_account_suspended(uuid, boolean, text, uuid) to authenticated;
drop function public.admin_update_settings(jsonb, uuid, text);
alter function public.admin_update_settings_a5(jsonb, uuid) rename to admin_update_settings;
revoke all on function public.admin_update_settings(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_settings(jsonb, uuid) to service_role;
grant execute on function public.admin_update_settings(jsonb, uuid) to authenticated;
drop function public.admin_set_company_plan(uuid, text, uuid, text);
alter function public.admin_set_company_plan_a5(uuid, text, uuid) rename to admin_set_company_plan;
revoke all on function public.admin_set_company_plan(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_company_plan(uuid, text, uuid) to service_role;
grant execute on function public.admin_set_company_plan(uuid, text, uuid) to authenticated;
drop function public.admin_extend_company_trial(uuid, integer, uuid, text);
alter function public.admin_extend_company_trial_a5(uuid, integer, uuid) rename to admin_extend_company_trial;
revoke all on function public.admin_extend_company_trial(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_extend_company_trial(uuid, integer, uuid) to service_role;
grant execute on function public.admin_extend_company_trial(uuid, integer, uuid) to authenticated;
drop function public.admin_extend_trial(uuid, integer, uuid, text);
alter function public.admin_extend_trial_a5(uuid, integer, uuid) rename to admin_extend_trial;
revoke all on function public.admin_extend_trial(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_extend_trial(uuid, integer, uuid) to service_role;
grant execute on function public.admin_extend_trial(uuid, integer, uuid) to authenticated;
drop function public.admin_set_subscription_price(uuid, numeric, uuid, text);
alter function public.admin_set_subscription_price_a5(uuid, numeric, uuid) rename to admin_set_subscription_price;
revoke all on function public.admin_set_subscription_price(uuid, numeric, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_subscription_price(uuid, numeric, uuid) to service_role;
grant execute on function public.admin_set_subscription_price(uuid, numeric, uuid) to authenticated;
drop function public.admin_grant_report_credit(uuid, uuid, text);
alter function public.admin_grant_report_credit_a5(uuid, uuid) rename to admin_grant_report_credit;
revoke all on function public.admin_grant_report_credit(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_grant_report_credit(uuid, uuid) to service_role;
grant execute on function public.admin_grant_report_credit(uuid, uuid) to authenticated;
drop function public.admin_verify_phone(uuid, uuid, text);
alter function public.admin_verify_phone_a5(uuid, uuid) rename to admin_verify_phone;
revoke all on function public.admin_verify_phone(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_verify_phone(uuid, uuid) to service_role;
grant execute on function public.admin_verify_phone(uuid, uuid) to authenticated;
drop function public.admin_vehicle_duplicates();
alter function public.admin_vehicle_duplicates_a5() rename to admin_vehicle_duplicates;
revoke all on function public.admin_vehicle_duplicates() from public, anon, authenticated, service_role;
grant execute on function public.admin_vehicle_duplicates() to service_role;
grant execute on function public.admin_vehicle_duplicates() to authenticated;
drop function public.admin_list_fleet_companies();
alter function public.admin_list_fleet_companies_a5() rename to admin_list_fleet_companies;
revoke all on function public.admin_list_fleet_companies() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_fleet_companies() to service_role;
grant execute on function public.admin_list_fleet_companies() to authenticated;
drop function public.admin_list_reviews(text);
alter function public.admin_list_reviews_a5(text) rename to admin_list_reviews;
revoke all on function public.admin_list_reviews(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reviews(text) to service_role;
grant execute on function public.admin_list_reviews(text) to authenticated;
drop function public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer);
alter function public.admin_list_bookings_a5(text[], uuid, uuid, date, date, text, integer) rename to admin_list_bookings;
revoke all on function public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer) to service_role;
grant execute on function public.admin_list_bookings(text[], uuid, uuid, date, date, text, integer) to authenticated;
drop function public.admin_list_shops();
alter function public.admin_list_shops_a5() rename to admin_list_shops;
revoke all on function public.admin_list_shops() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_shops() to service_role;
grant execute on function public.admin_list_shops() to authenticated;
drop function public.admin_list_clients();
alter function public.admin_list_clients_a5() rename to admin_list_clients;
revoke all on function public.admin_list_clients() from public, anon, authenticated, service_role;
grant execute on function public.admin_list_clients() to service_role;
grant execute on function public.admin_list_clients() to authenticated;
drop function public.admin_get_booking(uuid);
alter function public.admin_get_booking_a5(uuid) rename to admin_get_booking;
revoke all on function public.admin_get_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_booking(uuid) to service_role;
grant execute on function public.admin_get_booking(uuid) to authenticated;
drop function public.admin_get_shop(uuid);
alter function public.admin_get_shop_a5(uuid) rename to admin_get_shop;
revoke all on function public.admin_get_shop(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_shop(uuid) to service_role;
grant execute on function public.admin_get_shop(uuid) to authenticated;
drop function public.admin_get_client(uuid);
alter function public.admin_get_client_a5(uuid) rename to admin_get_client;
revoke all on function public.admin_get_client(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_client(uuid) to service_role;
grant execute on function public.admin_get_client(uuid) to authenticated;
drop function public.audit_forget_account(uuid, text, text, text);
alter function public.audit_forget_account_a5(uuid, text, text, text) rename to audit_forget_account;
revoke all on function public.audit_forget_account(uuid, text, text, text) from public, anon, authenticated, service_role;
drop function public.run_audit_retention(text, timestamp with time zone);
alter function public.run_audit_retention_a5(text, timestamp with time zone) rename to run_audit_retention;
revoke all on function public.run_audit_retention(text, timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.run_audit_retention(text, timestamp with time zone) to service_role;
drop function public.admin_force_cancel(uuid, text, uuid);
alter function public.admin_force_cancel_a5(uuid, text, uuid) rename to admin_force_cancel;
revoke all on function public.admin_force_cancel(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_force_cancel(uuid, text, uuid) to service_role;
grant execute on function public.admin_force_cancel(uuid, text, uuid) to authenticated;
drop function public.with_audit_reason(text);
drop function public.audit_view(text, text, text, jsonb);

-- §5: the audit log as before (the service role keeps every right it had).
drop trigger admin_audit_log_guard_truncate on public.admin_audit_log;
drop trigger admin_audit_log_guard on public.admin_audit_log;
drop function public.admin_audit_log_guard_truncate();
drop function public.admin_audit_log_guard();
drop function public.audit_log_relock();
drop function public.audit_log_unlock(text);
drop table public.audit_log_unlocks;
grant update, delete, truncate, references, trigger on public.admin_audit_log to service_role;

-- §4
drop function public.require_reason(text);
CREATE OR REPLACE FUNCTION public.admin_audit_log_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.admin_id is not null and (new.actor_role is null or new.actor_display_id is null) then
    select coalesce(new.actor_role, p.role), coalesce(new.actor_display_id, p.display_id)
      into new.actor_role, new.actor_display_id
    from public.profiles p where p.id = new.admin_id;
  end if;
  return new;
end
$function$;
drop index public.admin_audit_log_actor_idx;
alter table public.admin_audit_log drop column session_id;

-- §3: the access rules without the suspension check.
drop trigger profiles_suspended_guard on public.profiles;
drop function public.profiles_suspended_guard();
alter policy cars_insert_own on public.cars
  with check (((owner_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'client'::text))))));
alter policy cars_update_own on public.cars
  using ((owner_id = auth.uid()))
  with check ((owner_id = auth.uid()));
alter policy cars_delete_own on public.cars
  using ((owner_id = auth.uid()));
alter policy shops_update_owner on public.shops
  using (is_shop_owner(id))
  with check (is_shop_owner(id));
alter policy shop_billing_update_owner on public.shop_billing
  using (is_shop_owner(shop_id))
  with check (is_shop_owner(shop_id));
alter policy shop_hours_update_owner on public.shop_hours
  using (is_shop_owner(shop_id))
  with check (is_shop_owner(shop_id));
alter policy shop_closures_insert_owner on public.shop_closures
  with check (is_shop_owner(shop_id));
alter policy shop_closures_update_owner on public.shop_closures
  using (is_shop_owner(shop_id))
  with check (is_shop_owner(shop_id));
alter policy shop_closures_delete_owner on public.shop_closures
  using (is_shop_owner(shop_id));
alter policy shop_photos_add on public.shop_photos
  with check ((is_shop_member(shop_id) AND (path ~~ ((shop_id)::text || '/%'::text)) AND (url ~~ (('%/storage/v1/object/public/shop-photos/'::text || (shop_id)::text) || '/%'::text))));
alter policy shop_photos_order on public.shop_photos
  using (is_shop_member(shop_id))
  with check (is_shop_member(shop_id));
alter policy shop_photos_remove on public.shop_photos
  using (is_shop_member(shop_id));
alter policy shop_services_insert_owner on public.shop_services
  with check ((is_shop_owner(shop_id) AND (EXISTS ( SELECT 1
   FROM services sv
  WHERE ((sv.id = shop_services.service_id) AND sv.enabled)))));
alter policy shop_services_delete_owner on public.shop_services
  using (is_shop_owner(shop_id));
alter policy shop_staff_delete_owner on public.shop_staff
  using (((role = 'staff'::text) AND is_shop_owner(shop_id)));
alter policy logos_insert_owner on storage.objects
  with check (((bucket_id = 'logos'::text) AND is_shop_owner(try_uuid((storage.foldername(name))[1]))));
alter policy logos_update_owner on storage.objects
  using (((bucket_id = 'logos'::text) AND is_shop_owner(try_uuid((storage.foldername(name))[1]))))
  with check (((bucket_id = 'logos'::text) AND is_shop_owner(try_uuid((storage.foldername(name))[1]))));
alter policy logos_delete_owner on storage.objects
  using (((bucket_id = 'logos'::text) AND is_shop_owner(try_uuid((storage.foldername(name))[1]))));
alter policy shop_photos_files_insert on storage.objects
  with check (((bucket_id = 'shop-photos'::text) AND is_shop_member(try_uuid((storage.foldername(name))[1]))));
alter policy shop_photos_files_delete on storage.objects
  using (((bucket_id = 'shop-photos'::text) AND is_shop_member(try_uuid((storage.foldername(name))[1]))));
alter policy intake_photos_insert on storage.objects
  with check (((bucket_id = 'intake-photos'::text) AND is_booking_shop_member(try_uuid((storage.foldername(name))[1]))));
alter policy intake_photos_delete on storage.objects
  using (((bucket_id = 'intake-photos'::text) AND is_booking_shop_member(try_uuid((storage.foldername(name))[1]))));
alter policy fleet_files_delete on storage.objects
  using (((bucket_id = 'fleet-files'::text) AND
CASE
    WHEN fleet_issue_path(name) THEN fleet_issue_photo_can_delete(name, owner)
    ELSE (fleet_can(try_uuid((storage.foldername(name))[1]), 'costs.manage'::text) OR (owner = auth.uid()))
END));
drop function public.shop_writable(uuid);
drop function public.caller_can_write();

-- §2: the checks as at schema 118.
CREATE OR REPLACE FUNCTION public.support_file_caller(p_user uuid, p_aal text, p_session uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.profiles%rowtype;
begin
  select * into v from public.profiles where id = p_user;
  if not found or v.deleted_at is not null then
    perform public.fail('not_signed_in');
  end if;
  if v.role in ('client', 'shop') then
    -- An author, suspended included (it may still write to support).
    return v;
  end if;
  if v.role not in ('support', 'admin') then
    perform public.fail('not_allowed');
  end if;
  if v.suspended then
    perform public.fail('account_suspended');
  end if;
  if p_aal is distinct from 'aal2' then
    perform public.fail('mfa_required');
  end if;
  if v.role = 'support' and not exists (select 1 from auth.sessions s where s.id = p_session and s.user_id = p_user) then
    perform public.fail('not_signed_in');
  end if;
  return v;
end
$function$;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.caller_aal() = 'aal2' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  )
$function$;
CREATE OR REPLACE FUNCTION public.require_staff()
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.require_admin()
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.require_caller()
 RETURNS profiles
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v public.profiles%rowtype;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  select * into v from public.profiles where id = auth.uid();
  if not found then
    perform public.fail('not_signed_in');
  end if;
  if v.suspended then
    perform public.fail('account_suspended');
  end if;
  return v;
end
$function$;
CREATE OR REPLACE FUNCTION public.caller_session_alive()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sid text := auth.jwt()->>'session_id';
begin
  if v_sid is null or v_sid !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return exists (select 1 from auth.sessions s where s.id = v_sid::uuid and s.user_id = auth.uid());
end
$function$;

-- §1
drop function public.security_report(uuid, text, text, jsonb);
drop function public.staff_session_hours();
drop function public.security_record(text, text, text, text, jsonb, uuid);
drop function public.security_log(text, text, jsonb);
drop function public.security_context();
drop table public.security_events;

-- §11
delete from public.audit_action_classes where action in ('view_client', 'view_shop', 'view_booking', 'view_client_list',
  'view_shop_list', 'search_bookings', 'search_reviews', 'view_company_list', 'view_vehicle_duplicates', 'suspend_admin',
  'unsuspend_admin', 'end_admin_sessions', 'end_own_sessions');

update public.schema_version set version = 118;
