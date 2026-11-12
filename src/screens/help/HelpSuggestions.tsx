import { useDeferredValue, useMemo } from 'react';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { searchArticles } from '../../lib/helpSearch';
import { useI18n } from '../../i18n/context';
import { ArticleBody } from './parts';
import { useHelpCenter } from './useHelpCenter';
import styles from './help.module.css';

/**
 * While a support request is written (A3 ↔ A4): up to three Help Center articles that match its
 * title, opened in place so the request being written stays as it is. Never in the way: nothing
 * shows while the Help Center loads, fails or has no match, and sending is never blocked.
 */
export function HelpSuggestions({ text }: { text: string }) {
  const { t } = useI18n();
  const { state } = useHelpCenter();
  const query = useDeferredValue(text);
  const hits = useMemo(() => {
    if (state.status !== 'ready' || query.trim().length < 4) return [];
    const result = searchArticles(state.data.articles, query, 3);
    return result.partial ? [] : result.hits;
  }, [state, query]);

  if (hits.length === 0) return null;
  return (
    <section className={styles.suggest} aria-labelledby="help-suggest">
      <h2 id="help-suggest" className={styles.suggestTitle}>
        {t('help.suggest.title')}
      </h2>
      <DisclosureGroup>
        {hits.map(({ article }) => (
          <Disclosure key={article.id} title={article.title}>
            <ArticleBody body={article.body} />
          </Disclosure>
        ))}
      </DisclosureGroup>
    </section>
  );
}
