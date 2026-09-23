import { Navigate, Outlet } from 'react-router-dom';
import { homeOf, type Role } from './roles';
import { useSession } from './sessionContext';

/** Only the given role gets through; anyone else goes to their own home (or the public page). */
export function RoleGuard({ role }: { role: Role }) {
  const session = useSession();
  if (session.role === role) return <Outlet />;
  return <Navigate to={session.role ? homeOf(session.role) : '/'} replace />;
}
