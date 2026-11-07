import { Navigate, useLocation } from 'react-router-dom';
import { NotFound } from '../public/NotFound';
import { legacyAdminPath } from './paths';

/**
 * An admin address from before A1 (src/screens/admin/paths.ts, ADMIN_LEGACY_ROUTES): the same page at
 * its new address, with the query and the anchor kept. It replaces the history entry instead of
 * adding one, so the phone's or the browser's Back never returns to the old address (no loops, P1).
 */
export function LegacyRedirect() {
  const { pathname, search, hash, state } = useLocation();
  const to = legacyAdminPath(pathname);
  if (!to) return <NotFound inShell />;
  return <Navigate to={`${to}${search}${hash}`} replace state={state} />;
}
