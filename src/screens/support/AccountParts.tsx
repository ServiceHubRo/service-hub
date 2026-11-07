import type { SupportAccount } from '../../data/support';
import { useI18n } from '../../i18n/context';
import { Pill } from '../admin/parts';

/** Client or Service, and the account's state: text and color, never color alone. */
export function AccountPills({ account }: { account: Pick<SupportAccount, 'role' | 'state'> }) {
  const { t } = useI18n();
  return (
    <>
      <Pill tone="grey">{t(`support.account.role.${account.role}`)}</Pill>
      {account.state !== 'active' && (
        <Pill tone={account.state === 'suspended' ? 'red' : 'grey'}>{t(`support.account.state.${account.state}`)}</Pill>
      )}
    </>
  );
}
