-- The free period is counted on the Romanian calendar: 90 days after a sign-up at 00:25 on 26
-- September (summer time) end at 00:25 on 25 December (winter time), not an hour earlier on the 24th.
begin;

select test.eq(public.add_local_days('2026-09-25 21:25:00+00', 90), '2026-12-24 22:25:00+00'::timestamptz,
  'across the end of summer time: the same local time, 90 days later'),
       test.eq(public.add_local_days('2026-03-01 10:00:00+00', 30), '2026-03-31 09:00:00+00'::timestamptz,
  'across the start of summer time too'),
       test.eq(public.add_local_days('2026-06-01 10:00:00+00', 7), '2026-06-08 10:00:00+00'::timestamptz,
  'without a change: plain days');

-- A shop signing up now: the free period ends on the local day 90 days from today, at the same local time.
select test.sign_up('trial90@test.local',
  '{"role":"shop","name":"T","phone":"0268000090","shop_name":"Atelier Nouăzeci","city":"Brașov","lang":"ro","terms_version":"2026-09-25"}');
select test.eq((sub.trial_ends_at at time zone 'Europe/Bucharest')::date, public.bucharest_today() + 90,
  'the free period ends 90 calendar days from today, in Bucharest')
from public.subscriptions sub join public.shops s on s.id = sub.shop_id where s.name = 'Atelier Nouăzeci';

rollback;
