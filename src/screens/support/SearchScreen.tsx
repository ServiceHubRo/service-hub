import { SearchX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { rpcErrorMessage } from '../../data/rpc';
import { SUPPORT_SEARCH_MIN, supportSearchAccounts, type SupportAccount } from '../../data/support';
import { useI18n } from '../../i18n/context';
import { RowLink } from '../admin/parts';
import { day } from '../admin/format';
import styles from '../admin/admin.module.css';
import supportStyles from './support.module.css';
import { AccountPills } from './AccountParts';
import { shopLine } from './format';
import { supportAccountPath } from './paths';

type Result = { items: SupportAccount[]; more: boolean };
type Outcome = { q: string; attempt: number } & ({ data: Result } | { error: string });

/**
 * The last search of this tab: coming back from an account's card shows the same results without a
 * new search (each search is written to the audit log).
 */
let lastSearch: { q: string; data: Result } | null = null;

/**
 * Căutare (A2): an account by its ID, exact email, phone or a part of the name or the shop's name.
 * The search runs in the database (support_search_accounts) only when asked, never while typing; the
 * words searched stay in the address (?q=), so Back from a card returns to the same list.
 */
export function SearchScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const asked = q.length >= SUPPORT_SEARCH_MIN;
  const [text, setText] = useState(q);
  const [tooShort, setTooShort] = useState(false);
  // Bumped to search the same words again (the button, „Încearcă din nou”).
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    asked && lastSearch?.q === q ? { q, attempt: 0, data: lastSearch.data } : null,
  );
  const current = outcome && outcome.q === q && outcome.attempt === attempt ? outcome : null;

  useEffect(() => {
    if (!asked || current) return;
    let cancelled = false;
    supportSearchAccounts(q).then(
      (data) => {
        lastSearch = { q, data };
        if (!cancelled) setOutcome({ q, attempt, data });
      },
      (e: unknown) => {
        if (!cancelled) setOutcome({ q, attempt, error: rpcErrorMessage(lang, e) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [asked, current, q, attempt, lang]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = text.trim();
    if (query.length < SUPPORT_SEARCH_MIN) {
      setTooShort(true);
      // The focus stays in the field to correct it (the button had it).
      e.currentTarget.querySelector('input')?.focus();
      return;
    }
    setTooShort(false);
    if (query === q) setAttempt((a) => a + 1);
    else setParams({ q: query }, { replace: true });
  }

  const loading = asked && !current;

  return (
    <div className={styles.page}>
      <PageHeader title={t('support.search.title')} subtitle={t('support.search.desc')} />
      <form className={supportStyles.searchForm} role="search" noValidate onSubmit={submit}>
        <Field
          label={t('support.search.label')}
          hint={t('support.search.hint')}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={text}
          maxLength={100}
          onChange={(e) => {
            setText(e.target.value);
            setTooShort(false);
          }}
          error={tooShort ? t('rpcError.query_too_short', { min: SUPPORT_SEARCH_MIN }) : null}
        />
        <Button type="submit" variant="primary" disabled={loading}>
          {t('support.search.submit')}
        </Button>
      </form>
      <p className={styles.muted}>{t('support.search.audit')}</p>

      {loading && <SkeletonList />}
      {current && 'error' in current && <LoadError message={current.error} onRetry={() => setAttempt((a) => a + 1)} />}
      {current &&
        'data' in current &&
        (current.data.items.length === 0 ? (
          <EmptyState icon={SearchX} title={t('support.search.empty')} />
        ) : (
          <section aria-label={t('support.search.results')}>
            <ul className={styles.list}>
              {current.data.items.map((a) => (
                <li key={a.id}>
                  <RowLink to={supportAccountPath(a.id)}>
                    <span className={styles.rowTop}>
                      <span className={styles.rowTitle}>{a.name || t('admin.noName')}</span>
                      <AccountPills account={a} />
                    </span>
                    <span className={styles.rowMeta}>
                      <span className={styles.id}>{a.display_id}</span>
                      {a.email_masked && <span>{a.email_masked}</span>}
                      {a.shop && <span>{shopLine(t, a.shop)}</span>}
                    </span>
                    <span className={styles.rowMeta}>
                      <span>{t('admin.createdOn', { date: day(lang, a.created_at) })}</span>
                    </span>
                  </RowLink>
                </li>
              ))}
            </ul>
            {current.data.more && <p className={styles.muted}>{t('support.search.more')}</p>}
          </section>
        ))}
    </div>
  );
}
