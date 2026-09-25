import { MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { Tile } from '../../components/Tile';
import { fetchSettings, LIMIT_KEYS, updateSettings, type LimitKey, type PlatformSettings, type SettingKey } from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { DECIMAL_SETTINGS, SETTING_SECTIONS, settingsChange, type SettingsDraft } from '../../lib/adminTools';
import { useLoad } from '../../lib/useLoad';
import { SectionTitle } from './parts';
import { ADMIN_ACCOUNT_PATH, ADMIN_TEXTS_PATH } from './paths';
import { dateTime } from './format';
import styles from './admin.module.css';

/** The form's text for a value: `29,5` in Romanian, `29.5` in English. */
function shown(lang: string, n: number): string {
  const text = String(Number(n));
  return lang === 'ro' ? text.replace('.', ',') : text;
}

function draftOf(s: PlatformSettings, lang: string): SettingsDraft {
  const draft = {} as SettingsDraft;
  for (const section of SETTING_SECTIONS) for (const key of section.fields) draft[key] = shown(lang, s[key]);
  for (const key of LIMIT_KEYS) draft[key] = String(s.limits[key] ?? '');
  return draft;
}

function SettingsForm({ settings, onSaved }: { settings: PlatformSettings; onSaved: (s: PlatformSettings) => void }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<SettingsDraft>(() => draftOf(settings, lang));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const field = (key: SettingKey | LimitKey) => (
    <Field
      key={key}
      label={t(`admin.field.${key}` as MessageKey)}
      hint={t(`admin.settings.hint.${key}` as MessageKey)}
      error={invalid.includes(key) ? t('admin.settings.notNumber') : null}
      value={draft[key]}
      inputMode={DECIMAL_SETTINGS.has(key as SettingKey) ? 'decimal' : 'numeric'}
      mono
      onChange={(e) => {
        const value = e.target.value;
        setDraft((d) => ({ ...d, [key]: value }));
        setMessage(null);
        if (invalid.includes(key)) setInvalid((list) => list.filter((k) => k !== key));
      }}
    />
  );

  return (
    <form className={styles.stack} onSubmit={(e) => e.preventDefault()} noValidate>
      {SETTING_SECTIONS.map((section) => (
        <section key={section.key} className={styles.section} aria-labelledby={`settings-${section.key}`}>
          <SectionTitle>
            <span id={`settings-${section.key}`}>{t(`admin.settings.section.${section.key}` as MessageKey)}</span>
          </SectionTitle>
          <Card>
            <div className={styles.fields}>{section.fields.map(field)}</div>
          </Card>
        </section>
      ))}
      <section className={styles.section} aria-labelledby="settings-limits">
        <SectionTitle>
          <span id="settings-limits">{t('admin.settings.section.limits')}</span>
        </SectionTitle>
        <Card>
          <div className={styles.fields}>{LIMIT_KEYS.map(field)}</div>
        </Card>
      </section>
      <p className={styles.muted}>{t('admin.settings.onlyFuture')}</p>
      <ActionButton
        submit
        onAction={async (requestId) => {
          const { change, invalid: bad } = settingsChange(settings, draft);
          setInvalid(bad);
          if (bad.length > 0) {
            setMessage(t('admin.settings.fix'));
            return;
          }
          if (Object.keys(change).length === 0) {
            setMessage(t('admin.settings.nothing'));
            return;
          }
          const saved = await updateSettings(change, requestId);
          onSaved(saved);
          setDraft(draftOf(saved, lang));
          setMessage(t('admin.settings.saved'));
        }}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        canRetry={canRetryRpc}
      >
        {t('admin.settings.save')}
      </ActionButton>
      {message && (
        <p className={invalid.length > 0 ? styles.warning : styles.muted} role="status">
          {message}
        </p>
      )}
    </form>
  );
}

/**
 * Setări platformă (FR §5.10, P21): prices, free period, quote expiry, ranking constants, the
 * booking rules a new shop starts with, the abuse limits — and a tile to the push texts. Only what
 * changed is sent; every value is read when a record is made, so bookings, quotes and
 * subscriptions that already exist never change.
 */
export function SettingsScreen() {
  const { t, lang } = useI18n();
  const { state, reload, setData } = useLoad(fetchSettings);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.settings.title')}</h1>
        <p className={styles.sub}>
          {state.status === 'ready' ? t('admin.settings.updated', { date: dateTime(lang, state.data.updated_at) }) : t('admin.settings.sub')}
        </p>
      </div>
      <Tile to={ADMIN_TEXTS_PATH} icon={MessageSquareText} label={t('admin.texts.title')} hint={t('admin.texts.tileHint')} />
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' && <SettingsForm key={lang} settings={state.data} onSaved={setData} />}
    </div>
  );
}
