import { useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../app/AppShell';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/ro';
import styles from './Placeholder.module.css';

/** Empty screen with only its title, until the screen's own task builds it. */
export function Placeholder({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useI18n();
  return <h1>{t(titleKey)}</h1>;
}

/** Cont placeholder. On mobile, Deconectare lives here (on desktop it is in the sidebar). */
export function AccountPlaceholder() {
  const { t } = useI18n();
  const { logOut } = useOutletContext<ShellOutletContext>();
  return (
    <>
      <h1>{t('nav.account')}</h1>
      <div className={styles.mobileOnly}>
        <Button variant="danger" block onClick={logOut}>
          {t('nav.logout')}
        </Button>
      </div>
    </>
  );
}
