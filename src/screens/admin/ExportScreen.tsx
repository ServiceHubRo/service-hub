import { FileSpreadsheet } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows } from '../../components/ListRow';
import { PageHeader } from '../../components/PageHeader';
import { EXPORT_KINDS, type ExportKind } from '../../data/adminTools';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { useListDetail } from '../../lib/useListDetail';
import { ExportButton } from './ExportButton';
import { ADMIN_ANAF_PATH, ADMIN_BOOKINGS_PATH, ADMIN_CLIENTS_PATH, ADMIN_EXPORT_PATH, ADMIN_MODERATION_PATH, ADMIN_SHOPS_PATH, ADMIN_SUBSCRIPTIONS_PATH } from './paths';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_EXPORT_PATH);

/** The list screen whose filters narrow each export. */
const LIST_PATH: Record<ExportKind, string> = {
  shops: ADMIN_SHOPS_PATH,
  clients: ADMIN_CLIENTS_PATH,
  bookings: ADMIN_BOOKINGS_PATH,
  reviews: ADMIN_MODERATION_PATH,
  subscriptions: ADMIN_SUBSCRIPTIONS_PATH,
  company_checks: ADMIN_ANAF_PATH,
};

/**
 * Export (FR §5.11, P21): the lists as Excel files — everything here; the list screens have the
 * same button, which keeps the filters shown there. Every export goes into the audit log.
 * Page template A (docs/MODEL_DE_FOLOSIRE.md P8): one row per list, the chosen one beside the list
 * from 1024 px (in its place below) with its two ways to download.
 */
export function ExportScreen() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { wide, selectedId, open, select } = useListDetail(EXPORT_KINDS, 'lista');
  const chosen = EXPORT_KINDS.find((k) => k === selectedId) ?? null;

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.export.title')}
        header={<PageHeader back={{ to: ZONE_BACK.to, label: t(ZONE_BACK.label) }} title={t('admin.export.title')} />}
        list={
          <ListRows label={t('admin.export.title')}>
            {EXPORT_KINDS.map((kind) => (
              <ListRow
                key={kind}
                icon={<FileSpreadsheet size={20} />}
                title={t(`admin.export.kind.${kind}`)}
                detail={t(`admin.export.hint.${kind}`)}
                selected={wide && kind === selectedId}
                onSelect={() => select(kind)}
              />
            ))}
          </ListRows>
        }
        detail={
          chosen && (
            <DetailPane
              key={chosen}
              id={chosen}
              icon={<FileSpreadsheet size={20} />}
              title={t(`admin.export.kind.${chosen}`)}
              detail={t(`admin.export.hint.${chosen}`)}
              actions={
                <>
                  <ExportButton kind={chosen} label={t('admin.export.all')} />
                  <Link className={buttonClass('secondary')} to={LIST_PATH[chosen]}>
                    {t('admin.export.filtered')}
                  </Link>
                </>
              }
            />
          )
        }
      />
    </div>
  );
}
