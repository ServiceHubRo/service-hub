import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { IS_TEST_BUILD } from '../lib/env';
import { homeOf, roleFromParam } from './roles';
import { useSession } from './sessionContext';

/** Test builds: `?rol=client|service|admin` on any address switches role and opens its home. */
export function DevRoleFromUrl() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const { setDevRole } = useSession();

  useEffect(() => {
    if (!IS_TEST_BUILD) return;
    const role = roleFromParam(new URLSearchParams(search).get('rol'));
    if (!role) return;
    setDevRole(role);
    navigate(homeOf(role), { replace: true });
  }, [search, navigate, setDevRole]);

  return null;
}
