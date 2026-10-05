import { Route, Routes } from 'react-router-dom';
import { MessagesScreen } from '../../screens/messages/MessagesScreen';
import { ThreadsProvider } from '../../screens/messages/ThreadsProvider';
import { NoticesProvider } from '../../screens/notices/NoticesProvider';
import { AddBookingScreen } from '../../screens/shop/bookings/AddBookingScreen';
import { ImportScreen } from '../../screens/shop/bookings/ImportScreen';
import { ShopShareScreen } from '../../screens/shop/link/ShopShareScreen';
import { ShopBookingsProvider } from '../../screens/shop/bookings/ShopBookingsProvider';
import { ShopBookingsScreen } from '../../screens/shop/bookings/ShopBookingsScreen';
import { Dashboard } from '../../screens/shop/dashboard/Dashboard';
import { ShopHistoryScreen } from '../../screens/shop/history/ShopHistoryScreen';
import {
  ADD_BOOKING_PATH,
  IMPORT_PATH,
  SHOP_LINK_PATH,
  REPORTS_PATH,
  REVIEWS_PATH,
  SHOP_BOOKINGS_PATH,
  SHOP_HISTORY_PATH,
  SUBSCRIPTION_PATH,
  VEHICLE_FILE_SEGMENT,
} from '../../screens/shop/paths';
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
import { ShowcaseSettings } from '../../screens/shop/settings/ShowcaseSettings';
import { ServicesSettings } from '../../screens/shop/settings/ServicesSettings';
import { SettingsIndex } from '../../screens/shop/settings/SettingsIndex';
import { ShopSettingsLayout } from '../../screens/shop/settings/ShopSettingsLayout';
import { StaffSettings } from '../../screens/shop/settings/StaffSettings';
import { SubscriptionScreen } from '../../screens/shop/subscription/SubscriptionScreen';
import { VehicleFileScreen } from '../../screens/shop/vehicle/VehicleFileScreen';
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
                <NoticesProvider>
                  <AppShell role="shop" />
                </NoticesProvider>
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
        <Route path={rel('shop', ADD_BOOKING_PATH)} element={<AddBookingScreen />} />
        <Route path={rel('shop', IMPORT_PATH)} element={<ImportScreen />} />
        {/* Fișa mașinii (T27), under the tab it was opened from. */}
        <Route
          path={`${rel('shop', SHOP_BOOKINGS_PATH)}/${VEHICLE_FILE_SEGMENT}/:bookingId`}
          element={<VehicleFileScreen from="bookings" />}
        />
        <Route
          path={`${rel('shop', SHOP_HISTORY_PATH)}/${VEHICLE_FILE_SEGMENT}/:bookingId`}
          element={<VehicleFileScreen from="history" />}
        />
        <Route path={rel('shop', REVIEWS_PATH)} element={<ShopReviewsScreen />} />
        <Route path={rel('shop', SHOP_LINK_PATH)} element={<ShopShareScreen />} />
        <Route path={rel('shop', SUBSCRIPTION_PATH)} element={<SubscriptionScreen />} />
        <Route path={rel('shop', REPORTS_PATH)} element={<ShopReportsScreen />} />
        <Route path={rel('shop', SETTINGS_PATH)} element={<ShopSettingsLayout />}>
          <Route index element={<SettingsIndex />} />
          <Route element={<OwnerOnlySettings />}>
            <Route path="profil" element={<ProfileSettings />} />
            <Route path="program" element={<HoursSettings />} />
            <Route path="reguli" element={<RulesSettings />} />
            <Route path="servicii" element={<ServicesSettings />} />
            <Route path="vitrina" element={<ShowcaseSettings />} />
          </Route>
          <Route path="facturare" element={<BillingSettings />} />
          <Route path="personal" element={<StaffSettings />} />
          <Route path="notificari" element={<NotificationSettings />} />
        </Route>
      </Route>
    </Routes>
  );
}
