-- Colleagues' rights (Eduard, after T19b): a colleague works with bookings, quotes, jobs, messages
-- and the repair history; the shop's settings (public profile and logo, hours and days off, booking
-- rules and the inspection fee, services, SMS and daily summary), the replies to reviews and their
-- reports, the takings, the subscription, billing and the team are the owner's.
-- Enforced here, not only in the screens: the settings tables and the logo accept writes from the
-- owner alone, and the functions that save hours, services and review replies ask for the owner.
-- (The takings: Rapoarte were already the owner's; Istoric's total and CSV are left out for
-- colleagues in the app — each job's amount stays, a colleague writes the quotes.)

-- The caller's shop, when the caller owns it; `not_allowed` for a colleague or anyone else.
create function public.require_my_shop_owner()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_shop uuid := public.require_my_shop();
begin
  if not public.is_shop_owner(v_shop) then
    perform public.fail('not_allowed');
  end if;
  return v_shop;
end
$$;
revoke execute on function public.require_my_shop_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The settings tables: the owner writes, everyone who may read the shop still reads.
-- ---------------------------------------------------------------------------------------------

drop policy shops_update_member on public.shops;
create policy shops_update_owner on public.shops for update to authenticated
  using (public.is_shop_owner(id)) with check (public.is_shop_owner(id));

drop policy shop_hours_update_member on public.shop_hours;
create policy shop_hours_update_owner on public.shop_hours for update to authenticated
  using (public.is_shop_owner(shop_id)) with check (public.is_shop_owner(shop_id));

drop policy shop_closures_insert_member on public.shop_closures;
drop policy shop_closures_update_member on public.shop_closures;
drop policy shop_closures_delete_member on public.shop_closures;
create policy shop_closures_insert_owner on public.shop_closures for insert to authenticated
  with check (public.is_shop_owner(shop_id));
create policy shop_closures_update_owner on public.shop_closures for update to authenticated
  using (public.is_shop_owner(shop_id)) with check (public.is_shop_owner(shop_id));
create policy shop_closures_delete_owner on public.shop_closures for delete to authenticated
  using (public.is_shop_owner(shop_id));

drop policy shop_services_insert_member on public.shop_services;
drop policy shop_services_delete_member on public.shop_services;
create policy shop_services_insert_owner on public.shop_services for insert to authenticated
  with check (
    public.is_shop_owner(shop_id)
    and exists (select 1 from public.services sv where sv.id = service_id and sv.enabled)
  );
create policy shop_services_delete_owner on public.shop_services for delete to authenticated
  using (public.is_shop_owner(shop_id));

-- The logo: members still read the folder; only the owner uploads, replaces or deletes.
drop policy logos_insert_member on storage.objects;
drop policy logos_update_member on storage.objects;
drop policy logos_delete_member on storage.objects;
create policy logos_insert_owner on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
  );
create policy logos_update_owner on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'logos'
    and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
  );
create policy logos_delete_owner on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and public.is_shop_owner(public.try_uuid((storage.foldername(name))[1]))
  );

-- ---------------------------------------------------------------------------------------------
-- The functions behind the settings and the reviews: the owner only (bodies as before).
-- ---------------------------------------------------------------------------------------------

create or replace function public.save_shop_hours(p_hours jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_day jsonb;
  v_weekday int;
  v_closed boolean;
  v_open time;
  v_close time;
  v_seen_days int[] := '{}';
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'save_shop_hours');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop_owner();

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    perform public.fail('hours_invalid');
  end if;

  for v_day in select value from jsonb_array_elements(p_hours) loop
    begin
      v_weekday := (v_day->>'weekday')::int;
      v_closed := coalesce((v_day->>'is_closed')::boolean, false);
      v_open := case when v_closed then null else (v_day->>'open_time')::time end;
      v_close := case when v_closed then null else (v_day->>'close_time')::time end;
    exception when others then
      perform public.fail('hours_invalid');
    end;
    if v_weekday is null or v_weekday not between 0 and 6 or v_weekday = any (v_seen_days) then
      perform public.fail('hours_invalid');
    end if;
    v_seen_days := v_seen_days || v_weekday;
    if not v_closed then
      if v_open is null or v_close is null
         or extract(minute from v_open) not in (0, 30) or extract(minute from v_close) not in (0, 30)
         or extract(second from v_open) <> 0 or extract(second from v_close) <> 0 then
        perform public.fail('hours_invalid', jsonb_build_object('weekday', v_weekday));
      end if;
      if v_close <= v_open then
        perform public.fail('hours_close_before_open', jsonb_build_object('weekday', v_weekday));
      end if;
    end if;
    update public.shop_hours
      set is_closed = v_closed, open_time = v_open, close_time = v_close
      where shop_id = v_shop and weekday = v_weekday;
  end loop;

  update public.shops set hours_reviewed_at = now() where id = v_shop;

  select jsonb_agg(jsonb_build_object(
           'weekday', h.weekday, 'is_closed', h.is_closed,
           'open_time', to_char(h.open_time, 'HH24:MI'), 'close_time', to_char(h.close_time, 'HH24:MI'))
         order by h.weekday)
    into v_result
    from public.shop_hours h where h.shop_id = v_shop;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create or replace function public.set_shop_services(p_service_ids text[], p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_shop uuid;
  v_ids text[] := coalesce(p_service_ids, '{}');
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'set_shop_services');
  if v_seen is not null then
    return v_seen;
  end if;
  v_shop := public.require_my_shop_owner();

  if cardinality(v_ids) > 1000 then
    perform public.fail('service_unavailable');
  end if;
  if exists (
    select 1 from unnest(v_ids) as i(id)
    where not exists (select 1 from public.services sv where sv.id = i.id and sv.enabled)
  ) then
    perform public.fail('service_unavailable');
  end if;

  delete from public.shop_services where shop_id = v_shop and service_id <> all (v_ids);
  insert into public.shop_services (shop_id, service_id)
  select distinct v_shop, i.id from unnest(v_ids) as i(id)
  on conflict do nothing;

  select coalesce(jsonb_agg(ss.service_id order by ss.service_id), '[]'::jsonb) into v_result
  from public.shop_services ss where ss.shop_id = v_shop;
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

create or replace function public.reply_review(p_review_id uuid, p_reply text, p_request_id uuid)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_review public.reviews%rowtype;
  v_reply text := nullif(btrim(p_reply), '');
  v_first boolean;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'reply_review');
  if v_seen is not null then
    return jsonb_populate_record(null::public.reviews, v_seen);
  end if;
  select * into v_review from public.reviews where id = p_review_id for no key update;
  if not found or v_review.removed_at is not null then
    perform public.fail('review_not_found');
  end if;
  if not public.is_shop_owner(v_review.shop_id) then
    perform public.fail('not_allowed');
  end if;
  if char_length(v_reply) > 2000 then
    perform public.fail('reply_too_long');
  end if;

  v_first := v_review.reply is null and v_reply is not null;
  update public.reviews set reply = v_reply, reply_at = case when v_reply is null then null else now() end
  where id = v_review.id returning * into v_review;

  if v_first then
    perform public.notify_user(v_review.client_id, 'review_reply', jsonb_build_object(
      'review_id', v_review.id, 'booking_id', v_review.booking_id, 'shop_id', v_review.shop_id,
      'shop_name', (select s.name from public.shops s where s.id = v_review.shop_id)), v_review.booking_id);
  end if;
  perform public.request_finish(p_request_id, to_jsonb(v_review));
  return v_review;
end
$$;

create or replace function public.report_review(p_review_id uuid, p_reason text, p_request_id uuid)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_review public.reviews%rowtype;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'report_review');
  if v_seen is not null then
    return jsonb_populate_record(null::public.reviews, v_seen);
  end if;
  select * into v_review from public.reviews where id = p_review_id for no key update;
  if not found or v_review.removed_at is not null then
    perform public.fail('review_not_found');
  end if;
  if not public.is_shop_owner(v_review.shop_id) then
    perform public.fail('not_allowed');
  end if;
  if p_reason is null or p_reason not in ('fake', 'abusive', 'wrong_shop', 'personal_data') then
    perform public.fail('report_reason_invalid');
  end if;
  if v_review.report_status is not null then
    perform public.fail('already_reported');
  end if;

  update public.reviews
    set report_reason = p_reason, reported_at = now(), report_status = 'pending'
  where id = v_review.id returning * into v_review;
  perform public.request_finish(p_request_id, to_jsonb(v_review));
  return v_review;
end
$$;

update public.schema_version set version = 27;
