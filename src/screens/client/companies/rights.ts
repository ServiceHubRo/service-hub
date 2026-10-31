import type { Lang } from '../../../i18n/translate';
import { formatMoney } from '../../../i18n/format';
import { translate } from '../../../i18n/translate';
import { can, RIGHT_TICKS, type FleetRole } from '../../../lib/fleet';

/** The ticks a role does not have already (a manager already approves, books, manages vehicles…). */
export function ticksFor(role: FleetRole) {
  return RIGHT_TICKS.filter((tick) => !tick.caps.every((c) => can(role, c)));
}

/** "Aprobă devize (până la 300 lei) · Bugete": the rights the admin gave, in one line; '' when none. */
export function rightsSummary(lang: Lang, role: FleetRole, extra: readonly string[] | undefined, limit: number | null | undefined): string {
  const given = new Set(extra ?? []);
  const parts = ticksFor(role)
    .filter((tick) => tick.caps.every((c) => given.has(c)))
    .map((tick) =>
      tick.key === 'approve' && limit != null
        ? translate(lang, 'cos.right.approveUpTo', { amount: formatMoney(lang, limit) })
        : translate(lang, `cos.right.${tick.key}` as 'cos.right.approve'),
    );
  if (role === 'manager' && limit != null) parts.unshift(translate(lang, 'cos.right.limitOwn', { amount: formatMoney(lang, limit) }));
  return parts.join(' · ');
}
