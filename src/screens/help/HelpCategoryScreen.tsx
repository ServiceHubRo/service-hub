import { FileQuestion } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { articlesOf } from '../../lib/helpCenter';
import { ArticleBody, ArticleLinks } from './parts';
import { useHelpCenter } from './useHelpCenter';
import { helpArticlePath, helpHome, type HelpRole } from './paths';
import styles from './help.module.css';

/** One category of the Help Center: its articles, then its frequent questions (opened in place). */
export function HelpCategoryScreen({ role }: { role: HelpRole }) {
  const { t } = useI18n();
  const { slug } = useParams();
  const { state, reload } = useHelpCenter();
  const back = { to: helpHome(role), label: role === 'support' ? t('help.center.title') : t('help.title') };

  if (state.status !== 'ready') {
    return (
      <div className={styles.page}>
        <PageHeader back={back} title={t('help.center.title')} />
        {state.status === 'loading' ? <SkeletonList count={3} /> : <LoadError message={t('help.loadError')} onRetry={reload} />}
      </div>
    );
  }

  const category = state.data.categories.find((c) => c.slug === slug);
  if (!category) {
    return (
      <div className={styles.page}>
        <PageHeader back={back} title={t('help.center.title')} />
        <EmptyState icon={FileQuestion} title={t('help.category.notFound')} />
      </div>
    );
  }

  const { pages, questions } = articlesOf(state.data.articles, category.id);
  return (
    <div className={styles.page}>
      <PageHeader back={back} title={category.name} subtitle={category.description ?? undefined} />
      {pages.length > 0 && (
        <section aria-labelledby="help-cat-articles" className={styles.block}>
          <h2 id="help-cat-articles" className={styles.blockTitle}>
            {t('help.articles')}
          </h2>
          <ArticleLinks items={pages.map((a) => ({ article: a, to: helpArticlePath(role, a.slug) }))} />
        </section>
      )}
      {questions.length > 0 && (
        <section aria-labelledby="help-cat-faq" className={styles.block}>
          <h2 id="help-cat-faq" className={styles.blockTitle}>
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
    </div>
  );
}
