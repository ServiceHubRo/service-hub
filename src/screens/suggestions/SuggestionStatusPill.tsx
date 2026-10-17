import { useI18n } from '../../i18n/context';
import type { SuggestionStatus } from '../../data/suggestions';
import styles from './suggestions.module.css';

const TONE: Record<SuggestionStatus, 'blue' | 'amber' | 'green' | 'grey'> = {
  new: 'blue',
  planned: 'amber',
  done: 'green',
  declined: 'grey',
};

/**
 * The state of a suggestion, as a word in a colored pill (never color alone). The admin sees
 * "Nouă" where the author sees "Primită".
 */
export function SuggestionStatusPill({ status, admin = false }: { status: SuggestionStatus; admin?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`${styles.pill} ${styles[TONE[status]]}`}>
      {t(admin && status === 'new' ? 'admin.sugg.status.new' : `sugg.status.${status}`)}
    </span>
  );
}
