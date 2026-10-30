import { QuoteVariantTag } from '../../../components/QuoteVariantTag';
import type { ShopQuote, ShopQuoteItem } from '../../../data/shopBookings';
import { useI18n } from '../../../i18n/context';
import { formatMoney } from '../../../i18n/format';
import type { MessageKey } from '../../../i18n/ro';
import { hasSections, quantityDetail, quoteSections, vatOf, type QuoteSectionKind } from '../../../lib/quoteSections';
import { quoteTotal } from '../../../lib/shopBookings';
import styles from './shopBookings.module.css';

const HEADING: Record<QuoteSectionKind, MessageKey> = {
  labor: 'qe.labor',
  part: 'qe.parts',
  other: 'qe.other',
};

/**
 * A sent quote's lines with the total. Labor and parts under their headings (T50), each line with
 * its hours × rate or quantity × price and producer. After the client's decision, refused lines
 * are struck through (and say so in words) and the total is the approved one. A line with variants
 * shows both, each named (T37c); the one not taken is struck through.
 */
export function QuoteLines({ quote }: { quote: ShopQuote }) {
  const { t, lang } = useI18n();
  const decided = quote.status !== 'sent';
  const total = quoteTotal(quote);
  const headed = hasSections(quote.items);

  const line = (item: ShopQuoteItem) => {
    const refused = decided && item.approved === false;
    const detail = [quantityDetail(lang, item), item.kind === 'part' && !item.variant ? item.brand : null].filter(Boolean).join(' · ');
    return (
      <li key={item.id} className={`${styles.quoteLine} ${refused ? styles.refused : ''}`}>
        <span className={styles.quoteName}>
          {item.name}
          {refused && <span className="visually-hidden">, {t('sb.quote.refusedLine')}</span>}
          <QuoteVariantTag item={item} />
          {detail && <span className={styles.quoteDetail}>{detail}</span>}
        </span>
        <span className="mono">{formatMoney(lang, item.price)}</span>
      </li>
    );
  };

  return (
    <div className={styles.quote}>
      {quoteSections(quote.items).map((section) => (
        <div key={section.kind} className={styles.quoteSection}>
          {headed && <p className={styles.quoteHeading}>{t(HEADING[section.kind])}</p>}
          <ul className={styles.quoteLines}>
            {section.lines.flatMap((l) => (l.kind === 'plain' ? [line(l.item)] : [line(l.original), line(l.alternative)]))}
          </ul>
        </div>
      ))}
      <p className={styles.quoteTotal}>
        <span>{decided ? t('sb.quote.totalApproved') : t('sb.quote.total')}</span>
        <span className="mono">{formatMoney(lang, total)}</span>
      </p>
      {quote.vat_rate != null && (
        <p className={styles.quoteVat}>{t('quote.vatIncluded', { rate: quote.vat_rate, vat: formatMoney(lang, vatOf(total, quote.vat_rate)) })}</p>
      )}
      {quote.note && <p className={styles.note}>{quote.note}</p>}
    </div>
  );
}
