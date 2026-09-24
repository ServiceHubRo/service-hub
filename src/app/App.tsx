import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBar } from '../components/OfflineBar';
import { I18nProvider } from '../i18n/I18nProvider';
import { IS_TEST_BUILD } from '../lib/env';
import { AccountScreen } from '../screens/account/AccountScreen';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { BookingFlow } from '../screens/client/booking/BookingFlow';
import { BookingSent } from '../screens/client/booking/BookingSent';
import { ClientBookingsScreen } from '../screens/client/bookings/ClientBookingsScreen';
import { FavoritesScreen } from '../screens/client/favorites/FavoritesScreen';
import { CarFormScreen } from '../screens/client/garage/CarFormScreen';
import { GarageScreen } from '../screens/client/garage/GarageScreen';
import { SearchScreen } from '../screens/client/search/SearchScreen';
import { ShopPage } from '../screens/client/shop/ShopPage';
import { CheckEmail } from '../screens/auth/CheckEmail';
import { ForgotPassword } from '../screens/auth/ForgotPassword';
import { InviteScreen } from '../screens/auth/InviteScreen';
import { NewPassword } from '../screens/auth/NewPassword';
import { ComponentGallery } from '../screens/dev/ComponentGallery';
import { AccountLegal, PublicLegal } from '../screens/legal/LegalPages';
import { Placeholder } from '../screens/Placeholder';
import { Landing } from '../screens/public/Landing';
import { Dashboard } from '../screens/shop/dashboard/Dashboard';
import { BillingSettings } from '../screens/shop/settings/BillingSettings';
import { HoursSettings } from '../screens/shop/settings/HoursSettings';
import { NotificationSettings } from '../screens/shop/settings/NotificationSettings';
import { SETTINGS_PATH } from '../screens/shop/settings/paths';
import { ProfileSettings } from '../screens/shop/settings/ProfileSettings';
import { RulesSettings } from '../screens/shop/settings/RulesSettings';
import { ServicesSettings } from '../screens/shop/settings/ServicesSettings';
import { SettingsIndex } from '../screens/shop/settings/SettingsIndex';
import { ShopSettingsLayout } from '../screens/shop/settings/ShopSettingsLayout';
import { StaffSettings } from '../screens/shop/settings/StaffSettings';
import { ShopBookingsProvider } from '../screens/shop/bookings/ShopBookingsProvider';
import { ShopBookingsScreen } from '../screens/shop/bookings/ShopBookingsScreen';
import { AppShell } from './AppShell';
import { PublicOnly, RoleGuard } from './RoleGuard';
import { NAV, homeOf, type Role } from './roles';
import { SchemaBar } from './SchemaBar';
import { SessionProvider } from './SessionProvider';
import styles from './App.module.css';

/** Screens built so far; the other navigation items show only their title until their task. */
const SCREENS: Record<string, ReactElement> = {
  '/c/cauta': <SearchScreen />,
  '/c/garaj': <GarageScreen />,
  '/c/programari': <ClientBookingsScreen />,
  '/s/panou': <Dashboard />,
  '/s/programari': <ShopBookingsScreen />,
};

/** Routes a role has besides its navigation items and Cont. */
function extraRoutes(role: Role) {
  if (role === 'client') {
    return (
      <>
        <Route path="/c/service/:shopId" element={<ShopPage />} />
        <Route path="/c/service/:shopId/programare" element={<BookingFlow />} />
        <Route path="/c/service/:shopId/programare/trimisa" element={<BookingSent />} />
        <Route path="/c/garaj/nou" element={<CarFormScreen />} />
        <Route path="/c/garaj/:carId" element={<CarFormScreen />} />
        <Route path="/c/cont/favorite" element={<FavoritesScreen />} />
      </>
    );
  }
  if (role !== 'shop') return null;
  return (
    <Route path={SETTINGS_PATH} element={<ShopSettingsLayout />}>
      <Route index element={<SettingsIndex />} />
      <Route path="profil" element={<ProfileSettings />} />
      <Route path="program" element={<HoursSettings />} />
      <Route path="reguli" element={<RulesSettings />} />
      <Route path="servicii" element={<ServicesSettings />} />
      <Route path="facturare" element={<BillingSettings />} />
      <Route path="personal" element={<StaffSettings />} />
      <Route path="notificari" element={<NotificationSettings />} />
    </Route>
  );
}

function roleRoutes(role: Role) {
  const nav = NAV[role];
  return (
    <Route element={<RoleGuard role={role} />}>
      <Route
        element={
          role === 'shop' ? (
            // One live list of the shop's bookings for Panou, Programări and the tab badge.
            <ShopBookingsProvider>
              <AppShell role={role} />
            </ShopBookingsProvider>
          ) : (
            <AppShell role={role} />
          )
        }
      >
        {nav.main.map((item) => (
          <Route key={item.path} path={item.path} element={SCREENS[item.path] ?? <Placeholder titleKey={item.labelKey} />} />
        ))}
        <Route path={nav.account.path} element={<AccountScreen role={role} />} />
        <Route path={`${nav.account.path}/legal/:doc`} element={<AccountLegal role={role} />} />
        {extraRoutes(role)}
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
              <Route path="/legal/:doc" element={<PublicLegal />} />
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
