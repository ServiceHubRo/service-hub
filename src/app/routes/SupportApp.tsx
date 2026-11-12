import { Route, Routes } from 'react-router-dom';
import { MfaGate } from '../../screens/admin/MfaGate';
import { AccountScreen as SupportAccountScreen } from '../../screens/support/AccountScreen';
import { InboxScreen } from '../../screens/requests/InboxScreen';
import { RequestScreen } from '../../screens/requests/RequestScreen';
import { TextReviewsScreen } from '../../screens/requests/TextReviewsScreen';
import { HelpArticleScreen } from '../../screens/help/HelpArticleScreen';
import { HelpCategoryScreen } from '../../screens/help/HelpCategoryScreen';
import { SupportHelpScreen } from '../../screens/help/SupportHelpScreen';
import { ProcedureEditScreen } from '../../screens/procedures/ProcedureEditScreen';
import { ProcedureScreen } from '../../screens/procedures/ProcedureScreen';
import { ProceduresScreen } from '../../screens/procedures/ProceduresScreen';
import { ResponsiblesScreen } from '../../screens/procedures/ResponsiblesScreen';
import {
  SUPPORT_HELP_PATH,
  SUPPORT_PROCEDURES_PATH,
  SUPPORT_REQUESTS_PATH,
  SUPPORT_SEARCH_PATH,
  SUPPORT_TEXT_REVIEWS_PATH,
} from '../../screens/support/paths';
import { SearchScreen } from '../../screens/support/SearchScreen';
import { AppShell } from '../AppShell';
import { commonRoutes, rel } from './shared';

/**
 * Everything under /suport, loaded only by support agents (A2): after the second step of sign-in
 * (the database refuses every support_* function without it), Solicitări, Căutare with an account's
 * card, the Help Center (A4), the procedures (A5) and the agent's own Cont.
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
          [SUPPORT_HELP_PATH]: <SupportHelpScreen />,
          [SUPPORT_PROCEDURES_PATH]: <ProceduresScreen mode="support" />,
        })}
        <Route path={`${rel('support', SUPPORT_HELP_PATH)}/categorie/:slug`} element={<HelpCategoryScreen role="support" />} />
        <Route path={`${rel('support', SUPPORT_HELP_PATH)}/articol/:slug`} element={<HelpArticleScreen role="support" />} />
        <Route path={`${rel('support', SUPPORT_PROCEDURES_PATH)}/nou`} element={<ProcedureEditScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_PROCEDURES_PATH)}/responsabili`} element={<ResponsiblesScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_PROCEDURES_PATH)}/:procedureId`} element={<ProcedureScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_PROCEDURES_PATH)}/:procedureId/editare`} element={<ProcedureEditScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_REQUESTS_PATH)}/:requestId`} element={<RequestScreen mode="support" />} />
        <Route path={`${rel('support', SUPPORT_SEARCH_PATH)}/:accountId`} element={<SupportAccountScreen />} />
        <Route path={rel('support', SUPPORT_TEXT_REVIEWS_PATH)} element={<TextReviewsScreen mode="support" />} />
      </Route>
    </Routes>
  );
}
