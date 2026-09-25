import { FileText, Globe, Heart, History, Settings, Star } from 'lucide-react';
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
import { FAVORITES_PATH, VEHICLE_HISTORY_PICK_PATH } from '../client/paths';
import { REVIEWS_PATH } from '../shop/paths';
import { SETTINGS_PATH } from '../shop/settings/paths';
import { DataSection } from './DataSection';
import { IdentityCard } from './IdentityCard';
import { LocationRow } from './LocationRow';
import { PhoneCard } from './PhoneCard';
import { PushRow } from '../push/PushRow';
import { SecuritySection } from './SecuritySection';
import styles from './account.module.css';

const SUBTITLE: Record<Role, MessageKey> = {
  client: 'account.kind.client',
  shop: 'account.kind.shop',
  admin: 'account.kind.admin',
};

/**
 * Cont, the part every role shares (P13b): identity, language, push notifications on this device
 * (clients and shops, T12), email and password, legal documents, my data, log out. Clients also get Locație, Favorite (T06) and "Istoricul mașinilor
 * mele" (T10); shops get the Setări and Recenzii tiles; Abonament and Rapoarte arrive with their
 * tasks.
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
      {role === 'shop' && <PhoneCard />}

      <Card>
        <div className={styles.row}>
          <span className={styles.rowLabel}>
            <Globe size={20} aria-hidden="true" />
            {t('account.language')}
          </span>
          <LangSwitch />
        </div>
      </Card>

      {role !== 'admin' && <PushRow />}

      {role === 'client' && (
        <>
          <LocationRow />
          <div className={styles.tiles}>
            <Tile to={VEHICLE_HISTORY_PICK_PATH} icon={History} label={t('vh.title')} hint={t('vh.tileHint')} />
            <Tile to={FAVORITES_PATH} icon={Heart} label={t('favorites.title')} hint={t('favorites.hint')} />
          </div>
        </>
      )}

      {role === 'shop' && (
        <div className={styles.tiles}>
          <Tile to={SETTINGS_PATH} icon={Settings} label={t('account.tile.settings')} />
          <Tile to={REVIEWS_PATH} icon={Star} label={t('reviews.title')} />
        </div>
      )}

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
