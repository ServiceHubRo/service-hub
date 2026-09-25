import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { useSession } from '../../app/sessionContext';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { buttonClass } from '../../components/buttonClass';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import legal from '../legal/LegalPages.module.css';
import styles from './NotFound.module.css';

/**
 * An address that does not exist (T18). Inside a role's app it stays in the shell with a way back
 * to that role's home; anywhere else it is a public page. `/` sends signed-in users home.
 */
export function NotFound({ inShell = false }: { inShell?: boolean }) {
  const { t } = useI18n();
  const session = useSession();
  useDocumentTitle(t('notFound.title'));
  const signedIn = session.status === 'signedIn' && session.role !== null;

  const body = (
    <div className={styles.body}>
      <span className={styles.icon} aria-hidden="true">
        <MapPinOff size={30} />
      </span>
      <h1>{t('notFound.title')}</h1>
      <p className={styles.text}>{t('notFound.text')}</p>
      <Link to="/" className={buttonClass('primary')}>
        {signedIn ? t('notFound.appHome') : t('notFound.home')}
      </Link>
    </div>
  );

  if (inShell) return body;
  return (
    <div className={legal.page}>
      <div className="status-backdrop" aria-hidden="true" />
      <header className={legal.header}>
        <Link to="/" className={legal.brand} aria-label={t('app.title')}>
          <LogoTile size={28} />
          <Wordmark size={19} />
        </Link>
        <LangSwitch />
      </header>
      <main className={styles.main}>{body}</main>
    </div>
  );
}
