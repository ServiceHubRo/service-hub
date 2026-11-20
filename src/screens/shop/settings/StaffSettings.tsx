import { Check, Copy, Lock, User, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { InlinePanel } from '../../../components/InlinePanel';
import { DetailPane, ListDetailLayout } from '../../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../../components/ListRow';
import { PageHeader } from '../../../components/PageHeader';
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
import { plural, type Msg } from '../../../i18n/translate';
import { includedColleagues, monthlyAverage } from '../../../lib/subscription';
import { looksLikeEmail } from '../../../lib/password';
import { useListDetail } from '../../../lib/useListDetail';
import { useLoad } from '../../../lib/useLoad';
import { useLocation } from 'react-router-dom';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_PATH } from './paths';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';
import own from './StaffSettings.module.css';
import { StatusPill } from '../../../components/StatusPill';

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
  const { t, lang } = useI18n();
  const { isOwner } = useShopSettings();
  const load = useCallback(() => listStaff(), []);
  const { state, reload, setData } = useLoad(load);
  const [link, setLink] = useState<{ email: string; url: string; mailed: InviteEmailResult } | null>(null);

  const refresh = useCallback(async () => setData(await listStaff()), [setData]);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per colleague, the chosen one beside the
  // list from 1024 px (in its place below); „Invită un coleg” top right (P12).
  const members = state.status === 'ready' ? state.data : [];
  const { wide, selectedId, open, select } = useListDetail(
    members.map((m) => m.id),
    'coleg',
  );
  const chosen = members.find((m) => m.id === selectedId) ?? null;
  const [inviting, setInviting] = useState(false);
  const { pathname } = useLocation();

  if (!isOwner)
    return (
      <div className={styles.page}>
        <PageHeader back={{ to: SETTINGS_PATH, label: t('settings.title') }} title={t('settings.staff')} />
        <EmptyState icon={Lock} title={t('settings.ownerOnly')} />
      </div>
    );

  const header = (
    <>
      <PageHeader
        back={{ to: SETTINGS_PATH, label: t('settings.title') }}
        title={t('settings.staff')}
        actions={
          !inviting ? (
            <Button variant="primary" onClick={() => setInviting(true)} aria-label={t('staff.invite')}>
              <UserPlus size={18} aria-hidden="true" /> {t('action.invite')}
            </Button>
          ) : undefined
        }
      />
      {/* Read again whenever the team with accounts changes (a colleague removed here). */}
      <SeatPrice key={state.status === 'ready' ? state.data.filter((m) => m.role === 'staff' && m.accepted_at).length : -1} />
      {inviting && (
        <InlinePanel title={t('staff.invite')} onClose={() => setInviting(false)}>
          <InviteForm
            onInvited={async (email, url, mailed) => {
              setLink({ email, url, mailed });
              setInviting(false);
              await refresh().catch(() => undefined);
            }}
          />
          <Button onClick={() => setInviting(false)}>{t('common.cancel')}</Button>
        </InlinePanel>
      )}
      {link && <LinkPanel email={link.email} url={link.url} mailed={link.mailed} />}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('settings.loadError')} onRetry={reload} />;
  else
    list = (
      <ListRows label={t('staff.team')}>
        {members.map((m) => (
          <ListRow
            key={m.id}
            icon={<User size={20} />}
            title={`${m.name || m.email || ''}${m.is_me ? ` (${t('staff.you')})` : ''}`}
            detail={[m.name ? m.email : null, m.accepted_at === null ? (m.expired ? t('staff.expired') : t('staff.pending', { date: formatDate(lang, new Date(m.invited_at)) })) : null]
              .filter(Boolean)
              .join(' · ')}
            status={<StatusPill tone={m.role === 'owner' ? 'action' : 'neutral'}>{t(m.role === 'owner' ? 'staff.owner' : 'staff.member')}</StatusPill>}
            attention={m.accepted_at === null && m.expired}
            selected={wide && m.id === selectedId}
            onSelect={() => select(m.id)}
          />
        ))}
      </ListRows>
    );

  return (
    <ListDetailLayout
      wide={wide}
      open={open}
      backTo={pathname}
      backLabel={t('settings.staff')}
      header={header}
      list={list}
      detail={
        chosen && (
          <MemberDetail
            key={chosen.id}
            member={chosen}
            onRemoved={() => setData((list) => list.filter((x) => x.id !== chosen.id))}
            onNewLink={async (email, url, mailed) => {
              setLink({ email, url, mailed });
              await refresh().catch(() => undefined);
            }}
          />
        )
      }
    />
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
  const seat = formatMoney(lang, sub.seat_price_ron);
  const included = includedColleagues(lang, sub.free_seats);
  const now = { total: formatMoney(lang, monthlyAverage(sub)), colleagues: plural(lang, 'unit.colleagues', sub.seats) };
  return (
    <p className={styles.intro}>
      {included ? t('staff.seats.priceIncluded', { included, seat }) : t('staff.seats.price', { seat })}{' '}
      {sub.seats > 0 && (included ? t('staff.seats.nowExtra', now) : t('staff.seats.now', now))}
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
  const [error, setError] = useState<Msg | null>(null);
  const tokenFor = useTokenPerRequest();

  return (
    <Card>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
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
          error={error ? t(error.key, error.params) : null}
        />
        <ActionButton
          submit
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          onAction={async (requestId) => {
            if (!looksLikeEmail(email)) {
              setError({ key: 'auth.error.emailFormat' });
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
        {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
        {copied ? t('staff.copied') : t('staff.copy')}
      </Button>
    </Card>
  );
}

function MemberDetail({
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
    <DetailPane
      id={member.id}
      icon={<User size={20} />}
      title={`${who}${member.is_me ? ` (${t('staff.you')})` : ''}`}
      detail={member.name && member.email ? member.email : undefined}
      status={<StatusPill tone={member.role === 'owner' ? 'action' : 'neutral'}>{t(member.role === 'owner' ? 'staff.owner' : 'staff.member')}</StatusPill>}
      message={
        pending
          ? { tone: member.expired ? 'problem' : 'neutral', text: member.expired ? t('staff.expired') : t('staff.pending', { date: formatDate(lang, new Date(member.invited_at)) }) }
          : undefined
      }
      panel={
        confirming ? (
          <InlinePanel title={pending ? t('staff.cancelInviteConfirm', { email: member.email ?? '' }) : t('staff.removeConfirm', { name: who })} onClose={() => setConfirming(false)}>
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
          </InlinePanel>
        ) : undefined
      }
      actions={
        member.role === 'staff' ? (
          <>
            {pending && member.email && (
              <ActionButton
                variant="secondary"
                block={false}
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
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t(pending ? 'staff.cancelInvite' : 'staff.remove')}
            </Button>
          </>
        ) : undefined
      }
    />
  );
}
