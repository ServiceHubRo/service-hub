-- A shop's public phones changed by its owner need a new SMS code (after the audit, 30 Oct 2026):
-- the owner's confirmation is cleared and the shop leaves search until the code is typed. A change
-- of formatting only, or a change not made by the owner, keeps the confirmation.
begin;
select test.make_world();
-- The owner's account number: a mobile, so a code can be sent to it.
update public.profiles set phone = '0723 555 101' where id = test.id('owner1');
update public.profiles set phone_verified_by_admin = false, phone_verified_at = now() where id = test.id('owner1');
select test.ok(public.is_shop_public(test.id('shop1')), 'public before');

-- Formatting only: nothing changes.
select test.login(test.id('owner1'));
update public.shops set phone = '0268 312 445' where id = test.id('shop1');
select test.logout();
select test.ok((select phone_verified_at is not null from public.profiles where id = test.id('owner1')), 'same digits: still confirmed');
select test.ok(public.is_shop_public(test.id('shop1')), 'same digits: still public');

-- A new main number: confirmation cleared, out of search.
select test.login(test.id('owner1'));
update public.shops set phone = '0268 999 000' where id = test.id('shop1');
select test.logout();
select test.ok((select phone_verified_at is null and not phone_verified_by_admin from public.profiles where id = test.id('owner1')),
  'new number: confirmation cleared');
select test.ok(not public.is_shop_public(test.id('shop1')), 'new number: out of search');
select test.eq(phone, '0723 555 101', 'the account number stays as it was') from public.profiles where id = test.id('owner1');

-- The owner types the code sent to the account number: back in search.
select test.eq(public.phone_verify_begin(test.id('owner1'), '615243')->>'status', 'send', 'a code can be sent');
select test.login(test.id('owner1'));
select test.eq(public.check_phone_code('615243', gen_random_uuid())->>'status', 'verified', 'the owner confirms it');
select test.logout();
select test.ok(public.is_shop_public(test.id('shop1')), 'confirmed again: public');

-- The second number too.
select test.login(test.id('owner1'));
update public.shops set phone2 = '0723 000 777' where id = test.id('shop1');
select test.logout();
select test.ok(not public.is_shop_public(test.id('shop1')), 'second number added: out of search until confirmed');

-- A confirmation given by the admin is cleared as well (the admin confirms again by hand).
update public.profiles set phone_verified_by_admin = true where id = test.id('owner1');
select test.login(test.id('owner1'));
update public.shops set phone2 = null where id = test.id('shop1');
select test.logout();
select test.ok((select not phone_verified_by_admin from public.profiles where id = test.id('owner1')), 'admin confirmation cleared too');

-- A change the owner did not make (the admin, the server) keeps the confirmation.
update public.profiles set phone_verified_by_admin = true where id = test.id('owner1');
update public.shops set phone = '0268 111 222' where id = test.id('shop1');
select test.ok((select phone_verified_by_admin from public.profiles where id = test.id('owner1')), 'changed by the server: still confirmed');

-- Other columns never touch it.
select test.login(test.id('owner1'));
update public.shops set description = 'Service auto' where id = test.id('shop1');
select test.logout();
select test.ok(public.is_shop_public(test.id('shop1')), 'another field: still public');

-- A colleague cannot change the shop's numbers at all.
select test.login(test.id('staff1'));
update public.shops set phone = '0700 000 000' where id = test.id('shop1');
select test.logout();
select test.eq(phone, '0268 111 222', 'a colleague changes nothing') from public.shops where id = test.id('shop1');

rollback;
