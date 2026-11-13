import { ArrowDown, ArrowUp, BookOpen, ChevronRight, Plus, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminZoneBack } from '../../app/adminZones';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { CheckMenu } from '../../components/CheckMenu';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import {
  deleteHelpCategory,
  fetchAdminHelp,
  HELP_AUDIENCES,
  HELP_ICONS,
  moveHelpItem,
  saveHelpCategory,
  type AdminHelpArticleRow,
  type AdminHelpCategory,
  type HelpAudience,
  type HelpIcon,
  type HelpStatus,
} from '../../data/help';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { HELP_LIMITS, HELP_SLUG_PATTERN, helpTextProblem, slugify } from '../../lib/helpCenter';
import { fold } from '../../lib/helpSearch';
import { useLoad } from '../../lib/useLoad';
import { audienceLabel, problemText } from './helpFormat';
import { HELP_ICON } from '../help/parts';
import { Pill } from './parts';
import { ADMIN_HELP_PATH, adminHelpArticlePath } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';
import tools from './tools.module.css';
import rowStyles from './helpAdmin.module.css';

const ZONE_BACK = adminZoneBack(ADMIN_HELP_PATH);
const STATUS_TONE: Record<HelpStatus, 'green' | 'amber' | 'grey'> = { published: 'green', draft: 'amber', archived: 'grey' };

/** ↑ / ↓ — one place up or down; the whole button is the write (locked while it runs). */
function MoveButtons({ kind, id, first, last, onMoved }: { kind: 'category' | 'article'; id: string; first: boolean; last: boolean; onMoved: () => void }) {
  const { t, lang } = useI18n();
  return (
    <span className={tools.moves}>
      {([-1, 1] as const).map((direction) => (
        <ActionButton
          key={direction}
          variant="ghost"
          block={false}
          disabled={direction === -1 ? first : last}
          onAction={async (requestId) => {
            await moveHelpItem(kind, id, direction, requestId);
            onMoved();
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {direction === -1 ? <ArrowUp size={18} aria-hidden="true" /> : <ArrowDown size={18} aria-hidden="true" />}
          <span className="visually-hidden">{t(direction === -1 ? 'admin.catalog.moveUp' : 'admin.catalog.moveDown')}</span>
        </ActionButton>
      ))}
    </span>
  );
}

function CategoryPanel({ category, onDone, onCancel }: { category?: AdminHelpCategory; onDone: (message: string) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const [nameRo, setNameRo] = useState(category?.name_ro ?? '');
  const [nameEn, setNameEn] = useState(category?.name_en ?? '');
  const [descRo, setDescRo] = useState(category?.description_ro ?? '');
  const [descEn, setDescEn] = useState(category?.description_en ?? '');
  const [icon, setIcon] = useState<HelpIcon>(category?.icon ?? 'book');
  const [audience, setAudience] = useState<HelpAudience[]>(category?.audience ?? []);
  const [active, setActive] = useState(category?.active ?? true);
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shownSlug = slugTouched ? slug : slugify(nameRo, 60);
  const problems = {
    nameRo: problemText(t, helpTextProblem(nameRo, HELP_LIMITS.name), HELP_LIMITS.name),
    nameEn: problemText(t, helpTextProblem(nameEn, HELP_LIMITS.name), HELP_LIMITS.name),
    descRo: descRo.trim() ? problemText(t, helpTextProblem(descRo, HELP_LIMITS.description), HELP_LIMITS.description) : null,
    descEn: descEn.trim() ? problemText(t, helpTextProblem(descEn, HELP_LIMITS.description), HELP_LIMITS.description) : null,
    slug: HELP_SLUG_PATTERN.test(shownSlug) ? null : t('admin.help.problem.slug'),
  };
  const ok = Object.values(problems).every((p) => p === null);
  return (
    <InlinePanel title={category ? t('admin.help.cat.edit') : t('admin.help.newCategory')}>
      <div className={styles.fields}>
        <Field label={t('admin.help.cat.nameRo')} value={nameRo} maxLength={80} error={nameRo ? problems.nameRo : null} onChange={(e) => setNameRo(e.target.value)} />
        <Field label={t('admin.help.cat.nameEn')} value={nameEn} maxLength={80} error={nameEn ? problems.nameEn : null} onChange={(e) => setNameEn(e.target.value)} />
        <Field label={t('admin.help.cat.descRo')} value={descRo} maxLength={200} error={problems.descRo} onChange={(e) => setDescRo(e.target.value)} />
        <Field label={t('admin.help.cat.descEn')} value={descEn} maxLength={200} error={problems.descEn} onChange={(e) => setDescEn(e.target.value)} />
        <Field
          label={t('admin.help.slug')}
          hint={t('admin.help.slugHint')}
          error={shownSlug ? problems.slug : null}
          value={shownSlug}
          mono
          maxLength={60}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
        <SelectField
          label={t('admin.help.cat.icon')}
          value={icon}
          options={HELP_ICONS.map((i) => ({ value: i, label: t(`admin.help.icon.${i}` as MessageKey) }))}
          onChange={(e) => setIcon(e.target.value as HelpIcon)}
        />
        <div className={styles.full}>
          <CheckMenu
            label={t('admin.help.audience')}
            summary={audienceLabel(t, audience)}
            options={HELP_AUDIENCES.map((a) => ({ value: a, label: t(`help.audience.${a}` as MessageKey) }))}
            selected={audience}
            onToggle={(v) => setAudience((prev) => (prev.includes(v as HelpAudience) ? prev.filter((x) => x !== v) : [...prev, v as HelpAudience]))}
            all={{ label: t('admin.help.audienceAll'), selected: audience.length === 0, onSelect: () => setAudience([]) }}
          />
        </div>
      </div>
      <Switch checked={active} onChange={(e) => setActive(e.target.checked)} hint={t('admin.help.cat.activeHint')}>
        {t('admin.help.cat.active')}
      </Switch>
      <div className={styles.panelButtons}>
        <ActionButton
          disabled={!ok}
          onAction={async (requestId) => {
            await saveHelpCategory(
              category?.id ?? null,
              {
                slug: shownSlug,
                icon,
                audience,
                active,
                name_ro: nameRo.trim(),
                name_en: nameEn.trim(),
                description_ro: descRo.trim() || null,
                description_en: descEn.trim() || null,
              },
              requestId,
            );
            onDone(t('admin.help.cat.saved'));
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.save')}
        </ActionButton>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
      {category && category.articles === 0 && (
        <>
          {!confirmDelete ? (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              {t('admin.help.cat.delete')}
            </Button>
          ) : (
            <InlinePanel title={t('admin.help.cat.deleteConfirm')}>
              <div className={styles.panelButtons}>
                <ActionButton
                  variant="danger"
                  onAction={async (requestId) => {
                    await deleteHelpCategory(category.id, requestId);
                    onDone(t('admin.help.cat.deleted'));
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
        </>
      )}
      {category && category.articles > 0 && <p className={styles.muted}>{t('admin.help.cat.deleteNote')}</p>}
    </InlinePanel>
  );
}

function ArticleRow({ a, first, last, canMove, onMoved }: { a: AdminHelpArticleRow; first: boolean; last: boolean; canMove: boolean; onMoved: () => void }) {
  const { t } = useI18n();
  const votes = a.helpful + a.not_helpful;
  return (
    <div className={`${tools.serviceRow} ${rowStyles.articleRow}`}>
      <Link to={adminHelpArticlePath(a.id)} className={styles.rowMain} aria-label={`${t('admin.help.edit')}: ${a.title_ro}`}>
        <span className={styles.rowTop}>
          <span className={styles.rowTitle}>{a.title_ro}</span>
          <Pill tone={STATUS_TONE[a.status]}>{t(`admin.help.status.${a.status}`)}</Pill>
          {a.kind === 'faq' && <Pill tone="blue">{t('admin.help.kind.faq')}</Pill>}
          {a.featured && <Pill tone="amber">{t('admin.help.featured')}</Pill>}
          {!a.has_en && <Pill tone="grey">{t('admin.help.noEn')}</Pill>}
        </span>
        <span className={styles.rowMeta}>
          <span>{audienceLabel(t, a.audience)}</span>
          <span>{votes === 0 ? t('admin.help.votesNone') : t('admin.help.votes', { yes: a.helpful, no: a.not_helpful })}</span>
        </span>
      </Link>
      <span className={tools.rowTools}>
        {canMove && <MoveButtons kind="article" id={a.id} first={first} last={last} onMoved={onMoved} />}
        <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
      </span>
    </div>
  );
}

type Panel = { kind: 'new-category' } | { kind: 'category'; id: string };

/**
 * Centrul de ajutor (A4), admin: categories with their articles, every status, the vote totals; add,
 * edit, hide or delete a category, reorder categories and articles (↑ ↓), open an article to edit,
 * publish, withdraw or delete it. Every write is checked again by the database (admin, second step).
 */
export function HelpAdminScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchAdminHelp);
  const { params, setParam, text, setText } = useUrlParams();
  const query = useDeferredValue(text);
  const status = (params.get('stare') ?? '') as HelpStatus | '';
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchAdminHelp().then(setData, () => {});
  }, [setData]);
  const done = (message: string) => {
    setPanel(null);
    setNotice(message);
    refresh();
  };

  const data = state.status === 'ready' ? state.data : null;
  const filtering = query.trim() !== '' || status !== '';
  const shown = useMemo(() => {
    if (!data) return [];
    const q = fold(query);
    return data.articles.filter(
      (a) => (status === '' || a.status === status) && (q === '' || fold(`${a.title_ro} ${a.title_en ?? ''} ${a.slug}`).includes(q)),
    );
  }, [data, query, status]);

  return (
    <div className={styles.page}>
      <BackLink to={ZONE_BACK.to} label={t(ZONE_BACK.label)} />
      <div>
        <h1>{t('admin.help.title')}</h1>
        <p className={styles.sub}>{t('admin.help.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {data && (
        <>
          <div className={styles.controls}>
            <SearchField
              id="admin-help-q"
              label={t('admin.help.search')}
              placeholder={t('admin.help.search')}
              value={text}
              onChange={setText}
              onClear={() => {
                setText('');
                setParam({ q: null });
              }}
              clearLabel={t('admin.search.clear')}
            />
            <div className={rowStyles.toolbar}>
              <SelectField
                label={t('admin.help.statusFilter')}
                value={status}
                options={[
                  { value: '', label: t('admin.help.statusAll') },
                  ...(['published', 'draft', 'archived'] as const).map((s) => ({ value: s, label: t(`admin.help.status.${s}`) })),
                ]}
                onChange={(e) => setParam({ stare: e.target.value || null })}
              />
              <div className={`${styles.panelButtons} ${rowStyles.toolbarButtons}`}>
                <Link to={adminHelpArticlePath('nou')} className={buttonClass('primary')}>
                  <Plus size={18} aria-hidden="true" /> {t('admin.help.newArticle')}
                </Link>
                {panel?.kind !== 'new-category' && (
                  <Button onClick={() => setPanel({ kind: 'new-category' })}>
                    <Plus size={18} aria-hidden="true" /> {t('admin.help.newCategory')}
                  </Button>
                )}
              </div>
            </div>
          </div>
          {panel?.kind === 'new-category' && <CategoryPanel onDone={done} onCancel={() => setPanel(null)} />}
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {filtering && shown.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t('admin.help.noResults')}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setText('');
                    setParam({ q: null, stare: null });
                  }}
                >
                  {t('admin.clearFilters')}
                </Button>
              }
            />
          ) : data.categories.length === 0 ? (
            <EmptyState icon={BookOpen} title={t('help.empty')} />
          ) : (
            <ul className={styles.list}>
              {data.categories.map((c, ci) => {
                const own = shown.filter((a) => a.category_id === c.id).sort((a, b) => a.position - b.position);
                if (filtering && own.length === 0) return null;
                const Icon = HELP_ICON[c.icon];
                return (
                  <li key={c.id}>
                    <Card className={styles.stack}>
                      <div className={tools.categoryHead}>
                        <span className={styles.rowMain}>
                          <span className={styles.rowTop}>
                            <Icon size={20} aria-hidden="true" />
                            <h2 className={styles.cardTitle}>{lang === 'en' ? c.name_en : c.name_ro}</h2>
                            {!c.active && <Pill tone="grey">{t('admin.help.categoryHidden')}</Pill>}
                          </span>
                          <span className={styles.rowMeta}>
                            <span>{audienceLabel(t, c.audience)}</span>
                          </span>
                        </span>
                        <span className={tools.rowTools}>
                          {!filtering && <MoveButtons kind="category" id={c.id} first={ci === 0} last={ci === data.categories.length - 1} onMoved={refresh} />}
                          <Button variant="ghost" onClick={() => setPanel({ kind: 'category', id: c.id })} aria-label={`${t('admin.help.cat.edit')}: ${c.name_ro}`}>
                            {t('admin.help.edit')}
                          </Button>
                        </span>
                      </div>
                      {panel?.kind === 'category' && panel.id === c.id && <CategoryPanel category={c} onDone={done} onCancel={() => setPanel(null)} />}
                      {own.length === 0 ? (
                        <p className={styles.muted}>{t('admin.help.emptyCategory')}</p>
                      ) : (
                        <ul className={tools.services}>
                          {own.map((a, ai) => (
                            <li key={a.id}>
                              <ArticleRow a={a} first={ai === 0} last={ai === own.length - 1} canMove={!filtering} onMoved={refresh} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
