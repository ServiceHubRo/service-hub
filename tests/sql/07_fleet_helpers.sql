-- Shared fleet world for the T72–T77 tests (M2–M6, 107). Creates the function only; each test file
-- calls test.make_fleet() inside its own transaction and rolls back.
--
--   co   „Flota SRL” on Fleet Business (member rights on):
--        client_a = admin · mgr (Mara) = manager · client_b (Bogdan) = driver of v1
--        acc (Dan) = accountant · drv2 (Radu) = driver of v2 · appr (Ioana) = driver with quotes.approve
--   v1 „B 401 FLT” (driver client_b), v2 „B 402 FLT” (driver drv2), v3 „B 403 FLT” (archived)
--   co2  „Alta SRL” (admin: out = Oana), one vehicle v9 — the other company for isolation tests
-- Member ids: m_mgr, m_drv (client_b), m_drv2, m_acc, m_appr. Everything logged out at the end.
create function test.make_fleet() returns void
language plpgsql
as $$
declare
  v_co uuid;
  v_co2 uuid;
  v_mgr uuid;
  v_acc uuid;
  v_drv2 uuid;
  v_appr uuid;
  v_out uuid;
  v1 uuid;
  v2 uuid;
  v3 uuid;
  v9 uuid;
begin
  perform test.make_world();
  update public.platform_settings set fleet_enabled = true where id = 1;
  v_mgr := test.sign_up('mara@test.local', '{"role":"client","name":"Mara Manager","phone":"0723000021","lang":"ro","terms_version":"2026-09"}');
  v_acc := test.sign_up('dan@test.local', '{"role":"client","name":"Dan Contabil","phone":"0723000022","lang":"ro","terms_version":"2026-09"}');
  v_drv2 := test.sign_up('radu@test.local', '{"role":"client","name":"Radu Sofer","phone":"0723000023","lang":"en","terms_version":"2026-09"}');
  v_appr := test.sign_up('ioana@test.local', '{"role":"client","name":"Ioana Aprobare","phone":"0723000024","lang":"ro","terms_version":"2026-09"}');
  v_out := test.sign_up('oana@test.local', '{"role":"client","name":"Oana Alta","phone":"0723000025","lang":"ro","terms_version":"2026-09"}');

  perform test.login(test.id('client_a'));
  v_co := (public.create_company('Flota SRL', null, null, null, gen_random_uuid())->>'id')::uuid;
  v1 := (public.fleet_save_vehicle(v_co, null, '{"make":"Dacia","model":"Logan","plate":"B 401 FLT"}', gen_random_uuid())->>'id')::uuid;
  v2 := (public.fleet_save_vehicle(v_co, null, '{"make":"Ford","model":"Transit","plate":"B 402 FLT"}', gen_random_uuid())->>'id')::uuid;
  v3 := (public.fleet_save_vehicle(v_co, null, '{"make":"Skoda","model":"Octavia","plate":"B 403 FLT"}', gen_random_uuid())->>'id')::uuid;
  perform public.invite_company_member(v_co, 'mara@test.local', 'manager', repeat('f1', 32), gen_random_uuid());
  perform public.invite_company_member(v_co, 'bogdan@test.local', 'driver', repeat('f2', 32), gen_random_uuid());
  perform public.invite_company_member(v_co, 'dan@test.local', 'accountant', repeat('f3', 32), gen_random_uuid());
  perform public.invite_company_member(v_co, 'radu@test.local', 'driver', repeat('f4', 32), gen_random_uuid());
  perform public.invite_company_member(v_co, 'ioana@test.local', 'driver', repeat('f5', 32), gen_random_uuid());
  perform test.login(test.id('admin'));
  perform public.admin_set_company_plan(v_co, 'fleet_business', gen_random_uuid(), 'Test A6');

  perform test.login(v_mgr);
  perform public.accept_company_invite(repeat('f1', 32), gen_random_uuid());
  perform test.login(test.id('client_b'));
  perform public.accept_company_invite(repeat('f2', 32), gen_random_uuid());
  perform test.login(v_acc);
  perform public.accept_company_invite(repeat('f3', 32), gen_random_uuid());
  perform test.login(v_drv2);
  perform public.accept_company_invite(repeat('f4', 32), gen_random_uuid());
  perform test.login(v_appr);
  perform public.accept_company_invite(repeat('f5', 32), gen_random_uuid());

  perform test.logout();
  insert into test.ids (name, id)
  select 'm_' || x.k, m.id from public.company_members m
  join (values ('mgr', v_mgr), ('drv', test.id('client_b')), ('acc', v_acc), ('drv2', v_drv2), ('appr', v_appr)) x(k, u) on u = m.user_id
  where m.company_id = v_co;

  perform test.login(test.id('client_a'));
  perform public.fleet_assign_driver(v1, test.id('m_drv'), gen_random_uuid());
  perform public.fleet_assign_driver(v2, test.id('m_drv2'), gen_random_uuid());
  perform public.fleet_archive_vehicle(v3, true, gen_random_uuid());
  perform public.set_company_member_rights(test.id('m_appr'), array['quotes.approve'], null, gen_random_uuid());

  perform test.login(v_out);
  v_co2 := (public.create_company('Alta SRL', null, null, null, gen_random_uuid())->>'id')::uuid;
  v9 := (public.fleet_save_vehicle(v_co2, null, '{"make":"Opel","model":"Astra","plate":"B 409 ALT"}', gen_random_uuid())->>'id')::uuid;

  perform test.logout();
  insert into test.ids (name, id) values
    ('co', v_co), ('co2', v_co2), ('mgr', v_mgr), ('acc', v_acc), ('drv2', v_drv2), ('appr', v_appr), ('out', v_out),
    ('v1', v1), ('v2', v2), ('v3', v3), ('v9', v9);
  perform test.logout();
end
$$;

-- A company booking, written as the server would (status and money set directly; tests of the RPCs
-- that change them are in their own files).
create function test.fleet_booking(p_vehicle text, p_client uuid, p_status text, p_date date default null,
  p_slot time default '10:00', p_cost numeric default null, p_odometer int default null) returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_cv public.company_vehicles%rowtype;
begin
  select * into v_cv from public.company_vehicles where id = test.id(p_vehicle);
  insert into public.bookings (shop_id, client_id, service_id, client_name, client_lang, car_snapshot, date, slot, status, cost,
                               odometer, done_at, company_id, company_vehicle_id)
  values (test.id('shop1'), p_client, 'frane', 'Client', 'ro',
          jsonb_build_object('make', v_cv.make, 'model', v_cv.model, 'plate', v_cv.plate),
          coalesce(p_date, test.today() - 5), p_slot, p_status, p_cost, p_odometer,
          case when p_status = 'done' then (coalesce(p_date, test.today() - 5) + p_slot) at time zone 'Europe/Bucharest' end,
          v_cv.company_id, v_cv.id)
  returning id into v_id;
  return v_id;
end
$$;

grant execute on all functions in schema test to public;
