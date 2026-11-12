import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { fetchProcedures, setCategoryResponsible, type ProcedureCategory, type ProcedureLibrary, type Responsible } from '../../data/procedures';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { useLoad } from '../../lib/useLoad';
import { day } from '../admin/format';
import { ProcedureRow, Tag } from './parts';
import { procedurePath, proceduresHome, type ProcedureMode } from './paths';
import styles from './procedures.module.css';

/**
 * The categories with their responsible (A5): who, since when, named by whom, and the procedures of
 * each. A responsible who left the team, was suspended or deleted is marked „Necesită reatribuire”;
 * nobody is named in its place automatically. Only the admin names or removes a responsible; an agent
 * reads the list.
 */
export function ResponsiblesScreen({ mode }: { mode: ProcedureMode }) {
  const { t } = useI18n();
  const { state, reload, setData } = useLoad(fetchProcedures);
  return (
    <div className={styles.page}>
      <PageHeader back={{ to: proceduresHome(mode), label: t('proc.title') }} title={t('proc.resp.title')} subtitle={t('proc.resp.desc')} />
      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' && <LoadError message={t('proc.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        state.data.categories.map((c) => (
          <CategoryCard
            key={c.key}
            category={c.key}
            responsible={c.responsible}
            lib={state.data}
            mode={mode}
            onSaved={async () => setData(await fetchProcedures())}
          />
        ))}
    </div>
  );
}

function CategoryCard({
  category,
  responsible,
  lib,
  mode,
  onSaved,
}: {
  category: ProcedureCategory;
  responsible: Responsible | null;
  lib: ProcedureLibrary;
  mode: ProcedureMode;
  onSaved: () => Promise<void>;
}) {
  const { t, lang, plural } = useI18n();
  const current = responsible?.user?.id ?? '';
  const [choice, setChoice] = useState(current);
  const [notice, setNotice] = useState<string | null>(null);
  const procedures = lib.procedures.filter((p) => p.category === category);
  const who = responsible ? [responsible.display_id, responsible.user?.name].filter(Boolean).join(' · ') : t('proc.page.noResponsible');
  const titleId = `resp-${category}`;
  return (
    <section aria-labelledby={titleId}>
      <Card className={styles.categoryCard}>
        <div className={styles.categoryHead}>
          <h2 id={titleId} className={styles.categoryName}>
            {t(`proc.category.${category}`)}
          </h2>
          <span className={styles.muted}>{plural('unit.procedures', procedures.length)}</span>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>{t('proc.page.responsible')}</dt>
            <dd>
              {who}{' '}
              {responsible?.needs_reassignment && <Tag tone="amber">{t('proc.resp.reassign')}</Tag>}
            </dd>
          </div>
          {responsible && (
            <div>
              <dt>{t('proc.resp.assigned')}</dt>
              <dd>{t('proc.resp.since', { date: day(lang, responsible.assigned_at), who: responsible.assigned_by ?? '—' })}</dd>
            </div>
          )}
        </dl>
        {lib.team && (
          <div className={styles.stack}>
            <SelectField
              label={t('proc.filter.responsible')}
              value={choice}
              onChange={(e) => {
                setNotice(null);
                setChoice(e.target.value);
              }}
              options={[
                { value: '', label: t('proc.page.noResponsible') },
                ...lib.team.map((m) => ({ value: m.id, label: [m.display_id, m.name].filter(Boolean).join(' · ') })),
              ]}
            />
            <div className={styles.buttons}>
              <ActionButton
                variant="secondary"
                block={false}
                disabled={(choice === current && !responsible?.needs_reassignment) || (choice === '' && !responsible)}
                onAction={async (requestId) => {
                  await setCategoryResponsible(category, choice || null, requestId);
                  setNotice(t('proc.resp.saved'));
                  await onSaved();
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {choice ? t('proc.resp.save') : t('proc.resp.remove')}
              </ActionButton>
            </div>
            {notice && (
              <p className={styles.muted} role="status">
                {notice}
              </p>
            )}
          </div>
        )}
        {procedures.length > 0 && (
          <ul className={styles.rows}>
            {procedures.map((p) => (
              <ProcedureRow key={p.id} p={p} to={procedurePath(mode, p.id)} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
