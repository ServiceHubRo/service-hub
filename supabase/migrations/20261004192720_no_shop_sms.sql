-- No SMS to shops for a new request (Eduard, 4 Oct): every text costs money and the shop already
-- gets a push on its phone (the app, T20) and sees the request on Panou. The option is gone from
-- Setări → Notificări; shops that had it on are turned off, and the column can no longer be set,
-- so create_booking and its variants (which still read it) never ask for an SMS again. Nothing is
-- deleted. Texts that remain: the phone confirmation code and the link of a booking the shop added
-- for a client without an account (T29).

update public.shops set sms_on_new_booking = false where sms_on_new_booking;

revoke update (sms_on_new_booking) on public.shops from authenticated;

alter table public.shops add constraint shops_no_new_booking_sms check (not sms_on_new_booking);

update public.schema_version set version = 59;
