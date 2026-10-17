import { useState } from 'react';
import { useI18n } from '../i18n/context';
import { formatMoney } from '../i18n/format';
import type { QuoteLine, QuoteLineItem } from '../lib/quoteLines';
import { Checkbox } from './Checkbox';
import { QuoteVariantTag } from './QuoteVariantTag';
import styles from './QuoteVariantChoice.module.css';

/**
 * A quote line with two variants (T37c): a checkbox takes the line or leaves it out, and two
 * radio buttons pick the original or the alternative part, each with its price. Leaving the line
 * out and taking it back keeps the variant picked before.
 */
export function QuoteVariantChoice({
  line,
  pick,
  onPick,
  disabled,
}: {
  line: Extract<QuoteLine<QuoteLineItem>, { kind: 'variants' }>;
  /** The item taken, or null when the line is left out. */
  pick: string | null;
  onPick: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { t, lang } = useI18n();
  // The variant to take back when the line is ticked again.
  const [last, setLast] = useState(pick ?? line.original.id);
  const choose = (id: string) => {
    setLast(id);
    onPick(id);
  };
  const off = pick === null;
  return (
    <div className={styles.line}>
      <Checkbox checked={!off} disabled={disabled} onChange={(e) => onPick(e.target.checked ? last : null)}>
        <span className={off ? styles.off : undefined}>{line.original.name}</span>
      </Checkbox>
      <fieldset className={styles.options} disabled={disabled || off}>
        <legend className="visually-hidden">{t('cb.quote.variants', { name: line.original.name })}</legend>
        {[line.original, line.alternative].map((item) => (
          <label key={item.id} className={styles.option}>
            <input
              type="radio"
              className={styles.input}
              name={`variant-${line.key}`}
              checked={pick === item.id}
              onChange={() => choose(item.id)}
            />
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.label}>
              <QuoteVariantTag item={item} />
            </span>
            <span className="mono">{formatMoney(lang, item.price)}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
