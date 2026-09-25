import { LogOut, User } from 'lucide-react';
import { useRef, useEffect, type MouseEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogoTile } from '../components/LogoTile';
import { Wordmark } from '../components/Wordmark';
import { useI18n } from '../i18n/context';
import { plural, type PluralUnit } from '../i18n/translate';
import { quotesWaiting } from '../lib/clientBookings';
import { useOptionalAdminCounts } from '../screens/admin/adminContext';
import { ADMIN_MODERATION_PATH } from '../screens/admin/paths';
import { useOptionalClientBookings } from '../screens/client/bookings/clientBookingsContext';
import { BOOKINGS_PATH } from '../screens/client/paths';
import { useOptionalShopBookings } from '../screens/shop/bookings/shopBookingsContext';
import { SHOP_BOOKINGS_PATH } from '../screens/shop/paths';
import { messagesPath } from '../screens/messages/paths';
import { unreadThreads, useOptionalThreads } from '../screens/messages/threadsContext';
import { EmailVerifyBanner } from './EmailVerifyBanner';
import { LangSwitch } from './LangSwitch';
import { PushBridge } from './PushBridge';
import { ScreenErrorBoundary } from './ScreenErrorBoundary';
import { NAV, type NavItem, type Role } from './roles';
import { useSession } from './sessionContext';
import { useDocumentTitle } from './useDocumentTitle';
import styles from './AppShell.module.css';

/** The item's icon with its count bubble (the count is read out after the label). */
function NavIcon({ item, size, badge }: { item: NavItem; size: number; badge: number }) {
  const Icon = item.icon;
  if (badge <= 0) return <Icon size={size} aria-hidden="true" />;
  return (
    <span className={styles.iconWrap}>
      <Icon size={size} aria-hidden="true" />
      <span className={styles.badge} aria-hidden="true">
        {badge > 99 ? '99+' : badge}
      </span>
    </span>
  );
}

/** ", 3 cereri noi" for screen readers, after the item's label. */
function BadgeText({ badge }: { badge: Badge | undefined }) {
  const { lang } = useI18n();
  return badge && badge.count > 0 ? <span className="visually-hidden">, {plural(lang, badge.unit, badge.count)}</span> : null;
}

function SidebarLink({ item, badge }: { item: NavItem; badge?: Badge }) {
  const { t } = useI18n();
  return (
    <NavLink to={item.path} className={({ isActive }) => `${styles.sideLink} ${isActive ? styles.sideActive : ''}`}>
      <NavIcon item={item} size={20} badge={badge?.count ?? 0} />
      <span>{t(item.labelKey)}</span>
      <BadgeText badge={badge} />
    </NavLink>
  );
}

/** A count on a navigation item and what it counts (read out after the label). */
interface Badge {
  count: number;
  unit: PluralUnit;
}

/**
 * Counts shown on navigation items: new booking requests on the shop's Programări, quotes waiting
 * for a decision on the client's, conversations with unread messages on Mesaje (both), reported
 * reviews waiting on the admin's Moderare.
 */
function useNavBadges(): Record<string, Badge> {
  const shopBookings = useOptionalShopBookings();
  const clientBookings = useOptionalClientBookings();
  const threads = useOptionalThreads();
  const admin = useOptionalAdminCounts();
  const badges: Record<string, Badge> = {};
  if (admin?.pendingReports != null) {
    badges[ADMIN_MODERATION_PATH] = { count: admin.pendingReports, unit: 'unit.reportsPending' };
  }
  if (shopBookings?.state.status === 'ready') {
    const count = shopBookings.state.data.bookings.filter((b) => b.status === 'pending').length;
    badges[SHOP_BOOKINGS_PATH] = { count, unit: 'unit.newRequests' };
  }
  if (clientBookings?.state.status === 'ready') {
    badges[BOOKINGS_PATH] = { count: quotesWaiting(clientBookings.state.data.bookings), unit: 'unit.quotesToDecide' };
  }
  if (threads?.state.status === 'ready') {
    badges[messagesPath(threads.side)] = { count: unreadThreads(threads.state.data.threads), unit: 'unit.unreadConversations' };
  }
  return badges;
}

/**
 * Role shell (ARCHITECTURE §17): header + scrolling content + 5-item bottom bar below 1024 px;
 * fixed 240 px sidebar with Cont and Deconectare pinned at the bottom from 1024 px.
 */
export function AppShell({ role }: { role: Role }) {
  const { t } = useI18n();
  const { signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nav = NAV[role];
  const mainRef = useRef<HTMLElement>(null);
  const badges = useNavBadges();
  // The tab title follows the navigation item the screen belongs to (Cont for its tiles).
  const current = [...nav.main, nav.account].find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
  useDocumentTitle(current ? t(current.labelKey) : null);

  // A new screen starts at the top; only the content area scrolls.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  // Keyboard users jump past the navigation straight to the screen (T18).
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  // Leave first, then end the session: otherwise the role guard would send us to sign-in.
  async function logOut() {
    navigate('/', { replace: true, state: { leaving: true } });
    await signOut();
  }

  return (
    <div className={styles.shell} data-role={role}>
      <a href="#continut" className={styles.skipLink} onClick={skipToContent}>
        {t('nav.skipToContent')}
      </a>
      <header className={styles.header}>
        <LogoTile />
        <Wordmark />
        <div className={styles.headerEnd}>
          <LangSwitch />
          {role === 'admin' && (
            <NavLink
              to={nav.account.path}
              className={({ isActive }) => `${styles.iconLink} ${isActive ? styles.iconActive : ''}`}
              aria-label={t('nav.account')}
            >
              <User size={20} aria-hidden="true" />
            </NavLink>
          )}
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <LogoTile size={32} />
            <Wordmark size={19} />
          </div>
          <nav className={styles.sideNav} aria-label={t('nav.main')}>
            {nav.main.map((item) => (
              <SidebarLink key={item.path} item={item} badge={badges[item.path]} />
            ))}
          </nav>
          <div className={styles.sideBottom}>
            <div className={styles.sideLang}>
              <LangSwitch />
            </div>
            <SidebarLink item={nav.account} />
            <button type="button" className={`${styles.sideLink} ${styles.logout}`} onClick={() => void logOut()}>
              <LogOut size={20} aria-hidden="true" />
              <span>{t('nav.logout')}</span>
            </button>
          </div>
        </aside>

        <main className={styles.main} ref={mainRef} id="continut" tabIndex={-1}>
          <div className={styles.content}>
            <EmailVerifyBanner role={role} />
            {role !== 'admin' && <PushBridge />}
            <ScreenErrorBoundary resetKey={pathname}>
              <Outlet context={{ logOut } satisfies ShellOutletContext} />
            </ScreenErrorBoundary>
          </div>
        </main>
      </div>

      <nav className={styles.bottomBar} aria-label={t('nav.main')}>
        {nav.bottomBar.map((item) => {
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              <NavIcon item={item} size={21} badge={badges[item.path]?.count ?? 0} />
              <span className={styles.tabLabel}>{t(item.labelKey)}</span>
              <BadgeText badge={badges[item.path]} />
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

export interface ShellOutletContext {
  logOut: () => Promise<void>;
}
