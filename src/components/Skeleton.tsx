import { useI18n } from '../i18n/context';
import styles from './Skeleton.module.css';

/** Loading placeholder for lists: 3 cards by default. Never looks like an empty state. */
export function SkeletonList({ count = 3 }: { count?: number }) {
  const { t } = useI18n();
  return (
    <div className={styles.list} aria-busy="true" role="status">
      <span className="visually-hidden">{t('common.loading')}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.card} aria-hidden="true">
          <div className={styles.row}>
            <span className={`${styles.bar} ${styles.avatar}`} />
            <span className={`${styles.bar} ${styles.w60}`} />
          </div>
          <span className={`${styles.bar} ${styles.w80}`} />
          <span className={`${styles.bar} ${styles.w40}`} />
        </div>
      ))}
    </div>
  );
}

/** Loading placeholder for a grid of tiles (booking days and times). */
export function SkeletonGrid({ count, className }: { count: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={className} aria-busy="true" role="status">
      <span className="visually-hidden">{t('common.loading')}</span>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`${styles.bar} ${styles.tile}`} aria-hidden="true" />
      ))}
    </div>
  );
}

/** One loading line (inline panels that load a single value). */
export function SkeletonBar() {
  const { t } = useI18n();
  return (
    <div className={styles.single} aria-busy="true" role="status">
      <span className="visually-hidden">{t('common.loading')}</span>
      <span className={`${styles.bar} ${styles.w80}`} aria-hidden="true" />
      <span className={`${styles.bar} ${styles.w40}`} aria-hidden="true" />
    </div>
  );
}
