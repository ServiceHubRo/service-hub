import { FileSearch } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
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
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import { ConfirmPanel } from '../admin/ActionPanels';
import { Pill } from '../admin/parts';
import { ADMIN_TEXT_REVIEWS_PATH } from '../admin/paths';
import { SUPPORT_REQUESTS_PATH } from '../support/paths';
import adminStyles from '../admin/admin.module.css';
import supportStyles from '../support/support.module.css';
import styles from './requests.module.css';
import { PageHeader } from '../../components/PageHeader';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

function suggestionStatus(t: T, status: string): string {
  if (status === 'new') return t('admin.sugg.status.new');
  if (`sugg.status.${status}` in ro) return t(`sugg.status.${status}` as MessageKey);
  if (`support.staffStatus.${status}` in ro) return t(`support.staffStatus.${status}` as MessageKey);
  return t('admin.retention.status.unknown');
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

function ReviewDetail({ item, now, onDone }: { item: TextReview; now: Date; onDone: (action: TextReviewAction) => void }) {
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

  const actions =
    panel === null ? (
      <>
        {item.proposed && (
          <ActionButton
            variant="primary"
            block={false}
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
      </>
    ) : undefined;

  const panelNode =
    panel === 'edit' ? (
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
    ) : panel === 'remove' ? (
      <ConfirmPanel
        title={t('support.textReview.remove.title')}
        body={t('support.textReview.remove.body')}
        confirmLabel={t('support.textReview.remove')}
        danger
        onConfirm={(_, requestId) => act('remove', requestId, null)}
        onCancel={() => setPanel(null)}
      />
    ) : undefined;

  return (
    <DetailPane
      id={item.id}
      icon={<FileSearch size={20} />}
      title={t('support.textReview.written', { month: formatMonthYear(lang, item.created_month) })}
      detail={[t(`support.textReview.role.${item.author_role}`), suggestionStatus(t, item.final_status)].join(' · ')}
      status={item.review_due_at ? <DeadlinePill dueAt={item.review_due_at} now={now} /> : undefined}
      actions={actions}
      panel={panelNode}
    >
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
    </DetailPane>
  );
}

function KeptDetail({ item }: { item: TextReview }) {
  const { t, lang } = useI18n();
  return (
    <DetailPane
      id={item.id}
      icon={<FileSearch size={20} />}
      title={t('support.textReview.written', { month: formatMonthYear(lang, item.created_month) })}
      detail={[t(`support.textReview.role.${item.author_role}`), suggestionStatus(t, item.final_status)].join(' · ')}
    >
      <p className={styles.reviewText}>{item.text}</p>
    </DetailPane>
  );
}

/**
 * Sugestii de verificat (A3c2b1): the suggestions past their 12 months, separated from their account,
 * whose text an agent or an admin confirms, edits or deletes within 30 days; and the texts kept. The
 * database checks who asks (agent or admin, second step) and refuses an edited text that still
 * identifies somebody.
 */
export function TextReviewsScreen({ mode }: { mode: 'support' | 'admin' }) {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const view: TextReviewState = params.get('stare') === 'pastrate' ? 'kept' : 'pending';
  const load = useCallback(() => listTextReviews(view), [view]);
  const { state, reload, setData } = useLoad(load);
  const [notice, setNotice] = useState<string | null>(null);
  const back = mode === 'admin' ? adminZoneBack(ADMIN_TEXT_REVIEWS_PATH) : { to: SUPPORT_REQUESTS_PATH, label: 'nav.support.requests' as MessageKey };
  const items = state.status === 'ready' ? state.data.items : [];
  // Page template A (C7): one row per text, the chosen one beside the list (in its place on a phone).
  const { wide, selectedId, open, select } = useListDetail(
    items.map((i) => i.id),
    'text',
  );
  const chosen = items.find((i) => i.id === selectedId) ?? null;
  const now = state.status === 'ready' ? new Date(state.data.now) : new Date();

  const header = (
    <>
      <PageHeader back={{ to: back.to, label: t(back.label) }} title={t('support.textReview.title')} subtitle={t('support.textReview.desc')} />
      {notice && (
        <p className={supportStyles.notice} role="status">
          {notice}
        </p>
      )}
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
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('support.textReview.loadError')} onRetry={reload} />;
  else if (items.length === 0)
    list = <EmptyState icon={FileSearch} title={t(view === 'pending' ? 'support.textReview.empty' : 'support.textReview.emptyKept')} />;
  else
    list = (
      <ListRows label={t('support.textReview.title')}>
        {items.map((item) => (
          <ListRow
            key={item.id}
            icon={<FileSearch size={20} />}
            title={(view === 'pending' ? (item.proposed ?? item.original) : item.text) ?? t('support.textReview.written', { month: formatMonthYear(lang, item.created_month) })}
            detail={[
              t('support.textReview.written', { month: formatMonthYear(lang, item.created_month) }),
              t(`support.textReview.role.${item.author_role}`),
              suggestionStatus(t, item.final_status),
            ].join(' · ')}
            status={view === 'pending' && item.review_due_at ? <DeadlinePill dueAt={item.review_due_at} now={now} /> : undefined}
            attention={view === 'pending' && !!item.review_due_at && reviewUrgent(item.review_due_at, now)}
            selected={wide && item.id === selectedId}
            onSelect={() => select(item.id)}
          />
        ))}
      </ListRows>
    );

  const backQuery = params.toString();
  return (
    <div className={adminStyles.page}>
      <ListDetailLayout
        wide={wide}
        open={open}
        backTo={backQuery ? `${pathname}?${backQuery}` : pathname}
        backLabel={t('support.textReview.title')}
        header={header}
        list={list}
        detail={
          chosen &&
          (view === 'pending' ? (
            <ReviewDetail
              key={chosen.id}
              item={chosen}
              now={now}
              onDone={(action) => {
                setNotice(
                  t(action === 'confirm' ? 'support.textReview.confirmed' : action === 'edit' ? 'support.textReview.edited' : 'support.textReview.removed'),
                );
                setData((d) => ({ ...d, items: d.items.filter((x) => x.id !== chosen.id) }));
              }}
            />
          ) : (
            <KeptDetail key={chosen.id} item={chosen} />
          ))
        }
      />
    </div>
  );
}
