import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { OfflineBar } from '../components/OfflineBar';
import { I18nProvider } from '../i18n/I18nProvider';
import { IS_TEST_BUILD } from '../lib/env';
import { addBreadcrumb, safePath } from '../lib/monitoring';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { CheckEmail } from '../screens/auth/CheckEmail';
import { ForgotPassword } from '../screens/auth/ForgotPassword';
import { InviteScreen } from '../screens/auth/InviteScreen';
import { NewPassword } from '../screens/auth/NewPassword';
import { Landing } from '../screens/public/Landing';
import { NotFound } from '../screens/public/NotFound';
import { PublicOnly, RoleGuard } from './RoleGuard';
import { NAV, type Role } from './roles';
import { ChunkBoundary } from './routes/ChunkBoundary';
import { lazyChunk } from './routes/lazyChunk';
import { SchemaBar } from './SchemaBar';
import { ScreenErrorBoundary } from './ScreenErrorBoundary';
import { SessionProvider } from './SessionProvider';
import styles from './App.module.css';

// Each role's screens are a file of their own, loaded after sign-in (T18): a client never
// downloads the shop's or the admin's code, and the public page stays small.
const ROLE_APPS: Record<Role, ReturnType<typeof lazyChunk>> = {
  client: lazyChunk(() => import('./routes/ClientApp')),
  shop: lazyChunk(() => import('./routes/ShopApp')),
  admin: lazyChunk(() => import('./routes/AdminApp')),
};
const PublicLegal = lazyChunk(() => import('../screens/legal/LegalPages').then((m) => ({ default: m.PublicLegal })));
const VerifyScreen = lazyChunk(() => import('../screens/public/VerifyScreen').then((m) => ({ default: m.VerifyScreen })));
const ComponentGallery = lazyChunk(() =>
  import('../screens/dev/ComponentGallery').then((m) => ({ default: m.ComponentGallery })),
);

function roleRoutes(role: Role) {
  const RoleApp = ROLE_APPS[role];
  return (
    <Route element={<RoleGuard role={role} />}>
      <Route
        path={`${NAV[role].base}/*`}
        element={
          <ChunkBoundary>
            <RoleApp />
          </ChunkBoundary>
        }
      />
    </Route>
  );
}

/**
 * Every screen: a message instead of an empty page if one breaks (T19), and the screens visited
 * remembered for the error report (addresses without tokens, in memory only).
 */
function RouteGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  useEffect(() => {
    addBreadcrumb('navigation', safePath(window.location.href));
  }, [location.pathname, location.search]);
  return (
    <ScreenErrorBoundary resetKey={location.pathname} fullScreen>
      {children}
    </ScreenErrorBoundary>
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
            <RouteGuard>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route element={<PublicOnly />}>
                  <Route path="/intra" element={<AuthScreen tab="signin" />} />
                  <Route path="/cont-nou" element={<AuthScreen tab="signup" />} />
                  <Route path="/confirma-email" element={<CheckEmail />} />
                  <Route path="/parola-uitata" element={<ForgotPassword />} />
                </Route>
                <Route path="/parola-noua" element={<NewPassword />} />
                <Route path="/invitatie/:token" element={<InviteScreen />} />
                <Route
                  path="/legal/:doc"
                  element={
                    <ChunkBoundary>
                      <PublicLegal />
                    </ChunkBoundary>
                  }
                />
                <Route
                  path="/verifica"
                  element={
                    <ChunkBoundary>
                      <VerifyScreen />
                    </ChunkBoundary>
                  }
                />
                {IS_TEST_BUILD && (
                  <Route
                    path="/dev/componente"
                    element={
                      <ChunkBoundary>
                        <ComponentGallery />
                      </ChunkBoundary>
                    }
                  />
                )}
                {roleRoutes('client')}
                {roleRoutes('shop')}
                {roleRoutes('admin')}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RouteGuard>
          </div>
        </BrowserRouter>
      </SessionProvider>
    </I18nProvider>
  );
}
