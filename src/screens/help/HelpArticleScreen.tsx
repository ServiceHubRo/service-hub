import { FileQuestion, Inbox, Languages } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useDocumentTitle } from '../../app/useDocumentTitle';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SkeletonList } from '../../components/Skeleton';
import { useI18n } from '../../i18n/context';
import { relatedArticles } from '../../lib/helpCenter';
import { newRequestPath } from '../account/paths';
import { ArticleBody, ArticleFeedback, ArticleLinks } from './parts';
import { useHelpCenter } from './useHelpCenter';
import { helpArticlePath, helpCategoryPath, helpHome, type HelpRole } from './paths';
import styles from './help.module.css';

/** The way to the support requests (A3), for clients and shops; the agent is the team itself. */
export function ContactCard({ role }: { role: HelpRole }) {
  const { t } = useI18n();
  if (role === 'support') return null;
  return (
    <Card className={styles.contact}>
      <p>{t('help.contact.body')}</p>
      <Link to={newRequestPath(role)} className={buttonClass('secondary')}>
        <Inbox size={18} aria-hidden="true" /> {t('help.contact.new')}
      </Link>
    </Card>
  );
}

/**
 * One article of the Help Center (A4): its text, when it was updated, „Ți-a fost util acest
 * articol?”, other articles of the category and the way to the team. An article without a text in the
 * interface language says so (never another language on the page); one the reader may not see, or
 * that was withdrawn, reads as not found.
 */
export function HelpArticleScreen({ role }: { role: HelpRole }) {
  const { t, date } = useI18n();
  const { slug } = useParams();
  const { state, reload } = useHelpCenter();
  const data = state.status === 'ready' ? state.data : null;
  const article = data?.articles.find((a) => a.slug === slug) ?? null;
  const category = article ? data?.categories.find((c) => c.id === article.category_id) : undefined;
  const home = { to: helpHome(role), label: role === 'support' ? t('help.center.title') : t('help.title') };
  useDocumentTitle(article?.title ?? null);

  if (!data) {
    return (
      <div className={styles.page}>
        <PageHeader back={home} title={t('help.center.title')} />
        {state.status === 'loading' ? <SkeletonList count={2} /> : <LoadError message={t('help.loadError')} onRetry={reload} />}
      </div>
    );
  }

  if (!article) {
    const untranslated = slug !== undefined && data.untranslated.includes(slug);
    return (
      <div className={styles.page}>
        <PageHeader back={home} title={t('help.center.title')} />
        <EmptyState
          icon={untranslated ? Languages : FileQuestion}
          title={t(untranslated ? 'help.article.untranslated' : 'help.article.notFound')}
          body={t(untranslated ? 'help.article.untranslatedBody' : 'help.article.notFoundBody')}
          action={
            <Link to={home.to} className={buttonClass('primary')}>
              {t('help.article.toCenter')}
            </Link>
          }
        />
        <ContactCard role={role} />
      </div>
    );
  }

  const related = relatedArticles(data.articles, article);
  const back = category ? { to: helpCategoryPath(role, category.slug), label: category.name } : home;

  return (
    <div className={styles.page}>
      <PageHeader back={back} title={article.title} subtitle={article.summary ?? undefined} />
      <Card className={styles.articleCard}>
        <ArticleBody body={article.body} />
        <p className={styles.updated}>{t('help.article.updated', { date: date(new Date(article.updated_at)) })}</p>
      </Card>
      {role !== 'support' && (
        <ArticleFeedback key={article.id} article={article} vote={data.votes[article.id]} />
      )}
      {related.length > 0 && (
        <section aria-labelledby="help-related" className={styles.block}>
          <h2 id="help-related" className={styles.blockTitle}>
            {t('help.article.related')}
          </h2>
          <ArticleLinks items={related.map((a) => ({ article: a, to: helpArticlePath(role, a.slug) }))} />
        </section>
      )}
      <ContactCard role={role} />
    </div>
  );
}
