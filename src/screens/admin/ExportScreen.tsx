import { Link } from 'react-router-dom';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { EXPORT_KINDS, type ExportKind } from '../../data/adminTools';
import { useI18n } from '../../i18n/context';
import { ExportButton } from './ExportButton';
import { ADMIN_ACCOUNT_PATH, ADMIN_BOOKINGS_PATH, ADMIN_CLIENTS_PATH, ADMIN_MODERATION_PATH, ADMIN_SHOPS_PATH, ADMIN_SUBSCRIPTIONS_PATH } from './paths';
import styles from './admin.module.css';

/** The list screen whose filters narrow each export. */
const LIST_PATH: Record<ExportKind, string> = {
  shops: ADMIN_SHOPS_PATH,
  clients: ADMIN_CLIENTS_PATH,
  bookings: ADMIN_BOOKINGS_PATH,
  reviews: ADMIN_MODERATION_PATH,
  subscriptions: ADMIN_SUBSCRIPTIONS_PATH,
};

/**
 * Export (FR §5.11, P21): the five lists as CSV files — everything here; the list screens have the
 * same button, which keeps the filters shown there. Every export goes into the audit log.
 */
export function ExportScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.export.title')}</h1>
        <p className={styles.sub}>{t('admin.export.sub')}</p>
      </div>
      <ul className={styles.list}>
        {EXPORT_KINDS.map((kind) => (
          <li key={kind}>
            <Card className={styles.stack}>
              <div className={styles.toolbar}>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{t(`admin.export.kind.${kind}`)}</span>
                  <span className={styles.muted}>{t(`admin.export.hint.${kind}`)}</span>
                </span>
                <ExportButton kind={kind} label={t('admin.export.all')} />
              </div>
              <Link className={styles.link} to={LIST_PATH[kind]}>
                {t('admin.export.filtered')}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
