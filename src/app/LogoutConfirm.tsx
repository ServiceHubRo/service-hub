import { useEffect, useRef } from 'react';
import { Button } from '../components/Button';
import { InlinePanel } from '../components/InlinePanel';
import { useI18n } from '../i18n/context';
import styles from './LogoutConfirm.module.css';

/**
 * „Te deconectezi?” — the inline confirmation before signing out (CLAUDE.md §6.7: never
 * window.confirm), in the desktop sidebar and on Cont. Escape keeps the session, like „Rămân”.
 */
export function LogoutConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // On Cont the button is the last thing on the page: the whole panel, buttons included, comes
  // into view (the title already has the focus).
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div ref={ref} className={styles.wrap}>
      <InlinePanel title={t('nav.logoutConfirm.title')}>
        <p className={styles.body}>{t('nav.logoutConfirm.body')}</p>
        <div className={styles.buttons}>
          <Button variant="primary" block onClick={onConfirm}>
            {t('nav.logoutConfirm.yes')}
          </Button>
          <Button variant="ghost" block onClick={onCancel}>
            {t('nav.logoutConfirm.no')}
          </Button>
        </div>
      </InlinePanel>
    </div>
  );
}
