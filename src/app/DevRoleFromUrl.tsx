import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROLE_SWITCH_ENABLED } from '../lib/env';
import { homeOf, roleFromParam } from './roles';
import { useSession } from './sessionContext';

/** Until T04: `?rol=client|service|admin` on any address switches role and opens its home. */
export function DevRoleFromUrl() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { setDevRole } = useSession();

  useEffect(() => {
    if (!ROLE_SWITCH_ENABLED) return;
    const role = roleFromParam(new URLSearchParams(search).get('rol'));
    if (!role) return;
    setDevRole(role);
    navigate(homeOf(role), { replace: true });
  }, [search, navigate, setDevRole]);

  return null;
}
