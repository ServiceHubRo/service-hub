import { Link, Navigate, useParams } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { NAV, type Role } from '../../app/roles';
import { BackLink } from '../../components/BackLink';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import { isLegalDocId, LEGAL_DOCS } from '../../lib/legal';
import { LegalDocument } from './LegalDocument';
import styles from './LegalPages.module.css';

/** Inside Cont: replaces the screen content, with a back link (P13b). */
export function AccountLegal({ role }: { role: Role }) {
  const { t } = useI18n();
  const { doc } = useParams();
  const accountPath = NAV[role].account.path;
  if (!isLegalDocId(doc)) return <Navigate to={accountPath} replace />;
  const title = LEGAL_DOCS.find((d) => d.id === doc)!.titleKey;
  return (
    <div className={styles.inApp}>
      <BackLink to={accountPath} label={t('nav.account')} />
      <LegalDocument id={doc} title={t(title)} />
    </div>
  );
}

/** Public, without an account: /legal/termeni, /legal/confidentialitate, /legal/cookies. */
export function PublicLegal() {
  const { t } = useI18n();
  const { doc } = useParams();
  if (!isLegalDocId(doc)) return <Navigate to="/" replace />;
  const title = LEGAL_DOCS.find((d) => d.id === doc)!.titleKey;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label={t('app.title')}>
          <LogoTile size={28} />
          <Wordmark size={19} />
        </Link>
        <LangSwitch />
      </header>
      <main className={styles.content}>
        <BackLink to="/" />
        <LegalDocument id={doc} title={t(title)} />
      </main>
    </div>
  );
}
