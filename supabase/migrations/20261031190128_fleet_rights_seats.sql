-- T63i/T64d — rights the admin gives, and colleagues billed per person (approved by Eduard on
-- 31 Oct 2026: "Ar trebui să aibă posibilitatea de a oferi acces și funcții mai departe" and "vreau
-- la fel să fie taxat PER angajat … La cel standard are voie 1 și apoi e taxat, la următorul 3, la
-- ultimul 5. Prețurile vreau să le stabilesc eu din admin").
--
-- Rights
-- · company_members.extra_caps: what the admin lets one member do beyond their role — approve
--   quotes (company_members.approval_limit, null = the company's limit), budgets, book, manage
--   vehicles, see costs and reports, invite and remove members. Some rights bring what they need to
--   be used (approving sees all bookings, vehicles and costs). fleet_can follows them everywhere.
-- · Only the admin gives rights (set_company_member_rights), changes roles, hands over the
--   administration, invites or removes an admin, sets the approval limit; the subscription and the
--   company's details stay the admin's. Nobody gives a right on.
--
-- Colleagues billed per person
-- · fleet_plans.included_members (colleagues in the price; the admin does not count, as the shop's
--   owner) and member_price_ron (each colleague after them, a month): Fleet Start 1, Business 3,
--   Pro 5, 19 lei; Enterprise agreed per company. The fixed member limits go (null): colleagues past
--   the included ones are billed, not refused. The admin sets all of it in Admin → Flote.
-- · company_subscriptions.member_price_ron is fixed when a subscription starts or changes plan,
--   like price_ron. company_plan() answers colleagues, extra_members and monthly_total.
-- · No payment: billing stays off (T64b, separate approval).

-- ---------------------------------------------------------------------------------------------
-- Rights
-- ---------------------------------------------------------------------------------------------
alter table public.company_members
  add column extra_caps text[] not null default '{}',
  add column approval_limit numeric(12,2) check (approval_limit >= 0);
alter table public.company_members add constraint company_members_extra_caps_known check (
  extra_caps <@ array['quotes.approve', 'budget.manage', 'bookings.create', 'vehicles.manage', 'costs.view', 'reports.view', 'members.manage']);

-- What a member may do: their role's rights (fleet_role_can, mirrored in src/lib/fleet/permissions.ts),
-- the rights the admin gave and what those need to be used. Mirrored by memberCan().
create function public.fleet_member_can(p_role text, p_extra text[], p_capability text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.fleet_role_can(p_role, p_capability), false)
    or p_capability = any (coalesce(p_extra, '{}'))
    or (p_capability in ('vehicles.viewAll', 'bookings.viewAll', 'costs.view') and 'quotes.approve' = any (coalesce(p_extra, '{}')))
    or (p_capability = 'vehicles.viewAll' and 'vehicles.manage' = any (coalesce(p_extra, '{}')))
    or (p_capability = 'costs.view' and 'budget.manage' = any (coalesce(p_extra, '{}')))
$$;
revoke execute on function public.fleet_member_can(text, text[], text) from public, anon, authenticated;

create or replace function public.fleet_can(p_company uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.fleet_member_can(m.role, m.extra_caps, p_capability)
    from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
  ), false)
$$;

-- The company exists, is not archived and the caller is its admin; else not_found / not_allowed.
create function public.require_company_admin(p_company uuid)
returns public.companies
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.companies%rowtype;
begin
  select * into v from public.companies c where c.id = p_company and c.archived_at is null;
  if not found or public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  if public.company_role(p_company) <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  return v;
end
$$;
revoke execute on function public.require_company_admin(uuid) from public, anon, authenticated;

-- The caller's approval limit in a company: their own, else the company's (null = none).
create function public.my_approval_limit(p_company uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(m.approval_limit, c.manager_approval_limit)
  from public.company_members m
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company and m.user_id = auth.uid() and m.accepted_at is not null
$$;
revoke execute on function public.my_approval_limit(uuid) from public, anon, authenticated;

-- The admin gives one member rights beyond their role, and their own approval limit. Never to an
-- admin (who has them all); a limit only for someone who approves (a manager, or with the right).
create function public.set_company_member_rights(p_member uuid, p_caps text[], p_approval_limit numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_caps text[];
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_member_rights');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company_admin(v_row.company_id);
  select coalesce(array_agg(distinct c order by c), '{}') into v_caps from unnest(coalesce(p_caps, '{}')) c;
  if v_row.role = 'admin'
     or not (v_caps <@ array['quotes.approve', 'budget.manage', 'bookings.create', 'vehicles.manage', 'costs.view', 'reports.view', 'members.manage'])
     or p_approval_limit < 0 or p_approval_limit > 10000000
     or (p_approval_limit is not null and not public.fleet_member_can(v_row.role, v_caps, 'quotes.approve')) then
    perform public.fail('company_rights_invalid');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  update public.company_members set extra_caps = v_caps, approval_limit = round(p_approval_limit, 2)
  where id = p_member;
  perform public.company_audit(v_row.company_id, 'set_member_rights', 'member', v_row.id,
    jsonb_build_object('extra_caps', v_row.extra_caps, 'approval_limit', v_row.approval_limit),
    jsonb_build_object('extra_caps', v_caps, 'approval_limit', round(p_approval_limit, 2)));
  v_result := jsonb_build_object('id', v_row.id, 'extra_caps', v_caps, 'approval_limit', round(p_approval_limit, 2));
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.set_company_member_rights(uuid, text[], numeric, uuid) from public, anon;
grant execute on function public.set_company_member_rights(uuid, text[], numeric, uuid) to authenticated;

-- The browser never writes rights directly (no grants on company_members exist; kept so).
-- create_booking: a member books the vehicles they see (the role's or a right the admin gave).
create or replace function public.create_booking(
  p_shop_id uuid,
  p_service_id text,
  p_date date,
  p_slot time,
  p_request_id uuid,
  p_car_id uuid default null,
  p_car jsonb default null,
  p_save_car boolean default false,
  p_note text default null,
  p_extra_service_ids text[] default '{}',
  p_share_history boolean default false,
  p_company_vehicle_id uuid default null
)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_shop public.shops%rowtype;
  v_car public.cars%rowtype;
  v_vehicle public.company_vehicles%rowtype;
  v_company uuid;
  v_snapshot jsonb;
  v_note text := nullif(btrim(p_note), '');
  v_booking public.bookings%rowtype;
  v_year int;
  v_plate text;
  v_vin text;
  v_params jsonb;
  v_extra text[] := coalesce(p_extra_service_ids, '{}');
  v_share boolean := coalesce(p_share_history, false);
begin
  v_me := public.require_caller();
  v_seen := public.request_begin(p_request_id, 'create_booking');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;

  if v_me.role <> 'client' then
    perform public.fail('not_allowed');
  end if;
  if v_me.email_verified_at is null then
    perform public.fail('email_not_verified');
  end if;

  -- One booking at a time per client, so the limits below cannot be raced.
  perform 1 from public.profiles where id = v_me.id for no key update;

  -- A company vehicle (T63d): a member who may book, the vehicle assigned to them if a driver.
  if p_company_vehicle_id is not null then
    if p_car_id is not null or p_car is not null then
      perform public.fail('car_invalid');
    end if;
    perform public.require_fleet_client();
    select * into v_vehicle from public.company_vehicles where id = p_company_vehicle_id;
    if not found or public.company_role(v_vehicle.company_id) is null then
      perform public.fail('vehicle_not_found');
    end if;
    v_company := v_vehicle.company_id;
    perform public.require_company(v_company, 'bookings.create');
    if not public.fleet_can(v_company, 'vehicles.viewAll') and v_vehicle.driver_member_id is distinct from public.my_member_id(v_company) then
      perform public.fail('not_allowed');
    end if;
    if v_vehicle.archived_at is not null then
      perform public.fail('vehicle_archived');
    end if;
    if public.company_read_only(v_company) then
      perform public.fail('fleet_read_only');
    end if;
    -- One company booking at a time, so the company limits cannot be raced either.
    perform 1 from public.companies where id = v_company for no key update;
  end if;

  -- One writer at a time per shop, so capacity cannot be raced (§4).
  select * into v_shop from public.shops where id = p_shop_id for no key update;
  if not found then
    perform public.fail('shop_not_found');
  end if;
  if not public.is_shop_public(p_shop_id) then
    perform public.fail('shop_unavailable');
  end if;

  if not exists (
    select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
    where ss.shop_id = p_shop_id and ss.service_id = p_service_id and sv.enabled
  ) then
    perform public.fail('service_unavailable');
  end if;

  -- More services in the same booking (T21): up to 5 in all, each once, each offered by the shop.
  -- Still one car, one time and one place of the day's capacity.
  if cardinality(v_extra) > 4 then
    perform public.fail('too_many_services', jsonb_build_object('limit', 5));
  end if;
  if p_service_id = any (v_extra)
     or cardinality(v_extra) <> (select count(distinct x) from unnest(v_extra) x)
     or exists (
       select 1 from unnest(v_extra) x
       where x is null or not exists (
         select 1 from public.shop_services ss join public.services sv on sv.id = ss.service_id
         where ss.shop_id = p_shop_id and ss.service_id = x and sv.enabled)) then
    perform public.fail('service_unavailable');
  end if;

  if char_length(v_note) > 1000 then
    perform public.fail('note_too_long');
  end if;

  -- Car: the company vehicle, from the garage, or typed in.
  if v_company is not null then
    v_car.make := v_vehicle.make;
    v_car.model := v_vehicle.model;
    v_car.year := v_vehicle.year;
    v_car.plate := v_vehicle.plate;
    v_car.plate_norm := v_vehicle.plate_norm;
    v_car.vin := v_vehicle.vin;
  elsif p_car_id is not null then
    select * into v_car from public.cars where id = p_car_id and owner_id = v_me.id;
    if not found then
      perform public.fail('car_not_found');
    end if;
  elsif p_car is not null and jsonb_typeof(p_car) = 'object' then
    if coalesce(btrim(p_car->>'make'), '') = '' or coalesce(btrim(p_car->>'model'), '') = '' then
      perform public.fail('car_required');
    end if;
    v_year := case when coalesce(p_car->>'year', '') ~ '^\d{4}$' then (p_car->>'year')::int end;
    if coalesce(p_car->>'year', '') <> '' and (v_year is null or v_year not between 1900 and 2100) then
      perform public.fail('car_year_invalid');
    end if;
    v_plate := nullif(btrim(p_car->>'plate'), '');
    if char_length(v_plate) > 20 then
      perform public.fail('car_plate_invalid');
    end if;
    v_vin := public.normalize_code(p_car->>'vin');
    if v_vin is not null and not public.is_valid_vin(v_vin) then
      perform public.fail('car_vin_invalid');
    end if;
    if char_length(btrim(p_car->>'make')) > 60 or char_length(btrim(p_car->>'model')) > 60 then
      perform public.fail('car_invalid');
    end if;
    if p_save_car then
      insert into public.cars (owner_id, make, model, year, plate, vin)
      values (v_me.id, btrim(p_car->>'make'), btrim(p_car->>'model'), v_year, v_plate, v_vin)
      returning * into v_car;
    else
      v_car.make := btrim(p_car->>'make');
      v_car.model := btrim(p_car->>'model');
      v_car.year := v_year;
      v_car.plate := v_plate;
      v_car.plate_norm := nullif(upper(regexp_replace(coalesce(v_plate, ''), '[\s-]', '', 'g')), '');
      v_car.vin := v_vin;
    end if;
  else
    perform public.fail('car_required');
  end if;
  v_snapshot := jsonb_build_object(
    'make', v_car.make, 'model', v_car.model, 'year', v_car.year, 'plate', v_car.plate,
    'plate_norm', v_car.plate_norm, 'vin', v_car.vin);

  perform public.check_slot(v_shop, p_date, p_slot, null, true);

  -- Abuse limits (§6): the company's for a company vehicle, the person's otherwise.
  if v_company is not null then
    if (select count(*) from public.bookings b
        where b.company_id = v_company and b.shop_id = p_shop_id and public.is_active_status(b.status))
       >= public.app_limit('fleet_active_bookings_per_shop', 20) then
      perform public.fail('fleet_limit_active_shop', jsonb_build_object('limit', public.app_limit('fleet_active_bookings_per_shop', 20)));
    end if;
    if (select count(*) from public.bookings b
        where b.company_id = v_company and public.is_active_status(b.status))
       >= public.app_limit('fleet_active_bookings_total', 100) then
      perform public.fail('fleet_limit_active_total', jsonb_build_object('limit', public.app_limit('fleet_active_bookings_total', 100)));
    end if;
    if (select count(*) from public.bookings b
        where b.company_id = v_company and b.created_at > now() - interval '24 hours')
       >= public.app_limit('fleet_new_bookings_per_24h', 30) then
      perform public.fail('fleet_limit_daily', jsonb_build_object('limit', public.app_limit('fleet_new_bookings_per_24h', 30)));
    end if;
  else
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and b.shop_id = p_shop_id and public.is_active_status(b.status))
       >= public.app_limit('active_bookings_per_shop', 3) then
      perform public.fail('limit_active_shop', jsonb_build_object('limit', public.app_limit('active_bookings_per_shop', 3)));
    end if;
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and public.is_active_status(b.status))
       >= public.app_limit('active_bookings_total', 10) then
      perform public.fail('limit_active_total', jsonb_build_object('limit', public.app_limit('active_bookings_total', 10)));
    end if;
    if (select count(*) from public.bookings b
        where b.client_id = v_me.id and b.company_id is null and b.created_at > now() - interval '24 hours')
       >= public.app_limit('new_bookings_per_24h', 5) then
      perform public.fail('limit_daily', jsonb_build_object('limit', public.app_limit('new_bookings_per_24h', 5)));
    end if;
  end if;

  insert into public.bookings (
    shop_id, client_id, service_id, extra_service_ids, client_name, client_phone, client_lang, car_id, car_snapshot,
    date, slot, note, status, share_history, share_history_at, company_id, company_vehicle_id
  ) values (
    p_shop_id, v_me.id, p_service_id, v_extra, v_me.name, v_me.phone, v_me.lang, v_car.id, v_snapshot,
    p_date, p_slot, v_note, 'pending', v_share, case when v_share then now() end, v_company, v_vehicle.id
  )
  returning * into v_booking;

  v_params := public.booking_event_params(v_booking);
  perform public.post_booking_event(v_booking, 'booking_requested', 'client');
  -- Instant confirmation (T28a): the shop chose it, and the client has no no-show in the last 90
  -- days. The place was just counted under the shop's lock, so it is the shop's yes at once:
  -- confirmed in the same transaction, the client told, the shop told it came in confirmed.
  if v_shop.auto_confirm and public.instant_for_client(v_me.id) then
    update public.bookings set status = 'confirmed', confirmed_at = now()
    where id = v_booking.id returning * into v_booking;
    perform public.post_booking_event(v_booking, 'booking_auto_confirmed', 'system',
      jsonb_build_object('date', v_booking.date, 'slot', to_char(v_booking.slot, 'HH24:MI')));
    perform public.notify_user(v_booking.client_id, 'booking_confirmed',
      public.booking_event_params(v_booking) || jsonb_build_object('auto', true), v_booking.id);
    perform public.notify_shop(v_booking.shop_id, 'booking_auto_confirmed', v_params, v_booking.id,
      case when v_shop.sms_on_new_booking then array['push', 'sms'] else array['push'] end);
  else
    perform public.notify_shop(v_booking.shop_id, 'booking_requested', v_params, v_booking.id,
      case when v_shop.sms_on_new_booking then array['push', 'sms'] else array['push'] end);
  end if;

  if v_company is not null then
    perform public.company_audit(v_company, 'booking_created', 'booking', v_booking.id, null,
      jsonb_build_object('vehicle_id', v_vehicle.id, 'shop_id', p_shop_id, 'date', p_date, 'slot', to_char(p_slot, 'HH24:MI')));
  end if;

  perform public.request_finish(p_request_id, to_jsonb(v_booking));
  return v_booking;
end
$$;

-- fleet_decide_quote: each approver's own limit.
create or replace function public.fleet_decide_quote(p_booking_id uuid, p_quote_id uuid, p_approved_item_ids uuid[], p_request_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.bookings%rowtype;
  v_company public.companies%rowtype;
  v_role text;
  v_limit numeric;
  v_quote public.quotes%rowtype;
  v_ids uuid[] := coalesce(p_approved_item_ids, '{}');
  v_lines int;
  v_approved int;
  v_total numeric;
  v_event text;
  v_decision text;
  v_params jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'fleet_decide_quote');
  if v_seen is not null then
    return jsonb_populate_record(null::public.bookings, v_seen);
  end if;
  select * into v from public.bookings where id = p_booking_id for no key update;
  if not found or v.company_id is null or public.company_role(v.company_id) is null then
    perform public.fail('booking_not_found');
  end if;
  v_company := public.require_company(v.company_id, 'quotes.approve');
  v_role := public.company_role(v.company_id);
  perform public.require_status(v, 'quote_sent');

  v_quote := public.current_sent_quote(v.id);
  if v_quote.id is distinct from p_quote_id then
    perform public.fail('quote_changed');
  end if;
  if v_quote.expires_at is not null and v_quote.expires_at <= now() then
    perform public.fail('quote_expired');
  end if;
  select a.choices, a.approved, a.total into v_lines, v_approved, v_total
  from public.apply_quote_answer(v_quote.id, v_ids) a;

  -- Anyone but the admin approves up to their own limit, else the company's (none = no limit);
  -- refusing is always allowed.
  v_limit := public.my_approval_limit(v.company_id);
  if v_approved > 0 and v_role <> 'admin' and v_limit is not null and v_total > v_limit then
    perform public.fail('fleet_over_limit', jsonb_build_object('limit', v_limit));
  end if;

  if v_approved = 0 then
    update public.quotes set status = 'refused', total_approved = 0, decided_at = now(), decided_by_user = auth.uid()
    where id = v_quote.id;
    update public.bookings set status = 'quote_refused', cost = v_quote.inspection_fee
    where id = v.id returning * into v;
    v_event := 'quote_refused';
    v_decision := 'refused';
    v_params := jsonb_build_object('quote_id', v_quote.id, 'inspection_fee', v_quote.inspection_fee);
  else
    update public.quotes
      set status = case when v_approved = v_lines then 'accepted' else 'partially_accepted' end,
          total_approved = v_total, decided_at = now(), decided_by_user = auth.uid()
    where id = v_quote.id;
    update public.bookings set status = 'approved' where id = v.id returning * into v;
    v_event := case when v_approved = v_lines then 'quote_accepted' else 'quote_partially_accepted' end;
    v_decision := case when v_approved = v_lines then 'approved' else 'partially_approved' end;
    v_params := jsonb_build_object('quote_id', v_quote.id, 'total', v_total, 'total_sent', v_quote.total_sent);
  end if;

  insert into public.company_quote_decisions (company_id, booking_id, quote_id, user_id, role, decision, amount)
  values (v.company_id, v.id, v_quote.id, auth.uid(), v_role, v_decision, coalesce(v_total, 0));
  perform public.company_audit(v.company_id, 'quote_decided', 'booking', v.id, null,
    jsonb_build_object('quote_id', v_quote.id, 'decision', v_decision, 'amount', coalesce(v_total, 0)));

  perform public.post_booking_event(v, v_event, 'client', v_params);
  perform public.notify_shop(v.shop_id, v_event, public.booking_event_params(v) || v_params, v.id);
  perform public.request_finish(p_request_id, to_jsonb(v));
  return v;
end
$$;

-- fleet_overview: the member's rights and limit.
create or replace function public.fleet_overview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_role text;
  v_me uuid;
  v_all boolean;
  v_team boolean;
  v_money boolean;
  v_bookings boolean;
begin
  perform public.require_fleet_client();
  select * into v_company from public.companies c where c.id = p_company and c.archived_at is null;
  v_role := public.company_role(p_company);
  if v_company.id is null or v_role is null then
    perform public.fail('company_not_found');
  end if;
  v_me := public.my_member_id(p_company);
  v_all := public.fleet_can(p_company, 'vehicles.viewAll');
  v_team := public.fleet_can(p_company, 'members.manage') or public.fleet_can(p_company, 'vehicles.manage');
  v_money := public.fleet_can(p_company, 'costs.view');
  v_bookings := public.fleet_can(p_company, 'bookings.viewAll');
  return jsonb_build_object(
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name, 'vat_id', v_company.vat_id, 'plan_key', 'none',
      -- Money rules only for those who see money.
      'manager_approval_limit', case when v_money then v_company.manager_approval_limit end,
      'budget', jsonb_build_object(
        'monthly', case when v_money then v_company.budget_monthly end,
        'yearly', case when v_money then v_company.budget_yearly end)),
    'me', jsonb_build_object('member_id', v_me, 'role', v_role,
      'extra_caps', to_jsonb((select m.extra_caps from public.company_members m where m.id = v_me)),
      'approval_limit', case when v_money then public.my_approval_limit(p_company) end),
    'vehicles', coalesce((
      select jsonb_agg(public.vehicle_json(cv) order by cv.created_at, cv.id)
      from public.company_vehicles cv
      where cv.company_id = p_company
        and (v_all or (cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'user_id', m.user_id, 'name', coalesce(p.name, ''),
               'email', lower(coalesce(u.email, m.invited_email)), 'role', m.role, 'accepted_at', m.accepted_at,
               'extra_caps', to_jsonb(m.extra_caps), 'approval_limit', case when v_money then m.approval_limit end)
             order by m.accepted_at nulls last, m.invited_at)
      from public.company_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.company_id = p_company and (v_team or m.user_id = auth.uid())
    ), '[]'::jsonb),
    -- The company's bookings (T63d): all for those who see all; a driver those of the vehicles
    -- assigned to them and their own, without amounts.
    'jobs', coalesce((
      select jsonb_agg(public.fleet_job_json(b, v_money) order by b.date desc, b.slot desc, b.id)
      from public.bookings b
      where b.company_id = p_company
        and (v_bookings
             or b.client_id = auth.uid()
             or b.company_vehicle_id in (
               select cv.id from public.company_vehicles cv
               where cv.company_id = p_company and cv.driver_member_id = v_me and cv.archived_at is null))
    ), '[]'::jsonb),
    -- Expenses and issues arrive with T63i / T63f.
    'expenses', '[]'::jsonb,
    'issues', '[]'::jsonb
  );
end
$$;

-- fleet_bookable_vehicles: by the member's rights.
create or replace function public.fleet_bookable_vehicles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.my_fleet_access() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'company_id', c.id, 'company_name', c.name, 'read_only', public.company_read_only(c.id),
             'vehicles', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'id', cv.id, 'make', cv.make, 'model', cv.model, 'year', cv.year, 'plate', cv.plate)
                      order by cv.plate nulls last, cv.make, cv.model, cv.id), '[]'::jsonb)
               from public.company_vehicles cv
               where cv.company_id = c.id and cv.archived_at is null
                 and (public.fleet_member_can(m.role, m.extra_caps, 'vehicles.viewAll') or cv.driver_member_id = m.id)))
           order by c.name, c.id)
    from public.company_members m
    join public.companies c on c.id = m.company_id and c.archived_at is null
    where m.user_id = auth.uid() and m.accepted_at is not null
      and public.fleet_member_can(m.role, m.extra_caps, 'bookings.create')
  ), '[]'::jsonb);
end
$$;

-- invite_company_member: an admin is invited only by an admin.
create or replace function public.invite_company_member(p_company uuid, p_email text, p_role text, p_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'invite_company_member');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'members.manage');
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    perform public.fail('email_invalid');
  end if;
  if p_role is null or p_role not in ('admin', 'manager', 'driver', 'accountant') then
    perform public.fail('company_role_invalid');
  end if;
  -- Someone the admin let invite (members.manage) never invites an admin.
  if p_role = 'admin' and public.company_role(p_company) <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    perform public.fail('invite_invalid');
  end if;
  perform 1 from public.companies where id = p_company for update;
  if exists (
    select 1 from public.company_members m
    join auth.users u on u.id = m.user_id
    where m.company_id = p_company and lower(u.email) = v_email
  ) then
    perform public.fail('member_exists');
  end if;
  if not public.rate_take('company_invite', p_company, public.app_limit('company_invites_per_day', 30), interval '1 day') then
    perform public.fail('limit_invites', jsonb_build_object('limit', public.app_limit('company_invites_per_day', 30)));
  end if;

  select * into v_row from public.company_members m
  where m.company_id = p_company and m.accepted_at is null and lower(m.invited_email) = v_email;
  if found then
    if v_row.role = 'admin' and public.company_role(p_company) <> 'admin' then
      perform public.fail('not_allowed');
    end if;
    update public.company_members
      set invite_token_hash = public.invite_token_hash(p_token), invited_at = now(), role = p_role, invited_by = auth.uid()
      where id = v_row.id
      returning * into v_row;
  else
    if (select count(*) from public.company_members m where m.company_id = p_company) >= public.app_limit('company_members_max', 50) then
      perform public.fail('limit_members', jsonb_build_object('limit', public.app_limit('company_members_max', 50)));
    end if;
    insert into public.company_members (company_id, invited_email, role, invite_token_hash, invited_by)
    values (p_company, v_email, p_role, public.invite_token_hash(p_token), auth.uid())
    returning * into v_row;
  end if;
  perform public.company_audit(p_company, 'invite_member', 'member', v_row.id, null,
    jsonb_build_object('email', v_row.invited_email, 'role', v_row.role));
  v_result := jsonb_build_object('id', v_row.id, 'email', v_row.invited_email, 'role', v_row.role, 'invited_at', v_row.invited_at);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- set_company_member_role: the admin's alone.
create or replace function public.set_company_member_role(p_member uuid, p_role text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_before text;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_member_role');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company_admin(v_row.company_id);
  if p_role is null or p_role not in ('admin', 'manager', 'driver', 'accountant') then
    perform public.fail('company_role_invalid');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  select * into v_row from public.company_members where id = p_member;
  v_before := v_row.role;
  if v_row.role = 'admin' and p_role <> 'admin' and v_row.accepted_at is not null
     and public.company_admin_count(v_row.company_id) <= 1 then
    perform public.fail('last_admin');
  end if;
  update public.company_members set role = p_role where id = p_member returning * into v_row;
  perform public.company_audit(v_row.company_id, 'set_member_role', 'member', v_row.id,
    jsonb_build_object('role', v_before), jsonb_build_object('role', v_row.role));
  v_result := jsonb_build_object('id', v_row.id, 'role', v_row.role);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- remove_company_member: an admin is removed only by an admin (or leaves).
create or replace function public.remove_company_member(p_member uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_caller();
  v_seen := public.request_begin(p_request_id, 'remove_company_member');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found or public.company_role(v_row.company_id) is null then
    perform public.fail('member_not_found');
  end if;
  if v_row.user_id is distinct from auth.uid() and not public.fleet_can(v_row.company_id, 'members.manage') then
    perform public.fail('not_allowed');
  end if;
  -- An admin is removed only by an admin.
  if v_row.user_id is distinct from auth.uid() and v_row.role = 'admin' and public.company_role(v_row.company_id) <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  if v_row.role = 'admin' and v_row.accepted_at is not null and public.company_admin_count(v_row.company_id) <= 1 then
    perform public.fail('last_admin');
  end if;
  delete from public.company_members where id = p_member;
  perform public.company_audit(v_row.company_id, case when v_row.user_id = auth.uid() then 'leave_company' else 'remove_member' end,
    'member', v_row.id, jsonb_build_object('email', v_row.invited_email, 'role', v_row.role, 'accepted', v_row.accepted_at is not null), null);
  v_result := jsonb_build_object('removed', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- transfer_company_admin: the admin's alone.
create or replace function public.transfer_company_admin(p_member uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_row public.company_members%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'transfer_company_admin');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v_row from public.company_members where id = p_member;
  if not found then
    perform public.fail('member_not_found');
  end if;
  perform public.require_company_admin(v_row.company_id);
  if v_row.accepted_at is null or v_row.user_id = auth.uid() then
    perform public.fail('transfer_invalid');
  end if;
  perform 1 from public.companies where id = v_row.company_id for update;
  update public.company_members set role = 'admin' where id = p_member;
  update public.company_members set role = 'manager'
    where company_id = v_row.company_id and user_id = auth.uid();
  perform public.company_audit(v_row.company_id, 'transfer_admin', 'member', v_row.id,
    jsonb_build_object('role', v_row.role), jsonb_build_object('role', 'admin', 'previous_admin', auth.uid()));
  v_result := jsonb_build_object('admin', v_row.id);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- set_company_rules: the approval limit is the admin's alone.
create or replace function public.set_company_rules(p_company uuid, p_manager_approval_limit numeric, p_budget_monthly numeric,
  p_budget_yearly numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_before public.companies%rowtype;
  v_after public.companies%rowtype;
  v_result jsonb;
begin
  perform public.require_fleet_client();
  v_seen := public.request_begin(p_request_id, 'set_company_rules');
  if v_seen is not null then
    return v_seen;
  end if;
  perform public.require_company(p_company, 'budget.manage');
  if p_manager_approval_limit < 0 or p_manager_approval_limit > 10000000
     or p_budget_monthly <= 0 or p_budget_monthly > 100000000
     or p_budget_yearly <= 0 or p_budget_yearly > 1000000000 then
    perform public.fail('company_rules_invalid');
  end if;
  select * into v_before from public.companies where id = p_company for update;
  -- The approval limit is the admin's alone: whoever manages the budget never raises it.
  if p_manager_approval_limit is distinct from v_before.manager_approval_limit and public.company_role(p_company) <> 'admin' then
    perform public.fail('not_allowed');
  end if;
  update public.companies
    set manager_approval_limit = round(p_manager_approval_limit, 2), budget_monthly = round(p_budget_monthly, 2),
        budget_yearly = round(p_budget_yearly, 2), updated_at = now()
    where id = p_company
    returning * into v_after;
  perform public.company_audit(p_company, 'set_company_rules', 'company', p_company,
    jsonb_build_object('manager_approval_limit', v_before.manager_approval_limit, 'budget_monthly', v_before.budget_monthly, 'budget_yearly', v_before.budget_yearly),
    jsonb_build_object('manager_approval_limit', v_after.manager_approval_limit, 'budget_monthly', v_after.budget_monthly, 'budget_yearly', v_after.budget_yearly));
  v_result := public.company_json(v_after);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- list_company_members: each member's rights.
create or replace function public.list_company_members(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_all boolean;
begin
  perform public.require_caller();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  v_all := public.fleet_can(p_company, 'members.manage') or public.fleet_can(p_company, 'vehicles.manage');
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'role', m.role, 'name', p.name,
             'email', lower(coalesce(u.email, m.invited_email)),
             'invited_at', m.invited_at, 'accepted_at', m.accepted_at,
             'expired', m.accepted_at is null and m.invited_at <= now() - interval '14 days',
             'is_me', m.user_id = auth.uid(),
             'extra_caps', to_jsonb(m.extra_caps), 'approval_limit', m.approval_limit)
           order by (m.role = 'admin') desc, m.accepted_at nulls last, m.invited_at), '[]'::jsonb)
    from public.company_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.company_id = p_company and (v_all or m.user_id = auth.uid())
  );
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Colleagues billed per person
-- ---------------------------------------------------------------------------------------------
alter table public.fleet_plans
  add column included_members int check (included_members >= 0),          -- null = agreed per company
  add column member_price_ron numeric(10,2) check (member_price_ron >= 0);  -- a month, each one after them
update public.fleet_plans set included_members = 1, member_price_ron = 19, member_limit = null,
  features = case when 'members' = any (features) then features else features || array['members'] end
where key = 'fleet_start';
update public.fleet_plans set included_members = 3, member_price_ron = 19, member_limit = null where key = 'fleet_business';
update public.fleet_plans set included_members = 5, member_price_ron = 19, member_limit = null where key = 'fleet_pro';

alter table public.company_subscriptions
  add column member_price_ron numeric(10,2) check (member_price_ron >= 0),  -- fixed with price_ron
  add column custom_included_members int check (custom_included_members >= 0);
update public.company_subscriptions s set member_price_ron = p.member_price_ron
from public.fleet_plans p where p.key = s.plan_key;

-- A new company's subscription copies the colleague's price too.
create or replace function public.companies_start_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ps public.platform_settings%rowtype;
  v_plan public.fleet_plans%rowtype;
  v_used boolean;
begin
  select * into ps from public.platform_settings where id = 1;
  select * into v_plan from public.fleet_plans where key = ps.fleet_trial_plan;
  if not found then
    select * into v_plan from public.fleet_plans where key = 'fleet_business';
  end if;
  v_used := exists (select 1 from public.fleet_trial_claims c where c.user_id = new.created_by)
    or (new.vat_id is not null and exists (select 1 from public.fleet_trial_claims c where c.vat_id = new.vat_id));
  if v_used or ps.fleet_trial_days = 0 then
    insert into public.company_subscriptions (company_id, plan_key, status, ended_reason, price_ron, member_price_ron)
    values (new.id, v_plan.key, 'inactive', 'trial_used', v_plan.price_ron, v_plan.member_price_ron);
  else
    insert into public.company_subscriptions (company_id, plan_key, status, price_ron, member_price_ron, trial_started_at, trial_ends_at)
    values (new.id, v_plan.key, 'trial', v_plan.price_ron, v_plan.member_price_ron, now(), now() + make_interval(days => ps.fleet_trial_days));
    insert into public.fleet_trial_claims (company_id, user_id, vat_id) values (new.id, new.created_by, new.vat_id);
  end if;
  return new;
end
$$;

-- Everything the plan decides, with the colleagues and the month's total.
create or replace function public.company_plan(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with x as (
    select s.*, p.name_ro, p.name_en, p.vehicle_limit as plan_vehicle_limit, p.member_limit as plan_member_limit, p.features,
      coalesce(s.custom_included_members, p.included_members) as included,
      -- Colleagues: members with an account, the admin not counted (as the shop's owner).
      greatest((select count(*) from public.company_members m where m.company_id = p_company and m.accepted_at is not null) - 1, 0)::int
        as colleagues
    from public.company_subscriptions s
    join public.fleet_plans p on p.key = s.plan_key
    where s.company_id = p_company
  ), y as (
    select x.*, case when x.included is null then 0 else greatest(x.colleagues - x.included, 0) end as extra from x
  )
  select jsonb_build_object(
    'plan_key', y.plan_key, 'name_ro', y.name_ro, 'name_en', y.name_en,
    'price_ron', y.price_ron, 'billing_months', y.billing_months,
    'vehicle_limit', coalesce(y.custom_vehicle_limit, y.plan_vehicle_limit),
    'member_limit', coalesce(y.custom_member_limit, y.plan_member_limit),
    'features', to_jsonb(y.features),
    'included_members', y.included, 'member_price_ron', y.member_price_ron,
    'colleagues', y.colleagues, 'extra_members', y.extra,
    'monthly_total', case when y.price_ron is null then null else y.price_ron + coalesce(y.member_price_ron, 0) * y.extra end,
    'status', y.status, 'ended_reason', y.ended_reason,
    'trial_started_at', y.trial_started_at, 'trial_ends_at', y.trial_ends_at,
    'current_period_end', y.current_period_end, 'cancel_at_period_end', y.cancel_at_period_end,
    'read_only', public.company_read_only(p_company),
    'billing_enabled', coalesce((select ps.fleet_billing_enabled from public.platform_settings ps where ps.id = 1), false))
  from y
$$;

-- Every member's frame: no price.
create or replace function public.fleet_plan_summary(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.require_fleet_client();
  if public.company_role(p_company) is null then
    perform public.fail('company_not_found');
  end if;
  v := public.company_plan(p_company);
  return (v - 'price_ron' - 'billing_months' - 'member_price_ron' - 'monthly_total')
    || jsonb_build_object('vehicles', (select count(*) from public.company_vehicles cv where cv.company_id = p_company and cv.archived_at is null));
end
$$;

-- The Abonament page: the plans with their colleagues.
create or replace function public.fleet_subscription(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  perform public.require_fleet_client();
  v_role := public.company_role(p_company);
  if v_role is null then
    perform public.fail('company_not_found');
  end if;
  if v_role not in ('admin', 'manager', 'accountant') then
    perform public.fail('not_allowed');
  end if;
  return jsonb_build_object(
    'plan', public.company_plan(p_company),
    'usage', jsonb_build_object(
      'vehicles', (select count(*) from public.company_vehicles cv where cv.company_id = p_company and cv.archived_at is null),
      'members', (select count(*) from public.company_members m where m.company_id = p_company)),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p.key, 'name_ro', p.name_ro, 'name_en', p.name_en, 'price_ron', p.price_ron,
               'vehicle_limit', p.vehicle_limit, 'member_limit', p.member_limit, 'features', to_jsonb(p.features),
               'included_members', p.included_members, 'member_price_ron', p.member_price_ron)
             order by p.position, p.key)
      from public.fleet_plans p where p.public and p.active
    ), '[]'::jsonb)
  );
end
$$;

-- A plan change fixes the colleague's price too.
create or replace function public.admin_set_company_plan(p_company uuid, p_plan_key text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.company_subscriptions%rowtype;
  v_plan public.fleet_plans%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_company_plan');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.company_subscriptions where company_id = p_company for update;
  if not found then
    perform public.fail('company_not_found');
  end if;
  select * into v_plan from public.fleet_plans where key = p_plan_key and active;
  if not found then
    perform public.fail('plan_not_found');
  end if;
  update public.company_subscriptions
    set plan_key = v_plan.key, price_ron = v_plan.price_ron, member_price_ron = v_plan.member_price_ron
  where company_id = p_company;
  perform public.admin_audit('set_company_plan', 'company', p_company,
    jsonb_build_object('plan', v.plan_key, 'price_ron', v.price_ron, 'member_price_ron', v.member_price_ron),
    jsonb_build_object('plan', v_plan.key, 'price_ron', v_plan.price_ron, 'member_price_ron', v_plan.member_price_ron));
  v_result := public.company_plan(p_company);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

-- A plan's price, vehicles, colleagues included and the price of each one after them (Admin → Flote).
drop function public.admin_update_fleet_plan(text, numeric, int, int, uuid);
create function public.admin_update_fleet_plan(p_key text, p_price_ron numeric, p_vehicle_limit int,
  p_included_members int, p_member_price_ron numeric, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v public.fleet_plans%rowtype;
  v_after public.fleet_plans%rowtype;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_update_fleet_plan');
  if v_seen is not null then
    return v_seen;
  end if;
  select * into v from public.fleet_plans where key = p_key for update;
  if not found then
    perform public.fail('plan_not_found');
  end if;
  if p_price_ron < 0 or p_price_ron > 100000 or p_vehicle_limit < 1 or p_vehicle_limit > 100000
     or p_included_members < 0 or p_included_members > 10000
     or p_member_price_ron < 0 or p_member_price_ron > 10000 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'plan'));
  end if;
  update public.fleet_plans
    set price_ron = round(p_price_ron, 2), vehicle_limit = p_vehicle_limit, included_members = p_included_members,
        member_price_ron = round(p_member_price_ron, 2), updated_at = now()
  where key = p_key
  returning * into v_after;
  perform public.admin_audit('update_fleet_plan', 'fleet_plan', null,
    jsonb_build_object('key', v.key, 'price_ron', v.price_ron, 'vehicle_limit', v.vehicle_limit,
      'included_members', v.included_members, 'member_price_ron', v.member_price_ron),
    jsonb_build_object('key', v_after.key, 'price_ron', v_after.price_ron, 'vehicle_limit', v_after.vehicle_limit,
      'included_members', v_after.included_members, 'member_price_ron', v_after.member_price_ron));
  v_result := to_jsonb(v_after);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_update_fleet_plan(text, numeric, int, int, numeric, uuid) from public, anon;
grant execute on function public.admin_update_fleet_plan(text, numeric, int, int, numeric, uuid) to authenticated;

update public.schema_version set version = 96;
