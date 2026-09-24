import { LogOut, User } from 'lucide-react';
import { useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogoTile } from '../components/LogoTile';
import { Wordmark } from '../components/Wordmark';
import { useI18n } from '../i18n/context';
import { EmailVerifyBanner } from './EmailVerifyBanner';
import { LangSwitch } from './LangSwitch';
import { NAV, type NavItem, type Role } from './roles';
import { useSession } from './sessionContext';
import styles from './AppShell.module.css';

function SidebarLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  const Icon = item.icon;
  return (
    <NavLink to={item.path} className={({ isActive }) => `${styles.sideLink} ${isActive ? styles.sideActive : ''}`}>
      <Icon size={20} aria-hidden="true" />
      <span>{t(item.labelKey)}</span>
    </NavLink>
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

  // A new screen starts at the top; only the content area scrolls.
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  // Leave first, then end the session: otherwise the role guard would send us to sign-in.
  async function logOut() {
    navigate('/', { replace: true, state: { leaving: true } });
    await signOut();
  }

  return (
    <div className={styles.shell} data-role={role}>
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
              <SidebarLink key={item.path} item={item} />
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

        <main className={styles.main} ref={mainRef}>
          <div className={styles.content}>
            <EmailVerifyBanner role={role} />
            <Outlet context={{ logOut } satisfies ShellOutletContext} />
          </div>
        </main>
      </div>

      <nav className={styles.bottomBar} aria-label={t('nav.main')}>
        {nav.bottomBar.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
            >
              <Icon size={21} aria-hidden="true" />
              <span className={styles.tabLabel}>{t(item.labelKey)}</span>
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
