import { SearchX } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { TEMPLATES } from '../../../supabase/functions/_shared/templates.ts';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { SearchField } from '../../components/SearchField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { fetchSettings, setNotificationText, type NotificationTexts, type TextInput } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import { placeholdersOf, unknownPlaceholders } from '../../lib/adminTools';
import { matchesWords, searchWords } from '../../lib/text';
import { useLoad } from '../../lib/useLoad';
import { Pill, SectionTitle } from './parts';
import { ADMIN_SETTINGS_PATH } from './paths';
import { useUrlParams } from './useUrlParams';
import styles from './admin.module.css';
import tools from './tools.module.css';

const KEYS = Object.keys(TEMPLATES.ro);
const SIDES = ['client', 'shop'] as const;

/** The placeholders the built-in texts of a key fill (either language). */
function allowedFor(key: string): string[] {
  const ro = TEMPLATES.ro[key];
  const en = TEMPLATES.en[key];
  return [...new Set([ro?.title, ro?.body, en?.title, en?.body].flatMap((s) => placeholdersOf(s ?? '')))];
}

function TextPanel({ textKey, texts, onDone, onCancel }: { textKey: string; texts: NotificationTexts; onDone: (t: NotificationTexts, message: string) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const current = texts[textKey] ?? {};
  const [draft, setDraft] = useState<TextInput>({
    title_ro: current.ro?.title ?? '',
    body_ro: current.ro?.body ?? '',
    title_en: current.en?.title ?? '',
    body_en: current.en?.body ?? '',
  });
  const allowed = allowedFor(textKey);
  const unknown = [...new Set(Object.values(draft).flatMap((v) => unknownPlaceholders(v, allowed)))];
  const set = (k: keyof TextInput) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const defaults = { ro: TEMPLATES.ro[textKey], en: TEMPLATES.en[textKey] };
  const overridden = Boolean(texts[textKey]);

  return (
    <InlinePanel title={t('admin.texts.edit')}>
      <p className={styles.muted}>{t('admin.texts.editHint')}</p>
      {allowed.length > 0 && (
        <div className={tools.textRow}>
          <span className={styles.muted}>{t('admin.texts.placeholders')}</span>
          <span className={tools.placeholders}>
            {allowed.map((p) => (
              <span key={p} className={tools.placeholder}>{`{${p}}`}</span>
            ))}
          </span>
        </div>
      )}
      <div className={styles.fields}>
        <Field label={t('admin.texts.titleRo')} value={draft.title_ro} maxLength={80} placeholder={defaults.ro?.title} onChange={set('title_ro')} />
        <Field label={t('admin.texts.titleEn')} value={draft.title_en} maxLength={80} placeholder={defaults.en?.title} onChange={set('title_en')} />
        <TextArea label={t('admin.texts.bodyRo')} value={draft.body_ro} maxLength={300} rows={3} placeholder={defaults.ro?.body} onChange={set('body_ro')} />
        <TextArea label={t('admin.texts.bodyEn')} value={draft.body_en} maxLength={300} rows={3} placeholder={defaults.en?.body} onChange={set('body_en')} />
      </div>
      {unknown.length > 0 && (
        <p className={styles.warning} role="alert">
          {t('admin.texts.unknown', { names: unknown.map((p) => `{${p}}`).join(', ') })}
        </p>
      )}
      <div className={styles.panelButtons}>
        <ActionButton
          disabled={unknown.length > 0}
          onAction={async (requestId) => onDone(await setNotificationText(textKey, draft, requestId), t('admin.texts.saved'))}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.save')}
        </ActionButton>
        {overridden && (
          <ActionButton
            variant="secondary"
            onAction={async (requestId) =>
              onDone(await setNotificationText(textKey, { title_ro: '', body_ro: '', title_en: '', body_en: '' }, requestId), t('admin.texts.reset'))
            }
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('admin.texts.useDefault')}
          </ActionButton>
        )}
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </InlinePanel>
  );
}

/**
 * Textele notificărilor (FR §5.10, P21): every push text, to clients and to shops, in Romanian and
 * English — the built-in one, or the admin's own. Placeholders like {shop} are filled for each
 * person; a placeholder the text never gets is flagged before saving. An empty field keeps the
 * built-in text; "Revino la textul inițial" drops the change. Applies to the next notifications.
 */
export function TextsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchSettings);
  const { setParam, text, setText } = useUrlParams();
  const query = useDeferredValue(text);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const texts = state.status === 'ready' ? state.data.notification_texts : null;

  const shownKeys = useMemo(() => {
    const words = searchWords(query);
    if (words.length === 0) return KEYS;
    return KEYS.filter((k) => {
      const own = texts?.[k];
      return matchesWords(
        words,
        k,
        TEMPLATES[lang][k]?.title ?? '',
        TEMPLATES[lang][k]?.body ?? '',
        own?.ro?.title ?? '',
        own?.ro?.body ?? '',
        own?.en?.title ?? '',
        own?.en?.body ?? '',
      );
    });
  }, [query, texts, lang]);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_SETTINGS_PATH} label={t('admin.settings.title')} />
      <div>
        <h1>{t('admin.texts.title')}</h1>
        <p className={styles.sub}>{t('admin.texts.sub')}</p>
      </div>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {texts && (
        <>
          <SearchField
            id="admin-texts-q"
            label={t('admin.texts.search')}
            placeholder={t('admin.texts.search')}
            value={text}
            onChange={setText}
            onClear={() => {
              setText('');
              setParam({ q: null });
            }}
            clearLabel={t('admin.search.clear')}
          />
          {notice && (
            <p className={styles.muted} role="status">
              {notice}
            </p>
          )}
          {shownKeys.length === 0 && <EmptyState icon={SearchX} title={t('admin.noResults')} />}
          {SIDES.map((side) => {
            const keys = shownKeys.filter((k) => k.startsWith(`${side}.`));
            if (keys.length === 0) return null;
            return (
              <section key={side} className={styles.section}>
                <SectionTitle>{t(side === 'client' ? 'admin.texts.toClients' : 'admin.texts.toShops')}</SectionTitle>
                <ul className={styles.list}>
                  {keys.map((k) => {
                    const own = texts[k]?.[lang];
                    const base = TEMPLATES[lang][k]!;
                    return (
                      <li key={k}>
                        <Card className={styles.stack}>
                          <div className={styles.cardHead}>
                            <span className={`${styles.id}`}>{k}</span>
                            {texts[k] && <Pill tone="amber">{t('admin.texts.changed')}</Pill>}
                          </div>
                          <div className={tools.textRow}>
                            <span className={styles.rowTitle}>{own?.title || base.title}</span>
                            <span>{own?.body || base.body}</span>
                            {texts[k] && (
                              <span className={tools.defaultText}>
                                {t('admin.texts.builtIn')}: {base.title} — {base.body}
                              </span>
                            )}
                          </div>
                          {open === k ? (
                            <TextPanel
                              textKey={k}
                              texts={texts}
                              onDone={(next, message) => {
                                if (state.status === 'ready') setData({ ...state.data, notification_texts: next });
                                setOpen(null);
                                setNotice(message);
                              }}
                              onCancel={() => setOpen(null)}
                            />
                          ) : (
                            <Button onClick={() => setOpen(k)} aria-label={`${t('admin.texts.edit')}: ${k}`}>
                              {t('admin.texts.edit')}
                            </Button>
                          )}
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
