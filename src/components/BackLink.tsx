import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/context';
import styles from './BackLink.module.css';

/** "‹ Înapoi" at the top of a screen; inside the app it stays in reach while the screen scrolls. */
export function BackLink({ to, label }: { to: string; label?: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.bar} data-back-bar>
      <Link to={to} className={styles.back}>
        <ChevronLeft size={18} aria-hidden="true" />
        {label ?? t('common.back')}
      </Link>
    </div>
  );
}
