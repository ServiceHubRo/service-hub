import { Route, Routes } from 'react-router-dom';
import { MessagesScreen } from '../../screens/messages/MessagesScreen';
import { ThreadsProvider } from '../../screens/messages/ThreadsProvider';
import { ShopBookingsProvider } from '../../screens/shop/bookings/ShopBookingsProvider';
import { ShopBookingsScreen } from '../../screens/shop/bookings/ShopBookingsScreen';
import { Dashboard } from '../../screens/shop/dashboard/Dashboard';
import { ShopHistoryScreen } from '../../screens/shop/history/ShopHistoryScreen';
import { REPORTS_PATH, REVIEWS_PATH, SUBSCRIPTION_PATH } from '../../screens/shop/paths';
import { ShopReportsScreen } from '../../screens/shop/reports/ShopReportsScreen';
import { ShopReviewsScreen } from '../../screens/shop/reviews/ShopReviewsScreen';
import { ShopRoleProvider } from '../../screens/shop/ShopRoleProvider';
import { BillingSettings } from '../../screens/shop/settings/BillingSettings';
import { HoursSettings } from '../../screens/shop/settings/HoursSettings';
import { NotificationSettings } from '../../screens/shop/settings/NotificationSettings';
import { OwnerOnlySettings } from '../../screens/shop/settings/OwnerOnlySettings';
import { SETTINGS_PATH } from '../../screens/shop/settings/paths';
import { ProfileSettings } from '../../screens/shop/settings/ProfileSettings';
import { RulesSettings } from '../../screens/shop/settings/RulesSettings';
import { ServicesSettings } from '../../screens/shop/settings/ServicesSettings';
import { SettingsIndex } from '../../screens/shop/settings/SettingsIndex';
import { ShopSettingsLayout } from '../../screens/shop/settings/ShopSettingsLayout';
import { StaffSettings } from '../../screens/shop/settings/StaffSettings';
import { SubscriptionScreen } from '../../screens/shop/subscription/SubscriptionScreen';
import { AppShell } from '../AppShell';
import { commonRoutes, messageRoutes, rel } from './shared';

/** Everything under /s, loaded only by shops (T18). */
export default function ShopApp() {
  return (
    <Routes>
      <Route
        element={
          // Owner or colleague, once; one live list of the shop's bookings for Panou, Programări and
          // the tab badge; one of its conversations for Mesaje and that tab's badge.
          <ShopRoleProvider>
            <ShopBookingsProvider>
              <ThreadsProvider side="shop">
                <AppShell role="shop" />
              </ThreadsProvider>
            </ShopBookingsProvider>
          </ShopRoleProvider>
        }
      >
        {commonRoutes('shop', {
          '/s/panou': <Dashboard />,
          '/s/programari': <ShopBookingsScreen />,
          '/s/istoric': <ShopHistoryScreen />,
          '/s/mesaje': <MessagesScreen />,
        })}
        {messageRoutes('shop')}
        <Route path={rel('shop', REVIEWS_PATH)} element={<ShopReviewsScreen />} />
        <Route path={rel('shop', SUBSCRIPTION_PATH)} element={<SubscriptionScreen />} />
        <Route path={rel('shop', REPORTS_PATH)} element={<ShopReportsScreen />} />
        <Route path={rel('shop', SETTINGS_PATH)} element={<ShopSettingsLayout />}>
          <Route index element={<SettingsIndex />} />
          <Route element={<OwnerOnlySettings />}>
            <Route path="profil" element={<ProfileSettings />} />
            <Route path="program" element={<HoursSettings />} />
            <Route path="reguli" element={<RulesSettings />} />
            <Route path="servicii" element={<ServicesSettings />} />
          </Route>
          <Route path="facturare" element={<BillingSettings />} />
          <Route path="personal" element={<StaffSettings />} />
          <Route path="notificari" element={<NotificationSettings />} />
        </Route>
      </Route>
    </Routes>
  );
}
