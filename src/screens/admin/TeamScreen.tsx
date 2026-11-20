import { UserCog, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { InlinePanel } from '../../components/InlinePanel';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { TextArea } from '../../components/TextArea';
import { adminZoneBack } from '../../app/adminZones';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import {
  adminGrantSupport,
  adminListSupportAgents,
  adminRevokeSupport,
  SUPPORT_REASON_MAX,
  type SupportAgent,
} from '../../data/support';
import { useI18n } from '../../i18n/context';
import type { Lang } from '../../i18n/translate';
import { translate } from '../../i18n/translate';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from './ActionPanels';
import { dateTime, day } from './format';
import { Pill, SectionTitle } from './parts';
import { ADMIN_TEAM_PATH } from './paths';
import styles from './admin.module.css';
import supportStyles from '../support/support.module.css';
import { PageHeader } from '../../components/PageHeader';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_TEAM_PATH);

/** The refusals of the team functions, in words that fit this screen. */
function teamError(lang: Lang, error: unknown): string {
  switch (toRpcError(error).code) {
    case 'not_found':
      return translate(lang, 'admin.team.err.notFound');
    case 'wrong_status':
      return translate(lang, 'admin.team.err.already');
    default:
      return rpcErrorMessage(lang, error);
  }
}

/**
 * Platformă → Echipa de suport (A2): the support agents, appointing one (a new client account, a
 * reason) and withdrawing the role (a reason; the agent's sessions end at once). Both are in the
 * audit log; former agents stay listed with when and why.
 */
export function TeamScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const { state, reload } = useLoad(adminListSupportAgents);
  const [notice, setNotice] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per agent, the chosen one beside the list
  // from 1024 px (in its place below); „Numește un agent” top right (P12).
  const agents = state.status === 'ready' ? state.data.agents : [];
  const { wide, selectedId, open, select } = useListDetail(
    agents.map((a) => a.id),
    'agent',
  );
  const chosen = agents.find((a) => a.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader
        back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }}
        title={t('admin.team.title')}
        actions={
          !granting ? (
            <Button variant="primary" onClick={() => setGranting(true)}>
              <UserPlus size={18} aria-hidden="true" /> {t('admin.team.grant.title')}
            </Button>
          ) : undefined
        }
      />
      {granting && (
        <InlinePanel title={t('admin.team.grant.title')} onClose={() => setGranting(false)}>
          <GrantForm
            onGranted={(displayId) => {
              setGranting(false);
              setNotice(t('admin.team.granted', { id: displayId }));
              reload();
            }}
            onCancel={() => setGranting(false)}
          />
        </InlinePanel>
      )}
      {notice && (
        <p className={supportStyles.notice} role="status">
          {notice}
        </p>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.team.loadError')} onRetry={reload} />;
  else
    list = (
      <>
        {agents.length === 0 ? (
          <EmptyState icon={UserCog} title={t('admin.team.empty')} />
        ) : (
          <ListRows label={t('admin.team.agents')}>
            {agents.map((a) => (
              <ListRow
                key={a.id}
                icon={<UserCog size={20} />}
                title={a.name || t('admin.noName')}
                detail={[a.display_id, a.email].filter(Boolean).join(' · ')}
                status={<AgentPill agent={a} />}
                attention={!a.suspended && !a.mfa_ready}
                selected={wide && a.id === selectedId}
                onSelect={() => select(a.id)}
              />
            ))}
          </ListRows>
        )}
        {state.data.former.length > 0 && (
          <section className={styles.section}>
            <SectionTitle>{t('admin.team.former')}</SectionTitle>
            <ListRows label={t('admin.team.former')}>
              {state.data.former.map((f) => (
                <ListRow
                  key={`${f.id}-${f.revoked_at}`}
                  icon={<UserCog size={20} />}
                  title={f.name || t('admin.noName')}
                  detail={[
                    f.display_id,
                    t('admin.team.formerLine', { date: dateTime(lang, f.revoked_at) }),
                    f.by ? t('admin.audit.by', { admin: f.by }) : null,
                    f.reason ? t('admin.audit.reason', { reason: f.reason }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </ListRows>
          </section>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.team.title')}
        header={header}
        list={list}
        detail={
          chosen && (
            <AgentDetail
              key={chosen.id}
              agent={chosen}
              onRevoked={() => {
                setNotice(t('admin.team.revoked', { id: chosen.display_id }));
                reload();
              }}
            />
          )
        }
      />
    </div>
  );
}

function AgentPill({ agent }: { agent: SupportAgent }) {
  const { t } = useI18n();
  return agent.suspended ? (
    <Pill tone="red">{t('admin.team.suspended')}</Pill>
  ) : agent.mfa_ready ? (
    <Pill tone="green">{t('admin.team.mfaReady')}</Pill>
  ) : (
    <Pill tone="amber">{t('admin.team.mfaPending')}</Pill>
  );
}

function GrantForm({ onGranted, onCancel }: { onGranted: (displayId: string) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [account, setAccount] = useState('');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState<{ account: boolean; reason: boolean }>({ account: false, reason: false });

  return (
    <form className={supportStyles.form} noValidate onSubmit={(e) => e.preventDefault()}>
      <p className={styles.muted}>{t('admin.team.grant.desc')}</p>
      <Field
        label={t('admin.team.grant.account')}
        autoComplete="off"
        maxLength={254}
        value={account}
        error={missing.account ? t('admin.team.grant.accountRequired') : null}
        onChange={(e) => {
          setAccount(e.target.value);
          setMissing((m) => ({ ...m, account: false }));
        }}
      />
      <TextArea
        label={t('admin.team.reason')}
        rows={3}
        maxLength={SUPPORT_REASON_MAX}
        value={reason}
        error={missing.reason ? t('admin.reasonRequired') : null}
        onChange={(e) => {
          setReason(e.target.value);
          setMissing((m) => ({ ...m, reason: false }));
        }}
      />
      <ActionButton
        submit
        onAction={async (requestId) => {
          const gaps = { account: !account.trim(), reason: !reason.trim() };
          if (gaps.account || gaps.reason) {
            setMissing(gaps);
            return;
          }
          const res = await adminGrantSupport(account.trim(), reason.trim(), requestId);
          setAccount('');
          setReason('');
          onGranted(res.display_id);
        }}
        errorMessage={(e) => teamError(lang, e)}
        canRetry={canRetryRpc}
      >
        {t('admin.team.grant.submit')}
      </ActionButton>
      <Button onClick={onCancel}>{t('common.cancel')}</Button>
    </form>
  );
}

function AgentDetail({ agent, onRevoked }: { agent: SupportAgent; onRevoked: () => void }) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const revokeRef = useRef<HTMLButtonElement>(null);

  return (
    <DetailPane
      id={agent.id}
      icon={<UserCog size={20} />}
      title={agent.name || t('admin.noName')}
      detail={[agent.display_id, agent.email].filter(Boolean).join(' · ')}
      status={<AgentPill agent={agent} />}
      panel={
        confirming ? (
          <ConfirmPanel
            title={t('admin.team.revoke')}
            body={t('admin.team.revoke.confirm', { id: agent.display_id })}
            textLabel={t('admin.team.reason')}
            textRequired
            confirmLabel={t('admin.team.revoke')}
            danger
            errorMessage={(e) => (toRpcError(e).code === 'not_found' ? t('admin.team.err.gone') : rpcErrorMessage(lang, e))}
            onConfirm={async (reason, requestId) => {
              await adminRevokeSupport(agent.id, reason, requestId);
              onRevoked();
            }}
            onCancel={() => {
              setConfirming(false);
              requestAnimationFrame(() => revokeRef.current?.focus());
            }}
          />
        ) : undefined
      }
      actions={
        <Button ref={revokeRef} variant="secondary" onClick={() => setConfirming(true)}>
          {t('admin.team.revoke')}
        </Button>
      }
    >
      {agent.granted_at && <p className={styles.muted}>{t('admin.team.since', { date: day(lang, agent.granted_at) })}</p>}
      <p className={styles.muted}>{t('admin.team.lastActive', { date: agent.last_active_at ? dateTime(lang, agent.last_active_at) : t('admin.never') })}</p>
    </DetailPane>
  );
}
