import { useEffect } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { claimPath, pendingClaim } from '../../data/claim';
import { forgetShop, pendingShop } from '../../data/shopLink';
import { shopPath } from '../../screens/client/paths';
import { BookingFlow } from '../../screens/client/booking/BookingFlow';
import { BookingSent } from '../../screens/client/booking/BookingSent';
import { ClaimScreen } from '../../screens/client/claim/ClaimScreen';
import { ClientBookingsProvider } from '../../screens/client/bookings/ClientBookingsProvider';
import { ClientBookingsScreen } from '../../screens/client/bookings/ClientBookingsScreen';
import { FavoritesScreen } from '../../screens/client/favorites/FavoritesScreen';
import { CarFormScreen } from '../../screens/client/garage/CarFormScreen';
import { GarageScreen } from '../../screens/client/garage/GarageScreen';
import { VehicleHistoryScreen } from '../../screens/client/history/VehicleHistoryScreen';
import { VehiclePickScreen } from '../../screens/client/history/VehiclePickScreen';
import { MyReportsScreen } from '../../screens/client/report/MyReportsScreen';
import { ReportPreviewScreen } from '../../screens/client/report/ReportPreviewScreen';
import { SearchScreen } from '../../screens/client/search/SearchScreen';
import { ShopPage } from '../../screens/client/shop/ShopPage';
import { MessagesScreen } from '../../screens/messages/MessagesScreen';
import { ThreadsProvider } from '../../screens/messages/ThreadsProvider';
import { NoticesProvider } from '../../screens/notices/NoticesProvider';
import { AppShell } from '../AppShell';
import { commonRoutes, messageRoutes } from './shared';

/**
 * A visitor who opened a shop's booking link (T29) and then created an account or signed in lands
 * here, possibly in another tab after confirming the email: take them to that booking once.
 */
function PendingClaim() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const token = pendingClaim();
    if (token && pathname !== claimPath(token)) {
      navigate(claimPath(token), { replace: true });
      return;
    }
    // The shop's own link (T31b): its page, once.
    const shopId = pendingShop();
    if (shopId) {
      forgetShop();
      if (pathname !== shopPath(shopId)) navigate(shopPath(shopId), { replace: true });
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Everything under /c, loaded only by clients (T18). */
export default function ClientApp() {
  return (
    <>
      <PendingClaim />
      <Routes>
        <Route
          element={
            // The client's bookings, live, for Programări and the badge on its tab.
            <ClientBookingsProvider>
              <ThreadsProvider side="client">
                <NoticesProvider>
                  <AppShell role="client" />
                </NoticesProvider>
              </ThreadsProvider>
            </ClientBookingsProvider>
          }
        >
          {commonRoutes('client', {
            '/c/cauta': <SearchScreen />,
            '/c/garaj': <GarageScreen />,
            '/c/programari': <ClientBookingsScreen />,
            '/c/mesaje': <MessagesScreen />,
          })}
          <Route path="service/:shopId" element={<ShopPage />} />
          <Route path="service/:shopId/programare" element={<BookingFlow />} />
          <Route path="service/:shopId/programare/trimisa" element={<BookingSent />} />
          <Route path="garaj/nou" element={<CarFormScreen />} />
          <Route path="garaj/:carId" element={<CarFormScreen />} />
          <Route path="garaj/:carId/istoric" element={<VehicleHistoryScreen />} />
          <Route path="programari/:bookingId/istoric" element={<VehicleHistoryScreen />} />
          <Route path="cont/favorite" element={<FavoritesScreen />} />
          <Route path="cont/istoric" element={<VehiclePickScreen />} />
          <Route path="garaj/:carId/raport" element={<ReportPreviewScreen />} />
          <Route path="programari/:bookingId/raport" element={<ReportPreviewScreen />} />
          <Route path="cont/rapoarte" element={<MyReportsScreen />} />
          <Route path="preia/:token" element={<ClaimScreen />} />
          {messageRoutes('client')}
        </Route>
      </Routes>
    </>
  );
}
