import { BarChart3, Building2, CarFront, LayoutDashboard, ReceiptText, User, Users, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { Banner } from '../../components/Banner';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import { FLEET_ROLES, scopeFor, type FleetExpense, type FleetRole } from '../../lib/fleet';
import { FleetCosts } from './FleetCosts';
import { FleetDashboard } from './FleetDashboard';
import { FleetMembers } from './FleetMembers';
import { FleetReports } from './FleetReports';
import { FleetVehicle } from './FleetVehicle';
import { FleetVehicles } from './FleetVehicles';
import { FleetContext, FLEET_SECTIONS, type FleetLink, type FleetSection } from './fleetContext';
import { emptyFleet, SAMPLE_MEMBER_FOR_ROLE, sampleFleet } from './sample';
import styles from './fleet.module.css';

type DataMode = 'sample' | 'empty' | 'loading' | 'error';
const DATA_MODES: readonly DataMode[] = ['sample', 'empty', 'loading', 'error'];

const NAV: { section: FleetSection; icon: LucideIcon }[] = [
  { section: 'panou', icon: LayoutDashboard },
  { section: 'vehicule', icon: CarFront },
  { section: 'costuri', icon: ReceiptText },
  { section: 'rapoarte', icon: BarChart3 },
  { section: 'membri', icon: Users },
];

/**
 * The fleet account's design preview (T63a, docs/FLEET_PLAN.md): test builds only (`/dev/flota`,
 * like the component gallery), invented sample data clearly marked, nothing saved. The role, the
 * data (sample, empty, loading, error) and the page are in the address, so a link shows one state.
 * The screens are the real components; stage 3 gives them `fleet_overview()` instead of the sample.
 */
export function FleetPreviewScreen() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const role: FleetRole = FLEET_ROLES.includes(params.get('rol') as FleetRole) ? (params.get('rol') as FleetRole) : 'admin';
  const mode: DataMode = DATA_MODES.includes(params.get('date') as DataMode) ? (params.get('date') as DataMode) : 'sample';
  const rawSection = params.get('sectiune') as FleetSection | null;
  const section: FleetSection = rawSection && FLEET_SECTIONS.includes(rawSection) ? rawSection : 'panou';
  const vehicleId = params.get('vehicul');
  const filter = params.get('filtru') ?? undefined;
  const [added, setAdded] = useState<FleetExpense[]>([]);

  const data = useMemo(() => {
    const base = mode === 'empty' ? emptyFleet() : sampleFleet();
    const withAdded = { ...base, expenses: [...base.expenses, ...added] };
    return scopeFor(withAdded, role, SAMPLE_MEMBER_FOR_ROLE[role]);
  }, [mode, role, added]);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const go = useCallback(
    (link: FleetLink) => {
      update({ sectiune: link.section, vehicul: link.vehicle ?? null, filtru: link.filter ?? null });
      document.getElementById('fleet-main')?.scrollTo?.({ top: 0 });
    },
    [update],
  );

  const addExpense = useCallback((e: FleetExpense) => setAdded((list) => [...list, e]), []);
  const title = section === 'vehicul' ? t('fleet.nav.vehicle') : t(`fleet.nav.${section}`);
  useDocumentTitle(`${title} · ${t('fleet.preview.tag')}`);

  let body;
  if (mode === 'loading') body = <SkeletonList cards />;
  else if (mode === 'error') body = <LoadError message={t('fleet.loadError')} onRetry={() => update({ date: 'sample' })} />;
  else if (section === 'panou') body = <FleetDashboard />;
  else if (section === 'vehicule') body = <FleetVehicles key={filter ?? ''} initialStatus={filter} />;
  else if (section === 'vehicul') body = <FleetVehicle key={vehicleId ?? ''} vehicleId={vehicleId ?? ''} />;
  else if (section === 'costuri') body = <FleetCosts key={filter ?? ''} initialPeriod={filter} />;
  else if (section === 'rapoarte') body = <FleetReports key={filter ?? ''} initialReport={filter} />;
  else body = <FleetMembers />;

  const active = section === 'vehicul' ? 'vehicule' : section;

  return (
    <FleetContext.Provider value={{ data, go, addExpense }}>
      <div className={styles.frame}>
        {/* The same top bar as the app (AppShell): the logo and name on the left, the language on the right. */}
        <header className={styles.topBar}>
          <LogoTile />
          <Wordmark />
          <div className={styles.topBarEnd}>
            <LangSwitch />
          </div>
        </header>
        <aside className={styles.side} aria-label={t('fleet.nav.label')}>
          <Link to="/" className={styles.sideBrand} aria-label={t('app.title')}>
            <LogoTile size={32} />
            <Wordmark size={19} />
          </Link>
          <SpaceSwitch company={data.company.name} />
          <nav className={styles.sideNav}>
            {NAV.map(({ section: s, icon: Icon }) => (
              <button key={s} type="button" className={`${styles.sideItem} ${active === s ? styles.sideOn : ''}`} aria-current={active === s ? 'page' : undefined} onClick={() => go({ section: s })}>
                <Icon size={20} aria-hidden="true" />
                {t(`fleet.nav.${s}`)}
              </button>
            ))}
          </nav>
          <div className={styles.sideBottom}>
            <LangSwitch />
          </div>
        </aside>

        <main id="fleet-main" className={styles.main}>
          <div className={styles.mainInner}>
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
            <div className={styles.mobileSpace}>
              <SpaceSwitch company={data.company.name} />
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
          </div>
        </main>

        <nav className={styles.bottomNav} aria-label={t('fleet.nav.label')}>
          {NAV.map(({ section: s, icon: Icon }) => (
            <button key={s} type="button" className={`${styles.bottomItem} ${active === s ? styles.bottomOn : ''}`} aria-current={active === s ? 'page' : undefined} onClick={() => go({ section: s })}>
              <Icon size={22} aria-hidden="true" />
              <span>{t(`fleet.nav.${s}Short` as 'fleet.nav.panouShort')}</span>
            </button>
          ))}
        </nav>
      </div>
    </FleetContext.Provider>
  );
}

/**
 * Which space is open, always in sight: the company (building icon and name) or the personal one.
 * In the preview "Personal" leads to the client's own app, which does not change.
 */
function SpaceSwitch({ company }: { company: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.space} role="group" aria-label={t('fleet.space.label')}>
      <span className={`${styles.spaceItem} ${styles.spaceOn}`} aria-current="true">
        <Building2 size={16} aria-hidden="true" />
        <span className={styles.spaceName}>{company}</span>
      </span>
      <Link to="/c/garaj" className={styles.spaceItem}>
        <User size={16} aria-hidden="true" />
        <span className={styles.spaceName}>{t('fleet.space.personal')}</span>
      </Link>
    </div>
  );
}
