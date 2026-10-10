-- Temporary email addresses (Eduard, 10 Oct): no account and no new address on a throwaway
-- domain; real providers, company domains and everything else stay open.
begin;

select test.ok(public.email_domain_blocked('ion@guerrillamail.com'), 'guerrillamail is refused');
select test.ok(public.email_domain_blocked('Ion@SharkLasers.com '), 'whatever the case and spaces');
select test.ok(public.email_domain_blocked('ion@mail.mailinator.com'), 'an address under a listed domain too');
select test.ok(not public.email_domain_blocked('ion@gmail.com'), 'Gmail stays open');
select test.ok(not public.email_domain_blocked('ion@yahoo.ro'), 'Yahoo stays open');
select test.ok(not public.email_domain_blocked('office@atelier-popescu.ro'), 'a company domain stays open');
select test.ok(not public.email_domain_blocked('ion@rdslink.ro'), 'an internet provider address stays open');
select test.ok(not public.email_domain_blocked('fara-domeniu'), 'no domain: nothing to refuse (the form checks the format)');
select test.ok(not public.email_domain_blocked(null), 'nothing given');
select test.eq((select count(*) from public.blocked_email_domains where domain in ('gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'yahoo.ro')), 0::bigint,
  'none of the big providers is on the list');

-- The form asks before sending, signed in or not.
select test.login_anon();
select test.ok(public.email_domain_blocked('x@sharklasers.com'), 'the sign-up form can ask');
select test.fails($$select count(*) from public.blocked_email_domains$$, 'permission denied', 'but cannot read the list');
select test.logout();

-- The rule itself holds whatever sends the address.
select test.fails($$select test.sign_up('nou@guerrillamail.com', '{"role":"client","name":"Test","lang":"ro"}')$$,
  'email_disposable', 'no account on a throwaway address');
select test.ok(test.sign_up('nou@gmail.com', '{"role":"client","name":"Test","lang":"ro"}') is not null, 'a real address opens one');
select test.fails($$update auth.users set email_change = 'tot.eu@sharklasers.com' where email = 'nou@gmail.com'$$,
  'email_disposable', 'and cannot move to a throwaway address');
update auth.users set email_change = 'tot.eu@yahoo.ro' where email = 'nou@gmail.com';
select test.eq((select email_change from auth.users where email = 'nou@gmail.com'), 'tot.eu@yahoo.ro', 'a real new address is fine');
select test.fails($$update auth.users set email = 'tot.eu@mailinator.com' where email = 'nou@gmail.com'$$,
  'email_disposable', 'nor be set straight to one');

rollback;
