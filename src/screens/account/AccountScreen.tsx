import { FileText, Globe } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../../app/AppShell';
import { LangSwitch } from '../../app/LangSwitch';
import { NAV, type Role } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { LEGAL_DOCS } from '../../lib/legal';
import { DataSection } from './DataSection';
import { IdentityCard } from './IdentityCard';
import { SecuritySection } from './SecuritySection';
import styles from './account.module.css';

const SUBTITLE: Record<Role, MessageKey> = {
  client: 'account.kind.client',
  shop: 'account.kind.shop',
  admin: 'account.kind.admin',
};

/**
 * Cont, the part every role shares (P13b): identity, language, email and password, legal
 * documents, my data, log out. Role tiles (shop settings, subscription, …) arrive with their tasks.
 */
export function AccountScreen({ role }: { role: Role }) {
  const { t } = useI18n();
  const session = useSession();
  const { logOut } = useOutletContext<ShellOutletContext>();
  if (!session.profile) return null;

  return (
    <div className={styles.page}>
      <h1>{t('nav.account')}</h1>
      <p className={styles.sub}>{t(SUBTITLE[role])}</p>

      <IdentityCard />

      <Card>
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            <Globe size={20} aria-hidden="true" />
            {t('account.language')}
          </span>
          <LangSwitch />
        </div>
      </Card>

      <SecuritySection />

      <h2 className={styles.section}>{t('account.legal')}</h2>
      <div className={styles.tiles}>
        {LEGAL_DOCS.map((doc) => (
          <Tile key={doc.id} to={`${NAV[role].account.path}/legal/${doc.id}`} icon={FileText} label={t(doc.titleKey)} />
        ))}
      </div>

      <DataSection />

      <div className={styles.mobileOnly}>
        <Button block onClick={() => void logOut()}>
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  );
}
