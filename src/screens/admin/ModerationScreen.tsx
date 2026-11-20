import { ShieldAlert, ShieldCheck, Star, UserX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { Stars } from '../../components/Stars';
import { Tile } from '../../components/Tile';
import {
  decideReview,
  decideSuspectReview,
  fetchReviews,
  fetchSuspectReviews,
  type AdminReview,
  type ReviewDecision,
  type SuspectDecision,
  type SuspectReview,
} from '../../data/admin';
import { fetchNoShowDisputes } from '../../data/noShows';
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { reportAge } from '../../lib/admin';
import { useListDetail } from '../../lib/useListDetail';
import { useNow } from '../../lib/useNow';
import { ConfirmPanel } from './ActionPanels';
import { ExportButton } from './ExportButton';
import { Pill, SectionTitle } from './parts';
import { ADMIN_DISPUTES_PATH, ADMIN_MODERATION_PATH, adminBookingPath, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { dateTime, day } from './format';
import styles from './admin.module.css';
import { PageHeader } from '../../components/PageHeader';

const LIVE = [{ table: 'reviews' }, { table: 'no_show_disputes' }];
const back = adminZoneBack(ADMIN_MODERATION_PATH);

function ReviewBody({ r }: { r: AdminReview }) {
  const { t, lang } = useI18n();
  return (
    <>
      <div className={styles.rowTop}>
        <Stars value={r.rating} size={15} />
        <span className={styles.muted}>
          {r.client_display_name || t('admin.deletedAccount')}
          {r.client_display_id ? ` · ${r.client_display_id}` : ''} · {day(lang, r.created_at)}
        </span>
      </div>
      <span className={styles.rowMeta}>
        <Link className={styles.link} to={adminShopPath(r.shop_id)}>
          {r.shop_name}, {r.shop_city}
        </Link>
        {r.ref && (
          <Link className={styles.link} to={adminBookingPath(r.booking_id)}>
            {r.ref}
          </Link>
        )}
      </span>
      {r.text ? <p className={styles.quote}>{r.text}</p> : <p className={styles.muted}>{t('admin.moderation.noText')}</p>}
      {r.reply && <p className={styles.reply}>{r.reply}</p>}
    </>
  );
}

function statusPill(r: AdminReview, t: (k: 'admin.reportStatus.removed' | 'admin.reportStatus.kept' | 'admin.reportStatus.pending' | 'admin.moderation.visible') => string) {
  if (r.removed_at) return <Pill tone="grey">{t('admin.reportStatus.removed')}</Pill>;
  if (r.report_status === 'pending') return <Pill tone="amber">{t('admin.reportStatus.pending')}</Pill>;
  if (r.report_status === 'kept') return <Pill tone="green">{t('admin.reportStatus.kept')}</Pill>;
  return <Pill tone="blue">{t('admin.moderation.visible')}</Pill>;
}

type Kind = 'queue' | 'suspect' | 'all';
interface Item {
  /** The kind and the review: the same review may be in two of the lists. */
  id: string;
  kind: Kind;
  r: AdminReview | SuspectReview;
}
const asItem = (kind: Kind, r: AdminReview | SuspectReview): Item => ({ id: `${kind}:${r.id}`, kind, r });

/** The words that tell what a row is about: the author, the day, then what they wrote. */
function reviewLine(t: ReturnType<typeof useI18n>['t'], lang: 'ro' | 'en', r: AdminReview): string {
  return [
    t('admin.acct.rating', { n: r.rating }),
    r.client_display_name || t('admin.deletedAccount'),
    day(lang, r.created_at),
    r.text ? `„${r.text}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** One review in detail: what was written, and what the admin can do with it (a reported one, a suspect one). */
function ReviewDetail({ item, now, onDecided }: { item: Item; now: Date; onDecided: () => void }) {
  const { t, lang } = useI18n();
  const r = item.r;
  const [panel, setPanel] = useState<ReviewDecision | SuspectDecision | null>(null);
  const age = item.kind === 'queue' && r.reported_at ? reportAge(r.reported_at, now) : null;
  const suspect = item.kind === 'suspect' ? (r as SuspectReview) : null;
  const decide = item.kind !== 'all';
  const keepLabel = item.kind === 'queue' ? t('admin.moderation.keep') : t('admin.suspect.clear');
  const removeLabel = item.kind === 'queue' ? t('admin.moderation.remove') : t('admin.suspect.remove');
  const keepAction: ReviewDecision | SuspectDecision = item.kind === 'queue' ? 'keep' : 'clear';
  return (
    <DetailPane
      id={item.id}
      icon={<Star size={20} />}
      title={r.shop_name}
      detail={[r.shop_city, r.client_display_name || t('admin.deletedAccount'), day(lang, r.created_at)].filter(Boolean).join(' · ')}
      status={
        item.kind === 'queue' ? (
          <Pill tone="amber">{r.report_reason ? t(`reviews.reason.${r.report_reason}`) : t('admin.reportStatus.pending')}</Pill>
        ) : item.kind === 'all' ? (
          statusPill(r, t)
        ) : undefined
      }
      message={
        age
          ? {
              tone: age.overdue ? 'problem' : 'neutral',
              text: `${t('admin.moderation.waiting', { days: plural(lang, 'unit.days', age.days) })}${age.overdue ? ` · ${t('admin.moderation.overdue')}` : ''}`,
            }
          : undefined
      }
      panel={
        decide && panel !== null ? (
          <ConfirmPanel
            title={panel === keepAction ? (item.kind === 'queue' ? t('admin.moderation.keepTitle') : t('admin.suspect.clearTitle')) : t('admin.moderation.removeTitle')}
            body={
              panel === keepAction
                ? item.kind === 'queue'
                  ? t('admin.moderation.keepBody')
                  : t('admin.suspect.clearBody')
                : item.kind === 'queue'
                  ? t('admin.moderation.removeBody')
                  : t('admin.suspect.removeBody')
            }
            textLabel={t('admin.moderation.note')}
            textHint={t('admin.moderation.noteHint')}
            confirmLabel={panel === keepAction ? keepLabel : removeLabel}
            danger={panel === 'remove'}
            onConfirm={async (note, requestId) => {
              if (item.kind === 'queue') await decideReview(r.id, panel as ReviewDecision, note, requestId);
              else await decideSuspectReview(r.id, panel as SuspectDecision, note, requestId);
              onDecided();
            }}
            onCancel={() => setPanel(null)}
          />
        ) : undefined
      }
      actions={
        decide ? (
          <>
            <Button variant="success" onClick={() => setPanel(keepAction)}>
              {keepLabel}
            </Button>
            <Button variant="danger" onClick={() => setPanel('remove')}>
              {removeLabel}
            </Button>
          </>
        ) : undefined
      }
    >
      {item.kind === 'queue' && <p className={styles.muted}>{t('admin.moderation.reportedAt', { date: dateTime(lang, r.reported_at) })}</p>}
      {suspect && (
        <ul className={styles.signalList}>
          {suspect.signals.map((s) => (
            <li key={s} className={styles.muted}>
              <strong className={s === 'same_phone' || s === 'quick_job' ? styles.signalRed : styles.signalAmber}>{t(`admin.signal.${s}`)}</strong> ·{' '}
              {t(`admin.signal.${s}.why`)}
            </li>
          ))}
        </ul>
      )}
      <ReviewBody r={r} />
      {item.kind === 'all' && r.report_note && (
        <p className={styles.muted}>
          {t('admin.moderation.noteShown')}: {r.report_note}
        </p>
      )}
    </DetailPane>
  );
}

/**
 * Moderare (FR §5.5, P20): the reported reviews first, oldest first, each with the reason, the
 * shop, the text and how long it has waited — the platform promises a decision within 5 working
 * days. "Păstrează" dismisses the report, "Șterge" removes the review (the shop's average is
 * recalculated); an optional note is kept in the log; both sides are told. Then the reviews that
 * look staged (T25), with why; the no-shows clients contested (T53). Below, every review,
 * searchable. Live.
 */
export function ModerationScreen() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const now = useNow();
  const { params, setParam, text, setText } = useUrlParams();
  const q = params.get('q') ?? '';
  const load = useCallback(
    () =>
      Promise.all([fetchReviews(q), fetchSuspectReviews(), fetchNoShowDisputes()]).then(([reviews, suspects, disputes]) => ({
        ...reviews,
        suspects,
        disputes,
      })),
    [q],
  );
  const { state, reload, refetch } = useLiveData(load, LIVE, 'admin-moderation');
  // A decided review leaves its list: the answer is told above the lists.
  const [notice, setNotice] = useState<string | null>(null);

  // Page template A (docs/MODEL_DE_FOLOSIRE.md P8): the reported reviews, the ones that look staged and
  // every review are rows; the chosen one beside the list from 1024 px (in its place below).
  const data = state.status === 'ready' ? state.data : null;
  const queue = data ? data.queue.map((r) => asItem('queue', r)) : [];
  const suspects = data ? data.suspects.map((r) => asItem('suspect', r)) : [];
  const everyone = data ? data.reviews.map((r) => asItem('all', r)) : [];
  const items = [...queue, ...suspects, ...everyone];
  const { wide, selectedId, open, select } = useListDetail(
    items.map((i) => i.id),
    'recenzie',
  );
  const chosen = items.find((i) => i.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader back={{ to: back.to, label: t(back.label) }} title={t('nav.admin.moderation')} />
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </>
  );

  const row = (i: Item) => {
    const r = i.r;
    return (
      <ListRow
        key={i.id}
        icon={i.kind === 'suspect' ? <ShieldAlert size={20} /> : <Star size={20} />}
        title={r.shop_name}
        detail={reviewLine(t, lang, r)}
        status={
          i.kind === 'queue' ? (
            <Pill tone="amber">{r.report_reason ? t(`reviews.reason.${r.report_reason}`) : t('admin.reportStatus.pending')}</Pill>
          ) : i.kind === 'suspect' ? (
            <Pill tone="amber">{t(`admin.signal.${(r as SuspectReview).signals[0]!}`)}</Pill>
          ) : (
            statusPill(r, t)
          )
        }
        attention={i.kind !== 'all'}
        selected={wide && i.id === selectedId}
        onSelect={() => select(i.id)}
      />
    );
  };

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('admin.loadError')} onRetry={reload} />;
  else if (data)
    list = (
      <>
        <SectionTitle>{t('admin.moderation.queue', { n: queue.length })}</SectionTitle>
        {queue.length === 0 ? (
          <EmptyState icon={ShieldCheck} title={t('admin.moderation.queueEmpty')} body={t('admin.moderation.queueEmptyBody')} />
        ) : (
          <ListRows label={t('admin.moderation.queue', { n: queue.length })}>{queue.map(row)}</ListRows>
        )}

        <SectionTitle>{t('admin.suspect.title', { n: suspects.length })}</SectionTitle>
        {suspects.length === 0 ? (
          <EmptyState icon={ShieldAlert} title={t('admin.suspect.empty')} />
        ) : (
          <>
            <p className={styles.muted}>{t('admin.suspect.intro')}</p>
            <ListRows label={t('admin.suspect.title', { n: suspects.length })}>{suspects.map(row)}</ListRows>
          </>
        )}

        {/* The contested no-shows have a page of their own since A1; here, the way to it. */}
        <Tile
          to={ADMIN_DISPUTES_PATH}
          icon={UserX}
          label={t('admin.disputes.title')}
          hint={
            data.disputes.pending.length > 0 ? plural(lang, 'unit.disputesPending', data.disputes.pending.length) : t('admin.zone.disputes.hint')
          }
        />

        <SectionTitle>{t('admin.moderation.all')}</SectionTitle>
        <SearchField
          id="admin-reviews-q"
          label={t('admin.moderation.search')}
          placeholder={t('admin.moderation.search')}
          value={text}
          onChange={setText}
          onClear={() => {
            setText('');
            setParam({ q: null });
          }}
          clearLabel={t('admin.search.clear')}
        />
        <div className={styles.toolbar}>
          <span className={styles.sub}>{t('admin.moderation.exportHint')}</span>
          <ExportButton kind="reviews" filters={{ q: q || undefined }} />
        </div>
        {everyone.length === 0 ? (
          <EmptyState icon={Star} title={q ? t('admin.noResults') : t('admin.noReviews')} />
        ) : (
          <ListRows label={t('admin.moderation.all')}>{everyone.map(row)}</ListRows>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={pathname}
        backLabel={t('nav.admin.moderation')}
        header={header}
        list={list}
        detail={
          chosen && (
            <ReviewDetail
              key={chosen.id}
              item={chosen}
              now={now}
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
