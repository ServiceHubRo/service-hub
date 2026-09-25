import { Route, Routes } from 'react-router-dom';
import { AdminProvider } from '../../screens/admin/AdminProvider';
import { AuditScreen } from '../../screens/admin/AuditScreen';
import { BookingDetailScreen } from '../../screens/admin/BookingDetailScreen';
import { BookingsScreen } from '../../screens/admin/BookingsScreen';
import { CatalogScreen } from '../../screens/admin/CatalogScreen';
import { ClientDetailScreen } from '../../screens/admin/ClientDetailScreen';
import { ClientsScreen } from '../../screens/admin/ClientsScreen';
import { ExportScreen } from '../../screens/admin/ExportScreen';
import { ModerationScreen } from '../../screens/admin/ModerationScreen';
import { NoticesScreen } from '../../screens/admin/NoticesScreen';
import { OverviewScreen } from '../../screens/admin/OverviewScreen';
import { ReportsScreen } from '../../screens/admin/ReportsScreen';
import { SettingsScreen } from '../../screens/admin/SettingsScreen';
import { ShopDetailScreen } from '../../screens/admin/ShopDetailScreen';
import { ShopsScreen } from '../../screens/admin/ShopsScreen';
import { SubscriptionsScreen } from '../../screens/admin/SubscriptionsScreen';
import { TextsScreen } from '../../screens/admin/TextsScreen';
import { ThreadScreen } from '../../screens/admin/ThreadScreen';
import { AppShell } from '../AppShell';
import { commonRoutes } from './shared';

/** Everything under /admin, loaded only by admins (T18). */
export default function AdminApp() {
  return (
    <Routes>
      <Route
        element={
          // The reported reviews waiting, live, for the badge on Moderare (T16a).
          <AdminProvider>
            <AppShell role="admin" />
          </AdminProvider>
        }
      >
        {commonRoutes('admin', {
          '/admin/prezentare': <OverviewScreen />,
          '/admin/service-uri': <ShopsScreen />,
          '/admin/clienti': <ClientsScreen />,
          '/admin/rezervari': <BookingsScreen />,
          '/admin/moderare': <ModerationScreen />,
        })}
        <Route path="service-uri/:shopId" element={<ShopDetailScreen />} />
        <Route path="clienti/:clientId" element={<ClientDetailScreen />} />
        <Route path="rezervari/:bookingId" element={<BookingDetailScreen />} />
        <Route path="mesaje/:threadId" element={<ThreadScreen />} />
        <Route path="cont/jurnal" element={<AuditScreen />} />
        <Route path="cont/abonamente" element={<SubscriptionsScreen />} />
        <Route path="cont/rapoarte" element={<ReportsScreen />} />
        <Route path="cont/catalog" element={<CatalogScreen />} />
        <Route path="cont/setari" element={<SettingsScreen />} />
        <Route path="cont/setari/texte" element={<TextsScreen />} />
        <Route path="cont/anunturi" element={<NoticesScreen />} />
        <Route path="cont/export" element={<ExportScreen />} />
      </Route>
    </Routes>
  );
}
