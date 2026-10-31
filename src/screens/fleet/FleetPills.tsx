import { useI18n } from '../../i18n/context';
import type { CostSource, JobStage, VehicleStatus } from '../../lib/fleet';
import pill from '../../components/StatusBadge.module.css';

/** The pills of the fleet screens: the same shapes and tones as a booking's status, always a word. */
const VEHICLE_TONE: Record<VehicleStatus, string> = {
  active: 'green',
  scheduled: 'blue',
  in_service: 'amber',
  unavailable: 'red',
  archived: 'muted',
};

export function VehicleStatusPill({ status }: { status: VehicleStatus }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[VEHICLE_TONE[status]]}`}>{t(`fleet.status.${status}`)}</span>;
}

const STAGE_TONE: Record<JobStage, string> = {
  requested: 'blue',
  inspection: 'amber',
  estimate: 'amber',
  approved: 'green',
  in_progress: 'amber',
  final: 'blue',
  refused: 'muted',
  closed: 'muted',
};

export function JobStagePill({ stage }: { stage: JobStage }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[STAGE_TONE[stage]]}`}>{t(`fleet.stage.${stage}`)}</span>;
}

export function SourcePill({ source }: { source: CostSource }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[source === 'service' ? 'blue' : 'muted']}`}>{t(`fleet.source.${source}`)}</span>;
}
