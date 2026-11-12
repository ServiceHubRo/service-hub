import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { adminZoneBack } from '../../app/adminZones';
import { endAdminSessions, endMyOtherSessions, fetchAdmins, setAdminSuspended, type AdminAccount } from '../../data/adminSecurity';
import { rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { Lang } from '../../i18n/translate';
import { translate } from '../../i18n/translate';
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from './ActionPanels';
import { dateTime } from './format';
import { Pill, SectionTitle } from './parts';
import { ADMIN_ADMINS_PATH } from './paths';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_ADMINS_PATH);

type Panel = { id: string; action: 'sessions' | 'suspend' | 'reactivate' | 'mine' } | null;

/** The refusals of these functions, in words that fit this screen. */
function adminsError(lang: Lang, error: unknown): string {
  switch (toRpcError(error).code) {
    case 'wrong_status':
      return translate(lang, 'admin.admins.err.already');
    case 'not_found':
      return translate(lang, 'admin.admins.err.notFound');
    default:
      return rpcErrorMessage(lang, error);
  }
}

/**
 * Platformă → Administratori (A6, M6): the admins, and what one admin may do about another when an
 * account may be compromised — end all its sessions (its tokens stop at once), suspend it, reactivate
 * it — and end its own sessions on other devices. Never oneself, never the last active admin; a reason
 * every time, all in the audit log and the security log, all checked in the database. Admins are
 * still created only in the database (promote_to_admin), which also stays the way back if no active
 * admin remains.
 */
export function AdminsScreen() {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(fetchAdmins);
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = async (message: string) => {
    setPanel(null);
    setNotice(message);
    try {
      setData(await fetchAdmins());
    } catch {
      reload();
    }
  };

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.admins.title')}</h1>
        <p className={styles.muted}>{t('admin.admins.desc')}</p>
      </div>
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
      <section className={styles.section}>
        <SectionTitle>{t('admin.admins.list')}</SectionTitle>
        {state.status === 'loading' && <SkeletonList />}
        {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
        {state.status === 'ready' &&
          (state.data.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={t('admin.admins.empty')} />
          ) : (
            <ul className={styles.list}>
              {state.data.map((a) => (
                <li key={a.id}>
                  <AdminCard
                    admin={a}
                    activeOthers={state.data.filter((o) => !o.suspended && o.id !== a.id).length}
                    panel={panel?.id === a.id ? panel.action : null}
                    onPanel={(action) => setPanel(action ? { id: a.id, action } : null)}
                    onDone={(message) => void done(message)}
                  />
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

function AdminCard({
  admin: a,
  activeOthers,
  panel,
  onPanel,
  onDone,
}: {
  admin: AdminAccount;
  activeOthers: number;
  panel: 'sessions' | 'suspend' | 'reactivate' | 'mine' | null;
  onPanel: (action: 'sessions' | 'suspend' | 'reactivate' | 'mine' | null) => void;
  onDone: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const reason = { textLabel: t('admin.reason'), textHint: t('admin.reasonHint'), textRequired: true } as const;
  return (
    <Card className={styles.stack}>
      <span className={styles.rowTop}>
        <span className={styles.rowTitle}>
          {a.name || t('admin.noName')}
          {a.me && ` · ${t('admin.admins.me')}`}
        </span>
        <span className={styles.rowTop}>
          {a.suspended && <Pill tone="red">{t('admin.suspended')}</Pill>}
          {a.mfa_ready ? <Pill tone="green">{t('admin.team.mfaReady')}</Pill> : <Pill tone="amber">{t('admin.team.mfaPending')}</Pill>}
        </span>
      </span>
      <span className={styles.rowMeta}>
        <span className={styles.id}>{a.display_id}</span>
        <span>{t('admin.admins.sessions', { n: a.sessions })}</span>
        <span>
          {a.last_sign_in_at ? t('admin.admins.lastSignIn', { date: dateTime(lang, a.last_sign_in_at) }) : t('admin.admins.neverSignedIn')}
        </span>
      </span>

      {panel === null && (
        <div className={styles.actionGrid}>
          {a.me ? (
            <Button variant="secondary" onClick={() => onPanel('mine')}>
              {t('admin.admins.endMine')}
            </Button>
          ) : (
            <>
              {a.sessions > 0 && (
                <Button variant="secondary" onClick={() => onPanel('sessions')}>
                  {t('admin.admins.endSessions')}
                </Button>
              )}
              {a.suspended ? (
                <Button variant="secondary" onClick={() => onPanel('reactivate')}>
                  {t('admin.admins.reactivate')}
                </Button>
              ) : (
                activeOthers > 0 && (
                  <Button variant="danger" onClick={() => onPanel('suspend')}>
                    {t('admin.admins.suspend')}
                  </Button>
                )
              )}
            </>
          )}
        </div>
      )}
      {panel === 'mine' && (
        <ConfirmPanel
          title={t('admin.admins.endMine')}
          body={t('admin.admins.endMineBody')}
          {...reason}
          confirmLabel={t('admin.admins.endMine')}
          errorMessage={(e) => adminsError(lang, e)}
          onConfirm={async (why, requestId) => {
            const n = await endMyOtherSessions(why, requestId);
            onDone(t('admin.admins.done.endMine', { n }));
          }}
          onCancel={() => onPanel(null)}
        />
      )}
      {panel === 'sessions' && (
        <ConfirmPanel
          title={t('admin.admins.endSessions')}
          body={t('admin.admins.endSessionsBody', { id: a.display_id })}
          {...reason}
          confirmLabel={t('admin.admins.endSessions')}
          danger
          errorMessage={(e) => adminsError(lang, e)}
          onConfirm={async (why, requestId) => {
            const n = await endAdminSessions(a.id, why, requestId);
            onDone(t('admin.admins.done.endSessions', { id: a.display_id, n }));
          }}
          onCancel={() => onPanel(null)}
        />
      )}
      {panel === 'suspend' && (
        <ConfirmPanel
          title={t('admin.admins.suspend')}
          body={t('admin.admins.suspendBody', { id: a.display_id })}
          {...reason}
          confirmLabel={t('admin.admins.suspend')}
          danger
          errorMessage={(e) => adminsError(lang, e)}
          onConfirm={async (why, requestId) => {
            await setAdminSuspended(a.id, true, why, requestId);
            onDone(t('admin.admins.done.suspended', { id: a.display_id }));
          }}
          onCancel={() => onPanel(null)}
        />
      )}
      {panel === 'reactivate' && (
        <ConfirmPanel
          title={t('admin.admins.reactivate')}
          body={t('admin.admins.reactivateBody')}
          {...reason}
          confirmLabel={t('admin.admins.reactivate')}
          errorMessage={(e) => adminsError(lang, e)}
          onConfirm={async (why, requestId) => {
            await setAdminSuspended(a.id, false, why, requestId);
            onDone(t('admin.admins.done.reactivated', { id: a.display_id }));
          }}
          onCancel={() => onPanel(null)}
        />
      )}
    </Card>
  );
}
