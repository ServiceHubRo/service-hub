import { Card } from '../../components/Card';
import { QuoteVariantTag } from '../../components/QuoteVariantTag';
import { useI18n } from '../../i18n/context';
import { formatMoney } from '../../i18n/format';
import type { QuoteItem, QuoteStatus } from '../../lib/clientBookings';
import type { MessageKey } from '../../i18n/ro';
import { hasSections, quantityDetail, quoteSections, vatOf, type QuoteSectionKind } from '../../lib/quoteSections';
import styles from './history.module.css';

export interface HistoryQuoteProps {
  quote: {
    status: QuoteStatus;
    note: string | null;
    total_sent: number;
    total_approved: number | null;
    vat_rate?: number | null;
    items: QuoteItem[];
  };
}

const HEADING: Record<QuoteSectionKind, MessageKey> = { labor: 'qe.labor', part: 'qe.parts', other: 'qe.other' };

/**
 * The quote of a finished job, in full (P16b, P16c): an accepted one with the lines the client did
 * not approve struck through (and said so in words) and the approved total; a refused or expired
 * one with every line and the total that was proposed.
 */
export function HistoryQuote({ quote }: HistoryQuoteProps) {
  const { t, lang } = useI18n();
  const accepted = quote.status === 'accepted' || quote.status === 'partially_accepted';
  const headed = hasSections(quote.items);
  const total = accepted ? (quote.total_approved ?? quote.total_sent) : quote.total_sent;
  return (
    <Card inset className={styles.quote}>
      <p className={styles.quoteTitle}>{t('hist.card.quote')}</p>
      {quoteSections(quote.items).map((section) => (
        <div key={section.kind} className={styles.quoteSection}>
          {headed && <p className={styles.quoteHeading}>{t(HEADING[section.kind])}</p>}
          <ul className={styles.quoteLines}>
            {section.lines
              .flatMap((l) => (l.kind === 'plain' ? [l.item] : [l.original, l.alternative]))
              .map((item) => {
                const struck = accepted && item.approved === false;
                const detail = [quantityDetail(lang, item), item.kind === 'part' && !item.variant ? item.brand : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={item.id} className={`${styles.quoteLine} ${struck ? styles.refused : ''}`}>
                    <span className={styles.quoteName}>
                      {item.name}
                      {struck && <span className="visually-hidden">, {t('hist.quote.refusedLine')}</span>}
                      <QuoteVariantTag item={item} />
                      {detail && <span className={styles.quoteDetail}>{detail}</span>}
                    </span>
                    <span className="mono">{formatMoney(lang, item.price)}</span>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      <p className={styles.quoteTotal}>
        <span>{accepted ? t('hist.quote.totalApproved') : t('hist.quote.total')}</span>
        <span className="mono">{formatMoney(lang, total)}</span>
      </p>
      {quote.vat_rate != null && (
        <p className={styles.quoteVat}>{t('quote.vatIncluded', { rate: quote.vat_rate, vat: formatMoney(lang, vatOf(total, quote.vat_rate)) })}</p>
      )}
      {quote.note && <p className={styles.note}>{quote.note}</p>}
    </Card>
  );
}
