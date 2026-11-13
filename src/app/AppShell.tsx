import { CalendarDays, CarFront, LayoutDashboard, LogOut, ReceiptText, User, UserRound } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogoTile } from '../components/LogoTile';
import { Wordmark } from '../components/Wordmark';
import { useI18n } from '../i18n/context';
import { plural, type PluralUnit } from '../i18n/translate';
import { quotesWaiting } from '../lib/clientBookings';
import { motionOn } from '../lib/motion';
import { IS_NATIVE } from '../lib/native';
import { useScreenSlide } from '../lib/screenSlide';
import { useScrollMemory } from '../lib/scrollMemory';
import { useBumps } from '../lib/useBumps';
import { useOptionalAdminCounts } from '../screens/admin/adminContext';
import { ADMIN_ACTIVITY_PATH, ADMIN_MODERATION_PATH } from '../screens/admin/paths';
import { useOptionalClientBookings } from '../screens/client/bookings/clientBookingsContext';
import { BOOKINGS_PATH } from '../screens/client/paths';
import { useOptionalShopBookings } from '../screens/shop/bookings/shopBookingsContext';
import { SHOP_BOOKINGS_PATH } from '../screens/shop/paths';
import { messagesPath } from '../screens/messages/paths';
import { unreadThreads, useOptionalThreads } from '../screens/messages/threadsContext';
import { useOptionalNotices } from '../screens/notices/noticesContext';
import { PermissionsIntro } from '../screens/onboarding/PermissionsIntro';
import { EmailVerifyBanner } from './EmailVerifyBanner';
import { LogoutConfirm } from './LogoutConfirm';
import { PushBridge } from './PushBridge';
import { ScreenErrorBoundary } from './ScreenErrorBoundary';
import { isStaff, NAV, type NavItem, type Role } from './roles';
import type { MessageKey } from '../i18n/ro';
import { useSession } from './sessionContext';
import { TourHost } from './tour/TourHost';
import { useDocumentTitle } from './useDocumentTitle';
import { useOptionalWorkspace } from './workspace/workspaceContext';
import { WorkspaceSwitcher } from './workspace/WorkspaceSwitcher';
import { fleetSpacePath } from '../screens/client/companies/paths';
import styles from './AppShell.module.css';
import { markSigningOut } from '../lib/afterSignOut';

/**
 * The item's icon with its count bubble (the count is read out after the label). The bubble jumps
 * when the count grows (src/lib/motion.ts, badgePop).
 */
function NavIcon({ item, size, badge }: { item: NavItem; size: number; badge: number }) {
  const Icon = item.icon;
  const bumps = useBumps(badge);
  if (badge <= 0) return <Icon size={size} aria-hidden="true" />;
  const pop = bumps > 0 && motionOn('badgePop');
  return (
    <span className={styles.iconWrap}>
      <Icon size={size} aria-hidden="true" />
      <span key={bumps} className={`${styles.badge} ${pop ? styles.badgePop : ''}`} aria-hidden="true">
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
    <NavLink
      to={item.path}
      className={({ isActive }) => `${styles.sideLink} ${isActive ? styles.sideActive : ''}`}
      data-tour={item.path}
    >
      <NavIcon item={item} size={20} badge={badge?.count ?? 0} />
      <span>{t(item.labelKey)}</span>
      <BadgeText badge={badge} />
    </NavLink>
  );
}

/**
 * An admin zone in the sidebar (A1): the zone, and under it, while the zone is open, its
 * sub-sections — one level, the current one marked like the zone (tint, amber icon, bold).
 */
function SidebarZone({ item, badges }: { item: NavItem; badges: Record<string, Badge> }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const open = pathname === item.path || pathname.startsWith(`${item.path}/`);
  return (
    <>
      <SidebarLink item={item} badge={badges[item.path]} />
      {open && item.children && item.children.length > 0 && (
        <ul className={styles.sideSub} aria-label={t(item.labelKey)}>
          {item.children.map((child) => (
            <li key={child.path}>
              <NavLink
                to={child.path}
                className={({ isActive }) => `${styles.sideLink} ${styles.sideSubLink} ${isActive ? styles.sideActive : ''}`}
              >
                <NavIcon item={child} size={17} badge={badges[child.path]?.count ?? 0} />
                <span>{t(child.labelKey)}</span>
                <BadgeText badge={badges[child.path]} />
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A count on a navigation item and what it counts (read out after the label). */
interface Badge {
  count: number;
  unit: PluralUnit;
}

/**
 * Counts shown on navigation items: new booking requests on the shop's Programări, quotes waiting
 * for a decision on the client's, conversations with unread messages and new team notices on Mesaje
 * (both), reported
 * reviews waiting on the admin's Moderare.
 */
function useNavBadges(): Record<string, Badge> {
  const shopBookings = useOptionalShopBookings();
  const clientBookings = useOptionalClientBookings();
  const threads = useOptionalThreads();
  const notices = useOptionalNotices();
  const admin = useOptionalAdminCounts();
  const badges: Record<string, Badge> = {};
  if (admin?.pendingReports != null) {
    // On Moderare and on its zone, Activitate (A1), so the count shows whichever zone is open.
    badges[ADMIN_MODERATION_PATH] = { count: admin.pendingReports, unit: 'unit.reportsPending' };
    badges[ADMIN_ACTIVITY_PATH] = { count: admin.pendingReports, unit: 'unit.reportsPending' };
  }
  if (shopBookings?.state.status === 'ready') {
    const count = shopBookings.state.data.bookings.filter((b) => b.status === 'pending').length;
    badges[SHOP_BOOKINGS_PATH] = { count, unit: 'unit.newRequests' };
  }
  if (clientBookings?.state.status === 'ready') {
    badges[BOOKINGS_PATH] = { count: quotesWaiting(clientBookings.state.data.bookings), unit: 'unit.quotesToDecide' };
  }
  if (threads?.state.status === 'ready') {
    // The team's conversation (its notices, at the top of Mesaje) counts like the others.
    const team = (notices?.unread ?? 0) > 0 ? 1 : 0;
    badges[messagesPath(threads.side)] = {
      count: unreadThreads(threads.state.data.threads) + team,
      unit: 'unit.unreadConversations',
    };
  }
  return badges;
}

/** A company space's five pages (T65): the rarer ones are tiles in its Cont. */
const COMPANY_NAV: { section: string; icon: NavItem['icon'] }[] = [
  { section: 'panou', icon: LayoutDashboard },
  { section: 'vehicule', icon: CarFront },
  { section: 'programari', icon: CalendarDays },
  { section: 'costuri', icon: ReceiptText },
  { section: 'cont', icon: UserRound },
];

/** The nav item a fleet page belongs to: a vehicle to Vehicule, the Cont tiles to Cont. */
function companyNavOf(section: string | null): string {
  if (section === 'vehicul') return 'vehicule';
  if (section === 'rapoarte' || section === 'membri' || section === 'abonament') return 'cont';
  return section ?? 'panou';
}

interface CompanyLink {
  key: string;
  to: string;
  label: MessageKey;
  short: MessageKey;
  icon: NavItem['icon'];
  active: boolean;
}

function useCompanyNav(): CompanyLink[] | null {
  const ws = useOptionalWorkspace();
  const { search } = useLocation();
  if (ws?.active.kind !== 'company') return null;
  const base = fleetSpacePath(ws.active.id);
  const current = companyNavOf(new URLSearchParams(search).get('sectiune'));
  return COMPANY_NAV.map(({ section, icon }) => ({
    key: section,
    to: `${base}?sectiune=${section}`,
    label: `fleet.nav.${section}` as MessageKey,
    short: `fleet.nav.${section}Short` as MessageKey,
    icon,
    active: current === section,
  }));
}

/** A company page in the sidebar or the bottom bar (the section is in the address, not the path). */
function CompanyNavLink({ item, variant }: { item: CompanyLink; variant: 'side' | 'tab' }) {
  const { t } = useI18n();
  const Icon = item.icon;
  if (variant === 'side') {
    return (
      <Link to={item.to} className={`${styles.sideLink} ${item.active ? styles.sideActive : ''}`} aria-current={item.active ? 'page' : undefined}>
        <Icon size={20} aria-hidden="true" />
        <span>{t(item.label)}</span>
      </Link>
    );
  }
  return (
    <Link to={item.to} className={`${styles.tab} ${item.active ? styles.tabActive : ''}`} aria-current={item.active ? 'page' : undefined}>
      <Icon size={21} aria-hidden="true" />
      <span className={styles.tabLabel}>{t(item.short)}</span>
    </Link>
  );
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
  const contentRef = useRef<HTMLDivElement>(null);
  useScreenSlide(contentRef);
  const badges = useNavBadges();
  // In a company's space the navigation is the company's (T65); everything else stays the role's.
  const companyNav = useCompanyNav();
  // The tab title follows the navigation item the screen belongs to (Cont for its tiles).
  // An admin sub-section names the tab, not its zone (A1).
  const under = (item: NavItem) => pathname === item.path || pathname.startsWith(`${item.path}/`);
  const current = nav.main.flatMap((item) => item.children ?? []).find(under) ?? [...nav.main, nav.account].find(under);
  useDocumentTitle(current ? t(current.labelKey) : null);

  // The page scrolls: a new screen starts at the top, going back finds it where it was.
  useScrollMemory();

  // The header (top) and the tab bar (bottom) stay over the scrolling page: their heights, for what
  // sticks under them and for what is scrolled into view (0 where they are hidden, e.g. a laptop).
  const headerRef = useRef<HTMLElement>(null);
  const tabBarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const measure = () => {
      root.style.setProperty('--nav-top', `${headerRef.current?.offsetHeight ?? 0}px`);
      // The bar stepped aside for the phone's keyboard (src/lib/keyboard.ts): its height is kept, so
      // the page does not get shorter under the field, nor longer again when the keyboard closes.
      const bar = tabBarRef.current?.offsetHeight ?? 0;
      if (bar === 0 && root.hasAttribute('data-keyboard') && root.style.getPropertyValue('--nav-bottom')) return;
      root.style.setProperty('--nav-bottom', `${bar}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const el of [headerRef.current, tabBarRef.current]) if (el && observer) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--nav-top');
      root.style.removeProperty('--nav-bottom');
    };
  }, []);


  // Keyboard users jump past the navigation straight to the screen (T18).
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    mainRef.current?.focus();
  }

  // „Deconectare” in the sidebar asks first (LogoutConfirm); „Rămân” gives the focus back.
  const [askLogout, setAskLogout] = useState(false);
  const logoutRef = useRef<HTMLButtonElement>(null);
  const cancelLogout = useCallback(() => {
    setAskLogout(false);
    requestAnimationFrame(() => logoutRef.current?.focus());
  }, []);

  // Leave first, then end the session: otherwise the role guard would send us to sign-in.
  async function logOut() {
    markSigningOut();
    navigate('/', { replace: true, state: { leaving: true } });
    await signOut();
  }

  return (
    <div className={styles.shell} data-role={role}>
      {/* The phone app's first start asks for the permissions one by one (on the site: the banners). */}
      {IS_NATIVE && <PermissionsIntro role={role} />}
      {/* The short tour of the main features, once per account (T39). */}
      {!isStaff(role) && <TourHost role={role} />}
      <a href="#continut" className={styles.skipLink} onClick={skipToContent}>
        {t('nav.skipToContent')}
      </a>
      <header ref={headerRef} className={styles.header} data-fixed-top>
        {/* One row (Eduard, 6 Nov 2026): the logo left; right, a client's workspace switch (the admin's
            Cont). The language is a preference in Cont now, not in the header. */}
        <div className={styles.headerRow}>
          <LogoTile />
          <Wordmark />
          <div className={styles.headerEnd}>
            {role === 'client' && <WorkspaceSwitcher placement="header" />}
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
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <LogoTile size={32} />
            <Wordmark size={19} />
          </div>
          {role === 'client' && <WorkspaceSwitcher placement="sidebar" />}
          <nav className={styles.sideNav} aria-label={t('nav.main')}>
            {companyNav
              ? companyNav.slice(0, 4).map((item) => <CompanyNavLink key={item.key} item={item} variant="side" />)
              : nav.main.map((item) =>
                  item.children ? (
                    <SidebarZone key={item.path} item={item} badges={badges} />
                  ) : (
                    <SidebarLink key={item.path} item={item} badge={badges[item.path]} />
                  ),
                )}
          </nav>
          <div className={styles.sideBottom}>
            {companyNav ? <CompanyNavLink item={companyNav[4]!} variant="side" /> : <SidebarLink item={nav.account} />}
            {askLogout ? (
              <div className={styles.sideConfirm}>
                <LogoutConfirm onConfirm={() => void logOut()} onCancel={cancelLogout} />
              </div>
            ) : (
              <button
                ref={logoutRef}
                type="button"
                className={`${styles.sideLink} ${styles.logout}`}
                onClick={() => setAskLogout(true)}
              >
                <LogOut size={20} aria-hidden="true" />
                <span>{t('nav.logout')}</span>
              </button>
            )}
          </div>
        </aside>

        <main className={styles.main} ref={mainRef} id="continut" tabIndex={-1}>
          <div ref={contentRef} className={styles.content}>
            <EmailVerifyBanner role={role} />
            {!isStaff(role) && <PushBridge />}
            <ScreenErrorBoundary resetKey={pathname}>
              <Outlet context={{ logOut } satisfies ShellOutletContext} />
            </ScreenErrorBoundary>
          </div>
        </main>
      </div>

      <nav ref={tabBarRef} className={`${styles.bottomBar} ${motionOn('tabBounce') ? styles.bounce : ''}`} aria-label={t('nav.main')} data-fixed-bottom>
        {companyNav?.map((item) => <CompanyNavLink key={item.key} item={item} variant="tab" />)}
        {!companyNav && nav.bottomBar.map((item) => {
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
              data-tour={item.path}
            >
              <NavIcon item={item} size={21} badge={badges[item.path]?.count ?? 0} />
              <span className={styles.tabLabel}>{t(item.shortLabelKey ?? item.labelKey)}</span>
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
