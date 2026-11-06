import { Building2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { buttonClass } from '../../components/buttonClass';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import {
  addReading,
  archiveVehicle,
  correctReading,
  deleteMaintenance,
  fetchFuelStats,
  ignoreJobOdometer,
  assignDriver,
  deleteExpense,
  fetchFleetOverview,
  fetchFleetPlans,
  fetchIssueDetail,
  fleetCancelBooking,
  fleetRequestQuoteChanges,
  fleetFileUrl,
  fetchFleetReport,
  fetchPlanSummary,
  fetchSubscription,
  fleetDecideQuote,
  logFleetExport,
  markMaintenanceDone,
  markExpense,
  receiptUrl,
  reportIssue,
  saveExpense,
  saveMaintenance,
  saveVehicle,
  setUnavailable,
  updateIssue,
  uploadIssuePhoto,
  uploadReceipt,
} from '../../data/fleet';
import { subscribeRows } from '../../data/realtime';
import { toRpcError } from '../../data/rpc';
import { useOptionalWorkspace } from '../../app/workspace/workspaceContext';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { clearFleetBookingHint, setFleetBookingHint } from '../client/booking/fleetBookingHint';
import { COMPANIES_PATH, companyPath } from '../client/companies/paths';
import { SEARCH_PATH } from '../client/paths';
import { FleetContext, useFleetLocation, type FleetActions, type FleetContextValue } from './fleetContext';
import { FleetPlanNotice, FleetSectionBody, PlanBadge } from './FleetSections';
import styles from './fleet.module.css';

/**
 * The company's fleet space (T63c): `/c/firme/<company>?sectiune=…`, inside the client's shell since T65
 * (the workspace switch and the company's five pages are the shell's), the company's real data from `fleet_overview()` already narrowed to the
 * member's role, and the vehicle writes. Live: a vehicle or a member changed on another device shows
 * here without a reload (Realtime on the company's rows, then a quiet re-read).
 */
export function FleetSpaceScreen() {
  const { companyId = '' } = useParams();
  // A new company is a new screen (T65): nothing of the previous one is ever drawn while the new one loads.
  return <FleetSpace key={companyId} companyId={companyId} />;
}

function FleetSpace({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { section, vehicleId, filter, go } = useFleetLocation();
  const navigate = useNavigate();
  const load = useCallback(async () => {
    const [overview, plan, plans] = await Promise.all([fetchFleetOverview(companyId), fetchPlanSummary(companyId), fetchFleetPlans()]);
    return { overview, plan, plans };
  }, [companyId]);
  const { state, reload, setData } = useLoad(load);
  const loadSubscription = useCallback(() => fetchSubscription(companyId), [companyId]);
  const loadReport = useCallback<FleetContextValue['loadReport']>((range, previous, filters) => fetchFleetReport(companyId, range, previous, filters), [companyId]);
  const logExport = useCallback<FleetContextValue['logExport']>((kind, rows) => logFleetExport(companyId, kind, rows), [companyId]);

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
    // The company's bookings (T63d): readable live by those who see them all; a driver's own come
    // through their personal row.
    const offBookings = subscribeRows({ channel: `fleet-bookings:${companyId}`, table: 'bookings', filter: `company_id=eq.${companyId}`, onChange: later, onResync: later });
    return () => {
      window.clearTimeout(timer);
      offVehicles();
      offMembers();
      offPlan();
      offBookings();
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
      decideQuote: async (bookingId, quoteId, ids, requestId) => {
        const row = await fleetDecideQuote(bookingId, quoteId, ids, requestId);
        await refresh();
        return row;
      },
      book: (id) => {
        if (id) setFleetBookingHint(id);
        else clearFleetBookingHint();
        navigate(SEARCH_PATH);
      },
      saveExpense: async (id, fields, requestId) => {
        const saved = await saveExpense(companyId, id, fields, requestId);
        await refresh();
        return saved;
      },
      deleteExpense: async (id, requestId) => {
        await deleteExpense(id, requestId);
        await refresh();
      },
      markExpense: async (id, status, requestId) => {
        await markExpense(id, status, requestId);
        await refresh();
      },
      uploadReceipt: (vehicleId, file) => uploadReceipt(companyId, vehicleId, file),
      receiptUrl: (path) => receiptUrl(path),
      uploadIssuePhoto: (vehicleId, issueId, file) => uploadIssuePhoto(companyId, vehicleId, issueId, file),
      reportIssue: async (issueId, fields, requestId) => {
        const saved = await reportIssue(companyId, issueId, fields, requestId);
        await refresh();
        return saved;
      },
      updateIssue: async (issueId, fields, requestId) => {
        const saved = await updateIssue(issueId, fields, requestId);
        await refresh();
        return saved;
      },
      issueDetail: (issueId) => fetchIssueDetail(issueId),
      fileUrl: (path) => fleetFileUrl(path),
      addReading: async (vehicleId, day, km, requestId) => {
        const saved = await addReading(companyId, vehicleId, day, km, requestId);
        await refresh();
        return saved;
      },
      correctReading: async (readingId, km, reason, requestId) => {
        const saved = await correctReading(readingId, km, reason, requestId);
        await refresh();
        return saved;
      },
      ignoreJobOdometer: async (bookingId, reason, requestId) => {
        await ignoreJobOdometer(bookingId, reason, requestId);
        await refresh();
      },
      fuelStats: (vehicleId, from, to) => fetchFuelStats(companyId, vehicleId, from, to),
      requestQuoteChanges: async (bookingId, quoteId, reason, requestId) => {
        await fleetRequestQuoteChanges(bookingId, quoteId, reason, requestId);
        await refresh();
      },
      cancelBooking: async (bookingId, reason, requestId) => {
        await fleetCancelBooking(bookingId, reason, requestId);
        await refresh();
      },
      saveMaintenance: async (itemId, fields, requestId) => {
        const saved = await saveMaintenance(companyId, itemId, fields, requestId);
        await refresh();
        return saved;
      },
      deleteMaintenance: async (itemId, requestId) => {
        await deleteMaintenance(itemId, requestId);
        await refresh();
      },
      markMaintenanceDone: async (itemId, fields, requestId) => {
        await markMaintenanceDone(itemId, fields, requestId);
        await refresh();
      },
    }),
    [companyId, refresh, navigate],
  );

  // Removed from the company while the page was open (the workspace list no longer has it): nothing
  // of the company stays on screen; the database refuses every read and write anyway.
  const workspace = useOptionalWorkspace();
  const revoked = !!workspace?.ready && !workspace.companies.some((c) => c.id === companyId);

  const title = section === 'vehicul' ? t('fleet.nav.vehicle') : t(`fleet.nav.${section}`);
  useDocumentTitle(state.status === 'ready' ? `${title} · ${state.data.overview.company.name}` : t('fleet.space.loading'));

  if (state.status === 'loading') {
    return (
      <div className={styles.spaceStatus}>
        <SkeletonList cards />
      </div>
    );
  }
  if (state.status === 'error' || revoked) {
    const code = state.status === 'error' ? toRpcError(state.error).code : 'company_not_found';
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

  const { overview: data, plan, plans } = state.data;
  return (
    <FleetContext.Provider value={{ data, go, mode: 'live', actions, companyPage: companyPath(companyId), addExpense: null, plan, loadSubscription, plans, loadReport, logExport }}>
      <div className={styles.spaceTop}>
        <PlanBadge onOpen={() => go({ section: 'abonament' })} />
      </div>
      <PageHeader
          title={title}
          subtitle={
            <span className={styles.spaceLine}>
              <Building2 size={15} aria-hidden="true" /> {data.company.name} · {t(`fleet.role.${data.me.role}`)}
            </span>
          }
        />
        <FleetPlanNotice section={section} onOpen={() => go({ section: 'abonament' })} />
        <FleetSectionBody section={section} vehicleId={vehicleId} filter={filter} />
    </FleetContext.Provider>
  );
}
