import { Building2, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionButton } from '../../../components/ActionButton';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { LoadError } from '../../../components/LoadError';
import { PageHeader } from '../../../components/PageHeader';
import { SkeletonList } from '../../../components/Skeleton';
import { createCompany, fetchMyCompanies } from '../../../data/companies';
import { rpcErrorMessage } from '../../../data/rpc';
import { useI18n } from '../../../i18n/context';
import { useLoad } from '../../../lib/useLoad';
import { isValidCui, isValidRegCom, normalizeCode } from '../../../lib/validators';
import { companyPath } from './paths';
import { RolePill } from './RolePill';
import styles from './companies.module.css';

/**
 * Firmele mele (T63b): the companies the client belongs to, with their role, and a new company. The
 * personal garage, bookings and history stay as they are: a company is a separate space.
 */
export function CompaniesScreen() {
  const { t } = useI18n();
  const load = useCallback(() => fetchMyCompanies(), []);
  const { state, reload } = useLoad(load);
  const [creating, setCreating] = useState(false);

  let body;
  if (state.status === 'loading') body = <SkeletonList />;
  else if (state.status === 'error') body = <LoadError message={t('cos.loadError')} onRetry={reload} />;
  else if (state.data.length === 0 && !creating)
    body = (
      <EmptyState
        icon={Building2}
        title={t('cos.empty.title')}
        body={t('cos.empty.body')}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden="true" /> {t('cos.create')}
          </Button>
        }
      />
    );
  else
    body = (
      <>
        {state.data.length > 0 && (
          <ul className={styles.list}>
            {state.data.map((c) => (
              <li key={c.id}>
                <Link to={companyPath(c.id)} className={styles.row}>
                  <Building2 size={20} aria-hidden="true" className={styles.rowIcon} />
                  <span className={styles.rowName}>{c.name}</span>
                  <RolePill role={c.role} />
                  <ChevronRight size={18} aria-hidden="true" className={styles.chevron} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {creating ? (
          <CreateForm onCancel={() => setCreating(false)} />
        ) : (
          <div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={18} aria-hidden="true" /> {t('cos.create')}
            </Button>
          </div>
        )}
      </>
    );

  return (
    <div className={styles.page}>
      <PageHeader back={{ to: '/c/cont', label: t('nav.account') }} title={t('cos.title')} subtitle={t('cos.subtitle')} />
      {body}
    </div>
  );
}

type FieldName = 'name' | 'vat' | 'regCom';

function CreateForm({ onCancel }: { onCancel: () => void }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [vat, setVat] = useState('');
  const [regCom, setRegCom] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const vatRef = useRef<HTMLInputElement>(null);
  const regComRef = useRef<HTMLInputElement>(null);

  return (
    <Card className={styles.stack}>
      <h2 className={styles.cardTitle}>{t('cos.create')}</h2>
      <p className={styles.note}>{t('cos.create.note')}</p>
      <form className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
        <Field
          ref={nameRef}
          label={t('cos.field.name')}
          value={name}
          maxLength={120}
          autoComplete="organization"
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
        <div className={styles.twoCols}>
          <Field
            ref={vatRef}
            label={t('cos.field.vat')}
            hint={t('cos.optional')}
            value={vat}
            maxLength={14}
            mono
            upper
            error={errors.vat}
            onChange={(e) => {
              setVat(e.target.value.toUpperCase());
              setErrors((x) => ({ ...x, vat: undefined }));
            }}
          />
          <Field
            ref={regComRef}
            label={t('cos.field.regCom')}
            hint={t('cos.optional')}
            value={regCom}
            maxLength={20}
            mono
            upper
            error={errors.regCom}
            onChange={(e) => {
              setRegCom(e.target.value.toUpperCase());
              setErrors((x) => ({ ...x, regCom: undefined }));
            }}
          />
        </div>
        <Field label={t('cos.field.address')} hint={t('cos.optional')} value={address} maxLength={300} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} />
        <div className={styles.buttons}>
          <ActionButton
            submit
            variant="primary"
            errorMessage={(e) => rpcErrorMessage(lang, e)}
            onAction={async (requestId) => {
              const next: Partial<Record<FieldName, string>> = {};
              if (name.trim().length < 2) next.name = t('rpcError.company_name_invalid');
              if (vat.trim() && !isValidCui(vat.trim())) next.vat = t('rpcError.company_vat_invalid');
              if (regCom.trim() && !isValidRegCom(regCom.trim())) next.regCom = t('rpcError.company_regcom_invalid');
              setErrors(next);
              if (next.name) return nameRef.current?.focus();
              if (next.vat) return vatRef.current?.focus();
              if (next.regCom) return regComRef.current?.focus();
              const company = await createCompany(
                {
                  name: name.trim(),
                  vatId: vat.trim() ? normalizeCode(vat.trim()) : null,
                  regCom: regCom.trim() ? normalizeCode(regCom.trim()) : null,
                  address: address.trim() || null,
                },
                requestId,
              );
              navigate(companyPath(company.id));
            }}
          >
            {t('cos.create.save')}
          </ActionButton>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
        </div>
      </form>
    </Card>
  );
}
