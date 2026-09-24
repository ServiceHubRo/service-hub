import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { InlinePanel } from '../../../components/InlinePanel';
import { canRetryRpc, decideQuote, rpcErrorMessage, type Booking } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatMoney, formatTime } from '../../../i18n/format';
import { decisionKind, selectedTotal, type Quote } from '../../../lib/clientBookings';
import styles from './bookings.module.css';

/**
 * The client's answer to a quote (P15, P15c, FR §3.5): every line with a checkbox, all ticked at
 * first; the total follows the ticks. "Accept" with every line, "Accept selectate" with some;
 * unticking everything leaves only "Refuz". Refusing asks first and names the inspection fee
 * (never mentioned when the fee is 0). The answer names the version seen, so a quote the shop
 * replaced meanwhile is refused by the database instead of accepted blindly.
 */
export function QuoteDecision({
  bookingId,
  quote,
  act,
}: {
  bookingId: string;
  quote: Quote;
  act: (run: () => Promise<Booking>) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(quote.items.map((i) => i.id)));
  const [refusing, setRefusing] = useState(false);
  const kind = decisionKind(quote.items, selected);
  const total = selectedTotal(quote.items, selected);
  const fee = quote.inspection_fee;
  const expires = quote.expires_at ? new Date(quote.expires_at) : null;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const errorMessage = (e: unknown) => rpcErrorMessage(lang, e);

  return (
    <div className={styles.quote}>
      {quote.version > 1 && <p className={styles.muted}>{t('cb.quote.updated')}</p>}
      <p className={styles.hint}>{t('cb.quote.hint')}</p>
      <ul className={styles.quoteLines}>
        {quote.items.map((item) => (
          <li key={item.id}>
            <Checkbox
              checked={selected.has(item.id)}
              disabled={refusing}
              onChange={(e) => toggle(item.id, e.target.checked)}
              aria-label={t('cb.quote.line', { name: item.name, price: formatMoney(lang, item.price) })}
            >
              <span className={styles.lineText}>
                <span className={`${styles.lineName} ${selected.has(item.id) ? '' : styles.unticked}`}>{item.name}</span>
                <span className="mono">{formatMoney(lang, item.price)}</span>
              </span>
            </Checkbox>
          </li>
        ))}
      </ul>
      <p className={styles.quoteTotal} aria-live="polite">
        <span>{kind === 'all' ? t('cb.quote.total') : t('cb.quote.totalSelected')}</span>
        <span className="mono">{formatMoney(lang, total)}</span>
      </p>
      {quote.note && <p className={styles.note}>{quote.note}</p>}
      {expires && (
        <p className={styles.muted}>
          {t('cb.quote.expires', { when: `${formatDate(lang, expires)}, ${formatTime(lang, expires)}` })}
        </p>
      )}
      {fee > 0 && <p className={styles.muted}>{t('cb.quote.fee', { fee: formatMoney(lang, fee) })}</p>}

      {refusing ? (
        <InlinePanel title={t('cb.refuse.title')}>
          {fee > 0 && <p className={styles.panelBody}>{t('cb.refuse.fee', { fee: formatMoney(lang, fee) })}</p>}
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              block={false}
              onAction={(rid) => act(() => decideQuote(bookingId, quote.id, [], rid))}
              errorMessage={errorMessage}
              canRetry={canRetryRpc}
            >
              {t('cb.refuse.submit')}
            </ActionButton>
            <Button variant="ghost" onClick={() => setRefusing(false)}>
              {t('cb.refuse.keep')}
            </Button>
          </div>
        </InlinePanel>
      ) : (
        <>
          <p className={styles.ask}>{t('cb.quote.ask')}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="success"
              block={false}
              disabled={kind === 'none'}
              onAction={(rid) => act(() => decideQuote(bookingId, quote.id, [...selected], rid))}
              errorMessage={errorMessage}
              canRetry={canRetryRpc}
            >
              {kind === 'some' ? t('cb.quote.acceptSelected') : t('cb.quote.accept')}
            </ActionButton>
            <Button variant="danger" onClick={() => setRefusing(true)}>
              {t('cb.quote.refuse')}
            </Button>
          </div>
          {kind === 'none' && <p className={styles.muted}>{t('cb.quote.noneSelected')}</p>}
        </>
      )}
    </div>
  );
}
