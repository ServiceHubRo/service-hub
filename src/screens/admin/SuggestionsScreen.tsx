import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
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
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { SuggestionStatusPill } from '../suggestions/SuggestionStatusPill';
import suggestionStyles from '../suggestions/suggestions.module.css';
import { dateTime } from './format';
import { ADMIN_ACCOUNT_PATH, adminClientPath, adminShopPath } from './paths';
import styles from './admin.module.css';

type Filter = SuggestionStatus | 'all';

/** Who wrote it: "Client · C-00012 · Maria Pop" (to the client) or "Service · Atelier Unu" (to the shop). */
function Author({ s }: { s: AdminSuggestion }) {
  const { t } = useI18n();
  if (s.role === 'shop') {
    const who = [t('admin.sugg.fromShop'), s.shop_name ?? s.display_id].join(' · ');
    return s.shop_id ? (
      <Link className={styles.link} to={adminShopPath(s.shop_id)}>
        {who}
      </Link>
    ) : (
      <span>{who}</span>
    );
  }
  return (
    <Link className={styles.link} to={adminClientPath(s.author_id)}>
      {[t('admin.sugg.fromClient'), s.display_id, s.author_name].filter(Boolean).join(' · ')}
    </Link>
  );
}

function SuggestionCard({ s, onChanged }: { s: AdminSuggestion; onChanged: (status: SuggestionStatus) => void }) {
  const { t, lang } = useI18n();
  return (
    <Card className={suggestionStyles.item}>
      <p className={suggestionStyles.body}>{s.body}</p>
      <div className={suggestionStyles.meta}>
        <SuggestionStatusPill status={s.status} admin />
        <Author s={s} />
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
              await adminSetSuggestionStatus(s.id, next, requestId);
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

/**
 * Admin → Cont → Sugestii (T26): every idea clients and shops sent, newest first, filtered by state.
 * Each gets a state the author sees (planned, done, not now; back to new); every change is in the
 * audit log.
 */
export function SuggestionsScreen() {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(adminListSuggestions);
  const [filter, setFilter] = useState<Filter>('all');

  const count = (f: Filter) =>
    state.status === 'ready' ? state.data.items.filter((s) => f === 'all' || s.status === f).length : null;
  const label = (f: Filter) => {
    const name = f === 'all' ? t('admin.sugg.all') : f === 'new' ? t('admin.sugg.status.new') : t(`sugg.status.${f}`);
    const n = count(f);
    return n === null ? name : `${name} (${n})`;
  };

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.sugg.title')}</h1>
      </div>
      <ChipRow label={t('admin.sugg.filter')}>
        {(['all', ...SUGGESTION_STATUSES] as const).map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {label(f)}
          </Chip>
        ))}
      </ChipRow>
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
    </div>
  );
}
