import { BarChart3, Building2, CarFront, CreditCard, LayoutDashboard, ReceiptText, User, Users, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { overLimit, planState, trialDaysLeft, TRIAL_WARN_DAYS } from '../../lib/fleet';
import { FleetCosts } from './FleetCosts';
import { FleetDashboard } from './FleetDashboard';
import { FleetMembers } from './FleetMembers';
import { FleetReports } from './FleetReports';
import { FleetVehicle } from './FleetVehicle';
import { FleetSubscription } from './FleetSubscription';
import { FleetVehicles } from './FleetVehicles';
import { useFleet, type FleetSection } from './fleetContext';
import styles from './fleet.module.css';

const NAV: { section: FleetSection; icon: LucideIcon }[] = [
  { section: 'panou', icon: LayoutDashboard },
  { section: 'vehicule', icon: CarFront },
  { section: 'costuri', icon: ReceiptText },
  { section: 'rapoarte', icon: BarChart3 },
  { section: 'membri', icon: Users },
];

/** The page of the current section (inside a FleetContext). */
export function FleetSectionBody({ section, vehicleId, filter }: { section: FleetSection; vehicleId: string | null; filter: string | undefined }) {
  switch (section) {
    case 'panou':
      return <FleetDashboard />;
    case 'vehicule':
      return <FleetVehicles key={filter ?? ''} initialStatus={filter} />;
    case 'vehicul':
      return <FleetVehicle key={vehicleId ?? ''} vehicleId={vehicleId ?? ''} />;
    case 'costuri':
      return <FleetCosts key={filter ?? ''} initialPeriod={filter} />;
    case 'rapoarte':
      return <FleetReports key={filter ?? ''} initialReport={filter} />;
    case 'membri':
      return <FleetMembers />;
    case 'abonament':
      return <FleetSubscription />;
  }
}

/**
 * The plan's notices at the top of Panou and Vehicule only (T64a): read-only, over the vehicle limit,
 * or the trial's last week. One at a time, the most serious first, with the way to the plan.
 */
export function FleetPlanNotice({ section, onOpen }: { section: FleetSection; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const { plan, data } = useFleet();
  if (!plan || (section !== 'panou' && section !== 'vehicule')) return null;
  const canSee = data.me.role !== 'driver';
  const action = canSee ? (
    <Button variant="ghost" onClick={onOpen}>
      {t('fleet.sub.open')}
    </Button>
  ) : undefined;
  const name = lang === 'ro' ? plan.name_ro : plan.name_en;
  const over = overLimit(plan.vehicles, plan.vehicle_limit);
  const days = trialDaysLeft(plan.trial_ends_at);
  if (plan.read_only)
    return (
      <Banner tone="warning" action={action}>
        {t('rpcError.fleet_read_only')}
      </Banner>
    );
  if (over > 0)
    return (
      <Banner tone="warning" action={action}>
        {t('fleet.sub.overVehicles', { n: over, limit: plan.vehicle_limit ?? 0, plan: name })}
      </Banner>
    );
  if (planState(plan) === 'trial' && days !== null && days <= TRIAL_WARN_DAYS && canSee)
    return (
      <Banner tone="info" action={action}>
        {t('fleet.sub.trialEnding', { days: plural(lang, 'unit.days', days) })}
      </Banner>
    );
  return null;
}

/** The plan in a word under the space switch: opens Abonament (not for a driver). */
function PlanBadge({ onOpen }: { onOpen: () => void }) {
  const { t, lang } = useI18n();
  const { plan, data } = useFleet();
  if (!plan || data.me.role === 'driver') return null;
  const st = planState(plan);
  const days = trialDaysLeft(plan.trial_ends_at);
  const detail = st === 'trial' && days !== null ? t('fleet.sub.badgeTrial', { days: plural(lang, 'unit.days', days) }) : t(`fleet.sub.state.${st}`);
  return (
    <button type="button" className={styles.planBadge} onClick={onOpen}>
      <CreditCard size={15} aria-hidden="true" />
      <span className={styles.planBadgeText}>
        <span className={styles.planBadgeName}>{lang === 'ro' ? plan.name_ro : plan.name_en}</span>
        <span className={styles.muted}>{detail}</span>
      </span>
    </button>
  );
}

/**
 * The company space's own frame (Eduard: its own experience, the platform's look): on a phone the
 * app's top bar (logo and name left, language right) and a bottom bar of the five fleet pages; on a
 * laptop the sidebar with the logo, the space (company or personal), the pages and the language.
 */
export function FleetFrame({
  companyName,
  section,
  onNav,
  personalTo,
  children,
}: {
  companyName: string;
  section: FleetSection;
  onNav: (section: FleetSection) => void;
  personalTo: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const active = section === 'vehicul' ? 'vehicule' : section;
  return (
    <div className={styles.frame}>
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
        <SpaceSwitch company={companyName} personalTo={personalTo} />
        <PlanBadge onOpen={() => onNav('abonament')} />
        <nav className={styles.sideNav}>
          {NAV.map(({ section: s, icon: Icon }) => (
            <button key={s} type="button" className={`${styles.sideItem} ${active === s ? styles.sideOn : ''}`} aria-current={active === s ? 'page' : undefined} onClick={() => onNav(s)}>
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
          <div className={styles.mobileSpace}>
            <SpaceSwitch company={companyName} personalTo={personalTo} />
            <PlanBadge onOpen={() => onNav('abonament')} />
          </div>
          {children}
        </div>
      </main>

      <nav className={styles.bottomNav} aria-label={t('fleet.nav.label')}>
        {NAV.map(({ section: s, icon: Icon }) => (
          <button key={s} type="button" className={`${styles.bottomItem} ${active === s ? styles.bottomOn : ''}`} aria-current={active === s ? 'page' : undefined} onClick={() => onNav(s)}>
            <Icon size={22} aria-hidden="true" />
            <span>{t(`fleet.nav.${s}Short` as 'fleet.nav.panouShort')}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Which space is open, always in sight: the company (building icon and name) or the personal one. */
function SpaceSwitch({ company, personalTo }: { company: string; personalTo: string }) {
  const { t } = useI18n();
  return (
    <div className={styles.space} role="group" aria-label={t('fleet.space.label')}>
      <span className={`${styles.spaceItem} ${styles.spaceOn}`} aria-current="true">
        <Building2 size={16} aria-hidden="true" />
        <span className={styles.spaceName}>{company}</span>
      </span>
      <Link to={personalTo} className={styles.spaceItem}>
        <User size={16} aria-hidden="true" />
        <span className={styles.spaceName}>{t('fleet.space.personal')}</span>
      </Link>
    </div>
  );
}
