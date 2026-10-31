import { useI18n } from '../../../i18n/context';
import type { FleetRole } from '../../../lib/fleet';
import pill from '../../../components/StatusBadge.module.css';

const TONE: Record<FleetRole, string> = { admin: 'amber', manager: 'blue', driver: 'muted', accountant: 'green' };

/** A member's role in a company, as a word (never color alone). */
export function RolePill({ role }: { role: FleetRole }) {
  const { t } = useI18n();
  return <span className={`${pill.pill} ${pill[TONE[role]]}`}>{t(`fleet.role.${role}`)}</span>;
}
