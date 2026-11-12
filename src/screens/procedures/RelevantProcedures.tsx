import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { fetchRequestProcedures } from '../../data/procedures';
import { useI18n } from '../../i18n/context';
import { contentIn, procedureTitle } from '../../lib/procedures';
import { useLoad } from '../../lib/useLoad';
import { ProcedureTags, ProcedureText, Tag } from './parts';
import { procedurePath, type ProcedureMode } from './paths';
import styles from './procedures.module.css';

/**
 * „Proceduri relevante” inside a support request (A5): the published procedures of the request's
 * category the caller may read, opened in place (the request stays on the screen), each with a link
 * to its own page. Reads only; nothing of the request changes.
 */
export function RelevantProcedures({ requestId, mode }: { requestId: string; mode: ProcedureMode }) {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchRequestProcedures(requestId), [requestId]);
  const { state, reload } = useLoad(load);
  return (
    <section className={styles.panel} aria-labelledby="relevant-procedures">
      <h2 id="relevant-procedures" className={styles.blockTitle}>
        {t('proc.request.title')}
      </h2>
      {state.status === 'loading' && <SkeletonList count={1} />}
      {state.status === 'error' && <LoadError message={t('proc.request.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Card>
            <p className={styles.muted}>{t('proc.request.none')}</p>
          </Card>
        ) : (
          <DisclosureGroup label={t('proc.request.title')}>
            {state.data.map((p) => {
              const { content, fallback } = contentIn(lang, p.published);
              return (
                <Disclosure
                  key={p.id}
                  title={procedureTitle(lang, p)}
                  summary={
                    p.ack_required && !p.acknowledged_at ? <Tag tone="critical">{t('proc.row.toConfirm')}</Tag> : t(`proc.kind.${p.kind}`)
                  }
                >
                  <div className={styles.stack}>
                    <div className={styles.meta}>
                      <ProcedureTags p={p} showWork={false} />
                    </div>
                    {fallback && <p className={styles.note}>{t('proc.page.fallback')}</p>}
                    {content && <ProcedureText content={content} />}
                    <Link to={procedurePath(mode, p.id)} className={styles.inlineLink}>
                      {t('proc.request.open')}
                    </Link>
                  </div>
                </Disclosure>
              );
            })}
          </DisclosureGroup>
        ))}
    </section>
  );
}
