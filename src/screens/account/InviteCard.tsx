import { ChevronRight, Gift, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { getMyInvites, type MyInvites } from '../../data/referrals';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { webOrigin } from '../../lib/native';
import { inviteSignUpPath } from '../auth/paths';
import { MY_REPORTS_PATH } from '../client/paths';
import { CopyLink } from '../shop/subscription/ReferralCard';
import styles from '../shop/subscription/ReferralCard.module.css';

/**
 * "Invită un prieten" in the client's Cont (T35): the sign-up link with the client's code, sent on
 * WhatsApp or copied, and how many friends and free reports so far. Hidden while the admin has the
 * reward turned off (0 a year).
 */
export function InviteCard() {
  const { t } = useI18n();
  const { state, reload } = useLoad(getMyInvites);
  if (state.status === 'loading') return <SkeletonList count={1} />;
  if (state.status === 'error') return <LoadError message={t('friend.loadError')} onRetry={reload} />;
  if (!state.data || (state.data.creditsPerYear === 0 && state.data.creditsAvailable === 0)) return null;
  return <Invites data={state.data} />;
}

function Invites({ data }: { data: MyInvites }) {
  const { t, lang } = useI18n();
  const url = `${webOrigin()}${inviteSignUpPath(data.code)}`;
  return (
    <Card className={styles.card} aria-labelledby="invite-title" role="region">
      <h2 id="invite-title" className={styles.title}>
        <Gift size={20} className={styles.icon} aria-hidden="true" /> {t('friend.title')}
      </h2>
      <p>{t('friend.lead')}</p>
      {data.creditsPerYear > 0 && (
        <p className={styles.muted}>{t('friend.limit', { credits: plural(lang, 'unit.freeReports', data.creditsPerYear) })}</p>
      )}
      <div className={styles.codeBox}>
        <span className={styles.muted}>{t('friend.code')}</span>
        <span className={`mono ${styles.code}`}>{data.code}</span>
      </div>
      <a
        className={buttonClass('primary', true)}
        href={`https://wa.me/?text=${encodeURIComponent(t('friend.message', { url }))}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle size={18} aria-hidden="true" /> {t('friend.whatsapp')}
      </a>
      <CopyLink url={url} id="invite-link" />
      <p className={styles.muted}>{t('friend.stats', { invited: data.invited, rewarded: data.rewarded })}</p>
      {data.creditsAvailable > 0 && (
        <div className={styles.available}>
          <p className={styles.earned}>{t('friend.available', { credits: plural(lang, 'unit.freeReports', data.creditsAvailable) })}</p>
          <Link className={buttonClass('secondary', true)} to={MY_REPORTS_PATH}>
            {t('friend.use')} <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </div>
      )}
    </Card>
  );
}
