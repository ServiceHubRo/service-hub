import { useState } from 'react';
import { Banner } from '../../../components/Banner';
import { RELOAD_AVAILABILITY_CODES, rescheduleBooking, rpcErrorMessage, toRpcError, type Booking } from '../../../data/rpc';
import type { ShopBooking } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { Panel, PanelButtons } from './BookingPanels';
import { SlotPicker } from './SlotPicker';
import styles from './shopBookings.module.css';

/**
 * "Reprogramează" (P8, ARCHITECTURE §4): the shop's own calendar with the place this booking holds
 * now counted as free. The database checks the slot again at submit; if it filled up or passed
 * meanwhile, the booking stays exactly as it was and the days reload.
 */
export function ReschedulePanel({
  booking,
  shopId,
  act,
  onClose,
}: {
  booking: ShopBooking;
  shopId: string;
  /** Runs the move and hands the result to the list (ShopBookingCard). */
  act: (run: () => Promise<Booking>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Panel title={t('sb.reschedule.title')}>
      {notice && <Banner tone="warning">{notice}</Banner>}
      <p className={styles.panelBody}>
        {t('sb.reschedule.now', { when: `${formatDate(lang, booking.date)}, ${booking.slot}` })}
      </p>
      <SlotPicker
        key={calendar}
        shopId={shopId}
        excludeBooking={booking.id}
        current={{ date: booking.date, slot: booking.slot }}
        day={day}
        time={time}
        onDay={(d) => {
          setDay(d);
          setTime(null);
        }}
        onTime={setTime}
        dayLabel={t('sb.reschedule.day')}
      />
      <PanelButtons
        label={booking.status === 'pending' ? t('sb.reschedule.submitConfirm') : t('sb.reschedule.submit')}
        disabled={!day || !time}
        onAction={async (requestId) => {
          if (!day || !time) return;
          try {
            await act(() => rescheduleBooking(booking.id, day, time, requestId));
          } catch (e) {
            if (!RELOAD_AVAILABILITY_CODES.has(toRpcError(e).code)) throw e;
            // The calendar was out of date: say why, show it fresh, nothing was moved.
            setNotice(rpcErrorMessage(lang, e));
            setDay(null);
            setTime(null);
            setCalendar((n) => n + 1);
          }
        }}
        onClose={onClose}
      />
    </Panel>
  );
}
