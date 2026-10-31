import { Building2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { buttonClass } from '../../components/buttonClass';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { archiveVehicle, assignDriver, fetchFleetOverview, fetchPlanSummary, fetchSubscription, saveVehicle, setUnavailable } from '../../data/fleet';
import { subscribeRows } from '../../data/realtime';
import { toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { COMPANIES_PATH, companyPath } from '../client/companies/paths';
import { FleetContext, useFleetLocation, type FleetActions } from './fleetContext';
import { FleetFrame, FleetPlanNotice, FleetSectionBody } from './FleetFrame';
import styles from './fleet.module.css';

/**
 * The company's fleet space (T63c): `/c/firme/<company>?sectiune=…`. Its own frame (top bar, sidebar,
 * the five fleet pages), the company's real data from `fleet_overview()` already narrowed to the
 * member's role, and the vehicle writes. Live: a vehicle or a member changed on another device shows
 * here without a reload (Realtime on the company's rows, then a quiet re-read).
 */
export function FleetSpaceScreen() {
  const { t } = useI18n();
  const { companyId = '' } = useParams();
  const { section, vehicleId, filter, go } = useFleetLocation();
  const load = useCallback(async () => {
    const [overview, plan] = await Promise.all([fetchFleetOverview(companyId), fetchPlanSummary(companyId)]);
    return { overview, plan };
  }, [companyId]);
  const { state, reload, setData } = useLoad(load);
  const loadSubscription = useCallback(() => fetchSubscription(companyId), [companyId]);

  // Quiet re-read: several changes in a row cost one read; an older answer never replaces a newer one.
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const next = await load();
    if (mine === generation.current) setData(next);
  }, [load, setData]);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh().catch(() => {}), 300);
    };
    const offVehicles = subscribeRows({ channel: `fleet-vehicles:${companyId}`, table: 'company_vehicles', filter: `company_id=eq.${companyId}`, onChange: later, onResync: later });
    const offMembers = subscribeRows({ channel: `fleet-members:${companyId}`, table: 'company_members', filter: `company_id=eq.${companyId}`, onChange: later, onResync: later });
    const offPlan = subscribeRows({ channel: `fleet-plan:${companyId}`, table: 'company_subscriptions', filter: `company_id=eq.${companyId}`, onChange: later, onResync: later });
    return () => {
      window.clearTimeout(timer);
      offVehicles();
      offMembers();
      offPlan();
    };
  }, [ready, companyId, refresh]);

  // Every write waits for the fresh read, so the next screen already shows the change.
  const actions = useMemo<FleetActions>(
    () => ({
      saveVehicle: async (id, fields, requestId) => {
        const saved = await saveVehicle(companyId, id, fields, requestId);
        await refresh();
        return saved;
      },
      archiveVehicle: async (id, archived, requestId) => {
        await archiveVehicle(id, archived, requestId);
        await refresh();
      },
      assignDriver: async (id, member, requestId) => {
        await assignDriver(id, member, requestId);
        await refresh();
      },
      setUnavailable: async (id, unavailable, requestId) => {
        await setUnavailable(id, unavailable, requestId);
        await refresh();
      },
    }),
    [companyId, refresh],
  );

  const title = section === 'vehicul' ? t('fleet.nav.vehicle') : t(`fleet.nav.${section}`);
  useDocumentTitle(state.status === 'ready' ? `${title} · ${state.data.overview.company.name}` : t('fleet.space.loading'));

  if (state.status === 'loading') {
    return (
      <div className={styles.spaceStatus}>
        <SkeletonList cards />
      </div>
    );
  }
  if (state.status === 'error') {
    const code = toRpcError(state.error).code;
    return (
      <div className={styles.spaceStatus}>
        {code === 'company_not_found' || code === 'fleet_disabled' ? (
          <EmptyState
            icon={Building2}
            title={t('rpcError.company_not_found')}
            action={
              <Link to={COMPANIES_PATH} className={buttonClass('primary')}>
                {t('cos.title')}
              </Link>
            }
          />
        ) : (
          <LoadError message={t('fleet.loadError')} onRetry={reload} />
        )}
      </div>
    );
  }

  const { overview: data, plan } = state.data;
  return (
    <FleetContext.Provider value={{ data, go, mode: 'live', actions, companyPage: companyPath(companyId), addExpense: null, plan, loadSubscription }}>
      <FleetFrame companyName={data.company.name} section={section} onNav={(s) => go({ section: s })} personalTo="/c/cauta">
        <PageHeader
          back={{ to: companyPath(companyId), label: t('fleet.space.companyPage') }}
          title={title}
          subtitle={
            <span className={styles.spaceLine}>
              <Building2 size={15} aria-hidden="true" /> {data.company.name} · {t(`fleet.role.${data.me.role}`)}
            </span>
          }
        />
        <FleetPlanNotice section={section} onOpen={() => go({ section: 'abonament' })} />
        <FleetSectionBody section={section} vehicleId={vehicleId} filter={filter} />
      </FleetFrame>
    </FleetContext.Provider>
  );
}
