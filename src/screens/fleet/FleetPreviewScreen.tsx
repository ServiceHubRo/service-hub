import { Building2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { Banner } from '../../components/Banner';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { FLEET_ROLES, scopeFor, type FleetExpense, type FleetRole } from '../../lib/fleet';
import { FleetContext, useFleetLocation } from './fleetContext';
import { FleetFrame, FleetSectionBody } from './FleetFrame';
import { emptyFleet, SAMPLE_MEMBER_FOR_ROLE, sampleFleet } from './sample';
import styles from './fleet.module.css';

type DataMode = 'sample' | 'empty' | 'loading' | 'error';
const DATA_MODES: readonly DataMode[] = ['sample', 'empty', 'loading', 'error'];

/**
 * The fleet account's design preview (T63a, docs/FLEET_PLAN.md): test builds only (`/dev/flota`,
 * like the component gallery), invented sample data clearly marked, nothing saved. The role, the
 * data (sample, empty, loading, error) and the page are in the address, so a link shows one state.
 * The screens are the real components; stage 3 gives them `fleet_overview()` instead of the sample.
 */
export function FleetPreviewScreen() {
  const { t } = useI18n();
  const { section, vehicleId, filter, update, go, params } = useFleetLocation();
  const role: FleetRole = FLEET_ROLES.includes(params.get('rol') as FleetRole) ? (params.get('rol') as FleetRole) : 'admin';
  const mode: DataMode = DATA_MODES.includes(params.get('date') as DataMode) ? (params.get('date') as DataMode) : 'sample';
  const [added, setAdded] = useState<FleetExpense[]>([]);

  const data = useMemo(() => {
    const base = mode === 'empty' ? emptyFleet() : sampleFleet();
    const withAdded = { ...base, expenses: [...base.expenses, ...added] };
    return scopeFor(withAdded, role, SAMPLE_MEMBER_FOR_ROLE[role]);
  }, [mode, role, added]);

  const addExpense = useCallback((e: FleetExpense) => setAdded((list) => [...list, e]), []);
  const title = section === 'vehicul' ? t('fleet.nav.vehicle') : t(`fleet.nav.${section}`);
  useDocumentTitle(`${title} · ${t('fleet.preview.tag')}`);

  let body;
  if (mode === 'loading') body = <SkeletonList cards />;
  else if (mode === 'error') body = <LoadError message={t('fleet.loadError')} onRetry={() => update({ date: 'sample' })} />;
  else body = <FleetSectionBody section={section} vehicleId={vehicleId} filter={filter} />;

  return (
    <FleetContext.Provider value={{ data, go, mode: 'preview', actions: null, companyPage: null, addExpense }}>
      <FleetFrame companyName={data.company.name} section={section} onNav={(s) => go({ section: s })} personalTo="/c/garaj">
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
        </div>
        <PageHeader
          title={title}
          subtitle={
            <span className={styles.spaceLine}>
              <Building2 size={15} aria-hidden="true" /> {data.company.name} · {t(`fleet.role.${role}`)}
            </span>
          }
        />
        {body}
      </FleetFrame>
    </FleetContext.Provider>
  );
}
