import { SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveSearchParams } from '../../app/useLiveSearchParams';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { HELP_AUDIENCES, type HelpArticle, type HelpAudience, type HelpCenterData } from '../../data/help';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { featuredArticles, frequentQuestions, orderCategories } from '../../lib/helpCenter';
import { searchArticles } from '../../lib/helpSearch';
import { HELP_ICON } from './helpIcons';
import { ArticleBody, ArticleLinks } from './parts';
import { useHelpCenter } from './useHelpCenter';
import { helpArticlePath, helpCategoryPath, type HelpRole } from './paths';
import styles from './help.module.css';

/** The team's filter: what a group of readers sees (everyone's articles included). */
function forAudience(articles: readonly HelpArticle[], audience: HelpAudience | ''): HelpArticle[] {
  if (audience === '') return [...articles];
  return articles.filter((a) => a.audience.length === 0 || a.audience.includes(audience));
}

function Results({ data, articles, query, role }: { data: HelpCenterData; articles: HelpArticle[]; query: string; role: HelpRole }) {
  const { t } = useI18n();
  const result = useMemo(() => searchArticles(articles, query), [articles, query]);
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  if (result.hits.length === 0) {
    return <EmptyState icon={SearchX} title={t('help.search.empty', { q: query.trim() })} body={t('help.search.emptyBody')} />;
  }
  return (
    <section aria-labelledby="help-results" className={styles.block}>
      <h2 id="help-results" className={styles.blockTitle} role="status">
        {t('help.search.count', { n: result.hits.length })}
      </h2>
      {result.partial && <p className={styles.note}>{t('help.search.partial')}</p>}
      <ArticleLinks
        items={result.hits.map((hit) => ({
          article: hit.article,
          to: helpArticlePath(role, hit.article.slug),
          meta: [categoryName.get(hit.article.category_id), hit.article.kind === 'faq' ? t('help.faqTag') : null].filter(Boolean).join(' · '),
          snippet: hit.snippet,
        }))}
      />
    </section>
  );
}

/**
 * The Help Center's first page (A4): a search over every article the reader may see (results as it
 * types, no page reload), the categories with the reader's own first, the recommended articles and
 * the frequent questions. Used inside Ajutor și contact (clients and shops) and on the agent's page.
 */
export function HelpCenterHome({ role }: { role: HelpRole }) {
  const { t } = useI18n();
  const { state, reload } = useHelpCenter();
  const [params, setParams] = useLiveSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = useDeferredValue(text);
  const [audience, setAudience] = useState<HelpAudience | ''>('');

  const setQuery = (value: string) => {
    setText(value);
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const data = state.status === 'ready' ? state.data : null;
  const articles = useMemo(() => (data ? forAudience(data.articles, audience) : []), [data, audience]);
  const searching = query.trim() !== '';

  return (
    <div className={styles.home}>
      <div className={styles.searchRow}>
        <SearchField
          id="help-q"
          label={t('help.search.label')}
          placeholder={t('help.search.placeholder')}
          value={text}
          onChange={setQuery}
          onClear={() => setQuery('')}
          clearLabel={t('help.search.clear')}
        />
        {data?.me.staff && (
          <SelectField
            label={t('help.audience.label')}
            value={audience}
            onChange={(e) => setAudience(e.target.value as HelpAudience | '')}
            options={[
              { value: '', label: t('help.audience.all') },
              ...HELP_AUDIENCES.map((a) => ({ value: a, label: t(`help.audience.${a}` as MessageKey) })),
            ]}
          />
        )}
      </div>

      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' && <LoadError message={t('help.loadError')} onRetry={reload} />}
      {data && articles.length === 0 && <EmptyState title={t('help.empty')} />}
      {data && articles.length > 0 && searching && <Results data={data} articles={articles} query={query} role={role} />}
      {data && articles.length > 0 && !searching && <Overview data={data} articles={articles} role={role} />}
    </div>
  );
}

function Overview({ data, articles, role }: { data: HelpCenterData; articles: HelpArticle[]; role: HelpRole }) {
  const { t, plural } = useI18n();
  const shownIds = new Set(articles.map((a) => a.category_id));
  const categories = orderCategories(data.categories, data.me).filter((c) => shownIds.has(c.id));
  const featured = featuredArticles(articles, data.me, data.categories);
  const questions = frequentQuestions(articles, data.me);
  const count = (id: string) => articles.filter((a) => a.category_id === id).length;

  return (
    <>
      {featured.length > 0 && (
        <section aria-labelledby="help-featured" className={styles.block}>
          <h2 id="help-featured" className={styles.blockTitle}>
            {t('help.featured')}
          </h2>
          <ArticleLinks items={featured.map((a) => ({ article: a, to: helpArticlePath(role, a.slug) }))} />
        </section>
      )}

      <section aria-labelledby="help-categories" className={styles.block}>
        <h2 id="help-categories" className={styles.blockTitle}>
          {t('help.categories')}
        </h2>
        <ul className={styles.categories}>
          {categories.map((c) => {
            const Icon = HELP_ICON[c.icon];
            return (
              <li key={c.id}>
                <Link to={helpCategoryPath(role, c.slug)} className={styles.category}>
                  <span className={styles.categoryIcon} aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <span className={styles.linkText}>
                    <span className={styles.linkTitle}>{c.name}</span>
                    {c.description && <span className={styles.linkSummary}>{c.description}</span>}
                    <span className={styles.linkMeta}>{plural('unit.articles', count(c.id))}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {questions.length > 0 && (
        <section aria-labelledby="help-faq" className={styles.block}>
          <h2 id="help-faq" className={styles.blockTitle}>
            {t('help.faq')}
          </h2>
          <DisclosureGroup>
            {questions.map((q) => (
              <Disclosure key={q.id} title={q.title}>
                <ArticleBody body={q.body} />
              </Disclosure>
            ))}
          </DisclosureGroup>
        </section>
      )}
    </>
  );
}
