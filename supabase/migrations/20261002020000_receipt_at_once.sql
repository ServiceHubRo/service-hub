-- After T24: the payment receipt ("Plată primită", invoice_paid) is an email only and the person
-- who just paid waits for it, so it no longer waits out the quiet hours. Everything else in
-- is_quiet_event stays as it was.

create or replace function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report')
$$;

update public.schema_version set version = 45;
