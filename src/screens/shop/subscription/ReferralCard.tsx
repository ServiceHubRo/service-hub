import { Copy, Gift, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { LoadError } from '../../../components/LoadError';
import { SkeletonList } from '../../../components/Skeleton';
import { getMyReferrals, type MyReferrals, type ReferralItem } from '../../../data/referrals';
import { useI18n } from '../../../i18n/context';
import { formatDayMonth, formatMoney } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { useLoad } from '../../../lib/useLoad';
import { webOrigin } from '../../../lib/native';
import { referralSignUpPath } from '../../auth/paths';
import sub from './subscription.module.css';
import styles from './ReferralCard.module.css';

/**
 * "Recomandă Service-Hub" on Abonament (owner only): the code, the sign-up link to send (WhatsApp
 * or copied), how many free months so far out of 12, and the shops brought with where each stands.
 * Re-read with the subscription (a reward also changes the free period or the credit).
 */
export function ReferralCard({ version }: { version: number }) {
  const { t } = useI18n();
  const load = useCallback(() => getMyReferrals(), []);
  const { state, reload, setData } = useLoad(load);

  // Quiet re-read when the subscription changes (a newer read always wins).
  const generation = useRef(0);
  useEffect(() => {
    if (version === 0) return;
    const mine = ++generation.current;
    getMyReferrals().then(
      (data) => {
        if (mine === generation.current) setData(data);
      },
      () => {},
    );
  }, [version, setData]);

  if (state.status === 'loading') return <SkeletonList count={1} />;
  if (state.status === 'error') return <LoadError message={t('ref.loadError')} onRetry={reload} />;
  if (!state.data) return null;
  return <Referrals data={state.data} />;
}

function Referrals({ data }: { data: MyReferrals }) {
  const { t, lang } = useI18n();
  const url = `${webOrigin()}${referralSignUpPath(data.code)}`;
  const message = t('ref.message', { code: data.code, url });
  return (
    <Card className={styles.card}>
      <h2 className={styles.title}>
        <Gift size={20} className={styles.icon} aria-hidden="true" /> {t('ref.title')}
      </h2>
      <p>{t('ref.lead', { max: data.maxRewards })}</p>
      <p className={sub.muted}>{t('ref.how', { days: plural(lang, 'unit.days', data.trialDays) })}</p>
      <div className={styles.codeBox}>
        <span className={sub.muted}>{t('ref.code')}</span>
        <span className={`mono ${styles.code}`}>{data.code}</span>
      </div>
      <a
        className={buttonClass('primary', true)}
        href={`https://wa.me/?text=${encodeURIComponent(message)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MessageCircle size={18} aria-hidden="true" /> {t('ref.whatsapp')}
      </a>
      <CopyLink url={url} />
      <p className={styles.earned}>{t('ref.earned', { n: data.rewarded, max: data.maxRewards })}</p>
      <div
        className={sub.meter}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={data.maxRewards}
        aria-valuenow={data.rewarded}
        aria-label={t('ref.earned', { n: data.rewarded, max: data.maxRewards })}
      >
        <span style={{ width: `${Math.min(100, Math.round((data.rewarded / Math.max(1, data.maxRewards)) * 100))}%` }} />
      </div>
      <h3 className={styles.subtitle}>{t('ref.shops')}</h3>
      {data.items.length === 0 ? (
        <p className={sub.muted}>{t('ref.empty')}</p>
      ) : (
        <ul className={styles.list}>
          {data.items.map((item) => (
            <li key={`${item.name}-${item.joined_at}`}>
              <ReferralRow item={item} max={data.maxRewards} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATE_TONE = { trial: 'toneAmber', waiting: 'toneMuted', rewarded: 'toneGreen', refused: 'toneMuted' } as const;

function ReferralRow({ item, max }: { item: ReferralItem; max: number }) {
  const { t, lang } = useI18n();
  let detail = t('ref.joined', { date: formatDayMonth(lang, new Date(item.joined_at)) });
  if (item.state === 'rewarded') {
    detail =
      item.reward_kind === 'trial_days'
        ? t('ref.reward.days', { days: plural(lang, 'unit.days', item.reward_days ?? 0) })
        : t('ref.reward.credit', { amount: formatMoney(lang, item.reward_amount ?? 0) });
  } else if (item.state === 'refused' && item.reason) {
    detail = t(`ref.reason.${item.reason}`, { max });
  }
  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.name}>{item.name}</span>
        <span className={sub.muted}>{[item.city, detail].filter(Boolean).join(' · ')}</span>
      </div>
      <span className={`${sub.pill} ${sub[STATE_TONE[item.state]]}`}>{t(`ref.state.${item.state}`)}</span>
    </div>
  );
}

/** The link, selectable, with a copy button (the field is selected when copying is not allowed). */
function CopyLink({ url }: { url: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      inputRef.current?.select();
    }
  }

  return (
    <>
      <label htmlFor="referral-link" className="visually-hidden">
        {t('ref.link')}
      </label>
      <input
        id="referral-link"
        ref={inputRef}
        readOnly
        className={`mono ${styles.linkInput}`}
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <Button variant="secondary" block onClick={() => void copy()}>
        <Copy size={18} aria-hidden="true" />
        <span role="status">{copied ? t('ref.copied') : t('ref.copy')}</span>
      </Button>
    </>
  );
}
