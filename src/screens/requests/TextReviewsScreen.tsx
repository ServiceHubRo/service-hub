import { FileSearch } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { ViewSelect } from '../../components/ViewSelect';
import { adminZoneBack } from '../../app/adminZones';
import {
  findingList,
  listTextReviews,
  reviewDaysLeft,
  reviewSuggestionText,
  reviewUrgent,
  type TextReview,
  type TextReviewAction,
  type TextReviewState,
} from '../../data/retention';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { formatDecimal, formatMonthYear } from '../../i18n/format';
import type { MessageKey } from '../../i18n/ro';
import { ro } from '../../i18n/ro';
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from '../admin/ActionPanels';
import { Pill } from '../admin/parts';
import { ADMIN_TEXT_REVIEWS_PATH } from '../admin/paths';
import { SUPPORT_REQUESTS_PATH } from '../support/paths';
import adminStyles from '../admin/admin.module.css';
import supportStyles from '../support/support.module.css';
import styles from './requests.module.css';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

function suggestionStatus(t: T, status: string): string {
  if (status === 'new') return t('admin.sugg.status.new');
  if (`sugg.status.${status}` in ro) return t(`sugg.status.${status}` as MessageKey);
  if (`support.staffStatus.${status}` in ro) return t(`support.staffStatus.${status}` as MessageKey);
  return t('admin.retention.status.unknown');
}

/** „Scrisă în nov 2025 · Client · Planificată”: all that is left of who wrote it. */
function Origin({ item }: { item: TextReview }) {
  const { t, lang } = useI18n();
  return (
    <span className={adminStyles.rowMeta}>
      <span>{t('support.textReview.written', { month: formatMonthYear(lang, item.created_month) })}</span>
      <span>{t(`support.textReview.role.${item.author_role}`)}</span>
      <span>{suggestionStatus(t, item.final_status)}</span>
    </span>
  );
}

/** Days left before the text is deleted: words always, amber in the last 7 days. */
function DeadlinePill({ dueAt, now }: { dueAt: string; now: Date }) {
  const { t, lang } = useI18n();
  const days = reviewDaysLeft(dueAt, now);
  return (
    <Pill tone={reviewUrgent(dueAt, now) ? 'amber' : 'grey'}>
      {days === 0 ? t('support.textReview.lastDay') : t('support.textReview.daysLeft', { count: formatDecimal(lang, days) })}
    </Pill>
  );
}

function ReviewCard({ item, now, onDone }: { item: TextReview; now: Date; onDone: (action: TextReviewAction) => void }) {
  const { t, lang } = useI18n();
  const [panel, setPanel] = useState<'edit' | 'remove' | null>(null);
  const [text, setText] = useState(item.proposed ?? '');
  const [editError, setEditError] = useState<string | null>(null);
  const found = findingList(item.findings);
  const max = Math.max(item.original?.length ?? 0, item.proposed?.length ?? 0, 1);

  const act = async (action: TextReviewAction, requestId: string, value: string | null) => {
    await reviewSuggestionText(item.id, action, value, requestId);
    onDone(action);
  };

  return (
    <Card>
      <div className={adminStyles.stack}>
        <div className={adminStyles.cardHead}>
          <Origin item={item} />
          {item.review_due_at && <DeadlinePill dueAt={item.review_due_at} now={now} />}
        </div>
        <p className={found.length > 0 ? undefined : adminStyles.muted}>
          {found.length > 0
            ? t('support.textReview.findings', {
                list: found.map((f) => `${t(`support.textReview.kind.${f.kind}`)} (${formatDecimal(lang, f.n)})`).join(', '),
              })
            : t('support.textReview.findingsNone')}
        </p>
        <div>
          <h3 className={adminStyles.rowTitle}>{t('support.textReview.original')}</h3>
          <p className={styles.reviewText}>{item.original}</p>
        </div>
        <div>
          <h3 className={adminStyles.rowTitle}>{t('support.textReview.proposed')}</h3>
          {item.proposed ? (
            <p className={styles.reviewText}>{item.proposed}</p>
          ) : (
            <p className={adminStyles.warning}>{t('support.textReview.noProposal')}</p>
          )}
        </div>

        {panel === null && (
          <div className={adminStyles.panelButtons}>
            {item.proposed && (
              <ActionButton
                onAction={(requestId) => act('confirm', requestId, null)}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('support.textReview.confirm')}
              </ActionButton>
            )}
            <Button variant="secondary" onClick={() => setPanel('edit')}>
              {t('support.textReview.edit')}
            </Button>
            <Button variant="secondary" onClick={() => setPanel('remove')}>
              {t('support.textReview.remove')}
            </Button>
          </div>
        )}

        {panel === 'edit' && (
          <div className={supportStyles.form}>
            <TextArea
              label={t('support.textReview.editLabel')}
              hint={t('support.textReview.editHint')}
              rows={5}
              maxLength={max}
              value={text}
              error={editError}
              onChange={(e) => {
                setText(e.target.value);
                if (editError) setEditError(null);
              }}
            />
            <div className={adminStyles.panelButtons}>
              <ActionButton
                onAction={async (requestId) => {
                  if (!text.trim()) {
                    setEditError(t('rpcError.text_identifies'));
                    return;
                  }
                  try {
                    await act('edit', requestId, text.trim());
                  } catch (e) {
                    const code = toRpcError(e).code;
                    if (code === 'text_identifies' || code === 'field_invalid') {
                      setEditError(t('rpcError.text_identifies'));
                      return;
                    }
                    throw e;
                  }
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('support.textReview.save')}
              </ActionButton>
              <Button onClick={() => setPanel(null)}>{t('common.cancel')}</Button>
            </div>
          </div>
        )}

        {panel === 'remove' && (
          <ConfirmPanel
            title={t('support.textReview.remove.title')}
            body={t('support.textReview.remove.body')}
            confirmLabel={t('support.textReview.remove')}
            danger
            onConfirm={(_, requestId) => act('remove', requestId, null)}
            onCancel={() => setPanel(null)}
          />
        )}
      </div>
    </Card>
  );
}

function KeptCard({ item }: { item: TextReview }) {
  return (
    <Card>
      <div className={adminStyles.stack}>
        <Origin item={item} />
        <p className={styles.reviewText}>{item.text}</p>
      </div>
    </Card>
  );
}

/**
 * Sugestii de verificat (A3c2b1): the suggestions past their 12 months, separated from their account,
 * whose text an agent or an admin confirms, edits or deletes within 30 days; and the texts kept. The
 * database checks who asks (agent or admin, second step) and refuses an edited text that still
 * identifies somebody.
 */
export function TextReviewsScreen({ mode }: { mode: 'support' | 'admin' }) {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view: TextReviewState = params.get('stare') === 'pastrate' ? 'kept' : 'pending';
  const load = useCallback(() => listTextReviews(view), [view]);
  const { state, reload, setData } = useLoad(load);
  const [notice, setNotice] = useState<string | null>(null);
  const back = mode === 'admin' ? adminZoneBack(ADMIN_TEXT_REVIEWS_PATH) : { to: SUPPORT_REQUESTS_PATH, label: 'nav.support.requests' as MessageKey };

  return (
    <div className={adminStyles.page}>
      <BackLink to={back.to} label={t(back.label)} />
      <div>
        <h1>{t('support.textReview.title')}</h1>
        <p className={adminStyles.muted}>{t('support.textReview.desc')}</p>
      </div>
      {notice && (
        <p className={supportStyles.notice} role="status">
          {notice}
        </p>
      )}
      <section className={adminStyles.section}>
        <ViewSelect<TextReviewState>
          items={[
            { key: 'pending', label: t('support.textReview.pending') },
            { key: 'kept', label: t('support.textReview.kept') },
          ]}
          value={view}
          onChange={(k) => {
            setNotice(null);
            setParams(k === 'kept' ? { stare: 'pastrate' } : {}, { replace: true });
          }}
        />
        {state.status === 'loading' && <SkeletonList />}
        {state.status === 'error' && <LoadError message={t('support.textReview.loadError')} onRetry={reload} />}
        {state.status === 'ready' &&
          (state.data.items.length === 0 ? (
            <EmptyState icon={FileSearch} title={t(view === 'pending' ? 'support.textReview.empty' : 'support.textReview.emptyKept')} />
          ) : (
            <ul className={adminStyles.list}>
              {state.data.items.map((item) => (
                <li key={item.id}>
                  {view === 'pending' ? (
                    <ReviewCard
                      item={item}
                      now={new Date(state.data.now)}
                      onDone={(action) => {
                        setNotice(
                          t(action === 'confirm' ? 'support.textReview.confirmed' : action === 'edit' ? 'support.textReview.edited' : 'support.textReview.removed'),
                        );
                        setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== item.id) }));
                      }}
                    />
                  ) : (
                    <KeptCard item={item} />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
