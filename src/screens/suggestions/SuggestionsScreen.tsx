import { Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { NAV } from '../../app/roles';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { fetchMySuggestions, submitSuggestion, SUGGESTION_MAX } from '../../data/suggestions';
import { useI18n } from '../../i18n/context';
import { formatDayMonth } from '../../i18n/format';
import { useLoad } from '../../lib/useLoad';
import accountStyles from '../account/account.module.css';
import { SuggestionStatusPill } from './SuggestionStatusPill';
import styles from './suggestions.module.css';

/**
 * Cont → Sugestii (T26), for clients and shops: write an idea (up to 1,000 characters, 5 a day)
 * and see the ones already sent, each with the state the Service-Hub team gave it.
 */
export function SuggestionsScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchMySuggestions);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const filled = text.trim() !== '';

  return (
    <div className={accountStyles.page}>
      <BackLink to={NAV[role].account.path} label={t('nav.account')} />
      <h1>{t('sugg.title')}</h1>
      <p className={accountStyles.sub}>{t('sugg.sub')}</p>

      <Card className={styles.form}>
        <TextArea
          label={t('sugg.field')}
          value={text}
          rows={5}
          maxLength={SUGGESTION_MAX}
          hint={t('sugg.count', { n: text.length })}
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
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('sugg.send')}
        </ActionButton>
        {sent && (
          <p className={styles.sent} role="status">
            {t('sugg.sent')}
          </p>
        )}
      </Card>

      <h2 className={accountStyles.section}>{t('sugg.mine')}</h2>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('sugg.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState icon={Lightbulb} title={t('sugg.empty')} />
        ) : (
          <ul className={styles.list}>
            {state.data.map((s) => (
              <li key={s.id}>
                <Card className={styles.item}>
                  <p className={styles.body}>{s.body}</p>
                  <div className={styles.meta}>
                    <SuggestionStatusPill status={s.status} />
                    <span>{t('sugg.sentOn', { date: formatDayMonth(lang, new Date(s.created_at)) })}</span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
