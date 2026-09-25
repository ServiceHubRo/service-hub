import { Copy, Lock, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { SkeletonList } from '../../../components/Skeleton';
import { rpcErrorMessage } from '../../../data/rpc';
import {
  emailInvite,
  inviteLink,
  inviteStaff,
  listStaff,
  newInviteToken,
  removeStaff,
  type InviteEmailResult,
  type StaffMember,
} from '../../../data/shop';
import { getSubscriptionRow } from '../../../data/subscription';
import { useI18n } from '../../../i18n/context';
import { formatDate, formatMoney } from '../../../i18n/format';
import { plural } from '../../../i18n/translate';
import { monthlyTotal } from '../../../lib/subscription';
import { looksLikeEmail } from '../../../lib/password';
import { useLoad } from '../../../lib/useLoad';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_PATH } from './paths';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './StaffSettings.module.css';

/**
 * The invitation token belongs to one request id: a retry of the same request must send the same
 * token, because the server answers a repeated request with the first result.
 */
function useTokenPerRequest() {
  const ref = useRef<{ requestId: string; token: string } | null>(null);
  return (requestId: string) => {
    if (ref.current?.requestId !== requestId) ref.current = { requestId, token: newInviteToken() };
    return ref.current.token;
  };
}

/**
 * Personal (P5b): invite by email (T13; the link is shown too, for WhatsApp or when the email does
 * not arrive), list, remove. Owner only.
 */
export function StaffSettings() {
  const { t } = useI18n();
  const { isOwner } = useShopSettings();
  const load = useCallback(() => listStaff(), []);
  const { state, reload, setData } = useLoad(load);
  const [link, setLink] = useState<{ email: string; url: string; mailed: InviteEmailResult } | null>(null);

  const refresh = useCallback(async () => setData(await listStaff()), [setData]);

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.staff')}</h1>
      {!isOwner ? (
        <EmptyState icon={Lock} title={t('settings.ownerOnly')} />
      ) : (
        <>
          <p className={styles.intro}>{t('staff.intro')}</p>
          {/* Read again whenever the team with accounts changes (a colleague removed here). */}
          <SeatPrice
            key={state.status === 'ready' ? state.data.filter((m) => m.role === 'staff' && m.accepted_at).length : -1}
          />

          <InviteForm
            onInvited={async (email, url, mailed) => {
              setLink({ email, url, mailed });
              await refresh().catch(() => undefined);
            }}
          />
          {link && <LinkPanel email={link.email} url={link.url} mailed={link.mailed} />}

          <h2 className={styles.section}>{t('staff.team')}</h2>
          {state.status === 'loading' && <SkeletonList />}
          {state.status === 'error' && <LoadError message={t('settings.loadError')} onRetry={reload} />}
          {state.status === 'ready' && (
            <div className={styles.stack}>
              {state.data.map((m) => (
                <MemberCard
                  key={m.id}
                  member={m}
                  onRemoved={() => setData((list) => list.filter((x) => x.id !== m.id))}
                  onNewLink={async (email, url, mailed) => {
                    setLink({ email, url, mailed });
                    await refresh().catch(() => undefined);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What a colleague costs (paid staff seats): the price per colleague with an account, and what the
 * shop pays now. Shown once the subscription is read; nothing while loading or if it cannot be.
 */
function SeatPrice() {
  const { t, lang } = useI18n();
  const load = useCallback(() => getSubscriptionRow(), []);
  const { state } = useLoad(load);
  if (state.status !== 'ready' || !state.data || !(state.data.seat_price_ron > 0)) return null;
  const sub = state.data;
  return (
    <p className={styles.intro}>
      {t('staff.seats.price', { seat: formatMoney(lang, sub.seat_price_ron) })}{' '}
      {sub.seats > 0 &&
        t('staff.seats.now', { total: formatMoney(lang, monthlyTotal(sub)), colleagues: plural(lang, 'unit.colleagues', sub.seats) })}
    </p>
  );
}

function InviteForm({
  onInvited,
}: {
  onInvited: (email: string, url: string, mailed: InviteEmailResult) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tokenFor = useTokenPerRequest();

  return (
    <Card>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        <p className={styles.cardTitle}>{t('staff.invite')}</p>
        <Field
          label={t('staff.inviteEmail')}
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          error={error}
        />
        <ActionButton
          submit
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          onAction={async (requestId) => {
            if (!looksLikeEmail(email)) {
              setError(t('auth.error.emailFormat'));
              return;
            }
            const token = tokenFor(requestId);
            await inviteStaff(email.trim(), token, requestId);
            const mailed = await emailInvite(token, lang);
            setEmail('');
            await onInvited(email.trim().toLowerCase(), inviteLink(token), mailed);
          }}
        >
          <UserPlus size={18} aria-hidden="true" /> {t('staff.inviteSend')}
        </ActionButton>
      </form>
    </Card>
  );
}

/** Whether the email left, and the link with a copy button (the address is also selectable in the field). */
function LinkPanel({ email, url, mailed }: { email: string; url: string; mailed: InviteEmailResult }) {
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
    <Card highlight className={styles.stack}>
      <p role="status">{t(mailed === 'failed' ? 'staff.emailFailed' : 'staff.emailSent', { email })}</p>
      <div className={own.link}>
        <label htmlFor="invite-link" className="visually-hidden">
          {t('staff.link')}
        </label>
        <input
          id="invite-link"
          ref={inputRef}
          readOnly
          className={`mono ${own.linkInput}`}
          value={url}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <Button variant="primary" block onClick={() => void copy()}>
        <Copy size={18} aria-hidden="true" />
        {copied ? t('staff.copied') : t('staff.copy')}
      </Button>
    </Card>
  );
}

function MemberCard({
  member,
  onRemoved,
  onNewLink,
}: {
  member: StaffMember;
  onRemoved: () => void;
  onNewLink: (email: string, url: string, mailed: InviteEmailResult) => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const tokenFor = useTokenPerRequest();
  const pending = member.accepted_at === null;
  const who = member.name || member.email || '';

  return (
    <Card>
      <div className={styles.cardHead}>
        <div className={own.who}>
          <p className={styles.cardTitle}>
            {who}
            {member.is_me && <span className={own.me}> ({t('staff.you')})</span>}
          </p>
          {member.name && member.email && <p className={styles.note}>{member.email}</p>}
          {pending && (
            <p className={member.expired ? styles.warn : styles.note}>
              {member.expired ? t('staff.expired') : t('staff.pending', { date: formatDate(lang, new Date(member.invited_at)) })}
            </p>
          )}
        </div>
        <span className={member.role === 'owner' ? own.roleOwner : own.role}>
          {t(member.role === 'owner' ? 'staff.owner' : 'staff.member')}
        </span>
      </div>

      {member.role === 'staff' && !confirming && (
        <div className={`${styles.rowButtons} ${own.buttons}`}>
          {pending && member.email && (
            <ActionButton
              variant="secondary"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async (requestId) => {
                const token = tokenFor(requestId);
                await inviteStaff(member.email!, token, requestId);
                await onNewLink(member.email!, inviteLink(token), await emailInvite(token, lang));
              }}
            >
              {t('staff.newLink')}
            </ActionButton>
          )}
          <Button block variant="ghost" onClick={() => setConfirming(true)}>
            {t(pending ? 'staff.cancelInvite' : 'staff.remove')}
          </Button>
        </div>
      )}
      {confirming && (
        <div className={`${styles.confirm} ${own.buttons}`}>
          <p>{pending ? t('staff.cancelInviteConfirm', { email: member.email ?? '' }) : t('staff.removeConfirm', { name: who })}</p>
          <div className={styles.rowButtons}>
            <ActionButton
              variant="danger"
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              onAction={async () => {
                await removeStaff(member.id);
                onRemoved();
              }}
            >
              {t(pending ? 'staff.cancelYes' : 'staff.removeYes')}
            </ActionButton>
            <Button block onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
