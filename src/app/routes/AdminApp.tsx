import { Route, Routes } from 'react-router-dom';
import { FleetsScreen } from '../../screens/admin/FleetsScreen';
import { VehicleDuplicatesScreen } from '../../screens/admin/VehicleDuplicatesScreen';
import { FleetFailedEventsScreen } from '../../screens/admin/FleetFailedEventsScreen';
import { AdminProvider } from '../../screens/admin/AdminProvider';
import { AnafScreen } from '../../screens/admin/AnafScreen';
import { AuditScreen } from '../../screens/admin/AuditScreen';
import { BookingDetailScreen } from '../../screens/admin/BookingDetailScreen';
import { BookingsScreen } from '../../screens/admin/BookingsScreen';
import { CatalogScreen } from '../../screens/admin/CatalogScreen';
import { ClientDetailScreen } from '../../screens/admin/ClientDetailScreen';
import { ClientsScreen } from '../../screens/admin/ClientsScreen';
import { LegalHoldScreen, LegalHoldsScreen } from '../../screens/admin/LegalHoldsScreen';
import { ExportScreen } from '../../screens/admin/ExportScreen';
import { LegacyRedirect } from '../../screens/admin/LegacyRedirect';
import { MfaGate } from '../../screens/admin/MfaGate';
import { ModerationScreen } from '../../screens/admin/ModerationScreen';
import { NoShowDisputesScreen } from '../../screens/admin/NoShowDisputesScreen';
import { NoticesScreen } from '../../screens/admin/NoticesScreen';
import { OverviewScreen } from '../../screens/admin/OverviewScreen';
import {
  ADMIN_ACTIVITY_PATH,
  ADMIN_ANAF_PATH,
  ADMIN_AUDIT_PATH,
  ADMIN_BOOKINGS_PATH,
  ADMIN_CATALOG_PATH,
  ADMIN_CLIENTS_PATH,
  ADMIN_DISPUTES_PATH,
  ADMIN_DUPLICATES_PATH,
  ADMIN_EXPORT_PATH,
  ADMIN_FLEET_FAILED_PATH,
  ADMIN_FLEETS_PATH,
  ADMIN_LEGACY_ROUTES,
  ADMIN_MODERATION_PATH,
  ADMIN_NOTICES_PATH,
  ADMIN_PANEL_PATH,
  ADMIN_PARTNERS_PATH,
  ADMIN_PLATFORM_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_SETTINGS_PATH,
  ADMIN_SHOPS_PATH,
  ADMIN_SUBSCRIPTIONS_PATH,
  ADMIN_REQUESTS_PATH,
  ADMIN_HOLDS_PATH,
  ADMIN_SUPPORT_PATH,
  ADMIN_TEAM_PATH,
  ADMIN_RETENTION_PATH,
  ADMIN_TEXT_REVIEWS_PATH,
  ADMIN_TEXTS_PATH,
  ADMIN_ZONES_PATH,
} from '../../screens/admin/paths';
import { ReportsScreen } from '../../screens/admin/ReportsScreen';
import { SettingsScreen } from '../../screens/admin/SettingsScreen';
import { ShopDetailScreen } from '../../screens/admin/ShopDetailScreen';
import { ShopsScreen } from '../../screens/admin/ShopsScreen';
import { SubscriptionsScreen } from '../../screens/admin/SubscriptionsScreen';
import { TeamScreen } from '../../screens/admin/TeamScreen';
import { RetentionScreen } from '../../screens/admin/RetentionScreen';
import { TextReviewsScreen } from '../../screens/requests/TextReviewsScreen';
import { InboxScreen } from '../../screens/requests/InboxScreen';
import { RequestScreen } from '../../screens/requests/RequestScreen';
import { TextsScreen } from '../../screens/admin/TextsScreen';
import { ZoneScreen } from '../../screens/admin/ZoneScreen';
import { ZonesScreen } from '../../screens/admin/ZonesScreen';
import { AppShell } from '../AppShell';
import { commonRoutes, rel } from './shared';

/** A sub-section's route, relative to /admin. */
const at = (path: string) => rel('admin', path);

/**
 * Everything under /admin, loaded only by admins (T18). Since A1 the five zones (src/app/adminZones.ts)
 * and their sub-sections; every address from before A1 still opens its page at the new address
 * (LegacyRedirect, replacing the history entry).
 */
export default function AdminApp() {
  return (
    <Routes>
      <Route
        element={
          // The second step of sign-in first (T25); then the reported reviews waiting, live, for
          // the badge on Moderare (T16a).
          <MfaGate>
            <AdminProvider>
              <AppShell role="admin" />
            </AdminProvider>
          </MfaGate>
        }
      >
        {commonRoutes('admin', {
          [ADMIN_PANEL_PATH]: <OverviewScreen />,
          [ADMIN_PARTNERS_PATH]: <ZoneScreen path={ADMIN_PARTNERS_PATH} />,
          [ADMIN_ACTIVITY_PATH]: <ZoneScreen path={ADMIN_ACTIVITY_PATH} />,
          [ADMIN_SUPPORT_PATH]: <ZoneScreen path={ADMIN_SUPPORT_PATH} />,
          [ADMIN_PLATFORM_PATH]: <ZoneScreen path={ADMIN_PLATFORM_PATH} />,
        })}
        {/* Parteneri */}
        <Route path={at(ADMIN_CLIENTS_PATH)} element={<ClientsScreen />} />
        <Route path={`${at(ADMIN_CLIENTS_PATH)}/:clientId`} element={<ClientDetailScreen />} />
        <Route path={at(ADMIN_SHOPS_PATH)} element={<ShopsScreen />} />
        <Route path={`${at(ADMIN_SHOPS_PATH)}/:shopId`} element={<ShopDetailScreen />} />
        <Route path={at(ADMIN_FLEETS_PATH)} element={<FleetsScreen />} />
        <Route path={at(ADMIN_ANAF_PATH)} element={<AnafScreen />} />
        <Route path={at(ADMIN_DUPLICATES_PATH)} element={<VehicleDuplicatesScreen />} />
        {/* Activitate */}
        <Route path={at(ADMIN_BOOKINGS_PATH)} element={<BookingsScreen />} />
        <Route path={`${at(ADMIN_BOOKINGS_PATH)}/:bookingId`} element={<BookingDetailScreen />} />
        <Route path={at(ADMIN_MODERATION_PATH)} element={<ModerationScreen />} />
        <Route path={at(ADMIN_DISPUTES_PATH)} element={<NoShowDisputesScreen />} />
        <Route path={at(ADMIN_SUBSCRIPTIONS_PATH)} element={<SubscriptionsScreen />} />
        <Route path={at(ADMIN_REPORTS_PATH)} element={<ReportsScreen />} />
        <Route path={at(ADMIN_EXPORT_PATH)} element={<ExportScreen />} />
        {/* Suport */}
        <Route path={at(ADMIN_REQUESTS_PATH)} element={<InboxScreen mode="admin" />} />
        <Route path={`${at(ADMIN_REQUESTS_PATH)}/:requestId`} element={<RequestScreen mode="admin" />} />
        <Route path={at(ADMIN_HOLDS_PATH)} element={<LegalHoldsScreen />} />
        <Route path={`${at(ADMIN_HOLDS_PATH)}/:holdId`} element={<LegalHoldScreen />} />
        <Route path={at(ADMIN_TEXT_REVIEWS_PATH)} element={<TextReviewsScreen mode="admin" />} />
        {/* Platformă */}
        <Route path={at(ADMIN_SETTINGS_PATH)} element={<SettingsScreen />} />
        <Route path={at(ADMIN_TEXTS_PATH)} element={<TextsScreen />} />
        <Route path={at(ADMIN_NOTICES_PATH)} element={<NoticesScreen />} />
        <Route path={at(ADMIN_ZONES_PATH)} element={<ZonesScreen />} />
        <Route path={at(ADMIN_CATALOG_PATH)} element={<CatalogScreen />} />
        <Route path={at(ADMIN_AUDIT_PATH)} element={<AuditScreen />} />
        <Route path={at(ADMIN_FLEET_FAILED_PATH)} element={<FleetFailedEventsScreen />} />
        <Route path={at(ADMIN_TEAM_PATH)} element={<TeamScreen />} />
        <Route path={at(ADMIN_RETENTION_PATH)} element={<RetentionScreen />} />
        {/* The addresses from before A1 (kept at least until A8). */}
        {ADMIN_LEGACY_ROUTES.map(([old]) => (
          <Route key={old} path={`${at(old)}/*`} element={<LegacyRedirect />} />
        ))}
      </Route>
    </Routes>
  );
}
