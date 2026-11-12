import { Route, Routes } from 'react-router-dom';
import { MfaGate } from '../../screens/admin/MfaGate';
import { AccountScreen as SupportAccountScreen } from '../../screens/support/AccountScreen';
import { InboxScreen } from '../../screens/requests/InboxScreen';
import { RequestScreen } from '../../screens/requests/RequestScreen';
import { TextReviewsScreen } from '../../screens/requests/TextReviewsScreen';
import { SUPPORT_REQUESTS_PATH, SUPPORT_SEARCH_PATH, SUPPORT_TEXT_REVIEWS_PATH } from '../../screens/support/paths';
import { SearchScreen } from '../../screens/support/SearchScreen';
import { AppShell } from '../AppShell';
import { commonRoutes, rel } from './shared';

/**
 * Everything under /suport, loaded only by support agents (A2): after the second step of sign-in
 * (the database refuses every support_* function without it), Solicitări, Căutare with an account's
 * card, and the agent's own Cont. Help Center (A4) and Proceduri (A5) join when they exist.
 */
export default function SupportApp() {
  return (
    <Routes>
      <Route
        element={
          <MfaGate role="support">
            <AppShell role="support" />
          </MfaGate>
        }
      >
        {commonRoutes('support', {
          [SUPPORT_REQUESTS_PATH]: <InboxScreen mode="support" />,
          [SUPPORT_SEARCH_PATH]: <SearchScreen />,
        })}
        <Route path={`${rel('support', SUPPORT_REQUESTS_PATH)}/:requestId`} element={<RequestScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_SEARCH_PATH)}/:accountId`} element={<SupportAccountScreen />} />
        <Route path={rel('support', SUPPORT_TEXT_REVIEWS_PATH)} element={<TextReviewsScreen mode="support" />} />
      </Route>
    </Routes>
  );
}
