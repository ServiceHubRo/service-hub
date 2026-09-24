import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import type { QuoteItem, QuoteStatus } from '../../lib/clientBookings';
import styles from './history.module.css';

export interface HistoryQuoteProps {
  quote: {
    status: QuoteStatus;
    note: string | null;
    total_sent: number;
    total_approved: number | null;
    items: QuoteItem[];
  };
}

/**
 * The quote of a finished job, in full (P16b, P16c): an accepted one with the lines the client did
 * not approve struck through (and said so in words) and the approved total; a refused or expired
 * one with every line and the total that was proposed.
 */
export function HistoryQuote({ quote }: HistoryQuoteProps) {
  const { t, lang } = useI18n();
  const accepted = quote.status === 'accepted' || quote.status === 'partially_accepted';
  return (
    <Card inset className={styles.quote}>
      <p className={styles.quoteTitle}>{t('hist.card.quote')}</p>
      <ul className={styles.quoteLines}>
        {quote.items.map((item) => {
          const struck = accepted && item.approved === false;
          return (
            <li key={item.id} className={`${styles.quoteLine} ${struck ? styles.refused : ''}`}>
              <span className={styles.quoteName}>
                {item.name}
                {struck && <span className="visually-hidden">, {t('hist.quote.refusedLine')}</span>}
              </span>
              <span className="mono">{formatMoney(lang, item.price)}</span>
            </li>
          );
        })}
      </ul>
      <p className={styles.quoteTotal}>
        <span>{accepted ? t('hist.quote.totalApproved') : t('hist.quote.total')}</span>
        <span className="mono">{formatMoney(lang, accepted ? (quote.total_approved ?? quote.total_sent) : quote.total_sent)}</span>
      </p>
      {quote.note && <p className={styles.note}>{quote.note}</p>}
    </Card>
  );
}
