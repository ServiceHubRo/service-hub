import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Button } from '../../components/Button';
import { buttonClass } from '../../components/buttonClass';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { InlinePanel } from '../../components/InlinePanel';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { Section } from '../../components/Section';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import {
  approveProcedure,
  createProcedure,
  fetchProcedure,
  fetchProcedures,
  moveProcedureVersion,
  saveProcedureDraft,
  type ProcedureContent,
  type ProcedureDetail,
  type ProcedureLibrary,
  type ProcedureSettings,
} from '../../data/procedures';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import { useI18n } from '../../i18n/context';
import type { MessageKey } from '../../i18n/ro';
import {
  cleanContent,
  contentProblems,
  hasContent,
  parseSteps,
  PROCEDURE_LIMITS,
  STEP_LIMIT,
  stepsText,
  type ContentProblem,
  type ProcedureField,
} from '../../lib/procedures';
import { useLoad } from '../../lib/useLoad';
import { problemText } from '../admin/helpFormat';
import { NotFound } from '../public/NotFound';
import { ProcedureText, VersionTag } from './parts';
import { SettingsFields } from './ProcedureScreen';
import { procedureEditPath, procedurePath, proceduresHome, type ProcedureMode } from './paths';
import styles from './procedures.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One language as the form holds it: the steps as the text typed, one per line. */
type Form = Record<Exclude<ProcedureField, 'steps'>, string> & { steps: string };

const EMPTY_FORM: Form = {
  title: '',
  applies_when: '',
  purpose: '',
  responsibilities: '',
  steps: '',
  deadlines: '',
  escalation: '',
  forbidden: '',
  warnings: '',
};

function toForm(c: ProcedureContent | null | undefined): Form {
  if (!c) return { ...EMPTY_FORM };
  return {
    title: c.title,
    applies_when: c.applies_when,
    purpose: c.purpose,
    responsibilities: c.responsibilities ?? '',
    steps: stepsText(c.steps),
    deadlines: c.deadlines ?? '',
    escalation: c.escalation,
    forbidden: c.forbidden ?? '',
    warnings: c.warnings ?? '',
  };
}

function fromForm(f: Form): ProcedureContent {
  return cleanContent({ ...f, steps: parseSteps(f.steps) });
}

type Loaded = { lib: ProcedureLibrary; detail: ProcedureDetail | null };

/**
 * The editor of a procedure's version in work (A5), or of a new procedure (`nou`): the settings while
 * it was never published, the text in Romanian (required) and English (optional, all or nothing), the
 * preview as readers will see it, and the steps of the version: save, send for approval, back to draft,
 * discard; the admin approves (and publishes). An approved version is never edited here.
 */
export function ProcedureEditScreen({ mode }: { mode: ProcedureMode }) {
  const { t } = useI18n();
  const { procedureId = 'nou' } = useParams();
  const isNew = procedureId === 'nou';
  const valid = isNew || UUID.test(procedureId);
  const load = useCallback(async (): Promise<Loaded> => {
    if (!valid) throw new Error('invalid id');
    const [lib, detail] = await Promise.all([fetchProcedures(), isNew ? Promise.resolve(null) : fetchProcedure(procedureId)]);
    return { lib, detail };
  }, [valid, isNew, procedureId]);
  const { state, reload, setData } = useLoad(load);
  // Kept here: a save starts the editor again from the saved version, the line stays.
  const [notice, setNotice] = useState<string | null>(null);
  const back = isNew ? { to: proceduresHome(mode), label: t('proc.title') } : { to: procedurePath(mode, procedureId), label: t('proc.title') };

  if (!valid || (state.status === 'error' && toRpcError(state.error).code === 'procedure_not_found')) return <NotFound inShell />;
  if (state.status !== 'ready') {
    return (
      <div className={styles.page}>
        <PageHeader back={back} title={isNew ? t('proc.new') : t('proc.title')} />
        {state.status === 'loading' ? <SkeletonList count={3} /> : <LoadError message={t('proc.detailLoadError')} onRetry={reload} />}
      </div>
    );
  }
  const { lib, detail } = state.data;
  if (detail && !detail.open) {
    return (
      <div className={styles.page}>
        <PageHeader back={back} title={t('proc.title')} />
        <p className={styles.note}>{t('proc.editor.noOpen')}</p>
        <div className={styles.buttons}>
          <Link to={procedurePath(mode, detail.id)} className={buttonClass('secondary')}>
            {t('proc.request.open')}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <Editor
      key={detail?.open ? `${detail.open.id}:${detail.open.updated_at}:${detail.open.status}` : 'new'}
      mode={mode}
      lib={lib}
      detail={detail}
      back={back}
      notice={notice}
      setNotice={setNotice}
      onSaved={async () => {
        if (!detail) return;
        const fresh = await fetchProcedure(detail.id);
        setData((prev) => ({ ...prev, detail: fresh }));
      }}
    />
  );
}

function Editor({
  mode,
  lib,
  detail,
  back,
  notice,
  setNotice,
  onSaved,
}: {
  mode: ProcedureMode;
  lib: ProcedureLibrary;
  detail: ProcedureDetail | null;
  back: { to: string; label: string };
  notice: string | null;
  setNotice: (notice: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const admin = lib.me.role === 'admin';
  const open = detail?.open ?? null;
  const initialSettings = useMemo<Required<ProcedureSettings>>(
    () =>
      detail
        ? { category: detail.category, kind: detail.kind, support_categories: detail.support_categories, visibility: detail.visibility, critical: detail.critical }
        : { category: 'access', kind: 'usual', support_categories: [], visibility: 'support', critical: false },
    [detail],
  );
  const initialRo = useMemo(() => toForm(open?.content_ro), [open]);
  const initialEn = useMemo(() => toForm(open?.content_en), [open]);
  const [settings, setSettings] = useState(initialSettings);
  const [ro, setRo] = useState<Form>(initialRo);
  const [en, setEn] = useState<Form>(initialEn);
  const [previewLang, setPreviewLang] = useState<'ro' | 'en'>(lang);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const settingsEditable = !detail || detail.status === 'draft';
  const pending = open?.status === 'pending';
  const roContent = fromForm(ro);
  const enStarted = hasContent({ ...en, steps: parseSteps(en.steps) });
  const enContent = enStarted ? fromForm(en) : null;
  const roProblems = contentProblems(roContent);
  const enProblems: Partial<Record<ProcedureField, ContentProblem>> = enStarted ? contentProblems(enContent!) : {};
  const valid = Object.keys(roProblems).length === 0 && Object.keys(enProblems).length === 0;
  const dirty =
    JSON.stringify(roContent) !== JSON.stringify(fromForm(initialRo)) ||
    JSON.stringify(enContent) !== JSON.stringify(hasContent(open?.content_en) ? fromForm(initialEn) : null) ||
    JSON.stringify(settings) !== JSON.stringify(initialSettings);

  const setSetting = <K extends keyof ProcedureSettings>(key: K, value: Required<ProcedureSettings>[K]) => {
    setNotice(null);
    setSettings((s) => ({ ...s, [key]: value, ...(key === 'kind' && value === 'usual' ? { critical: false } : {}) }));
  };
  const supportName = (key: string) => {
    const c = lib.support_categories.find((x) => x.key === key);
    return c ? (lang === 'en' ? c.name_en : c.name_ro) : key;
  };
  const sentSettings = (): ProcedureSettings =>
    admin ? settings : { category: settings.category, kind: settings.kind, support_categories: settings.support_categories };

  const problemOf = (p: ContentProblem | undefined, field: ProcedureField): string | null => {
    if (!p) return null;
    if (p === 'required') return t('proc.problem.required');
    if (p === 'steps') return t('proc.problem.steps');
    if (p === 'secret') return t('proc.problem.secret');
    const range = field === 'steps' ? STEP_LIMIT : PROCEDURE_LIMITS[field].range;
    return problemText(t, p, range);
  };

  const preview = previewLang === 'en' ? enContent : roContent;
  const previewOk = preview && Object.keys(previewLang === 'en' ? enProblems : roProblems).length === 0;

  return (
    <div className={styles.page}>
      <PageHeader back={back} title={open ? t('proc.editor.edit', { n: open.version }) : t('proc.new')} />
      {open && (
        <div className={styles.meta}>
          <VersionTag status={open.status} />
        </div>
      )}
      {pending && <p className={styles.note}>{t('proc.editor.pendingNote')}</p>}

      <Section
        title={t('proc.settings.title')}
        description={!settingsEditable ? t('proc.editor.settingsLocked') : !admin ? t('proc.editor.agentSettings') : undefined}
      >
        {settingsEditable && (
          <Card>
            <SettingsFields draft={settings} set={setSetting} categories={lib.support_categories} name={supportName} admin={admin} />
          </Card>
        )}
      </Section>

      {(['ro', 'en'] as const).map((l) => {
        const form = l === 'ro' ? ro : en;
        const setForm = l === 'ro' ? setRo : setEn;
        const problems = l === 'ro' ? roProblems : enProblems;
        const show = (field: ProcedureField) => (touched.has(`${l}.${field}`) || !!open ? problemOf(problems[field], field) : null);
        const change = (field: ProcedureField, value: string) => {
          setNotice(null);
          setForm((f) => ({ ...f, [field]: value }));
          setTouched((s) => new Set(s).add(`${l}.${field}`));
        };
        const label = (key: MessageKey, optional = false) => (optional ? t('proc.field.optional', { label: t(key) }) : t(key));
        const area = (field: Exclude<ProcedureField, 'title' | 'steps'>, key: MessageKey, optional = false) => (
          <TextArea
            label={label(key, optional)}
            hint={t('proc.field.markdownHint')}
            rows={3}
            maxLength={PROCEDURE_LIMITS[field].range[1]}
            value={form[field]}
            disabled={pending}
            error={show(field)}
            onChange={(e) => change(field, e.target.value)}
          />
        );
        return (
          <Section key={l} title={t(l === 'ro' ? 'proc.editor.ro' : 'proc.editor.en')} description={t(l === 'ro' ? 'proc.editor.roDesc' : 'proc.editor.enDesc')}>
            <Card className={styles.stack}>
              <Field
                label={t('proc.page.title')}
                value={form.title}
                maxLength={PROCEDURE_LIMITS.title.range[1]}
                disabled={pending}
                error={show('title')}
                onChange={(e) => change('title', e.target.value)}
              />
              {area('applies_when', 'proc.page.appliesWhen')}
              {area('purpose', 'proc.page.purpose')}
              {area('responsibilities', 'proc.page.responsibilities', true)}
              <TextArea
                label={t('proc.page.steps')}
                hint={t('proc.field.stepsHint')}
                rows={8}
                value={form.steps}
                disabled={pending}
                error={show('steps')}
                onChange={(e) => change('steps', e.target.value)}
              />
              {area('deadlines', 'proc.page.deadlines', true)}
              {area('escalation', 'proc.page.escalation')}
              {area('forbidden', 'proc.page.forbidden', true)}
              {area('warnings', 'proc.page.warnings', true)}
            </Card>
          </Section>
        );
      })}

      <Section title={t('proc.editor.preview')}>
        <Card className={styles.stack}>
          <SelectField
            label={t('proc.editor.previewLang')}
            value={previewLang}
            options={[
              { value: 'ro', label: t('proc.editor.ro') },
              { value: 'en', label: t('proc.editor.en') },
            ]}
            onChange={(e) => setPreviewLang(e.target.value as 'ro' | 'en')}
          />
          {preview && previewOk ? <ProcedureText content={preview} /> : <p className={styles.muted}>{t('proc.problem.required')}</p>}
        </Card>
      </Section>

      {!open ? (
        <div className={styles.buttons}>
          <ActionButton
            block={false}
            disabled={!valid}
            onAction={async (requestId) => {
              const { id } = await createProcedure(sentSettings(), roContent, enContent, requestId);
              navigate(procedureEditPath(mode, id), { replace: true });
            }}
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            canRetry={canRetryRpc}
          >
            {t('proc.editor.create')}
          </ActionButton>
        </div>
      ) : (
        <div className={styles.stack}>
          {!pending && (
            <div className={styles.buttons}>
              <ActionButton
                block={false}
                disabled={!valid || !dirty}
                onAction={async (requestId) => {
                  await saveProcedureDraft(open.id, roContent, enContent, settingsEditable ? sentSettings() : null, requestId);
                  setNotice(t('proc.editor.saved'));
                  await onSaved();
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('proc.editor.save')}
              </ActionButton>
              {!admin && (
                <ActionButton
                  variant="secondary"
                  block={false}
                  disabled={dirty || !valid}
                  onAction={async (requestId) => {
                    await moveProcedureVersion(open.id, 'submit', requestId);
                    setNotice(t('proc.editor.submitted'));
                    await onSaved();
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('proc.editor.submit')}
                </ActionButton>
              )}
            </div>
          )}
          {pending && (
            <div className={styles.buttons}>
              <ActionButton
                variant="secondary"
                block={false}
                onAction={async (requestId) => {
                  await moveProcedureVersion(open.id, 'to_draft', requestId);
                  setNotice(t('proc.editor.drafted'));
                  await onSaved();
                }}
                errorMessage={(e) => rpcErrorMessage(lang, e)}
                canRetry={canRetryRpc}
              >
                {t('proc.editor.toDraft')}
              </ActionButton>
            </div>
          )}
          {admin && (
            <Card className={styles.stack}>
              <p className={styles.muted}>{dirty ? t('proc.editor.saveFirst') : t('proc.editor.approveNote')}</p>
              <div className={styles.buttons}>
                <ActionButton
                  block={false}
                  disabled={dirty || !valid}
                  onAction={async (requestId) => {
                    await approveProcedure(open.id, true, requestId);
                    navigate(procedurePath(mode, detail!.id), { replace: true });
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('proc.editor.approvePublish')}
                </ActionButton>
                <ActionButton
                  variant="secondary"
                  block={false}
                  disabled={dirty || !valid}
                  onAction={async (requestId) => {
                    await approveProcedure(open.id, false, requestId);
                    navigate(procedurePath(mode, detail!.id), { replace: true });
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('proc.editor.approve')}
                </ActionButton>
              </div>
            </Card>
          )}
          {!confirmDiscard ? (
            <div className={styles.buttons}>
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
                {t('proc.editor.discard')}
              </Button>
            </div>
          ) : (
            <InlinePanel title={t('proc.editor.discardConfirm')}>
              <p className={styles.muted}>{t('proc.editor.discardBody')}</p>
              <div className={styles.buttons}>
                <ActionButton
                  variant="danger"
                  block={false}
                  onAction={async (requestId) => {
                    const r = await moveProcedureVersion(open.id, 'discard', requestId);
                    navigate(r.procedure_deleted ? proceduresHome(mode) : procedurePath(mode, detail!.id), { replace: true });
                  }}
                  errorMessage={(e) => rpcErrorMessage(lang, e)}
                  canRetry={canRetryRpc}
                >
                  {t('proc.editor.discardYes')}
                </ActionButton>
                <Button onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</Button>
              </div>
            </InlinePanel>
          )}
        </div>
      )}
      {notice && (
        <p className={styles.muted} role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
