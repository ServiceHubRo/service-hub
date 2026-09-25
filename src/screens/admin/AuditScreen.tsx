import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { AUDIT_PAGE, fetchAudit, type AuditEntry } from '../../data/admin';
import { rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { AuditList } from './parts';
import {
  ADMIN_ACCOUNT_PATH,
  ADMIN_CATALOG_PATH,
  ADMIN_MODERATION_PATH,
  ADMIN_NOTICES_PATH,
  ADMIN_REPORTS_PATH,
  ADMIN_TEXTS_PATH,
  adminBookingPath,
  adminClientPath,
  adminShopPath,
} from './paths';
import styles from './admin.module.css';

const loadFirst = () => fetchAudit();

/** A link with the entry's label to where the thing lives (T16b tools: the tool's screen). */
function toolLink(to: string, label: string) {
  return (
    <Link className={styles.link} to={to}>
      {label}
    </Link>
  );
}

function entityLink(e: AuditEntry) {
  if (e.entity_type === 'settings') {
    // The platform settings, or one push text (its key).
    return e.entity_id ? toolLink(`${ADMIN_TEXTS_PATH}?q=${encodeURIComponent(e.entity_id)}`, e.entity_id) : null;
  }
  if (!e.entity_id) return null;
  const label = e.label || e.entity_id.slice(0, 8);
  switch (e.entity_type) {
    case 'shop':
      return (
        <Link className={styles.link} to={adminShopPath(e.entity_id)}>
          {label}
        </Link>
      );
    case 'booking':
      return (
        <Link className={styles.link} to={adminBookingPath(e.entity_id)}>
          {label}
        </Link>
      );
    case 'review':
      return (
        <Link className={styles.link} to={ADMIN_MODERATION_PATH}>
          {label}
        </Link>
      );
    case 'profile':
      // Only a client account has a detail screen (a shop owner's is reached through the shop).
      return label.startsWith('C-') ? (
        <Link className={styles.link} to={adminClientPath(e.entity_id)}>
          {label}
        </Link>
      ) : (
        <span className={styles.muted}>{label}</span>
      );
    case 'report':
      return toolLink(`${ADMIN_REPORTS_PATH}?q=${encodeURIComponent(label)}`, label);
    case 'notice':
      return toolLink(ADMIN_NOTICES_PATH, label);
    case 'category':
    case 'service':
      return toolLink(`${ADMIN_CATALOG_PATH}?q=${encodeURIComponent(e.entity_id)}`, label);
    case 'export':
      return null;
    default:
      return <span className={styles.muted}>{label}</span>;
  }
}

/**
 * Jurnal de audit (P19): every admin action, newest first — who, what, on what, when, and the
 * values before → after. 100 at a time. A tile in the admin's Cont.
 */
export function AuditScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(loadFirst);
  const [more, setMore] = useState<{ busy: boolean; done: boolean; error: string | null }>({ busy: false, done: false, error: null });

  async function loadMore(entries: AuditEntry[]) {
    const last = entries[entries.length - 1];
    if (!last) return;
    setMore({ busy: true, done: false, error: null });
    try {
      const next = await fetchAudit(last.created_at);
      setData((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]);
      setMore({ busy: false, done: next.length < AUDIT_PAGE, error: null });
    } catch (e) {
      setMore({ busy: false, done: false, error: rpcErrorMessage(lang, e) });
    }
  }

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.audit.title')}</h1>
        <p className={styles.sub}>{t('admin.audit.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('admin.audit.empty')} />
        ) : (
          <>
            <AuditList entries={state.data} entityLink={entityLink} />
            {state.data.length >= AUDIT_PAGE && !more.done && (
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
