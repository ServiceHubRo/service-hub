-- The browser can never change protected columns (CLAUDE.md §6.1): role, verification, suspension,
-- shop status, subscription, booking status, quotes, review rating/text, platform settings.
-- Column grants make these fail with "permission denied", whatever the row policies say.
begin;
select test.make_world();

-- ---------------------------------------------------------------- client
select test.login(test.id('client_a'));
select test.fails($$update public.profiles set role = 'admin' where id = auth.uid()$$, 'permission denied', 'client cannot change role');
select test.fails($$update public.profiles set role = 'shop' where id = auth.uid()$$, 'permission denied', 'client cannot become a shop');
select test.fails($$update public.profiles set display_id = 'A-00001' where id = auth.uid()$$, 'permission denied', 'display id is fixed');
select test.fails($$update public.profiles set suspended = false where id = auth.uid()$$, 'permission denied', 'client cannot unsuspend');
select test.fails($$update public.profiles set email_verified_at = now() where id = auth.uid()$$, 'permission denied', 'client cannot verify own email');
select test.fails($$update public.profiles set phone_verified_at = now() where id = auth.uid()$$, 'permission denied', 'client cannot verify own phone');
select test.fails($$update public.profiles set phone_verified_by_admin = true where id = auth.uid()$$, 'permission denied', 'client cannot fake admin verification');
select test.fails($$update public.profiles set terms_version = 'x' where id = auth.uid()$$, 'permission denied', 'terms acceptance is fixed');
select test.fails($$insert into public.profiles (id, role, display_id) values (gen_random_uuid(), 'admin', 'A-99999')$$, 'permission denied', 'client cannot create profiles');
select test.fails($$delete from public.profiles where id = auth.uid()$$, 'permission denied', 'profiles are not deleted from the browser');
-- The allowed columns work.
update public.profiles set name = 'Ana M. Marin', lang = 'en', location_prompt_dismissed_at = now() where id = auth.uid();

select test.fails($$insert into public.bookings (shop_id, service_id, date, slot) values (test.id('shop1'), 'ulei', current_date + 1, '10:00')$$,
  'permission denied', 'client cannot insert bookings directly');
select test.fails($$update public.bookings set status = 'cancelled' where client_id = auth.uid()$$, 'permission denied', 'client cannot change booking status');
select test.fails($$update public.bookings set cost = 1 where client_id = auth.uid()$$, 'permission denied', 'client cannot change the cost');
select test.fails($$delete from public.bookings where client_id = auth.uid()$$, 'permission denied', 'client cannot delete bookings');
select test.fails($$update public.quotes set status = 'accepted'$$, 'permission denied', 'client cannot decide a quote directly');
select test.fails($$update public.quote_items set approved = true$$, 'permission denied', 'client cannot approve quote items directly');
select test.fails($$update public.quote_items set price = 0$$, 'permission denied', 'client cannot change quote prices');
select test.fails($$insert into public.reviews (booking_id, shop_id, client_display_name, rating) values (test.id('booking_a'), test.id('shop1'), 'X', 5)$$,
  'permission denied', 'reviews are written only through submit_review (T03)');
select test.fails($$update public.reviews set rating = 1$$, 'permission denied', 'client cannot edit rating directly');
select test.fails($$insert into public.messages (thread_id, kind, body) values (test.id('thread_a'), 'user', 'hi')$$,
  'permission denied', 'messages are sent only through send_message (T03)');
select test.fails($$update public.threads set client_last_read_at = now()$$, 'permission denied', 'read markers only through mark_thread_read (T03)');
select test.fails($$insert into public.favorites (client_id, shop_id) values (auth.uid(), test.id('shop1'))$$,
  'permission denied', 'favorites only through toggle_favorite (T03)');
select test.fails($$update public.cars set reminded = '{}' where owner_id = auth.uid()$$, 'permission denied', 'reminder state is server-owned');
select test.fails($$update public.cars set owner_id = test.id('client_b') where owner_id = auth.uid()$$, 'permission denied', 'a car cannot change owner');
select test.fails($$update public.history_reports set status = 'paid'$$, 'permission denied', 'client cannot mark a report paid');
select test.fails($$insert into public.history_reports (client_id, car_snapshot) values (auth.uid(), '{}')$$, 'permission denied', 'reports are created by functions');
select test.fails($$update public.push_subscriptions set user_id = test.id('client_b')$$, 'permission denied', 'device subscription cannot change owner');
select test.fails($$select * from public.request_log$$, 'permission denied', 'idempotency log is server-only');
select test.fails($$select * from public.stripe_events$$, 'permission denied', 'Stripe events are server-only');
select test.fails($$select * from public.phone_verifications$$, 'permission denied', 'phone codes are server-only');
select test.fails($$select * from public.schema_version$$, 'permission denied', 'schema_version only through get_schema_version()');
select test.fails($$insert into public.notification_events (user_id, event) values (auth.uid(), 'x')$$, 'permission denied', 'outbox is server-only');
select test.fails($$insert into public.notices (audience, title_ro, body_ro, title_en, body_en) values ('all', 'a', 'b', 'c', 'd')$$,
  'permission denied', 'notices are admin-only');
select test.fails($$select nextval('public.display_id_admin_seq')$$, 'permission denied', 'sequences are not reachable');
select test.logout();
select test.eq(name, 'Ana M. Marin', 'client can edit own name'),
       test.eq(lang, 'en', 'client can change language'),
       test.eq(role, 'client', 'role unchanged')
from public.profiles where id = test.id('client_a');

-- ---------------------------------------------------------------- shop owner
select test.login(test.id('owner1'));
select test.fails($$update public.shops set active = true where id = test.id('shop1')$$, 'permission denied', 'shop cannot change active');
select test.fails($$update public.shops set suspended = false where id = test.id('shop1')$$, 'permission denied', 'shop cannot unsuspend itself');
select test.fails($$update public.shops set owner_id = test.id('client_a') where id = test.id('shop1')$$, 'permission denied', 'shop cannot change owner');
select test.fails($$update public.shops set setup_completed_at = now() where id = test.id('shop1')$$, 'permission denied', 'setup completion is server-owned');
select test.fails($$insert into public.shops (owner_id, name, city) values (auth.uid(), 'Second', 'Brașov')$$, 'permission denied', 'shops are created only at sign-up');
select test.fails($$delete from public.shops where id = test.id('shop1')$$, 'permission denied', 'shops are not deleted from the browser');
select test.fails($$update public.subscriptions set status = 'active' where shop_id = test.id('shop1')$$, 'permission denied', 'shop cannot change its plan status');
select test.fails($$update public.subscriptions set trial_ends_at = now() + interval '10 years'$$, 'permission denied', 'shop cannot extend its trial');
select test.fails($$insert into public.subscriptions (shop_id, price_ron) values (test.id('shop1'), 0)$$, 'permission denied', 'shop cannot create subscriptions');
select test.fails($$update public.shop_billing set shop_id = test.id('shop2')$$, 'permission denied', 'billing row stays with its shop');
select test.fails($$insert into public.shop_billing (shop_id) values (test.id('shop2'))$$, 'permission denied', 'billing rows are created at sign-up');
select test.fails($$update public.bookings set status = 'confirmed' where shop_id = test.id('shop1')$$, 'permission denied', 'shop cannot change booking status directly');
select test.fails($$update public.bookings set odometer = 1000 where shop_id = test.id('shop1')$$, 'permission denied', 'odometer only through complete_job (T03)');
select test.fails($$insert into public.quotes (booking_id, version, total_sent) values (test.id('booking_a'), 2, 100)$$, 'permission denied', 'quotes only through send_quote (T03)');
select test.fails($$update public.quote_items set price = 1$$, 'permission denied', 'sent quote items cannot change');
select test.fails($$update public.quote_items set approved = true$$, 'permission denied', 'shop cannot accept a quote for the client');
select test.fails($$update public.reviews set rating = 5 where shop_id = test.id('shop1')$$, 'permission denied', 'shop cannot change a rating');
select test.fails($$update public.reviews set text = 'Great' where shop_id = test.id('shop1')$$, 'permission denied', 'shop cannot change review text');
select test.fails($$update public.reviews set removed_at = now() where shop_id = test.id('shop1')$$, 'permission denied', 'shop cannot remove reviews');
select test.fails($$insert into public.shop_staff (shop_id, user_id, role, accepted_at) values (test.id('shop1'), test.id('client_a'), 'staff', now())$$,
  'permission denied', 'staff only through the invite flow (T05)');
select test.fails($$update public.shop_staff set role = 'owner'$$, 'permission denied', 'staff roles are fixed');
select test.fails($$insert into public.shop_hours (shop_id, weekday) values (test.id('shop1'), 1)$$, 'permission denied', 'hours rows are created at sign-up');
select test.fails($$update public.platform_settings set subscription_price_ron = 0$$, 'permission denied', 'shop cannot change platform settings');
select test.fails($$insert into public.invoices (shop_id, amount) values (test.id('shop1'), 0)$$, 'permission denied', 'invoices are server-only');
select test.fails($$update public.profiles set phone_verified_at = now() where id = auth.uid()$$, 'permission denied', 'shop cannot verify own phone');
select test.logout();

-- ---------------------------------------------------------------- admin: writes go through audited functions (T16)
select test.login(test.id('admin'));
select test.fails($$update public.shops set suspended = true$$, 'permission denied', 'admin writes only through functions');
select test.fails($$update public.platform_settings set trial_days = 1$$, 'permission denied', 'admin settings only through functions');
select test.fails($$update public.profiles set role = 'client' where id = auth.uid()$$, 'permission denied', 'admin cannot change roles directly');
select test.fails($$update public.reviews set removed_at = now()$$, 'permission denied', 'moderation only through functions');
select test.logout();

-- Everything above left the world as it was.
select test.eq(s.active and not s.suspended, true, 'shop1 status unchanged'),
       test.eq(sub.status, 'trial', 'subscription unchanged'),
       test.eq(b.status, 'done', 'booking unchanged'),
       test.eq(r.rating, 5, 'rating unchanged')
from public.shops s
join public.subscriptions sub on sub.shop_id = s.id
join public.bookings b on b.id = test.id('booking_a')
join public.reviews r on r.booking_id = b.id
where s.id = test.id('shop1');

rollback;
