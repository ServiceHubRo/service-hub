import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { SelectField } from '../../components/SelectField';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import {
  adminListSuggestions,
  adminSetSuggestionStatus,
  SUGGESTION_STATUSES,
  type AdminSuggestion,
  type SuggestionStatus,
} from '../../data/suggestions';
import { adminZoneBack } from '../../app/adminZones';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { SuggestionStatusPill } from '../suggestions/SuggestionStatusPill';
import suggestionStyles from '../suggestions/suggestions.module.css';
import { dateTime } from './format';
import { ADMIN_SUGGESTIONS_PATH, adminClientPath, adminShopPath } from './paths';
import styles from './admin.module.css';

/** „‹ Înapoi” goes to the screen's zone (A1). */
const ZONE_BACK = adminZoneBack(ADMIN_SUGGESTIONS_PATH);

type Filter = SuggestionStatus | 'all';

/** Where the author's line leads, or null for plain text (the board's owner decides: A2). */
export type AuthorLink = (s: AdminSuggestion) => string | null;

/** The admin: a shop's suggestion to the shop, a client's to the client. */
const adminAuthorLink: AuthorLink = (s) => (s.role === 'shop' ? (s.shop_id ? adminShopPath(s.shop_id) : null) : adminClientPath(s.author_id));

/** Who wrote it: "Client · C-00012 · Maria Pop" or "Service · Atelier Unu". */
function Author({ s, link }: { s: AdminSuggestion; link: AuthorLink }) {
  const { t } = useI18n();
  const who =
    s.role === 'shop'
      ? [t('admin.sugg.fromShop'), s.shop_name ?? s.display_id].join(' · ')
      : [t('admin.sugg.fromClient'), s.display_id, s.author_name].filter(Boolean).join(' · ');
  const to = link(s);
  return to ? (
    <Link className={styles.link} to={to}>
      {who}
    </Link>
  ) : (
    <span>{who}</span>
  );
}

function SuggestionCard({
  s,
  onChanged,
  setStatus,
  authorLink,
}: {
  s: AdminSuggestion;
  onChanged: (status: SuggestionStatus) => void;
  setStatus: SetStatus;
  authorLink: AuthorLink;
}) {
  const { t, lang } = useI18n();
  return (
    <Card className={suggestionStyles.item}>
      <p className={suggestionStyles.body}>{s.body}</p>
      <div className={suggestionStyles.meta}>
        <SuggestionStatusPill status={s.status} admin />
        <Author s={s} link={authorLink} />
        <span>{dateTime(lang, s.created_at)}</span>
      </div>
      <span id={`sugg-state-${s.id}`} className={suggestionStyles.meta}>
        {t('admin.sugg.setState')}
      </span>
      <div className={suggestionStyles.actions} role="group" aria-labelledby={`sugg-state-${s.id}`}>
        {SUGGESTION_STATUSES.filter((next) => next !== s.status).map((next) => (
          <ActionButton
            key={next}
            variant="secondary"
            block={false}
            onAction={async (requestId) => {
              await setStatus(s.id, next, requestId);
              onChanged(next);
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t(`admin.sugg.mark.${next}`)}
          </ActionButton>
        ))}
      </div>
    </Card>
  );
}

type SetStatus = (id: string, status: SuggestionStatus, requestId: string) => Promise<void>;

/**
 * Sugestii (T26): every idea clients and shops sent, newest first, filtered by state. Each gets a state
 * the author sees (planned, done, not now; back to new); every change is in the audit log. The admin's
 * screen and the support agent's Solicitări (A2) show the same board, each through its own database
 * functions.
 */
export function SuggestionsBoard({
  load,
  setStatus,
  authorLink,
}: {
  load: () => Promise<{ new: number; items: AdminSuggestion[] }>;
  setStatus: SetStatus;
  authorLink: AuthorLink;
}) {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(load);
  const [filter, setFilter] = useState<Filter>('all');

  const count = (f: Filter) =>
    state.status === 'ready' ? state.data.items.filter((s) => f === 'all' || s.status === f).length : null;
  const label = (f: Filter) => {
    const name = f === 'all' ? t('admin.sugg.all') : f === 'new' ? t('admin.sugg.status.new') : t(`sugg.status.${f}`);
    const n = count(f);
    return n === null ? name : `${name} (${n})`;
  };

  return (
    <>
      <SelectField
        className={styles.narrowSelect}
        label={t('admin.sugg.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value as Filter)}
        options={(['all', ...SUGGESTION_STATUSES] as const).map((f) => ({ value: f, label: label(f) }))}
      />
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (() => {
          const shown = state.data.items.filter((s) => filter === 'all' || s.status === filter);
          if (shown.length === 0) {
            return <EmptyState icon={Lightbulb} title={t(state.data.items.length === 0 ? 'admin.sugg.empty' : 'admin.sugg.emptyFilter')} />;
          }
          return (
            <ul className={suggestionStyles.list}>
              {shown.map((s) => (
                <li key={s.id}>
                  <SuggestionCard
                    s={s}
                    setStatus={setStatus}
                    authorLink={authorLink}
                    onChanged={(status) =>
                      setData((d) => ({
                        new: d.new + (status === 'new' ? 1 : 0) - (s.status === 'new' ? 1 : 0),
                        items: d.items.map((x) => (x.id === s.id ? { ...x, status } : x)),
                      }))
                    }
                  />
                </li>
              ))}
            </ul>
          );
        })()}
    </>
  );
}

/** Admin → Suport → Sugestii (T26, A1). */
export function SuggestionsScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.sugg.title')}</h1>
      </div>
      <SuggestionsBoard load={adminListSuggestions} setStatus={adminSetSuggestionStatus} authorLink={adminAuthorLink} />
    </div>
  );
}
