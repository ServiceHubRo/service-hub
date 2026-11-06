import { useI18n } from '../../i18n/context';
import type { FleetMaintenanceItem } from '../../lib/fleet';

/** A maintenance item's name: the kind, or the label typed for a custom one. */
export function useMaintenanceName() {
  const { t } = useI18n();
  return (i: Pick<FleetMaintenanceItem, 'kind' | 'label'>) => (i.kind === 'custom' ? (i.label ?? '') : t(`fleet.maint.kind.${i.kind}`));
}
