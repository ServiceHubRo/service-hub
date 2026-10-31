import { Building2, LinkIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { ActionButton } from '../../../components/ActionButton';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { SkeletonList } from '../../../components/Skeleton';
import { acceptCompanyInvite, getCompanyInvite } from '../../../data/companies';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import { companyPath } from './paths';
import { RolePill } from './RolePill';
import styles from './companies.module.css';

/**
 * An invitation link (T63b): `/c/firme/invitatie/<token>`. Inside the client app, so a visitor signs
 * in first and comes back here. The company, the invited address and the role, then "Acceptă". The
 * database accepts only the invited address, confirmed, once.
 */
export function CompanyInviteScreen() {
  const { t, lang } = useI18n();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const load = useCallback(() => getCompanyInvite(token), [token]);
  const { state, reload } = useLoad(load);

  let body;
  if (state.status === 'loading') body = <SkeletonList count={1} />;
  else if (state.status === 'error') body = <LoadError message={t('cos.loadError')} onRetry={reload} />;
  else if (!state.data) body = <EmptyState icon={LinkIcon} title={t('cos.inviteGone.title')} body={t('cos.inviteGone.body')} />;
  else {
    const invite = state.data;
    const other = !!user?.email && user.email.toLowerCase() !== invite.email.toLowerCase();
    body = (
      <Card className={styles.stack}>
        <div className={styles.inviteHead}>
          <Building2 size={22} aria-hidden="true" className={styles.rowIcon} />
          <h2 className={styles.cardTitle}>{invite.company_name}</h2>
          <RolePill role={invite.role} />
        </div>
        <p>{t('cos.inviteFor', { email: invite.email })}</p>
        {other && <p className={styles.warn}>{t('rpcError.invite_other_email')}</p>}
        <div>
          <ActionButton
            variant="primary"
            disabled={other}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            onAction={async (requestId) => {
              const company = await acceptCompanyInvite(token, requestId);
              navigate(companyPath(company.id), { replace: true });
            }}
          >
            {t('cos.inviteAccept')}
          </ActionButton>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader title={t('cos.inviteTitle')} />
      {body}
    </div>
  );
}
