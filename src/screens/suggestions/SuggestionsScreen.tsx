import { Lightbulb, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV } from '../../app/roles';
import { ActionButton } from '../../components/ActionButton';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { DetailPane, ListDetailLayout } from '../../components/ListDetailLayout';
import { ListRow, ListRows, ListRowsSkeleton } from '../../components/ListRow';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { fetchMySuggestions, submitSuggestion, SUGGESTION_MAX } from '../../data/suggestions';
import { useI18n } from '../../i18n/context';
import { formatDayMonth } from '../../i18n/format';
import { useListDetail } from '../../lib/useListDetail';
import { useLoad } from '../../lib/useLoad';
import accountStyles from '../account/account.module.css';
import { SuggestionStatusPill } from './SuggestionStatusPill';
import styles from './suggestions.module.css';

/** The „new suggestion” form takes the place of a chosen one in the address (`?sugestie=nou`). */
const NEW = 'nou';

/**
 * Cont → Sugestii (T26), for clients and shops; page template A since C7 (Eduard, 20 Nov 2026): the
 * ideas already sent are rows (the text, the day, the state the Service-Hub team gave it), the chosen
 * one reads in full beside the list, and „Adaugă” opens the form for a new one (up to 1,000 characters,
 * 5 a day) in the same place.
 */
export function SuggestionsScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchMySuggestions);
  const { pathname } = useLocation();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const filled = text.trim() !== '';
  const suggestions = state.status === 'ready' ? state.data : [];
  const { wide, selectedId, open, select, back } = useListDetail([NEW, ...suggestions.map((s) => s.id)], 'sugestie');
  const chosen = suggestions.find((s) => s.id === selectedId) ?? null;

  const header = (
    <>
      <PageHeader
        back={{ to: NAV[role].account.path, label: t('nav.account') }}
        title={t('sugg.title')}
        subtitle={t('sugg.sub')}
        actions={
          state.status === 'ready' && suggestions.length > 0 ? (
            <Button variant="primary" onClick={() => select(NEW)} aria-label={t('sugg.add')}>
              <Plus size={18} aria-hidden="true" /> {t('action.add')}
            </Button>
          ) : undefined
        }
      />
      {sent && !wide && !open && (
        <Banner tone="info">
          {t('sugg.sent')}
        </Banner>
      )}
    </>
  );

  let list;
  if (state.status === 'loading') list = <ListRowsSkeleton label={t('common.loading')} />;
  else if (state.status === 'error') list = <LoadError message={t('sugg.loadError')} onRetry={reload} />;
  else if (suggestions.length === 0)
    list = (
      <EmptyState
        icon={Lightbulb}
        title={t('sugg.empty')}
        action={
          wide ? undefined : (
            <Button variant="primary" onClick={() => select(NEW)} aria-label={t('sugg.add')}>
              <Plus size={18} aria-hidden="true" /> {t('action.add')}
            </Button>
          )
        }
      />
    );
  else
    list = (
      <ListRows label={t('sugg.mine')}>
        {suggestions.map((s) => (
          <ListRow
            key={s.id}
            icon={<Lightbulb size={20} />}
            title={s.body}
            detail={t('sugg.sentOn', { date: formatDayMonth(lang, new Date(s.created_at)) })}
            status={<SuggestionStatusPill status={s.status} />}
            selected={wide && s.id === selectedId}
            onSelect={() => select(s.id)}
          />
        ))}
      </ListRows>
    );

  let detail = null;
  if (selectedId === NEW || (wide && suggestions.length === 0 && state.status === 'ready')) {
    detail = (
      <DetailPane id={NEW} icon={<Lightbulb size={20} />} title={t('sugg.new')}>
        <div className={styles.form}>
          <TextArea
            label={t('sugg.field')}
            value={text}
            rows={5}
            maxLength={SUGGESTION_MAX}
            count={t('sugg.count', { n: text.length })}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
          />
          <ActionButton
            disabled={!filled}
            onAction={async (requestId) => {
              const added = await submitSuggestion(text, requestId);
              setText('');
              setSent(true);
              setData((list) => [added, ...list.filter((s) => s.id !== added.id)]);
              // On a phone the list comes back, with the new one in it.
              if (open) back();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('sugg.send')}
          </ActionButton>
          {sent && wide && (
            <p className={styles.sent} role="status">
              {t('sugg.sent')}
            </p>
          )}
        </div>
      </DetailPane>
    );
  } else if (chosen) {
    detail = (
      <DetailPane
        id={chosen.id}
        icon={<Lightbulb size={20} />}
        title={t('sugg.sentOn', { date: formatDayMonth(lang, new Date(chosen.created_at)) })}
        status={<SuggestionStatusPill status={chosen.status} />}
      >
        <p className={styles.body}>{chosen.body}</p>
      </DetailPane>
    );
  }

  return (
    <div className={accountStyles.page}>
      <ListDetailLayout wide={wide} open={open} backTo={pathname} backLabel={t('sugg.title')} header={header} list={list} detail={detail} />
    </div>
  );
}
