import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { BackLink } from '../../components/BackLink';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Checkbox } from '../../components/Checkbox';
import { Chip, ChipRow } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import {
  fetchNotices,
  NOTICE_AUDIENCES,
  previewNotice,
  sendNotice,
  withdrawNotice,
  type AdminNotice,
  type NoticeDraft,
} from '../../data/adminTools';
import { canRetryRpc, rpcErrorMessage } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import { plural } from '../../i18n/translate';
import { NoticeView } from '../notices/NoticeBanner';
import { ConfirmPanel } from './ActionPanels';
import { SectionTitle } from './parts';
import { ADMIN_ACCOUNT_PATH } from './paths';
import { useLiveData } from './useLiveData';
import { dateTime } from './format';
import styles from './admin.module.css';
import tools from './tools.module.css';

const LIVE = [{ table: 'notices' }];

const EMPTY: NoticeDraft = { audience: 'clients', city: '', title_ro: '', body_ro: '', title_en: '', body_en: '', push: false };

/** "Clienții din Brașov", "Toate service-urile", "Toată lumea". */
function audienceText(t: (k: MessageKey, p?: Record<string, string | number>) => string, audience: string, city: string | null): string {
  const who = audience === 'city' ? 'all' : audience;
  return city ? t(`admin.notices.audienceIn.${who}` as MessageKey, { city }) : t(`admin.notices.audience.${who}` as MessageKey);
}

function Composer({ onSent }: { onSent: (n: AdminNotice) => void }) {
  const { t, lang } = useI18n();
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY);
  const [missing, setMissing] = useState(false);
  const [preview, setPreview] = useState<{ recipients: number; with_push: number } | null>(null);
  const set = <K extends keyof NoticeDraft>(key: K, value: NoticeDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setPreview(null);
    setMissing(false);
  };
  const filled = draft.title_ro.trim() !== '' && draft.body_ro.trim() !== '';
  const shownNotice = {
    title_ro: draft.title_ro.trim(),
    body_ro: draft.body_ro.trim(),
    title_en: draft.title_en.trim() || draft.title_ro.trim(),
    body_en: draft.body_en.trim() || draft.body_ro.trim(),
    created_at: new Date().toISOString(),
  };

  return (
    <Card className={styles.stack}>
      <ChipRow label={t('admin.notices.to')}>
        {NOTICE_AUDIENCES.map((a) => (
          <Chip key={a} selected={draft.audience === a} onClick={() => set('audience', a)}>
            {t(`admin.notices.audience.${a}` as MessageKey)}
          </Chip>
        ))}
      </ChipRow>
      <Field
        label={t('admin.notices.city')}
        hint={t(draft.audience === 'shops' ? 'admin.notices.cityHintShops' : 'admin.notices.cityHint')}
        value={draft.city}
        maxLength={80}
        onChange={(e) => set('city', e.target.value)}
      />
      <div className={styles.fields}>
        <Field
          label={t('admin.notices.titleRo')}
          value={draft.title_ro}
          maxLength={80}
          error={missing && !draft.title_ro.trim() ? t('admin.notices.required') : null}
          onChange={(e) => set('title_ro', e.target.value)}
        />
        <Field
          label={t('admin.notices.titleEn')}
          hint={t('admin.notices.enHint')}
          value={draft.title_en}
          maxLength={80}
          onChange={(e) => set('title_en', e.target.value)}
        />
        <TextArea
          label={t('admin.notices.bodyRo')}
          value={draft.body_ro}
          maxLength={500}
          rows={4}
          error={missing && !draft.body_ro.trim() ? t('admin.notices.required') : null}
          onChange={(e) => set('body_ro', e.target.value)}
        />
        <TextArea
          label={t('admin.notices.bodyEn')}
          hint={t('admin.notices.enHint')}
          value={draft.body_en}
          maxLength={500}
          rows={4}
          onChange={(e) => set('body_en', e.target.value)}
        />
      </div>
      <Checkbox checked={draft.push} onChange={(e) => set('push', e.target.checked)}>
        {t('admin.notices.push')}
      </Checkbox>

      {preview === null ? (
        <ActionButton
          variant="secondary"
          onAction={async () => {
            if (!filled) {
              setMissing(true);
              return;
            }
            setPreview(await previewNotice(draft.audience, draft.city.trim()));
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('admin.notices.preview')}
        </ActionButton>
      ) : (
        <div className={styles.stack}>
          <SectionTitle>{t('admin.notices.previewTitle')}</SectionTitle>
          <div className={tools.previews}>
            {(['ro', 'en'] as const).map((l) => (
              <div key={l} className={styles.stack}>
                <span className={tools.previewLabel}>{t(l === 'en' ? 'admin.lang.en' : 'admin.lang.ro')}</span>
                <NoticeView notice={shownNotice} lang={l} />
              </div>
            ))}
          </div>
          <p className={preview.recipients === 0 ? styles.warning : styles.muted} role="status">
            {preview.recipients === 0
              ? t('admin.notices.nobody')
              : `${audienceText(t, draft.audience, draft.city.trim() || null)}: ${plural(lang, 'unit.people', preview.recipients)}${
                  draft.push ? ` · ${t('admin.notices.withPush', { n: preview.with_push })}` : ''
                }`}
          </p>
          <div className={styles.panelButtons}>
            <ActionButton
              disabled={preview.recipients === 0}
              onAction={async (requestId) => {
                const sent = await sendNotice({ ...draft, city: draft.city.trim() }, requestId);
                setDraft(EMPTY);
                setPreview(null);
                onSent(sent);
              }}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('admin.notices.send', { n: plural(lang, 'unit.people', preview.recipients) })}
            </ActionButton>
            <Button onClick={() => setPreview(null)}>{t('admin.notices.change')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SentNotice({ n, onWithdrawn }: { n: AdminNotice; onWithdrawn: () => void }) {
  const { t, lang } = useI18n();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card className={styles.stack}>
      <div className={styles.cardHead}>
        <span className={styles.rowTitle}>{lang === 'en' ? n.title_en : n.title_ro}</span>
        <span className={styles.muted}>{dateTime(lang, n.created_at)}</span>
      </div>
      <p className={styles.quote}>{lang === 'en' ? n.body_en : n.body_ro}</p>
      <span className={styles.rowMeta}>
        <span>{audienceText(t, n.audience, n.city)}</span>
        <span>{plural(lang, 'unit.people', n.recipients)}</span>
        <span>{t('admin.notices.reads', { n: n.reads })}</span>
        <span>{n.send_push ? t('admin.notices.pushSent', { n: n.push_recipients }) : t('admin.notices.noPush')}</span>
        {n.created_by_display_id && <span>{t('admin.audit.by', { admin: [n.created_by_display_id, n.created_by_name].filter(Boolean).join(' · ') })}</span>}
      </span>
      {confirm ? (
        <ConfirmPanel
          title={t('admin.notices.withdraw')}
          body={t('admin.notices.withdrawBody')}
          confirmLabel={t('admin.notices.withdraw')}
          danger
          onConfirm={async (_text, requestId) => {
            await withdrawNotice(n.id, requestId);
            onWithdrawn();
          }}
          onCancel={() => setConfirm(false)}
        />
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          {t('admin.notices.withdraw')}
        </Button>
      )}
    </Card>
  );
}

/**
 * Anunțuri (FR §5.9, P21): a notice to all clients, all shops or everyone — optionally only in one
 * city (a shop by its address, a client by the shops they booked with). Romanian and English (the
 * English left empty shows the Romanian), optionally also as a push notification. "Previzualizează"
 * shows it as people will see it and how many it reaches; only then "Trimite". Sent notices below,
 * with how many read them; one sent by mistake can be withdrawn. Every notice is in the audit log.
 */
export function NoticesScreen() {
  const { t } = useI18n();
  const { state, reload, refetch } = useLiveData(fetchNotices, LIVE, 'admin-notices');
  const [message, setMessage] = useState<string | null>(null);
  const [composer, setComposer] = useState(0);

  return (
    <div className={styles.page}>
      <BackLink to={ADMIN_ACCOUNT_PATH} label={t('nav.account')} />
      <div>
        <h1>{t('admin.notices.title')}</h1>
        <p className={styles.sub}>{t('admin.notices.sub')}</p>
      </div>
      <SectionTitle>{t('admin.notices.new')}</SectionTitle>
      <Composer
        key={composer}
        onSent={(n) => {
          setComposer((k) => k + 1);
          setMessage(t('admin.notices.sent', { title: n.title_ro }));
          void refetch().catch(() => {});
        }}
      />
      {message && (
        <p className={styles.muted} role="status">
          {message}
        </p>
      )}
      <SectionTitle>{t('admin.notices.sentTitle')}</SectionTitle>
      {state.status === 'loading' && <SkeletonList />}
      {state.status === 'error' && <LoadError message={t('admin.loadError')} onRetry={reload} />}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyState icon={Megaphone} title={t('admin.notices.empty')} />
        ) : (
          <ul className={styles.list}>
            {state.data.map((n) => (
              <li key={n.id}>
                <SentNotice
                  n={n}
                  onWithdrawn={() => {
                    setMessage(t('admin.notices.withdrawn'));
                    void refetch().catch(() => {});
                  }}
                />
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
