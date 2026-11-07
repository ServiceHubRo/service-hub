import { ChevronLeft } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/context';
import { goUp } from '../lib/navHistory';
import styles from './BackLink.module.css';

/**
 * "‹ Înapoi" at the top of a screen; inside the app it stays in reach while the screen scrolls.
 * It goes back to its parent page without adding a history entry (src/lib/navHistory.ts): the
 * browser's Back and this one never loop. A real link still: opening it in a new tab works.
 */
export function BackLink({ to, label }: { to: string; label?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goUp(navigate as (to: string | number, options?: { replace?: boolean }) => void, to);
  }
  return (
    <div className={styles.bar} data-back-bar>
      <Link to={to} className={styles.back} onClick={onClick}>
        <ChevronLeft size={18} aria-hidden="true" />
        {label ?? t('common.back')}
      </Link>
    </div>
  );
}
