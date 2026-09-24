import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingScreen } from './LoadingScreen';
import { ReauthPanel } from './ReauthPanel';
import { afterSignIn, homeOf, type Role } from './roles';
import { SessionErrorScreen } from './SessionErrorScreen';
import { useSession } from './sessionContext';

/**
 * Only the given role gets through (ARCHITECTURE §15): signed-out visitors go to sign-in (and come
 * back here afterwards), other roles go to their own home. When the session ends by itself, the
 * screen stays as it is under a sign-in panel, so nothing typed is lost.
 */
export function RoleGuard({ role }: { role: Role }) {
  const session = useSession();
  const location = useLocation();

  switch (session.status) {
    case 'loading':
      return <LoadingScreen />;
    case 'error':
      return <SessionErrorScreen />;
    case 'signedOut':
      return <Navigate to="/intra" replace state={{ from: location.pathname + location.search }} />;
    case 'expired':
    case 'signedIn':
      if (session.role !== role) return <Navigate to={session.role ? homeOf(session.role) : '/'} replace />;
      return (
        <>
          <Outlet />
          {session.status === 'expired' && <ReauthPanel />}
        </>
      );
  }
}

/** Sign-in, sign-up, "check your email", "forgot password": signed-in users go home instead. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();
  if (session.status === 'loading') return <LoadingScreen />;
  if (session.status === 'signedIn' && session.role) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={afterSignIn(session.role, from)} replace />;
  }
  return <Outlet />;
}
