import { Star } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { formatRating } from '../i18n/format';
import styles from './Stars.module.css';

function Row({ size, className }: { size: number; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} />
      ))}
    </span>
  );
}

/** Five stars filled to the exact rating (4,5 → four and a half); the number is read out ("4,5 din 5"). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const { t, lang } = useI18n();
  const percent = Math.max(0, Math.min(5, value)) * 20;
  return (
    <span className={styles.stars} role="img" aria-label={t('rating.outOf5', { value: formatRating(lang, value) })}>
      <Row size={size} className={styles.off} />
      <span className={styles.clip} style={{ width: `${percent}%` }}>
        <Row size={size} className={styles.on} />
      </span>
    </span>
  );
}
