import { useI18n } from '../../../i18n/context';
import type { FleetRole } from '../../../lib/fleet';
import { StatusPill, toneOf } from '../../../components/StatusPill';

const TONE: Record<FleetRole, string> = { admin: 'amber', manager: 'blue', driver: 'muted', accountant: 'green' };

/** A member's role in a company, as a word (never color alone). */
export function RolePill({ role }: { role: FleetRole }) {
  const { t } = useI18n();
  return <StatusPill tone={toneOf(TONE[role])}>{t(`fleet.role.${role}`)}</StatusPill>;
}
