import { UserX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { EmptyState } from '../../components/EmptyState';
import { ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { fetchNoShowDisputes, type AdminNoShowDispute } from '../../data/noShows';
import { useI18n } from '../../i18n/context';
import { useListDetail } from '../../lib/useListDetail';
import { disputeLine } from './format';
import { DisputeDetail } from './NoShowDisputes';
import { Pill, SectionTitle } from './parts';
import { ADMIN_DISPUTES_PATH } from './paths';
import { useLiveData } from './useLiveData';
import styles from './admin.module.css';

const LIVE = [{ table: 'no_show_disputes' }];
const back = adminZoneBack(ADMIN_DISPUTES_PATH);

/**
 * Contestații de neprezentare (T53), a page of their own since A1 (it was a section of Moderare):
 * the waiting ones first, oldest first, then the last decided ones — one row each (page template A),
 * the chosen one beside the list from 1024 px (in its place below), live.
 */
export function NoShowDisputesScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const load = useCallback(() => fetchNoShowDisputes(), []);
  const { state, reload, refetch } = useLiveData(load, LIVE, 'admin-disputes');
  // A decided dispute leaves the waiting ones: the answer is told above the lists.
  const [notice, setNotice] = useState<string | null>(null);

  const data = state.status === 'ready' ? state.data : null;
  const all: AdminNoShowDispute[] = data ? [...data.pending, ...data.decided] : [];
  const { wide, selectedId, open, select } = useListDetail(
    all.map((d) => d.id),
    'contestatie',
  );
  const chosen = all.find((d) => d.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: back.to, label: t(back.label) }} title={t('admin.disputes.title')} />
      {notice && !open && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </>
  );

  const row = (d: AdminNoShowDispute) => (
    <ListRow
      key={d.id}
      icon={<UserX size={20} />}
      title={d.booking?.shop_name ?? d.booking?.ref ?? t('admin.disputes.title')}
      detail={disputeLine(t, lang, d)}
      status={<Pill tone={d.status === 'pending' ? 'amber' : d.status === 'upheld' ? 'green' : 'grey'}>{t(`admin.noShowDispute.status.${d.status}`)}</Pill>}
      attention={d.status === 'pending'}
      selected={wide && d.id === selectedId}
      onSelect={() => select(d.id)}
    />
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (data)
    list = (
      <>
        <SectionTitle>{t('admin.noShowDispute.title', { n: data.pending.length })}</SectionTitle>
        {data.pending.length === 0 ? (
          <EmptyState icon={UserX} title={t('admin.noShowDispute.empty')} />
        ) : (
          <ListRows label={t('admin.noShowDispute.title', { n: data.pending.length })}>{data.pending.map(row)}</ListRows>
        )}
        {data.decided.length > 0 && (
          <>
            <SectionTitle>{t('admin.noShowDispute.decided', { n: data.decided.length })}</SectionTitle>
            <ListRows label={t('admin.noShowDispute.decided', { n: data.decided.length })}>{data.decided.map(row)}</ListRows>
          </>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('admin.disputes.title')}
        header={header}
        list={list}
        detail={
          chosen && (
            <DisputeDetail
              key={chosen.id}
              d={chosen}
              notice={open ? notice : null}
              onDecided={() => {
                setNotice(t('admin.done.decided'));
                void refetch().catch(() => {});
              }}
            />
          )
        }
      />
    </div>
  );
}
