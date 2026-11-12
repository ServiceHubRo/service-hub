import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { CheckMenu } from '../../components/CheckMenu';
import { Disclosure, DisclosureGroup } from '../../components/Disclosure';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { Section } from '../../components/Section';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import {
  acknowledgeProcedure,
  archiveProcedure,
  fetchProcedure,
  fetchProcedureAcks,
  newProcedureVersion,
  PROCEDURE_CATEGORIES,
  publishProcedure,
  setProcedureSettings,
  type ProcedureAcks,
  type ProcedureCategory,
  type ProcedureDetail,
  type ProcedureKind,
  type ProcedureSettings,
  type ProcedureVisibility,
} from '../../data/procedures';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { fetchSupportCategories, type SupportCategory } from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { contentIn, procedureTitle } from '../../lib/procedures';
import { useLoad } from '../../lib/useLoad';
import { day } from '../admin/format';
import { NotFound } from '../public/NotFound';
import { versionLine } from './format';
import { ProcedureTags, ProcedureText, Tag, VersionTag } from './parts';
import { procedureEditPath, proceduresHome, type ProcedureMode } from './paths';
import styles from './procedures.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One procedure (A5): its warnings, when it applies, why, who is responsible, the roles that read it,
 * the numbered steps, the deadlines, when to escalate and what is forbidden; the version and the day it
 * was published; „Am citit” on a critical one (only the button writes it, never opening the page); the
 * version in work; the history the caller may see. The admin also changes the settings, sees who
 * confirmed, archives and publishes an older approved version again.
 */
export function ProcedureScreen({ mode }: { mode: ProcedureMode }) {
  const { t } = useI18n();
  const { procedureId = '' } = useParams();
  const valid = UUID.test(procedureId);
  const load = useCallback(() => (valid ? fetchProcedure(procedureId) : Promise.reject(new Error('invalid id'))), [valid, procedureId]);
  const { state, reload, setData } = useLoad(load);
  const back = { to: proceduresHome(mode), label: t('proc.title') };
  const refresh = useCallback(async () => setData(await fetchProcedure(procedureId)), [procedureId, setData]);

  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'procedure_not_found')) return <NotFound inShell />;
  if (state.status !== 'ready') {
    return (
      <div className={styles.page}>
        <PageHeader back={back} title={t('proc.title')} />
        {state.status === 'loading' ? <SkeletonList count={3} /> : <LoadError message={t('proc.detailLoadError')} onRetry={reload} />}
      </div>
    );
  }
  return <Detail p={state.data} mode={mode} back={back} refresh={refresh} />;
}

function Detail({ p, mode, back, refresh }: { p: ProcedureDetail; mode: ProcedureMode; back: { to: string; label: string }; refresh: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const shownVersion = p.published ?? p.open;
  const { content, fallback } = contentIn(lang, shownVersion);
  const responsible = p.responsible?.user ? [p.responsible.user.display_id, p.responsible.user.name].filter(Boolean).join(' · ') : null;

  return (
    <div className={styles.page}>
      <PageHeader back={back} title={procedureTitle(lang, p)} />
      <div className={styles.meta}>
        <Tag>{t(`proc.category.${p.category}`)}</Tag>
        <ProcedureTags p={p} />
      </div>

      {p.ack_required && p.published && <Acknowledge p={p} onDone={refresh} />}

      <Card>
        <dl className={styles.facts}>
          <div>
            <dt>{t('proc.page.responsible')}</dt>
            <dd>
              {responsible ?? t('proc.page.noResponsible')}
              {p.responsible?.needs_reassignment && (
                <>
                  {' '}
                  <Tag tone="amber">{t('proc.resp.reassign')}</Tag>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>{t('proc.page.roles')}</dt>
            <dd>{t(`proc.visibility.${p.visibility}`)}</dd>
          </div>
          <div>
            <dt>{t('proc.page.type')}</dt>
            <dd>{t(`proc.kind.${p.kind}`)}</dd>
          </div>
          <div>
            <dt>{t('proc.page.version')}</dt>
            <dd>
              {p.published?.published_at
                ? t('proc.page.versionValue', { n: p.published.version, date: day(lang, p.published.published_at) })
                : t('proc.status.draft')}
            </dd>
          </div>
        </dl>
      </Card>

      {!p.published && <p className={styles.note}>{t('proc.page.notPublished')}</p>}
      {fallback && <p className={styles.note}>{t('proc.page.fallback')}</p>}
      {content && <ProcedureText content={content} />}

      <Work p={p} mode={mode} onNewVersion={(id) => navigate(procedureEditPath(mode, id))} />

      {mode === 'admin' && <Settings p={p} onDone={refresh} />}
      {/* Keyed by the version shown: a new version published reads the confirmations again. */}
      {mode === 'admin' && p.critical && p.published && <Acks key={`${p.published.id}:${p.acknowledged_at ?? ''}`} id={p.id} />}
      {mode === 'admin' && <Archive p={p} onDone={refresh} />}

      <History p={p} mode={mode} onDone={refresh} />
    </div>
  );
}

/** „Am citit”: the reader confirms the version shown. */
function Acknowledge({ p, onDone }: { p: ProcedureDetail; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  if (p.acknowledged_at) {
    return (
      <div className={`${styles.ack} ${styles.ackDone}`} role="status">
        <span className={styles.ackText}>
          <CheckCircle2 size={20} aria-hidden="true" />
          {t('proc.ack.done', { n: p.published!.version, date: day(lang, p.acknowledged_at) })}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.ack}>
      <span className={styles.ackText}>
        <ShieldAlert size={20} aria-hidden="true" />
        <strong>{t('proc.ack.required')}</strong>
      </span>
      <ActionButton
        block={false}
        onAction={async (requestId) => {
          await acknowledgeProcedure(p.published!.id, requestId);
          await onDone();
        }}
        errorMessage={(e) => rpcErrorMessage(lang, e)}
        canRetry={canRetryRpc}
      >
        {t('proc.ack.button')}
      </ActionButton>
    </div>
  );
}

/** The version in work, or a new one: a published version is never edited in place. */
function Work({ p, mode, onNewVersion }: { p: ProcedureDetail; mode: ProcedureMode; onNewVersion: (id: string) => void }) {
  const { t, lang } = useI18n();
  if (p.open) {
    return (
      <Section title={t('proc.work.title')}>
        <Card className={styles.stack}>
          <div className={styles.meta}>
            <VersionTag status={p.open.status} />
            <span className={styles.muted}>
              {t('proc.history.item', { n: p.open.version })} · {versionLine(t, lang, p.open)}
            </span>
          </div>
          <div className={styles.buttons}>
            <Link to={procedureEditPath(mode, p.id)} className={buttonClass('secondary')}>
              {t('proc.work.open')}
            </Link>
          </div>
        </Card>
      </Section>
    );
  }
  if (!p.can_edit || p.status === 'archived' || !p.versions.some((v) => v.status === 'approved')) return null;
  return (
    <Section title={t('proc.work.title')} description={t('proc.work.newVersionHint')}>
      <div className={styles.buttons}>
        <ActionButton
          variant="secondary"
          block={false}
          onAction={async (requestId) => {
            await newProcedureVersion(p.id, requestId);
            onNewVersion(p.id);
          }}
          errorMessage={(e) => rpcErrorMessage(lang, e)}
          canRetry={canRetryRpc}
        >
          {t('proc.work.newVersion')}
        </ActionButton>
      </div>
    </Section>
  );
}

/** The admin's settings: not part of a version, each change in the audit log. */
function Settings({ p, onDone }: { p: ProcedureDetail; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [draft, setDraft] = useState<Required<ProcedureSettings>>({
    category: p.category,
    kind: p.kind,
    visibility: p.visibility,
    critical: p.critical,
    support_categories: p.support_categories,
  });
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchSupportCategories().then((c) => live && setCategories(c), () => {});
    return () => {
      live = false;
    };
  }, []);
  const set = <K extends keyof ProcedureSettings>(key: K, value: Required<ProcedureSettings>[K]) => {
    setNotice(null);
    setDraft((d) => ({ ...d, [key]: value, ...(key === 'kind' && value === 'usual' ? { critical: false } : {}) }));
  };
  const dirty =
    draft.category !== p.category ||
    draft.kind !== p.kind ||
    draft.visibility !== p.visibility ||
    draft.critical !== p.critical ||
    [...draft.support_categories].sort().join() !== [...p.support_categories].sort().join();
  const name = (key: string) => {
    const c = categories.find((x) => x.key === key);
    return c ? (lang === 'en' ? c.name_en : c.name_ro) : key;
  };
  return (
    <Section title={t('proc.settings.title')} description={t('proc.settings.desc')}>
      <Card className={styles.stack}>
        <SettingsFields draft={draft} set={set} categories={categories} name={name} admin />
        <div className={styles.buttons}>
          <ActionButton
            variant="secondary"
            block={false}
            disabled={!dirty}
            onAction={async (requestId) => {
              await setProcedureSettings(p.id, draft, requestId);
              setNotice(t('proc.settings.saved'));
              await onDone();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('proc.settings.save')}
          </ActionButton>
        </div>
        {notice && (
          <p className={styles.muted} role="status">
            {notice}
          </p>
        )}
      </Card>
    </Section>
  );
}

/** Category, type, request categories; for the admin also who reads it and critical. */
export function SettingsFields({
  draft,
  set,
  categories,
  name,
  admin,
}: {
  draft: Required<ProcedureSettings>;
  set: <K extends keyof ProcedureSettings>(key: K, value: Required<ProcedureSettings>[K]) => void;
  categories: SupportCategory[];
  name: (key: string) => string;
  admin: boolean;
}) {
  const { t } = useI18n();
  const toggle = (key: string) =>
    set('support_categories', draft.support_categories.includes(key) ? draft.support_categories.filter((k) => k !== key) : [...draft.support_categories, key]);
  return (
    <div className={styles.fields}>
      <SelectField
        label={t('proc.page.category')}
        value={draft.category}
        onChange={(e) => set('category', e.target.value as ProcedureCategory)}
        options={PROCEDURE_CATEGORIES.map((c) => ({ value: c, label: t(`proc.category.${c}`) }))}
      />
      <SelectField
        label={t('proc.page.type')}
        value={draft.kind}
        onChange={(e) => set('kind', e.target.value as ProcedureKind)}
        options={[
          { value: 'usual', label: t('proc.kind.usual') },
          { value: 'exceptional', label: t('proc.kind.exceptional') },
        ]}
      />
      <div className={styles.full}>
        <CheckMenu
          label={t('proc.settings.requests')}
          summary={draft.support_categories.length === 0 ? t('proc.settings.requestsNone') : draft.support_categories.map(name).join(', ')}
          options={categories.map((c) => ({ value: c.key, label: name(c.key) }))}
          selected={draft.support_categories}
          onToggle={toggle}
        />
      </div>
      {admin && (
        <>
          <SelectField
            label={t('proc.settings.visibility')}
            value={draft.visibility}
            onChange={(e) => set('visibility', e.target.value as ProcedureVisibility)}
            options={[
              { value: 'support', label: t('proc.visibility.support') },
              { value: 'admin', label: t('proc.visibility.admin') },
            ]}
          />
          <div className={styles.full}>
            <Switch
              checked={draft.critical}
              disabled={draft.kind !== 'exceptional'}
              hint={t('proc.settings.criticalHint')}
              onChange={(e) => set('critical', e.target.checked)}
            >
              {t('proc.settings.critical')}
            </Switch>
          </div>
        </>
      )}
    </div>
  );
}

/** Who confirmed the version shown, and who did not (not confirmed first). */
function Acks({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const load = useCallback(() => fetchProcedureAcks(id), [id]);
  const { state, reload } = useLoad<ProcedureAcks>(load);
  return (
    <Section title={t('proc.acks.title')} description={t('proc.acks.desc')}>
      <Card>
        {state.status === 'loading' && <SkeletonList count={1} />}
        {state.status === 'error' && <LoadError message={t('proc.acks.loadError')} onRetry={reload} />}
        {state.status === 'ready' &&
          (state.data.people.length === 0 ? (
            <p className={styles.muted}>{t('proc.acks.none')}</p>
          ) : (
            <>
              <p className={styles.muted}>
                {t('proc.acks.summary', {
                  done: state.data.people.filter((x) => x.acknowledged_at).length,
                  total: state.data.people.length,
                })}
              </p>
              <ul className={styles.people}>
                {state.data.people.map((x) => (
                  <li key={x.id}>
                    <span className={styles.person}>{[x.display_id, x.name].filter(Boolean).join(' · ')}</span>
                    {x.acknowledged_at ? (
                      <Tag tone="green">{t('proc.acks.confirmedOn', { date: day(lang, x.acknowledged_at) })}</Tag>
                    ) : (
                      <Tag tone="critical">{t('proc.acks.missing')}</Tag>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ))}
      </Card>
    </Section>
  );
}

function Archive({ p, onDone }: { p: ProcedureDetail; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const archived = p.status === 'archived';
  return (
    <div className={styles.stack}>
      {archived ? (
        <div className={styles.buttons}>
          <ActionButton
            variant="secondary"
            block={false}
            onAction={async (requestId) => {
              await archiveProcedure(p.id, false, requestId);
              setNotice(t('proc.restoredNow'));
              await onDone();
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('proc.restore')}
          </ActionButton>
        </div>
      ) : !confirm ? (
        <div className={styles.buttons}>
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            {t('proc.archive')}
          </Button>
        </div>
      ) : (
        <InlinePanel title={t('proc.archiveConfirm')}>
          <p className={styles.muted}>{t('proc.archiveBody')}</p>
          <div className={styles.buttons}>
            <ActionButton
              variant="danger"
              block={false}
              onAction={async (requestId) => {
                await archiveProcedure(p.id, true, requestId);
                setConfirm(false);
                setNotice(t('proc.archivedNow'));
                await onDone();
              }}
              errorMessage={(e) => rpcErrorMessage(lang, e)}
              canRetry={canRetryRpc}
            >
              {t('proc.archive')}
            </ActionButton>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          </div>
        </InlinePanel>
      )}
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/** Every version the caller may see, newest first; an approved one opens with its text. */
function History({ p, mode, onDone }: { p: ProcedureDetail; mode: ProcedureMode; onDone: () => Promise<void> }) {
  const { t, lang } = useI18n();
  if (p.versions.length === 0) return null;
  return (
    <Section title={t('proc.history.title')} description={t('proc.history.desc')}>
      <DisclosureGroup>
        {p.versions.map((v) => {
          const { content } = contentIn(lang, v);
          const shown = p.published?.id === v.id;
          return (
            <Disclosure
              key={v.id}
              title={
                <>
                  {t('proc.history.item', { n: v.version })}{' '}
                  {shown ? <Tag tone="green">{t('proc.history.current')}</Tag> : <VersionTag status={v.status} />}
                </>
              }
              summary={day(lang, v.published_at ?? v.approved_at ?? v.updated_at)}
            >
              <div className={styles.stack}>
                <p className={styles.muted}>{versionLine(t, lang, v)}</p>
                {mode === 'admin' && v.status === 'approved' && !shown && (
                  <div className={styles.buttons}>
                    <ActionButton
                      variant="secondary"
                      block={false}
                      onAction={async (requestId) => {
                        await publishProcedure(v.id, requestId);
                        await onDone();
                      }}
                      errorMessage={(e) => rpcErrorMessage(lang, e)}
                      canRetry={canRetryRpc}
                    >
                      {t('proc.history.publishThis')}
                    </ActionButton>
                  </div>
                )}
                {content && <ProcedureText content={content} />}
              </div>
            </Disclosure>
          );
        })}
      </DisclosureGroup>
    </Section>
  );
}
