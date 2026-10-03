import { ShieldCheck, Star } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { Stars } from '../../components/Stars';
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
import { useI18n } from '../../i18n/context';
import { plural } from '../../i18n/translate';
import { reportAge } from '../../lib/admin';
import { useNow } from '../../lib/useNow';
import { ConfirmPanel } from './ActionPanels';
import { ExportButton } from './ExportButton';
import { Pill, SectionTitle } from './parts';
import { adminBookingPath, adminShopPath } from './paths';
import { useLiveData } from './useLiveData';
import { useUrlParams } from './useUrlParams';
import { dateTime, day } from './format';
import styles from './admin.module.css';

const LIVE = [{ table: 'reviews' }];

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

function QueueCard({ r, now, onDecided }: { r: AdminReview; now: Date; onDecided: () => void }) {
  const { t, lang } = useI18n();
  const [panel, setPanel] = useState<ReviewDecision | null>(null);
  const age = r.reported_at ? reportAge(r.reported_at, now) : null;
  return (
    <Card highlight className={styles.stack}>
      <div className={styles.rowTop}>
        <Pill tone="amber">{r.report_reason ? t(`reviews.reason.${r.report_reason}`) : t('admin.reportStatus.pending')}</Pill>
        {age && (
          <span className={age.overdue ? styles.overdue : styles.muted}>
            {t('admin.moderation.waiting', { days: plural(lang, 'unit.days', age.days) })}
            {age.overdue ? ` · ${t('admin.moderation.overdue')}` : ''}
          </span>
        )}
      </div>
      <span className={styles.muted}>{t('admin.moderation.reportedAt', { date: dateTime(lang, r.reported_at) })}</span>
      <ReviewBody r={r} />
      {panel === null ? (
        <div className={styles.panelButtons}>
          <Button variant="success" onClick={() => setPanel('keep')}>
            {t('admin.moderation.keep')}
          </Button>
          <Button variant="danger" onClick={() => setPanel('remove')}>
            {t('admin.moderation.remove')}
          </Button>
        </div>
      ) : (
        <ConfirmPanel
          title={panel === 'keep' ? t('admin.moderation.keepTitle') : t('admin.moderation.removeTitle')}
          body={panel === 'keep' ? t('admin.moderation.keepBody') : t('admin.moderation.removeBody')}
          textLabel={t('admin.moderation.note')}
          textHint={t('admin.moderation.noteHint')}
          confirmLabel={panel === 'keep' ? t('admin.moderation.keep') : t('admin.moderation.remove')}
          danger={panel === 'remove'}
          onConfirm={async (note, requestId) => {
            await decideReview(r.id, panel, note, requestId);
            onDecided();
          }}
          onCancel={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

/** A review that looks staged (T25): why, and "Este în regulă" or "Șterge recenzia". */
function SuspectCard({ r, onDecided }: { r: SuspectReview; onDecided: () => void }) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<SuspectDecision | null>(null);
  return (
    <Card highlight className={styles.stack}>
      <div className={styles.rowTop}>
        {r.signals.map((s) => (
          <Pill key={s} tone={s === 'same_phone' || s === 'quick_job' ? 'red' : 'amber'}>
            {t(`admin.signal.${s}`)}
          </Pill>
        ))}
      </div>
      <ul className={styles.signalList}>
        {r.signals.map((s) => (
          <li key={s} className={styles.muted}>
            {t(`admin.signal.${s}.why`)}
          </li>
        ))}
      </ul>
      <ReviewBody r={r} />
      {panel === null ? (
        <div className={styles.panelButtons}>
          <Button variant="success" onClick={() => setPanel('clear')}>
            {t('admin.suspect.clear')}
          </Button>
          <Button variant="danger" onClick={() => setPanel('remove')}>
            {t('admin.suspect.remove')}
          </Button>
        </div>
      ) : (
        <ConfirmPanel
          title={panel === 'clear' ? t('admin.suspect.clearTitle') : t('admin.moderation.removeTitle')}
          body={panel === 'clear' ? t('admin.suspect.clearBody') : t('admin.suspect.removeBody')}
          textLabel={t('admin.moderation.note')}
          textHint={t('admin.moderation.noteHint')}
          confirmLabel={panel === 'clear' ? t('admin.suspect.clear') : t('admin.suspect.remove')}
          danger={panel === 'remove'}
          onConfirm={async (note, requestId) => {
            await decideSuspectReview(r.id, panel, note, requestId);
            onDecided();
          }}
          onCancel={() => setPanel(null)}
        />
      )}
    </Card>
  );
}

function statusPill(r: AdminReview, t: (k: 'admin.reportStatus.removed' | 'admin.reportStatus.kept' | 'admin.reportStatus.pending' | 'admin.moderation.visible') => string) {
  if (r.removed_at) return <Pill tone="grey">{t('admin.reportStatus.removed')}</Pill>;
  if (r.report_status === 'pending') return <Pill tone="amber">{t('admin.reportStatus.pending')}</Pill>;
  if (r.report_status === 'kept') return <Pill tone="green">{t('admin.reportStatus.kept')}</Pill>;
  return <Pill tone="blue">{t('admin.moderation.visible')}</Pill>;
}

/**
 * Moderare (FR §5.5, P20): the reported reviews first, oldest first, each with the reason, the
 * shop, the text and how long it has waited — the platform promises a decision within 5 working
 * days. "Păstrează" dismisses the report, "Șterge" removes the review (the shop's average is
 * recalculated); an optional note is kept in the log; both sides are told. Then the reviews that
 * look staged (T25), with why. Below, every review, searchable. Live.
 */
export function ModerationScreen() {
  const { t } = useI18n();
  const now = useNow();
  const { params, setParam, text, setText } = useUrlParams();
  const q = params.get('q') ?? '';
  const load = useCallback(
    () => Promise.all([fetchReviews(q), fetchSuspectReviews()]).then(([reviews, suspects]) => ({ ...reviews, suspects })),
    [q],
  );
  const { state, reload, refetch } = useLiveData(load, LIVE, 'admin-moderation');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <h1>{t('nav.admin.moderation')}</h1>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          <SectionTitle>{t('admin.moderation.queue', { n: state.data.queue.length })}</SectionTitle>
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {state.data.queue.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={t('admin.moderation.queueEmpty')} body={t('admin.moderation.queueEmptyBody')} />
          ) : (
            <ul className={styles.list}>
              {state.data.queue.map((r) => (
                <li key={r.id}>
                  <QueueCard
                    r={r}
                    now={now}
                    onDecided={() => {
                      setNotice(t('admin.done.decided'));
                      void refetch().catch(() => {});
                    }}
                  />
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>{t('admin.suspect.title', { n: state.data.suspects.length })}</SectionTitle>
          {state.data.suspects.length === 0 ? (
            <p className={styles.muted}>{t('admin.suspect.empty')}</p>
          ) : (
            <>
              <p className={styles.muted}>{t('admin.suspect.intro')}</p>
              <ul className={styles.list}>
                {state.data.suspects.map((r) => (
                  <li key={r.id}>
                    <SuspectCard
                      r={r}
                      onDecided={() => {
                        setNotice(t('admin.done.decided'));
                        void refetch().catch(() => {});
                      }}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

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
          {state.data.reviews.length === 0 ? (
            <EmptyState icon={Star} title={q ? t('admin.noResults') : t('admin.noReviews')} />
          ) : (
            <ul className={styles.list}>
              {state.data.reviews.map((r) => (
                <li key={r.id}>
                  <Card className={styles.stack}>
                    <div className={styles.rowTop}>{statusPill(r, t)}</div>
                    <ReviewBody r={r} />
                    {r.report_note && (
                      <p className={styles.muted}>
                        {t('admin.moderation.noteShown')}: {r.report_note}
                      </p>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
