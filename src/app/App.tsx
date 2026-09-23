import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBar } from '../components/OfflineBar';
import { I18nProvider } from '../i18n/I18nProvider';
import { IS_TEST_BUILD } from '../lib/env';
import { ComponentGallery } from '../screens/dev/ComponentGallery';
import { AccountPlaceholder, Placeholder } from '../screens/Placeholder';
import { Landing } from '../screens/public/Landing';
import { AppShell } from './AppShell';
import { DevRoleFromUrl } from './DevRoleFromUrl';
import { RoleGuard } from './RoleGuard';
import { NAV, homeOf, type Role } from './roles';
import { SchemaBar } from './SchemaBar';
import { SessionProvider } from './SessionProvider';
import styles from './App.module.css';

function roleRoutes(role: Role) {
  const nav = NAV[role];
  return (
    <Route element={<RoleGuard role={role} />}>
      <Route element={<AppShell role={role} />}>
        {nav.main.map((item) => (
          <Route key={item.path} path={item.path} element={<Placeholder titleKey={item.labelKey} />} />
        ))}
        <Route path={nav.account.path} element={<AccountPlaceholder />} />
        <Route path={`${nav.base}/*`} element={<Navigate to={homeOf(role)} replace />} />
      </Route>
    </Route>
  );
}

export function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <BrowserRouter>
          <div className={styles.app}>
            <OfflineBar />
            <SchemaBar />
            <DevRoleFromUrl />
            <Routes>
              <Route path="/" element={<Landing />} />
              {IS_TEST_BUILD && <Route path="/dev/componente" element={<ComponentGallery />} />}
              {roleRoutes('client')}
              {roleRoutes('shop')}
              {roleRoutes('admin')}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}
