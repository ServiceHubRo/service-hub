import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../../i18n/context';
import styles from './SearchScreen.module.css';

/** "Cum e ordonată lista?" (P11): the toggle; the explanation is `RankingExplanation`. */
export function RankingToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  const { t } = useI18n();
  return (
    <button type="button" className={styles.textButton} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {t('search.howOrdered')}
      <ChevronDown size={16} aria-hidden="true" className={open ? styles.chevronOpen : styles.chevron} />
    </button>
  );
}

/** A short, honest explanation of the order: rating only, new shops mid-list, nobody pays. */
export function RankingExplanation({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div id={id} className={styles.explain}>
      <p>{t('search.howOrdered.body1')}</p>
      <p>{t('search.howOrdered.body2')}</p>
    </div>
  );
}
