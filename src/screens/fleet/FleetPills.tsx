import { useI18n } from '../../i18n/context';
import type { CostSource, JobStage, VehicleStatus } from '../../lib/fleet';
import { StatusPill } from '../../components/StatusPill';
import { toneOf } from '../../lib/statusTone';

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
  return <StatusPill tone={toneOf(VEHICLE_TONE[status])}>{t(`fleet.status.${status}`)}</StatusPill>;
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
  return <StatusPill tone={toneOf(STAGE_TONE[stage])}>{t(`fleet.stage.${stage}`)}</StatusPill>;
}

export function SourcePill({ source }: { source: CostSource }) {
  const { t } = useI18n();
  return <StatusPill tone={toneOf(source === 'service' ? 'blue' : 'muted')}>{t(`fleet.source.${source}`)}</StatusPill>;
}
