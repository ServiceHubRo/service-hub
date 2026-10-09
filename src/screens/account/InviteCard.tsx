import { ChevronRight, Copy, Gift, MessageCircle, Send, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { MenuButton, type MenuItem } from '../../components/MenuButton';
import { SkeletonList } from '../../components/Skeleton';
import { getMyInvites, type MyInvites } from '../../data/referrals';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { webOrigin } from '../../lib/native';
import { inviteSignUpPath } from '../auth/paths';
import { MY_REPORTS_PATH } from '../client/paths';
import styles from '../shop/subscription/ReferralCard.module.css';

/**
 * "Invită un prieten" in the client's Cont (T35): the client's code and one "Trimite invitația"
 * button whose menu sends the sign-up link on WhatsApp, copies it or hands it to another app
 * (Eduard, 9 Oct: one menu, not a row of buttons); how many friends and free reports so far.
 * Hidden while the admin has the reward turned off (0 a year).
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
  const message = t('friend.message', { url });
  // "Copiat" for a moment; when the browser refuses to copy, the link is shown to copy by hand.
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (copied === 'manual') linkRef.current?.select();
  }, [copied]);

  const items: MenuItem[] = [
    {
      key: 'whatsapp',
      icon: <MessageCircle size={18} aria-hidden="true" />,
      label: t('friend.whatsapp'),
      href: `https://wa.me/?text=${encodeURIComponent(message)}`,
      external: true,
    },
    {
      key: 'copy',
      icon: <Copy size={18} aria-hidden="true" />,
      label: t('ref.copy'),
      onSelect: () => {
        navigator.clipboard.writeText(url).then(
          () => {
            setCopied('yes');
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(null), 2000);
          },
          () => setCopied('manual'),
        );
      },
    },
    // The phone's own share sheet (Messenger, SMS, email…), where there is one.
    ...(typeof navigator.share === 'function'
      ? [
          {
            key: 'share',
            icon: <Share2 size={18} aria-hidden="true" />,
            label: t('friend.other'),
            onSelect: () => void navigator.share({ text: message }).catch(() => undefined),
          },
        ]
      : []),
  ];

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
      <MenuButton
        label={
          <>
            <Send size={18} aria-hidden="true" /> {t('friend.send')}
          </>
        }
        items={items}
      />
      <p className={styles.muted} role="status">
        {copied === 'yes' ? t('ref.copied') : ''}
      </p>
      {copied === 'manual' && (
        <>
          <label htmlFor="invite-link" className="visually-hidden">
            {t('ref.link')}
          </label>
          <input
            id="invite-link"
            ref={linkRef}
            readOnly
            className={`mono ${styles.linkInput}`}
            value={url}
            onFocus={(e) => e.target.select()}
          />
        </>
      )}
      <p className={styles.muted}>{t('friend.stats', { invited: data.invited, rewarded: data.rewarded })}</p>
      {data.creditsAvailable > 0 && (
        <p className={styles.available}>
          <span className={styles.earned}>{t('friend.available', { credits: plural(lang, 'unit.freeReports', data.creditsAvailable) })}</span>
          <Link className={styles.textLink} to={MY_REPORTS_PATH}>
            {t('friend.use')}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </p>
      )}
    </Card>
  );
}
