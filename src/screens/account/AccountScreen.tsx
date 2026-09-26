import { CreditCard, Download, FileCheck, FileText, Globe, Heart, History, LifeBuoy, ListTree, Megaphone, ScrollText, Settings, SlidersHorizontal, Star } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../../app/AppShell';
import { LangSwitch } from '../../app/LangSwitch';
import { LogoutConfirm } from '../../app/LogoutConfirm';
import { NAV, type Role } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { LEGAL_DOCS } from '../../lib/legal';
import {
  ADMIN_AUDIT_PATH,
  ADMIN_CATALOG_PATH,
  ADMIN_EXPORT_PATH,
  ADMIN_NOTICES_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_SETTINGS_PATH,
  ADMIN_SUBSCRIPTIONS_PATH,
} from '../admin/paths';
import { FAVORITES_PATH, MY_REPORTS_PATH, VEHICLE_HISTORY_PICK_PATH } from '../client/paths';
import { REVIEWS_PATH } from '../shop/paths';
import { SETTINGS_PATH } from '../shop/settings/paths';
import { OwnerTiles } from '../shop/OwnerTiles';
import { DataSection } from './DataSection';
import { helpPath } from './paths';
import { IdentityCard } from './IdentityCard';
import { LocationRow } from './LocationRow';
import { ReminderRow } from './ReminderRow';
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
 * (clients and shops, T12), email and password, legal documents, my data, log out. Clients also get Locație, Favorite (T06), "Istoricul mașinilor
 * mele" (T10) and "Rapoartele mele" (T15); shops get the Setări and Recenzii tiles, and the owner Abonament (T14) and Rapoarte (T17); the admin gets the platform tools (T16b) and the audit log
 * (T16a).
 */
export function AccountScreen({ role }: { role: Role }) {
  const { t } = useI18n();
  const session = useSession();
  const { logOut } = useOutletContext<ShellOutletContext>();
  // „Deconectare” asks first (LogoutConfirm); „Rămân” gives the focus back to the button.
  const [askLogout, setAskLogout] = useState(false);
  const logoutRef = useRef<HTMLButtonElement>(null);
  const cancelLogout = useCallback(() => {
    setAskLogout(false);
    requestAnimationFrame(() => logoutRef.current?.focus());
  }, []);
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
          <ReminderRow setting="review_requests" />
          <ReminderRow setting="service_reminders" />
          <div className={styles.tiles}>
            <Tile to={VEHICLE_HISTORY_PICK_PATH} icon={History} label={t('vh.title')} hint={t('vh.tileHint')} />
            <Tile to={MY_REPORTS_PATH} icon={FileCheck} label={t('reports.title')} hint={t('reports.tileHint')} />
            <Tile to={FAVORITES_PATH} icon={Heart} label={t('favorites.title')} hint={t('favorites.hint')} />
          </div>
        </>
      )}

      {role === 'shop' && (
        <div className={styles.tiles}>
          <Tile to={SETTINGS_PATH} icon={Settings} label={t('account.tile.settings')} />
          <Tile to={REVIEWS_PATH} icon={Star} label={t('reviews.title')} />
          <OwnerTiles />
        </div>
      )}

      {role === 'admin' && (
        <div className={styles.tiles}>
          <Tile to={ADMIN_SUBSCRIPTIONS_PATH} icon={CreditCard} label={t('admin.subs.title')} hint={t('admin.subs.tileHint')} />
          <Tile to={ADMIN_REPORTS_PATH} icon={FileCheck} label={t('admin.reports.title')} hint={t('admin.reports.tileHint')} />
          <Tile to={ADMIN_CATALOG_PATH} icon={ListTree} label={t('admin.catalog.title')} hint={t('admin.catalog.tileHint')} />
          <Tile to={ADMIN_SETTINGS_PATH} icon={SlidersHorizontal} label={t('admin.settings.title')} hint={t('admin.settings.tileHint')} />
          <Tile to={ADMIN_NOTICES_PATH} icon={Megaphone} label={t('admin.notices.title')} hint={t('admin.notices.tileHint')} />
          <Tile to={ADMIN_EXPORT_PATH} icon={Download} label={t('admin.export.title')} hint={t('admin.export.tileHint')} />
          <Tile to={ADMIN_AUDIT_PATH} icon={ScrollText} label={t('admin.audit.title')} hint={t('admin.audit.tileHint')} />
        </div>
      )}

      <SecuritySection />

      {role !== 'admin' && (
        <>
          <h2 className={styles.section}>{t('help.title')}</h2>
          <div className={styles.tiles}>
            <Tile to={helpPath(role)} icon={LifeBuoy} label={t('help.title')} hint={t('help.tileHint')} />
          </div>
        </>
      )}

      <h2 className={styles.section}>{t('account.legal')}</h2>
      <div className={styles.tiles}>
        {LEGAL_DOCS.map((doc) => (
          <Tile key={doc.id} to={`${NAV[role].account.path}/legal/${doc.id}`} icon={FileText} label={t(doc.titleKey)} />
        ))}
      </div>

      <DataSection />

      <div className={styles.mobileOnly}>
        {askLogout ? (
          <LogoutConfirm onConfirm={() => void logOut()} onCancel={cancelLogout} />
        ) : (
          <Button ref={logoutRef} block onClick={() => setAskLogout(true)}>
            {t('nav.logout')}
          </Button>
        )}
      </div>
    </div>
  );
}
