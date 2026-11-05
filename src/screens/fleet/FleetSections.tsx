import { CreditCard } from 'lucide-react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { overLimit, planState, trialDaysLeft, TRIAL_WARN_DAYS } from '../../lib/fleet';
import { FleetCosts } from './FleetCosts';
import { FleetDashboard } from './FleetDashboard';
import { FleetMembers } from './FleetMembers';
import { FleetAccount } from './FleetAccount';
import { FleetBookings } from './FleetBookings';
import { FleetReports } from './FleetReports';
import { FleetVehicle } from './FleetVehicle';
import { FleetSubscription } from './FleetSubscription';
import { FleetVehicles } from './FleetVehicles';
import { useFleet, type FleetSection } from './fleetContext';
import styles from './fleet.module.css';

/** The page of the current section (inside a FleetContext). */
export function FleetSectionBody({ section, vehicleId, filter }: { section: FleetSection; vehicleId: string | null; filter: string | undefined }) {
  switch (section) {
    case 'panou':
      return <FleetDashboard />;
    case 'vehicule':
      return <FleetVehicles key={filter ?? ''} initialStatus={filter} />;
    case 'vehicul':
      return <FleetVehicle key={vehicleId ?? ''} vehicleId={vehicleId ?? ''} />;
    case 'programari':
      return <FleetBookings key={filter ?? ''} initialGroup={filter} />;
    case 'costuri':
      return <FleetCosts key={filter ?? ''} initialPeriod={filter} />;
    case 'cont':
      return <FleetAccount />;
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
export function PlanBadge({ onOpen }: { onOpen: () => void }) {
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

