import { Award } from 'lucide-react';
import { useI18n } from '../i18n/context';
import styles from './FounderBadge.module.css';

/**
 * "Partener fondator" (Eduard, 8 Oct): a shop that signed up at the launch price. Shown on the
 * search card and the shop page; it never changes the order of the list.
 */
export function FounderBadge({ withHint = false }: { withHint?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={styles.badge} title={withHint ? undefined : t('founder.hint')}>
      <Award size={13} aria-hidden="true" />
      {t('founder.badge')}
      {withHint && <span className="visually-hidden">: {t('founder.hint')}</span>}
    </span>
  );
}
