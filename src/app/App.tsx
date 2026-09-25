import type { ReactElement } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { OfflineBar } from '../components/OfflineBar';
import { I18nProvider } from '../i18n/I18nProvider';
import { IS_TEST_BUILD } from '../lib/env';
import { AccountScreen } from '../screens/account/AccountScreen';
import { AuthScreen } from '../screens/auth/AuthScreen';
import { BookingFlow } from '../screens/client/booking/BookingFlow';
import { BookingSent } from '../screens/client/booking/BookingSent';
import { ClientBookingsProvider } from '../screens/client/bookings/ClientBookingsProvider';
import { ClientBookingsScreen } from '../screens/client/bookings/ClientBookingsScreen';
import { FavoritesScreen } from '../screens/client/favorites/FavoritesScreen';
import { CarFormScreen } from '../screens/client/garage/CarFormScreen';
import { VehicleHistoryScreen } from '../screens/client/history/VehicleHistoryScreen';
import { VehiclePickScreen } from '../screens/client/history/VehiclePickScreen';
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
import { ShopHistoryScreen } from '../screens/shop/history/ShopHistoryScreen';
import { REVIEWS_PATH, SUBSCRIPTION_PATH } from '../screens/shop/paths';
import { ShopReviewsScreen } from '../screens/shop/reviews/ShopReviewsScreen';
import { SubscriptionScreen } from '../screens/shop/subscription/SubscriptionScreen';
import { BookingThreadRedirect } from '../screens/messages/BookingThreadRedirect';
import { ConversationScreen } from '../screens/messages/ConversationScreen';
import { MessagesScreen } from '../screens/messages/MessagesScreen';
import { messagesPath } from '../screens/messages/paths';
import { ThreadsProvider } from '../screens/messages/ThreadsProvider';
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
  '/s/istoric': <ShopHistoryScreen />,
  '/c/mesaje': <MessagesScreen />,
  '/s/mesaje': <MessagesScreen />,
};

/** A conversation and the way in from a booking card (T11), for the client and the shop. */
function messageRoutes(side: 'client' | 'shop') {
  const base = messagesPath(side);
  return (
    <>
      <Route path={`${base}/programare/:bookingId`} element={<BookingThreadRedirect />} />
      <Route path={`${base}/:threadId`} element={<ConversationScreen />} />
    </>
  );
}

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
        <Route path="/c/garaj/:carId/istoric" element={<VehicleHistoryScreen />} />
        <Route path="/c/programari/:bookingId/istoric" element={<VehicleHistoryScreen />} />
        <Route path="/c/cont/favorite" element={<FavoritesScreen />} />
        <Route path="/c/cont/istoric" element={<VehiclePickScreen />} />
        {messageRoutes('client')}
      </>
    );
  }
  if (role !== 'shop') return null;
  return (
    <>
      {messageRoutes('shop')}
      <Route path={REVIEWS_PATH} element={<ShopReviewsScreen />} />
      <Route path={SUBSCRIPTION_PATH} element={<SubscriptionScreen />} />
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
    </>
  );
}

function roleRoutes(role: Role) {
  const nav = NAV[role];
  return (
    <Route element={<RoleGuard role={role} />}>
      <Route
        element={
          role === 'shop' ? (
            // One live list of the shop's bookings for Panou, Programări and the tab badge; one of
            // its conversations for Mesaje and that tab's badge.
            <ShopBookingsProvider>
              <ThreadsProvider side="shop">
                <AppShell role={role} />
              </ThreadsProvider>
            </ShopBookingsProvider>
          ) : role === 'client' ? (
            // The client's bookings, live, for Programări and the badge on its tab.
            <ClientBookingsProvider>
              <ThreadsProvider side="client">
                <AppShell role={role} />
              </ThreadsProvider>
            </ClientBookingsProvider>
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
