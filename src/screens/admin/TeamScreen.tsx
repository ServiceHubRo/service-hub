import { UserCog } from 'lucide-react';
import { useRef, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
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
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from './ActionPanels';
import { dateTime, day } from './format';
import { Pill, SectionTitle } from './parts';
import { ADMIN_TEAM_PATH } from './paths';
import styles from './admin.module.css';
import supportStyles from '../support/support.module.css';

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
  const { state, reload } = useLoad(adminListSupportAgents);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.team.title')}</h1>
      </div>

      <GrantForm
        onGranted={(displayId) => {
          setNotice(t('admin.team.granted', { id: displayId }));
          reload();
        }}
      />
      {notice && (
        <p className={supportStyles.notice} role="status">
          {notice}
        </p>
      )}

      <section className={styles.section}>
        <SectionTitle>{t('admin.team.agents')}</SectionTitle>
        {state.status === 'loading' && <SkeletonList />}
        {state.status === 'error' && <LoadError message={t('admin.team.loadError')} onRetry={reload} />}
        {state.status === 'ready' &&
          (state.data.agents.length === 0 ? (
            <EmptyState icon={UserCog} title={t('admin.team.empty')} />
          ) : (
            <ul className={styles.list}>
              {state.data.agents.map((a) => (
                <li key={a.id}>
                  <AgentCard
                    agent={a}
                    onRevoked={() => {
                      setNotice(t('admin.team.revoked', { id: a.display_id }));
                      reload();
                    }}
                  />
                </li>
              ))}
            </ul>
          ))}
      </section>

      {state.status === 'ready' && state.data.former.length > 0 && (
        <section className={styles.section}>
          <SectionTitle>{t('admin.team.former')}</SectionTitle>
          <ul className={styles.list}>
            {state.data.former.map((f) => (
              <li key={`${f.id}-${f.revoked_at}`}>
                <Card className={supportStyles.agent}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowTitle}>{f.name || t('admin.noName')}</span>
                  </span>
                  <span className={styles.rowMeta}>
                    {f.display_id && <span className={styles.id}>{f.display_id}</span>}
                    <span>{t('admin.team.formerLine', { date: dateTime(lang, f.revoked_at) })}</span>
                    {f.by && <span>{t('admin.audit.by', { admin: f.by })}</span>}
                  </span>
                  {f.reason && <span className={styles.muted}>{t('admin.audit.reason', { reason: f.reason })}</span>}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GrantForm({ onGranted }: { onGranted: (displayId: string) => void }) {
  const { t, lang } = useI18n();
  const [account, setAccount] = useState('');
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState<{ account: boolean; reason: boolean }>({ account: false, reason: false });

  return (
    <section className={styles.section}>
      <SectionTitle>{t('admin.team.grant.title')}</SectionTitle>
      <Card>
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
        </form>
      </Card>
    </section>
  );
}

function AgentCard({ agent, onRevoked }: { agent: SupportAgent; onRevoked: () => void }) {
  const { t, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const revokeRef = useRef<HTMLButtonElement>(null);

  return (
    <Card className={supportStyles.agent}>
      <span className={styles.rowTop}>
        <span className={styles.rowTitle}>{agent.name || t('admin.noName')}</span>
        {agent.suspended ? (
          <Pill tone="red">{t('admin.team.suspended')}</Pill>
        ) : agent.mfa_ready ? (
          <Pill tone="green">{t('admin.team.mfaReady')}</Pill>
        ) : (
          <Pill tone="amber">{t('admin.team.mfaPending')}</Pill>
        )}
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.id}>{agent.display_id}</span>
        {agent.email && <span>{agent.email}</span>}
      </span>
      <span className={styles.rowMeta}>
        {agent.granted_at && <span>{t('admin.team.since', { date: day(lang, agent.granted_at) })}</span>}
        <span>{t('admin.team.lastActive', { date: agent.last_active_at ? dateTime(lang, agent.last_active_at) : t('admin.never') })}</span>
      </span>
      {confirming ? (
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
      ) : (
        <div className={supportStyles.actions}>
          <Button ref={revokeRef} variant="secondary" onClick={() => setConfirming(true)}>
            {t('admin.team.revoke')}
          </Button>
        </div>
      )}
    </Card>
  );
}
