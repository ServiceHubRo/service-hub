import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchMyCompanies, type MyCompany } from '../../data/companies';
import { fetchMyFleetAccess } from '../../data/fleet';
import { subscribeRows } from '../../data/realtime';
import { SEARCH_PATH } from '../../screens/client/paths';
import { fleetSpacePath } from '../../screens/client/companies/paths';
import { useSession } from '../sessionContext';
import { companyOfPath, WorkspaceContext, type ActiveWorkspace } from './workspaceContext';

/** The companies, or none when fleets are off for the caller. */
async function readSpaces(): Promise<MyCompany[]> {
  return (await fetchMyFleetAccess()) ? fetchMyCompanies() : [];
}

/** The fleet pages every company has; a vehicle's page belongs to one company and is not carried over. */
const CARRIED_SECTIONS = new Set(['panou', 'vehicule', 'programari', 'costuri', 'cont', 'rapoarte', 'membri', 'abonament']);

/**
 * The client's spaces (T65): reads the companies once, again when the member's rows change (joined,
 * left, removed, a role changed — Realtime on the caller's own `company_members` rows) and on demand.
 * The active space is the address; switching navigates, and the fleet screen remounts for the new
 * company, so nothing of the previous one is ever drawn.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [ready, setReady] = useState(false);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const list = await readSpaces();
      if (mine === generation.current) setCompanies(list);
    } catch {
      // Offline or a failed read: keep what was shown; the next change or reload tries again.
    } finally {
      if (mine === generation.current) setReady(true);
    }
  }, []);

  // The first read when the shell opens.
  useEffect(() => {
    const mine = ++generation.current;
    readSpaces().then(
      (list) => {
        if (mine !== generation.current) return;
        setCompanies(list);
        setReady(true);
      },
      () => {
        if (mine === generation.current) setReady(true);
      },
    );
  }, []);

  // Read again when a membership changes. Not filtered: a removal arrives as a DELETE, which Realtime
  // never filters (it carries only the row's id); inserts and updates come only for rows the caller
  // may read. Several changes in a row cost one read. Also when the tab comes back to the front.
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 400);
    };
    const off = subscribeRows({ channel: `workspaces:${uid}`, table: 'company_members', onChange: later, onResync: later });
    const visible = () => {
      if (document.visibilityState === 'visible') later();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearTimeout(timer);
      off();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [uid, reload]);

  const companyId = companyOfPath(pathname);
  const active = useMemo<ActiveWorkspace>(() => (companyId ? { kind: 'company', id: companyId } : { kind: 'personal' }), [companyId]);

  const switchTo = useCallback(
    (target: ActiveWorkspace) => {
      if (target.kind === 'personal') {
        if (active.kind !== 'personal') navigate(SEARCH_PATH);
        return;
      }
      if (active.kind === 'company' && active.id === target.id) return;
      // From one company to another: the same page when the new company has it, else its Panou.
      const section = active.kind === 'company' ? new URLSearchParams(search).get('sectiune') : null;
      const keep = section && CARRIED_SECTIONS.has(section) ? `?sectiune=${section}` : '';
      navigate(`${fleetSpacePath(target.id)}${keep}`);
    },
    [active, navigate, search],
  );

  const value = useMemo(() => ({ companies, ready, active, switchTo, reload }), [companies, ready, active, switchTo, reload]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
