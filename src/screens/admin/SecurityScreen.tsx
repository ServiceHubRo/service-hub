import { ShieldAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ChoiceFilters } from '../../components/Filters';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { adminZoneBack } from '../../app/adminZones';
import {
  fetchSecurityEvents,
  REPEATED_FROM,
  SECURITY_EVENT_KINDS,
  SECURITY_PAGE,
  SECURITY_SEVERITIES,
  type SecurityEvent,
  type SecuritySeverity,
} from '../../data/adminSecurity';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { useLoad } from '../../lib/useLoad';
import { dateTime } from './format';
import { Pill } from './parts';
import { ADMIN_SECURITY_PATH } from './paths';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_SECURITY_PATH);

const TONE: Record<SecuritySeverity, 'red' | 'amber' | 'grey'> = { high: 'red', warning: 'amber', info: 'grey' };

/** The event's name; a kind without words (a newer one) shows its code. */
function kindLabel(t: (key: MessageKey) => string, kind: string): string {
  return (SECURITY_EVENT_KINDS as readonly string[]).includes(kind) ? t(`admin.security.kind.${kind}` as MessageKey) : kind;
}

/**
 * Platformă → Securitate (A6, M3): the security events, newest first — what happened, how serious,
 * who (role and ID, never a name), on which account, how many times in the hour. The same event
 * repeated is one row with its count; five or more in an hour are marked as unusual activity.
 * Admins only (admin_security_events). Refusals raised inside a database function are in the
 * Postgres log, not here (docs/SECURITATE.md).
 */
export function SecurityScreen() {
  const { t, lang } = useI18n();
  const [severity, setSeverity] = useState<SecuritySeverity | ''>('');
  const load = useCallback(() => fetchSecurityEvents(severity || null), [severity]);
  const { state, reload, setData } = useLoad(load);
  const [more, setMore] = useState<{ busy: boolean; done: boolean; error: string | null }>({ busy: false, done: false, error: null });

  async function loadMore(events: SecurityEvent[]) {
    const last = events[events.length - 1];
    if (!last) return;
    setMore({ busy: true, done: false, error: null });
    try {
      const next = await fetchSecurityEvents(severity || null, last.last_at);
      setData((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]);
      setMore({ busy: false, done: next.length < SECURITY_PAGE, error: null });
    } catch (e) {
      setMore({ busy: false, done: false, error: rpcErrorMessage(lang, e) });
    }
  }

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.security.title')}</h1>
        <p className={styles.muted}>{t('admin.security.desc')}</p>
      </div>
      <ChoiceFilters
        groups={[
          {
            key: 'severity',
            title: t('admin.security.severity'),
            options: [
              { value: '', label: t('admin.security.severity.all') },
              ...SECURITY_SEVERITIES.map((s) => ({ value: s, label: t(`admin.security.severity.${s}`) })),
            ],
            value: severity,
            defaultValue: '',
            onChange: (v: string) => {
              setSeverity(v as SecuritySeverity | '');
              setMore({ busy: false, done: false, error: null });
            },
          },
        ]}
        onClearAll={() => setSeverity('')}
      />
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState icon={ShieldAlert} title={t('admin.security.empty')} />
        ) : (
          <>
            <ul className={styles.list}>
              {state.data.map((e) => (
                <li key={e.id}>
                  <Card>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{kindLabel(t, e.kind)}</span>
                      <span className={styles.rowTop}>
                        {e.occurrences >= REPEATED_FROM && <Pill tone="red">{t('admin.security.repeated')}</Pill>}
                        <Pill tone={TONE[e.severity]}>{t(`admin.security.severity.${e.severity}`)}</Pill>
                      </span>
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{dateTime(lang, e.last_at)}</span>
                      {e.occurrences > 1 && (
                        <span>{t('admin.security.times', { n: e.occurrences, since: dateTime(lang, e.first_at) })}</span>
                      )}
                      {e.actor_display_id && (
                        <span>
                          {t('admin.security.by')} <span className={styles.id}>{e.actor_display_id}</span>
                        </span>
                      )}
                      {e.subject_display_id && e.subject_display_id !== e.actor_display_id && (
                        <span>
                          {t('admin.security.on')} <span className={styles.id}>{e.subject_display_id}</span>
                        </span>
                      )}
                    </span>
                  </Card>
                </li>
              ))}
            </ul>
            {state.data.length >= SECURITY_PAGE && !more.done && (
              <Button className={styles.more} disabled={more.busy} onClick={() => void loadMore(state.data)}>
                {t('admin.showMore')}
              </Button>
            )}
            {more.error && (
              <p className={styles.warning} role="alert">
                {more.error}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
