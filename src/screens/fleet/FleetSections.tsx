import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { planNotice } from '../../lib/fleet';
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
  const notice = planNotice(plan, data.me.role);
  if (!notice) return null;
  const action =
    data.me.role !== 'driver' ? (
      <Button variant="ghost" onClick={onOpen}>
        {t('fleet.sub.open')}
      </Button>
    ) : undefined;
  const name = lang === 'ro' ? plan.name_ro : plan.name_en;
  const text =
    notice.kind === 'expired'
      ? t('rpcError.fleet_read_only')
      : notice.kind === 'payment'
        ? t('fleet.sub.pastDue')
        : notice.kind === 'overVehicles'
          ? t('fleet.sub.overVehicles', { n: notice.over ?? 0, limit: notice.limit ?? 0, plan: name })
          : notice.kind === 'overMembers'
            ? t('fleet.sub.overMembers', { n: notice.over ?? 0, limit: notice.limit ?? 0 })
            : t('fleet.sub.trialEnding', { days: plural(lang, 'unit.days', notice.days ?? 0) });
  return (
    <Banner tone={notice.tone} action={action}>
      {text}
    </Banner>
  );
}

