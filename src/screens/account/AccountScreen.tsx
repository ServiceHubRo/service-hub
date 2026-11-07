import { Bell, Building2, FileCheck, FileText, Heart, History, LifeBuoy, Lightbulb, QrCode, Settings, Star, Truck } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../../app/AppShell';
import { LogoutConfirm } from '../../app/LogoutConfirm';
import { isStaff, NAV, type Role } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { AnpcSal } from '../../components/AnpcSal';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { Section } from '../../components/Section';
import { SelectField } from '../../components/SelectField';
import { Tile } from '../../components/Tile';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import type { Lang } from '../../i18n/translate';
import { LEGAL_DOCS } from '../../lib/legal';
import { FAVORITES_PATH, MY_REPORTS_PATH, VEHICLE_HISTORY_PICK_PATH } from '../client/paths';
import { REVIEWS_PATH, SHOP_LINK_PATH } from '../shop/paths';
import { SETTINGS_PATH } from '../shop/settings/paths';
import { OwnerTiles } from '../shop/OwnerTiles';
import { DataSection } from './DataSection';
import { COMPANY_PATH, helpPath, notificationsPath, suggestionsPath } from './paths';
import { COMPANIES_PATH } from '../client/companies/paths';
import { useFleetVisible } from '../client/companies/useFleetVisible';
import { IdentityCard } from './IdentityCard';
import { InviteCard } from './InviteCard';
import { LocationRow } from './LocationRow';
import { ReminderRow } from './ReminderRow';
import { PhoneCard } from './PhoneCard';
import { SecuritySection } from './SecuritySection';
import styles from './account.module.css';

const SUBTITLE: Record<Role, MessageKey> = {
  client: 'account.kind.client',
  shop: 'account.kind.shop',
  admin: 'account.kind.admin',
  support: 'account.kind.support',
};

/**
 * Cont, the part every role shares (P13b): identity, language, push notifications on this device
 * (clients and shops, T12), email and password, legal documents, my data, log out. Clients also get Locație, Favorite (T06), "Istoricul mașinilor
 * mele" (T10), "Rapoartele mele" (T15) and "Invită un prieten" (T35); shops get the Setări and Recenzii tiles, and the owner Abonament (T14) and Rapoarte (T17). The admin's platform tools
 * (T16b) and the audit log (T16a) are in its five zones since A1 (src/app/adminZones.ts).
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
      <PageHeader title={t('nav.account')} subtitle={t(SUBTITLE[role])} />

      <Section title={t('account.sec.profile')} description={t('account.sec.profile.desc')}>
        <IdentityCard />
        {role === 'shop' && <PhoneCard />}
        {role === 'client' && (
          <>
            <LocationRow />
            <ReminderRow setting="share_history" />
          </>
        )}
      </Section>

      {/* The language, a preference of the person (Eduard, 6 Nov 2026): saved on the profile, so it
          follows them to every device and stays the same whichever workspace is open. */}
      <Section title={t('account.sec.prefs')}>
        <LanguagePreference />
      </Section>

      {/* The team's tools live in its own sections (admin: five zones, A1; agent: A2); its Cont is its own account. */}
      {!isStaff(role) && (
        <Section title={t('account.sec.tools')}>
          {role === 'client' && (
            <>
              <div className={styles.tiles} data-layout="tiles">
                <NotificationsTile role="client" />
                <Tile to={VEHICLE_HISTORY_PICK_PATH} icon={History} label={t('vh.title')} hint={t('vh.tileHint')} />
                <Tile to={MY_REPORTS_PATH} icon={FileCheck} label={t('reports.title')} hint={t('reports.tileHint')} />
                <Tile to={FAVORITES_PATH} icon={Heart} label={t('favorites.title')} hint={t('favorites.hint')} />
                <Tile to={COMPANY_PATH} icon={Building2} label={t('co.title')} hint={t('co.tileHint')} />
                <CompaniesTile />
              </div>
              <InviteCard />
            </>
          )}
          {role === 'shop' && (
            <div className={styles.tiles} data-layout="tiles">
              <NotificationsTile role="shop" />
              <Tile to={SETTINGS_PATH} icon={Settings} label={t('account.tile.settings')} />
              <Tile to={REVIEWS_PATH} icon={Star} label={t('reviews.title')} />
              <Tile to={SHOP_LINK_PATH} icon={QrCode} label={t('slk.title')} hint={t('slk.tileHint')} />
              <OwnerTiles />
            </div>
          )}
        </Section>
      )}

      <SecuritySection />

      {!isStaff(role) && (
        <Section title={t('help.title')} description={t('account.sec.help.desc')}>
          <div className={styles.tiles} data-layout="tiles">
            <Tile to={helpPath(role)} icon={LifeBuoy} label={t('help.title')} hint={t('help.tileHint')} />
            <Tile to={suggestionsPath(role)} icon={Lightbulb} label={t('sugg.title')} hint={t('sugg.tileHint')} />
          </div>
        </Section>
      )}

      <Section title={t('account.legal')}>
        <div className={styles.tiles} data-layout="tiles">
          {LEGAL_DOCS.map((doc) => (
            <Tile key={doc.id} to={`${NAV[role].account.path}/legal/${doc.id}`} icon={FileText} label={t(doc.titleKey)} />
          ))}
        </div>
        {!isStaff(role) && <AnpcSal />}
      </Section>

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

/**
 * Every notification setting in one place (Eduard, 26 Oct): push and the reminders for a client;
 * push, the new-booking sound and the summaries for a shop.
 */
/** Firmele mele (T63b): only where fleets are visible (test builds with the switch on). */
function CompaniesTile() {
  const { t } = useI18n();
  return useFleetVisible() ? <Tile to={COMPANIES_PATH} icon={Truck} label={t('cos.title')} hint={t('cos.tileHint')} /> : null;
}

function NotificationsTile({ role }: { role: 'client' | 'shop' }) {
  const { t } = useI18n();
  return <Tile to={notificationsPath(role)} icon={Bell} label={t('settings.notifications')} hint={t(`account.notifications.hint.${role}`)} />;
}

/** „Limba”: Română / English, each in its own language; the whole interface follows at once. */
function LanguagePreference() {
  const { t, lang } = useI18n();
  const { setLanguage } = useSession();
  return (
    <SelectField
      className={styles.prefSelect}
      label={t('lang.switch')}
      value={lang}
      onChange={(e) => setLanguage(e.target.value as Lang)}
      options={[
        { value: 'ro', label: t('lang.ro') },
        { value: 'en', label: t('lang.en') },
      ]}
    />
  );
}
