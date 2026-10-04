import { useState } from 'react';
import { Checkbox } from '../../../components/Checkbox';
import type { Booking } from '../../../data/rpc';
import { shopDecideQuote, type ShopBooking, type ShopQuote } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatMoney } from '../../../i18n/format';
import { Panel, PanelButtons } from './BookingPanels';
import styles from './shopBookings.module.css';

/**
 * "Răspunsul clientului" (T29): a client without an account answers the quote at the shop or on
 * the phone; the shop ticks what was approved. Every line starts ticked; nothing ticked refuses
 * the quote (the inspection fee becomes the cost), exactly as the client's own answer would.
 */
export function ClientAnswerPanel({
  booking,
  quote,
  act,
  onClose,
}: {
  booking: ShopBooking;
  quote: ShopQuote;
  act: (run: () => Promise<Booking>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [approved, setApproved] = useState<ReadonlySet<string>>(() => new Set(quote.items.map((i) => i.id)));
  const toggle = (id: string, on: boolean) =>
    setApproved((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const total = quote.items.filter((i) => approved.has(i.id)).reduce((sum, i) => sum + i.price, 0);
  const none = approved.size === 0;

  return (
    <Panel title={t('sb.answer.title')}>
      <p className={styles.panelBody}>{t('sb.answer.body')}</p>
      <div className={styles.answerLines}>
        {quote.items.map((item) => (
          <Checkbox key={item.id} checked={approved.has(item.id)} onChange={(e) => toggle(item.id, e.target.checked)}>
            <span className={styles.answerLine}>
              <span>{item.name}</span>
              <span className="mono">{formatMoney(lang, item.price)}</span>
            </span>
          </Checkbox>
        ))}
      </div>
      <p className={styles.quoteTotal}>
        <span>{t('sb.quote.totalApproved')}</span>
        <span className="mono">{formatMoney(lang, none ? 0 : total)}</span>
      </p>
      <PanelButtons
        label={none ? t('sb.answer.refuse') : t('sb.answer.approve')}
        variant={none ? 'danger' : 'success'}
        onAction={(requestId) =>
          act(() =>
            shopDecideQuote(
              booking.id,
              quote.id,
              quote.items.filter((i) => approved.has(i.id)).map((i) => i.id),
              requestId,
            ),
          )
        }
        onClose={onClose}
      />
    </Panel>
  );
}
