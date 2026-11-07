import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { LoadError } from '../../components/LoadError';
import { PageHeader } from '../../components/PageHeader';
import { SelectField } from '../../components/SelectField';
import { SkeletonList } from '../../components/Skeleton';
import { TextArea } from '../../components/TextArea';
import { canRetryRpc, rpcErrorMessage, toRpcError } from '../../data/rpc';
import {
  createRequest,
  fetchSupportCategories,
  REQUEST_BODY_MAX,
  REQUEST_TITLE_MAX,
  REQUEST_TITLE_MIN,
} from '../../data/supportRequests';
import { useI18n } from '../../i18n/context';
import { formatDecimal } from '../../i18n/format';
import { useLoad } from '../../lib/useLoad';
import accountStyles from '../account/account.module.css';
import { requestPath, requestsPath } from '../account/paths';
import { AttachmentPicker } from './Attachments';
import styles from './requests.module.css';

type Field_ = 'category' | 'title' | 'body';

/**
 * A new support request (A3a): a category, a title, a description and, optionally, the code of a
 * booking. `?categorie=` picks the category. Sent once (ActionButton); then the request opens.
 */
export function NewRequestScreen({ role }: { role: 'client' | 'shop' }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, reload } = useLoad(fetchSupportCategories);
  const [category, setCategory] = useState(params.get('categorie') ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bookingRef, setBookingRef] = useState(params.get('programare') ?? '');
  const [missing, setMissing] = useState<Set<Field_>>(new Set());
  const [fileIds, setFileIds] = useState<string[]>([]);
  const clear = (f: Field_) => setMissing((m) => (m.has(f) ? new Set([...m].filter((x) => x !== f)) : m));
  const categories = state.status === 'ready' ? state.data : [];
  const chosen = categories.some((c) => c.key === category) ? category : '';

  return (
    <div className={accountStyles.page}>
      <PageHeader back={{ to: requestsPath(role), label: t('support.my.title') }} title={t('support.new.title')} />
      {state.status === 'loading' && <SkeletonList count={1} />}
      {state.status === 'error' && <LoadError message={t('support.new.loadError')} onRetry={reload} />}
      {state.status === 'ready' && (
        <Card>
          <form className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
            <SelectField
              label={t('support.new.category')}
              value={chosen}
              onChange={(e) => {
                setCategory(e.target.value);
                clear('category');
              }}
              hint={missing.has('category') ? t('support.new.categoryRequired') : undefined}
              aria-invalid={missing.has('category') || undefined}
              options={[
                { value: '', label: t('support.new.categoryPick') },
                ...categories.map((c) => ({ value: c.key, label: lang === 'en' ? c.name_en : c.name_ro })),
              ]}
            />
            <Field
              label={t('support.new.subject')}
              value={title}
              maxLength={REQUEST_TITLE_MAX}
              autoComplete="off"
              error={missing.has('title') ? t('support.new.titleRequired') : null}
              onChange={(e) => {
                setTitle(e.target.value);
                clear('title');
              }}
            />
            <TextArea
              label={t('support.new.body')}
              rows={6}
              maxLength={REQUEST_BODY_MAX}
              value={body}
              hint={`${t('support.new.bodyHint')} ${t('support.new.count', { n: formatDecimal(lang, body.length) })}`}
              error={missing.has('body') ? t('support.new.bodyRequired') : null}
              onChange={(e) => {
                setBody(e.target.value);
                clear('body');
              }}
            />
            <Field
              label={t('support.new.booking')}
              hint={t('support.new.bookingHint')}
              value={bookingRef}
              maxLength={20}
              autoComplete="off"
              mono
              upper
              onChange={(e) => setBookingRef(e.target.value)}
            />
            <p className={styles.warning}>{t('support.new.privacy')}</p>
            <AttachmentPicker onChange={setFileIds} />
            <ActionButton
              submit
              onAction={async (requestId) => {
                const gaps = new Set<Field_>();
                if (!chosen) gaps.add('category');
                if (title.trim().length < REQUEST_TITLE_MIN) gaps.add('title');
                if (!body.trim()) gaps.add('body');
                if (gaps.size > 0) {
                  setMissing(gaps);
                  return;
                }
                const { id } = await createRequest({ category: chosen, title: title.trim(), body: body.trim(), bookingRef: bookingRef.trim(), fileIds }, requestId);
                navigate(requestPath(role, id), { replace: true });
              }}
              errorMessage={(e) => {
                const err = toRpcError(e);
                if (err.code === 'booking_not_found') return t('support.new.bookingUnknown');
                if (err.code === 'request_invalid' && typeof err.params.field === 'string') {
                  return t(`support.new.${err.params.field === 'category' ? 'categoryRequired' : err.params.field === 'title' ? 'titleRequired' : 'bodyRequired'}`);
                }
                return rpcErrorMessage(lang, e);
              }}
              canRetry={canRetryRpc}
            >
              {t('support.new.send')}
            </ActionButton>
          </form>
        </Card>
      )}
    </div>
  );
}
