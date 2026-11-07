import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { toRpcError } from '../../data/rpc';
import { supportGetAccount } from '../../data/support';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { dateTime, day } from '../admin/format';
import { Facts, SectionTitle, Verified } from '../admin/parts';
import styles from '../admin/admin.module.css';
import { SuggestionStatusPill } from '../suggestions/SuggestionStatusPill';
import suggestionStyles from '../suggestions/suggestions.module.css';
import { NotFound } from '../public/NotFound';
import { AccountPills } from './AccountParts';
import { shopLine } from './format';
import { SUPPORT_SEARCH_PATH } from './paths';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An account as a support agent sees it (A2): who it is and in what state, the email masked, the
 * phone's last three digits, and its suggestions. Never its bookings, cars, companies, billing or
 * messages. Each opening is written to the audit log (support_get_account).
 */
export function AccountScreen() {
  const { t, lang } = useI18n();
  const { accountId = '' } = useParams();
  const valid = UUID.test(accountId);
  const load = useCallback(() => (valid ? supportGetAccount(accountId) : Promise.reject(new Error('invalid id'))), [valid, accountId]);
  const { state, reload } = useLoad(load);
  const back = { to: SUPPORT_SEARCH_PATH, label: t('nav.support.search') };

  // Not a client's or a shop's account (or no account at all): the same answer as a wrong address.
  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'not_found')) return <NotFound inShell />;

  return (
    <div className={styles.page}>
      {state.status !== 'ready' && <PageHeader back={back} title={t('support.account.details')} />}
      {state.status === 'loading' && <SkeletonList count={2} />}
      {state.status === 'error' && <LoadError message={t('support.account.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          <PageHeader back={back} title={state.data.name || t('admin.noName')} subtitle={state.data.display_id} />
          <div className={styles.rowTop}>
            <AccountPills account={state.data} />
          </div>
          <section className={styles.section}>
            <SectionTitle>{t('support.account.details')}</SectionTitle>
            <Card>
              <Facts
                rows={[
                  [
                    t('support.account.email'),
                    state.data.email_masked && (
                      <span>
                        {state.data.email_masked}{' '}
                        <Verified ok={state.data.email_verified} label={t('admin.email')} />
                      </span>
                    ),
                  ],
                  [
                    t('support.account.phone'),
                    state.data.phone_last3 && t('support.account.phoneEnds', { digits: state.data.phone_last3 }),
                  ],
                  [t('support.account.lang'), t(state.data.lang === 'en' ? 'lang.en' : 'lang.ro')],
                  ...(state.data.shop ? [[t('support.account.shop'), shopLine(t, state.data.shop)] as [string, string]] : []),
                  [t('support.account.created'), day(lang, state.data.created_at)],
                  [t('support.account.lastActive'), state.data.last_active_at ? dateTime(lang, state.data.last_active_at) : t('admin.never')],
                ]}
              />
            </Card>
          </section>
          <section className={styles.section}>
            <SectionTitle>{t('support.account.suggestions')}</SectionTitle>
            {state.data.suggestions.length === 0 ? (
              <p className={styles.muted}>{t('support.account.noSuggestions')}</p>
            ) : (
              <ul className={suggestionStyles.list}>
                {state.data.suggestions.map((s) => (
                  <li key={s.id}>
                    <Card className={suggestionStyles.item}>
                      <p className={suggestionStyles.body}>{s.body}</p>
                      <div className={suggestionStyles.meta}>
                        <SuggestionStatusPill status={s.status} admin />
                        <span>{dateTime(lang, s.created_at)}</span>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
