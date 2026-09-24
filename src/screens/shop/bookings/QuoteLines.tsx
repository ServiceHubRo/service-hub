import type { ShopQuote } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatMoney } from '../../../i18n/format';
import styles from './shopBookings.module.css';

/**
 * A sent quote's lines with the total. After the client's decision, refused lines are struck
 * through (and say so in words) and the total is the approved one.
 */
export function QuoteLines({ quote }: { quote: ShopQuote }) {
  const { t, lang } = useI18n();
  const decided = quote.status !== 'sent';
  const total = decided ? (quote.total_approved ?? quote.total_sent) : quote.total_sent;
  return (
    <div className={styles.quote}>
      <ul className={styles.quoteLines}>
        {quote.items.map((item) => {
          const refused = decided && item.approved === false;
          return (
            <li key={item.id} className={`${styles.quoteLine} ${refused ? styles.refused : ''}`}>
              <span className={styles.quoteName}>
                {item.name}
                {refused && <span className="visually-hidden">, {t('sb.quote.refusedLine')}</span>}
              </span>
              <span className="mono">{formatMoney(lang, item.price)}</span>
            </li>
          );
        })}
      </ul>
      <p className={styles.quoteTotal}>
        <span>{decided ? t('sb.quote.totalApproved') : t('sb.quote.total')}</span>
        <span className="mono">{formatMoney(lang, total)}</span>
      </p>
      {quote.note && <p className={styles.note}>{quote.note}</p>}
    </div>
  );
}
