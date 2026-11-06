import { Building2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { Banner } from '../../components/Banner';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { buildReport, FLEET_ROLES, scopeFor, type FleetExpense, type FleetRole } from '../../lib/fleet';
import { FLEET_SECTIONS, FleetContext, useFleetLocation, type FleetContextValue } from './fleetContext';
import { FleetPlanNotice, FleetSectionBody, PlanBadge } from './FleetSections';
import { emptyFleet, SAMPLE_MEMBER_FOR_ROLE, SAMPLE_PLANS, sampleFleet, samplePlanSummary, sampleSubscription } from './sample';
import styles from './fleet.module.css';

type DataMode = 'sample' | 'empty' | 'loading' | 'error';
const DATA_MODES: readonly DataMode[] = ['sample', 'empty', 'loading', 'error'];

/**
 * The fleet account's design preview (T63a, docs/FLEET_PLAN.md): test builds only (`/dev/flota`,
 * like the component gallery), invented sample data clearly marked, nothing saved. The role, the
 * data (sample, empty, loading, error) and the page are in the address, so a link shows one state.
 * Since T65 the real space lives in the client's shell; the preview is a plain page with a page picker.
 * The screens are the real components; stage 3 gives them `fleet_overview()` instead of the sample.
 */
export function FleetPreviewScreen() {
  const { t } = useI18n();
  const { section, vehicleId, filter, update, go, back, params } = useFleetLocation();
  const role: FleetRole = FLEET_ROLES.includes(params.get('rol') as FleetRole) ? (params.get('rol') as FleetRole) : 'admin';
  const mode: DataMode = DATA_MODES.includes(params.get('date') as DataMode) ? (params.get('date') as DataMode) : 'sample';
  const [added, setAdded] = useState<FleetExpense[]>([]);

  const data = useMemo(() => {
    const base = mode === 'empty' ? emptyFleet() : sampleFleet();
    const withAdded = { ...base, expenses: [...base.expenses, ...added] };
    return scopeFor(withAdded, role, SAMPLE_MEMBER_FOR_ROLE[role]);
  }, [mode, role, added]);

  const addExpense = useCallback((e: FleetExpense) => setAdded((list) => [...list, e]), []);
  const activeVehicles = data.vehicles.filter((v) => !v.archived_at).length;
  const plan = useMemo(() => (mode === 'sample' || mode === 'empty' ? samplePlanSummary(new Date(), activeVehicles) : null), [mode, activeVehicles]);
  const loadSubscription = useCallback(async () => sampleSubscription(new Date(), activeVehicles, data.members.length), [activeVehicles, data.members.length]);
  // The preview's plan is Fleet Business with every feature shown (no plan = everything, hasFeature).
  const features = useMemo(() => SAMPLE_PLANS[2]!.features, []);
  const loadReport = useCallback<FleetContextValue['loadReport']>(async (range, previous, filters) => buildReport(data, features, range, previous, filters), [data, features]);
  const logExport = useCallback<FleetContextValue['logExport']>(async () => undefined, []);
  const title = section === 'vehicul' ? t('fleet.nav.vehicle') : t(`fleet.nav.${section}`);
  useDocumentTitle(`${title} · ${t('fleet.preview.tag')}`);

  let body;
  if (mode === 'loading') body = <SkeletonList cards />;
  else if (mode === 'error') body = <LoadError message={t('fleet.loadError')} onRetry={() => update({ date: 'sample' })} />;
  else body = <FleetSectionBody section={section} vehicleId={vehicleId} filter={filter} />;

  return (
    <FleetContext.Provider value={{ data, go, back, mode: 'preview', actions: null, companyPage: null, addExpense, plan, loadSubscription, plans: SAMPLE_PLANS, loadReport, logExport }}>
      <div className={styles.previewPage}>
        <Banner tone="warning">{t('fleet.preview.banner')}</Banner>
        <div className={styles.controls}>
          <SelectField
            label={t('fleet.preview.role')}
            value={role}
            onChange={(e) => update({ rol: e.target.value })}
            options={FLEET_ROLES.map((r) => ({ value: r, label: t(`fleet.role.${r}`) }))}
          />
          <SelectField
            label={t('fleet.preview.data')}
            value={mode}
            onChange={(e) => update({ date: e.target.value })}
            options={DATA_MODES.map((m) => ({ value: m, label: t(`fleet.preview.mode.${m}`) }))}
          />
          <SelectField
            label={t('fleet.preview.page')}
            value={section === 'vehicul' ? 'vehicule' : section}
            onChange={(e) => go({ section: e.target.value as typeof section })}
            options={FLEET_SECTIONS.filter((x) => x !== 'vehicul').map((x) => ({ value: x, label: t(`fleet.nav.${x}`) }))}
          />
        </div>
        <div className={styles.spaceTop}>
          <PlanBadge onOpen={() => go({ section: 'abonament' })} />
        </div>
        <PageHeader
          title={title}
          subtitle={
            <span className={styles.spaceLine}>
              <Building2 size={15} aria-hidden="true" /> {data.company.name} · {t(`fleet.role.${role}`)}
            </span>
          }
        />
        <FleetPlanNotice section={section} onOpen={() => go({ section: 'abonament' })} />
        {body}
      </div>
    </FleetContext.Provider>
  );
}
