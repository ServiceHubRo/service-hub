import { useI18n } from '../i18n/context';
import type { QuoteVariantFields } from '../lib/quoteLines';
import styles from './QuoteVariantTag.module.css';

/** "Piesă originală" / "Piesă alternativă, Bosch" after a quote line's name (T37c); nothing for a plain line. */
export function QuoteVariantTag({ item }: { item: QuoteVariantFields }) {
  const { t } = useI18n();
  if (!item.variant) return null;
  const label =
    item.variant === 'original'
      ? t('quote.variant.original')
      : item.brand
        ? t('quote.variant.alternativeBrand', { brand: item.brand })
        : t('quote.variant.alternative');
  return <span className={styles.tag}>{label}</span>;
}
