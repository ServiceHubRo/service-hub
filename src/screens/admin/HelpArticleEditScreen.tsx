import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CheckMenu } from '../../components/CheckMenu';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { Section } from '../../components/Section';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { TextArea } from '../../components/TextArea';
import {
  deleteHelpArticle,
  fetchAdminHelp,
  fetchAdminHelpArticle,
  HELP_AUDIENCES,
  HELP_COMPANY_ROLES,
  saveHelpArticle,
  setHelpArticleStatus,
  type AdminHelpArticle,
  type AdminHelpCategory,
  type HelpArticleInput,
  type HelpAudience,
  type HelpCompanyRole,
  type HelpKind,
  type HelpStatus,
} from '../../data/help';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { HELP_LIMITS, HELP_SLUG_PATTERN, helpTextProblem, keywordsProblem, parseKeywords, slugify } from '../../lib/helpCenter';
import { useLoad } from '../../lib/useLoad';
import { ArticleBody } from '../help/parts';
import { dateTime } from './format';
import { audienceLabel, problemText } from './helpFormat';
import { Pill } from './parts';
import { ADMIN_HELP_PATH, adminHelpArticlePath } from './paths';
import styles from './admin.module.css';

/** The form's own state: keywords as the line the admin types. */
interface Draft {
  category_id: string;
  slug: string;
  slugTouched: boolean;
  kind: HelpKind;
  audience: HelpAudience[];
  company_roles: HelpCompanyRole[];
  featured: boolean;
  title_ro: string;
  summary_ro: string;
  body_ro: string;
  keywords_ro: string;
  title_en: string;
  summary_en: string;
  body_en: string;
  keywords_en: string;
}

function toDraft(a: HelpArticleInput, slugTouched = true): Draft {
  return {
    category_id: a.category_id,
    slug: a.slug,
    slugTouched,
    kind: a.kind,
    audience: [...a.audience],
    company_roles: [...a.company_roles],
    featured: a.featured,
    title_ro: a.title_ro,
    summary_ro: a.summary_ro ?? '',
    body_ro: a.body_ro,
    keywords_ro: a.keywords_ro.join(', '),
    title_en: a.title_en ?? '',
    summary_en: a.summary_en ?? '',
    body_en: a.body_en ?? '',
    keywords_en: a.keywords_en.join(', '),
  };
}

function toInput(d: Draft): HelpArticleInput {
  const fleet = d.audience.includes('fleet');
  return {
    category_id: d.category_id,
    slug: d.slugTouched ? d.slug.trim() : slugify(d.title_ro),
    kind: d.kind,
    audience: d.audience,
    company_roles: fleet ? d.company_roles : [],
    featured: d.featured,
    title_ro: d.title_ro.trim(),
    summary_ro: d.summary_ro.trim() || null,
    body_ro: d.body_ro.trim(),
    keywords_ro: parseKeywords(d.keywords_ro),
    title_en: d.title_en.trim() || null,
    summary_en: d.summary_en.trim() || null,
    body_en: d.body_en.trim() || null,
    keywords_en: parseKeywords(d.keywords_en),
  };
}

const EMPTY: Omit<Draft, 'category_id'> = {
  slug: '',
  slugTouched: false,
  kind: 'article',
  audience: [],
  company_roles: [],
  featured: false,
  title_ro: '',
  summary_ro: '',
  body_ro: '',
  keywords_ro: '',
  title_en: '',
  summary_en: '',
  body_en: '',
  keywords_en: '',
};

type Loaded = { categories: AdminHelpCategory[]; article: AdminHelpArticle | null };

/** One article's editor (A4): a new one (`nou`) or an existing one with its status, votes and history. */
export function HelpArticleEditScreen() {
  const { articleId } = useParams();
  const isNew = articleId === 'nou';
  const load = useCallback(async (): Promise<Loaded> => {
    const [list, article] = await Promise.all([fetchAdminHelp(), isNew ? Promise.resolve(null) : fetchAdminHelpArticle(articleId ?? '')]);
    return { categories: list.categories, article };
  }, [articleId, isNew]);
  const { state, reload, setData } = useLoad(load);
  const { t } = useI18n();
  // Kept here: a save shows the article's new version (the editor starts again from it).
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_HELP_PATH} label={t('admin.help.title')} />
      <h1>{isNew ? t('admin.help.editor.new') : t('admin.help.editor.edit')}</h1>
      {state.status === 'loading' && <SkeletonList count={3} />}
      {state.status === 'error' && <LoadError message={t('admin.help.editor.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <Editor
          key={state.data.article ? `${state.data.article.id}:${state.data.article.version}` : 'new'}
          loaded={state.data}
          notice={notice}
          setNotice={setNotice}
          onSaved={(article) => setData((prev) => ({ ...prev, article }))}
        />
      )}
    </div>
  );
}

function Editor({
  loaded,
  notice,
  setNotice,
  onSaved,
}: {
  loaded: Loaded;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  onSaved: (article: AdminHelpArticle) => void;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { article, categories } = loaded;
  const initial = useMemo<Draft>(
    () => (article ? toDraft(article) : { ...EMPTY, category_id: categories[0]?.id ?? '' }),
    [article, categories],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [previewLang, setPreviewLang] = useState<'ro' | 'en'>('ro');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const input = toInput(draft);
  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(initial));
  const enStarted = Boolean(input.title_en || input.body_en || input.summary_en);
  const problems: Partial<Record<keyof Draft, string | null>> = {
    slug: HELP_SLUG_PATTERN.test(input.slug) && input.slug.length <= 80 ? null : t('admin.help.problem.slug'),
    title_ro: problemText(t, helpTextProblem(draft.title_ro, HELP_LIMITS.title), HELP_LIMITS.title),
    summary_ro: draft.summary_ro.trim() ? problemText(t, helpTextProblem(draft.summary_ro, HELP_LIMITS.summary), HELP_LIMITS.summary) : null,
    body_ro: problemText(t, helpTextProblem(draft.body_ro, HELP_LIMITS.body), HELP_LIMITS.body),
    keywords_ro: keywordsProblem(input.keywords_ro) === null ? null : t(keywordsProblem(input.keywords_ro) === 'count' ? 'admin.help.problem.keywordsCount' : 'admin.help.problem.keyword'),
    title_en: !enStarted ? null : input.title_en ? problemText(t, helpTextProblem(draft.title_en, HELP_LIMITS.title), HELP_LIMITS.title) : t('admin.help.problem.enPair'),
    summary_en: draft.summary_en.trim() ? problemText(t, helpTextProblem(draft.summary_en, HELP_LIMITS.summary), HELP_LIMITS.summary) : null,
    body_en: !enStarted ? null : input.body_en ? problemText(t, helpTextProblem(draft.body_en, HELP_LIMITS.body), HELP_LIMITS.body) : t('admin.help.problem.enPair'),
    keywords_en: keywordsProblem(input.keywords_en) === null ? null : t(keywordsProblem(input.keywords_en) === 'count' ? 'admin.help.problem.keywordsCount' : 'admin.help.problem.keyword'),
  };
  const valid = Boolean(input.category_id) && Object.values(problems).every((p) => p === null);
  // A field shows its problem once something was written in it (a new form does not start in red).
  const shown = (key: keyof Draft) => (String(draft[key] ?? '').trim() !== '' || !!article ? (problems[key] ?? null) : null);

  const toggle = <V extends string>(list: V[], value: V): V[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  const previewBody = previewLang === 'en' ? draft.body_en : draft.body_ro;

  return (
    <>
      {article && (
        <div className={styles.rowTop}>
          <Pill tone={article.status === 'published' ? 'green' : article.status === 'draft' ? 'amber' : 'grey'}>{t(`admin.help.status.${article.status}`)}</Pill>
          <span className={styles.muted}>
            {t('admin.help.historyVersion', { n: article.version })} · {dateTime(lang, article.updated_at)}
            {article.updated_by ? ` · ${article.updated_by}` : ''}
          </span>
        </div>
      )}

      <form className="form-contents" onSubmit={(e) => e.preventDefault()} noValidate>
        <Section title={t('admin.help.editor.settings')} description={t('admin.help.editor.settingsDesc')}>
          <Card className={styles.stack}>
            <div className={styles.fields}>
              <SelectField
                label={t('admin.help.editor.category')}
                value={draft.category_id}
                options={categories.map((c) => ({ value: c.id, label: lang === 'en' ? c.name_en : c.name_ro }))}
                onChange={(e) => set('category_id', e.target.value)}
              />
              <SelectField
                label={t('admin.help.editor.kind')}
                value={draft.kind}
                options={(['article', 'faq'] as const).map((k) => ({ value: k, label: t(`admin.help.kind.${k}`) }))}
                onChange={(e) => set('kind', e.target.value as HelpKind)}
              />
              <Field
                className={styles.full}
                label={t('admin.help.slug')}
                hint={t('admin.help.slugHint')}
                error={input.slug ? (problems.slug ?? null) : null}
                value={input.slug}
                mono
                maxLength={80}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value.toLowerCase(), slugTouched: true }))}
              />
              <div className={styles.full}>
                <CheckMenu
                  label={t('admin.help.audience')}
                  summary={audienceLabel(t, draft.audience)}
                  options={HELP_AUDIENCES.map((a) => ({ value: a, label: t(`help.audience.${a}` as MessageKey) }))}
                  selected={draft.audience}
                  onToggle={(v) => set('audience', toggle(draft.audience, v as HelpAudience))}
                  all={{ label: t('admin.help.audienceAll'), selected: draft.audience.length === 0, onSelect: () => set('audience', []) }}
                />
                <p className={styles.muted}>{t('admin.help.audienceHint')}</p>
              </div>
              {draft.audience.includes('fleet') && (
                <div className={styles.full}>
                  <CheckMenu
                    label={t('admin.help.companyRoles')}
                    summary={
                      draft.company_roles.length === 0
                        ? t('admin.help.companyRolesAll')
                        : draft.company_roles.map((r) => t(`fleet.role.${r}` as MessageKey)).join(', ')
                    }
                    options={HELP_COMPANY_ROLES.map((r) => ({ value: r, label: t(`fleet.role.${r}` as MessageKey) }))}
                    selected={draft.company_roles}
                    onToggle={(v) => set('company_roles', toggle(draft.company_roles, v as HelpCompanyRole))}
                    all={{ label: t('admin.help.companyRolesAll'), selected: draft.company_roles.length === 0, onSelect: () => set('company_roles', []) }}
                  />
                </div>
              )}
            </div>
            <Switch checked={draft.featured} onChange={(e) => set('featured', e.target.checked)}>
              {t('admin.help.editor.featured')}
            </Switch>
          </Card>
        </Section>

        {(['ro', 'en'] as const).map((l) => (
          <Section key={l} title={t(l === 'ro' ? 'admin.help.editor.ro' : 'admin.help.editor.en')} description={t(l === 'ro' ? 'admin.help.editor.roDesc' : 'admin.help.editor.enDesc')}>
            <Card className={styles.stack}>
              <Field
                label={t('admin.help.editor.title')}
                value={draft[`title_${l}`]}
                maxLength={HELP_LIMITS.title[1]}
                error={shown(`title_${l}`)}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    [`title_${l}`]: e.target.value,
                    ...(l === 'ro' && !d.slugTouched ? { slug: slugify(e.target.value) } : {}),
                  }))
                }
              />
              <Field
                label={t('admin.help.editor.summary')}
                value={draft[`summary_${l}`]}
                maxLength={HELP_LIMITS.summary[1]}
                error={shown(`summary_${l}`)}
                onChange={(e) => set(`summary_${l}`, e.target.value)}
              />
              <TextArea
                label={t('admin.help.editor.body')}
                hint={t('admin.help.editor.bodyHint')}
                rows={14}
                maxLength={HELP_LIMITS.body[1]}
                value={draft[`body_${l}`]}
                error={shown(`body_${l}`)}
                onChange={(e) => set(`body_${l}`, e.target.value)}
              />
              <Field
                label={t('admin.help.editor.keywords')}
                hint={t('admin.help.editor.keywordsHint')}
                value={draft[`keywords_${l}`]}
                error={shown(`keywords_${l}`)}
                onChange={(e) => set(`keywords_${l}`, e.target.value)}
              />
            </Card>
          </Section>
        ))}

        <Section title={t('admin.help.editor.preview')}>
          <Card className={styles.stack}>
            <SelectField
              label={t('admin.help.editor.previewLang')}
              value={previewLang}
              options={[
                { value: 'ro', label: t('admin.help.editor.ro') },
                { value: 'en', label: t('admin.help.editor.en') },
              ]}
              onChange={(e) => setPreviewLang(e.target.value as 'ro' | 'en')}
            />
            {previewBody.trim() ? <ArticleBody body={previewBody} /> : <p className={styles.muted}>{t('admin.help.editor.previewEmpty')}</p>}
          </Card>
        </Section>

        <div className={styles.panelButtons}>
          <ActionButton
            submit
            disabled={!valid || (!dirty && !!article)}
            onAction={async (requestId) => {
              const { id } = await saveHelpArticle(article?.id ?? null, input, requestId);
              if (!article) {
                setNotice(t('admin.help.editor.created'));
                navigate(adminHelpArticlePath(id), { replace: true });
                return;
              }
              setNotice(t('admin.help.editor.saved'));
              onSaved(await fetchAdminHelpArticle(id));
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('admin.help.editor.save')}
          </ActionButton>
        </div>
      </form>
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}

      {article && (
        <>
          <Section title={t('admin.help.editor.state')} description={t('admin.help.editor.stateDesc')}>
            <Card className={styles.stack}>
              {dirty && <p className={styles.warning}>{t('admin.help.editor.saveFirst')}</p>}
              <div className={styles.panelButtons}>
                {(
                  [
                    ['published', 'admin.help.publish', 'admin.help.published'],
                    ['draft', 'admin.help.toDraft', 'admin.help.drafted'],
                    ['archived', 'admin.help.archive', 'admin.help.archived'],
                  ] as const
                )
                  .filter(([status]) => status !== article.status)
                  .map(([status, label, done]) => (
                    <ActionButton
                      key={status}
                      variant={status === 'published' ? 'primary' : 'secondary'}
                      disabled={dirty}
                      onAction={async (requestId) => {
                        await setHelpArticleStatus(article.id, status as HelpStatus, requestId);
                        setNotice(t(done));
                        onSaved(await fetchAdminHelpArticle(article.id));
                      }}
                      errorMessage={(e) => rpcErrorMessage(lang, e)}
                      canRetry={canRetryRpc}
                    >
                      {t(label)}
                    </ActionButton>
                  ))}
              </div>
              {article.status === 'published' ? (
                <p className={styles.muted}>{t('admin.help.deletePublished')}</p>
              ) : !confirmDelete ? (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  {t('admin.help.delete')}
                </Button>
              ) : (
                <InlinePanel title={t('admin.help.deleteConfirm')} onClose={() => setConfirmDelete(false)}>
                  <p>{t('admin.help.deleteBody')}</p>
                  <div className={styles.panelButtons}>
                    <ActionButton
                      variant="danger"
                      onAction={async (requestId) => {
                        await deleteHelpArticle(article.id, requestId);
                        navigate(ADMIN_HELP_PATH, { replace: true });
                      }}
                      errorMessage={(e) => rpcErrorMessage(lang, e)}
                      canRetry={canRetryRpc}
                    >
                      {t('admin.help.deleteYes')}
                    </ActionButton>
                    <Button onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
                  </div>
                </InlinePanel>
              )}
            </Card>
          </Section>

          <Section title={t('admin.help.feedback')} description={t('admin.help.feedbackDesc')}>
            <Card>
              <p>
                {article.helpful + article.not_helpful === 0
                  ? t('admin.help.votesNone')
                  : t('admin.help.votes', { yes: article.helpful, no: article.not_helpful })}
              </p>
            </Card>
          </Section>

          <Section title={t('admin.help.history')} description={t('admin.help.historyDesc')}>
            <DisclosureGroup>
              {article.revisions.map((r) => (
                <Disclosure
                  key={`${r.version}-${r.at}`}
                  title={`${t('admin.help.historyVersion', { n: r.version })} · ${t(`admin.help.historyAction.${r.action}`)}`}
                  summary={`${dateTime(lang, r.at)}${r.by ? ` · ${r.by}` : ''}`}
                >
                  <div className={styles.stack}>
                    {r.changed.length > 0 && <p className={styles.muted}>{t('admin.help.historyFields', { fields: r.changed.join(', ') })}</p>}
                    <p>
                      <strong>{r.snapshot.title_ro}</strong>
                    </p>
                    <ArticleBody body={r.snapshot.body_ro} />
                    <Button
                      onClick={() => {
                        setDraft(toDraft(r.snapshot));
                        setNotice(t('admin.help.historyRestored'));
                      }}
                    >
                      {t('admin.help.historyRestore')}
                    </Button>
                  </div>
                </Disclosure>
              ))}
            </DisclosureGroup>
          </Section>
        </>
      )}
    </>
  );
}
