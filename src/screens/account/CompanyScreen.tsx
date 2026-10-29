import { useRef, useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { Field } from '../../components/Field';
import { updateCompany } from '../../data/profile';
import { useI18n } from '../../i18n/context';
import { isValidCui, normalizeCode } from '../../lib/validators';
import { SaveButton } from '../shop/settings/SaveButton';
import styles from './account.module.css';

/**
 * Date pentru deviz (T50): a client who has the car repaired on a company gives the company's
 * name, CUI and address once; every quote sent after that prints them as the client. All empty
 * means quotes in the client's own name.
 */
export function CompanyScreen() {
  const { t } = useI18n();
  const { user, profile, setProfile } = useSession();
  const [name, setName] = useState(profile?.company_name ?? '');
  const [vat, setVat] = useState(profile?.company_vat_id ?? '');
  const [address, setAddress] = useState(profile?.company_address ?? '');
  const [errors, setErrors] = useState<{ name?: string; vat?: string; address?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const vatRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  async function save(): Promise<boolean> {
    if (!user) return false;
    const n = name.trim();
    const v = vat.trim();
    const a = address.trim();
    const any = n || v || a;
    const next: typeof errors = {};
    if (any && !n) next.name = t('co.name.required');
    if (v && !isValidCui(v)) next.vat = t('co.vat.invalid');
    if (any && !a) next.address = t('co.address.required');
    setErrors(next);
    if (next.name) nameRef.current?.focus();
    else if (next.vat) vatRef.current?.focus();
    else if (next.address) addressRef.current?.focus();
    if (Object.keys(next).length) return false;
    const saved = await updateCompany(user.id, {
      company_name: n || null,
      company_vat_id: v ? normalizeCode(v) : null,
      company_address: a || null,
    });
    setProfile(saved);
    return true;
  }

  return (
    <div className={styles.page}>
      <BackLink to="/c/cont" label={t('nav.account')} />
      <h1>{t('co.title')}</h1>
      <p className={styles.intro}>{t('co.intro')}</p>
      <Card className={styles.stack}>
        <Field
          ref={nameRef}
          label={t('co.name')}
          value={name}
          maxLength={200}
          autoComplete="organization"
          error={errors.name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
        <Field
          ref={vatRef}
          label={t('co.vat')}
          value={vat}
          maxLength={14}
          autoComplete="off"
          mono
          upper
          error={errors.vat}
          onChange={(e) => {
            setVat(e.target.value.toUpperCase());
            setErrors((x) => ({ ...x, vat: undefined }));
          }}
        />
        <Field
          ref={addressRef}
          label={t('co.address')}
          value={address}
          maxLength={300}
          autoComplete="street-address"
          error={errors.address}
          onChange={(e) => {
            setAddress(e.target.value);
            setErrors((x) => ({ ...x, address: undefined }));
          }}
        />
      </Card>
      <SaveButton onSave={save}>{t('common.save')}</SaveButton>
    </div>
  );
}
