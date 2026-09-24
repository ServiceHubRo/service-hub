import { Copy, Lock } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { BackLink } from '../../../components/BackLink';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Field } from '../../../components/Field';
import { SkeletonList } from '../../../components/Skeleton';
import { fetchBilling, updateBilling, type ShopBilling } from '../../../data/shop';
import { useI18n } from '../../../i18n/context';
import { looksLikeEmail } from '../../../lib/password';
import { useLoad } from '../../../lib/useLoad';
import { isValidCui, isValidIban, isValidRegCom, normalizeCode } from '../../../lib/validators';
import { LoadError } from '../../../components/LoadError';
import { SETTINGS_PATH } from './paths';
import { SaveButton } from './SaveButton';
import { useShopSettings } from './shopSettingsContext';
import styles from './settings.module.css';

interface Form {
  legal_name: string;
  vat_id: string;
  reg_com: string;
  legal_address: string;
  vat_payer: boolean;
  bank_name: string;
  iban: string;
  billing_email: string;
  legal_rep: string;
}

type Errors = Partial<Record<keyof Form, string>>;

const toForm = (b: ShopBilling | null): Form => ({
  legal_name: b?.legal_name ?? '',
  vat_id: b?.vat_id ?? '',
  reg_com: b?.reg_com ?? '',
  legal_address: b?.legal_address ?? '',
  vat_payer: b?.vat_payer ?? false,
  bank_name: b?.bank_name ?? '',
  iban: b?.iban ?? '',
  billing_email: b?.billing_email ?? '',
  legal_rep: b?.legal_rep ?? '',
});

const nullable = (v: string) => (v.trim() === '' ? null : v.trim());

/** Date de facturare (P5c group B): fiscal data for our invoices, never public, owner only. */
export function BillingSettings() {
  const { t } = useI18n();
  const { shop, isOwner } = useShopSettings();
  const load = useCallback(() => (isOwner ? fetchBilling(shop.id) : Promise.resolve(null)), [shop.id, isOwner]);
  const { state, reload } = useLoad(load);

  return (
    <div className={styles.page}>
      <BackLink to={SETTINGS_PATH} label={t('settings.title')} />
      <h1>{t('settings.billing')}</h1>
      {!isOwner ? (
        <EmptyState icon={Lock} title={t('settings.ownerOnly')} />
      ) : (
        <>
          <p className={styles.intro}>{t('billing.intro')}</p>
          <p className={styles.note}>{t('billing.later')}</p>
          {state.status === 'loading' && <SkeletonList />}
          {state.status === 'error' && <LoadError message={t('settings.loadError')} onRetry={reload} />}
          {state.status === 'ready' && <BillingForm initial={state.data} />}
        </>
      )}
    </div>
  );
}

function BillingForm({ initial }: { initial: ShopBilling | null }) {
  const { t } = useI18n();
  const { shop } = useShopSettings();
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (form.vat_id.trim() !== '' && !isValidCui(form.vat_id)) e.vat_id = t('billing.error.vatId');
    if (form.reg_com.trim() !== '' && !isValidRegCom(form.reg_com)) e.reg_com = t('billing.error.regCom');
    if (form.iban.trim() !== '' && !isValidIban(form.iban)) e.iban = t('billing.error.iban');
    if (form.billing_email.trim() !== '' && !looksLikeEmail(form.billing_email)) e.billing_email = t('auth.error.emailFormat');
    return e;
  }

  function copyWorkshopAddress() {
    set('legal_address', [shop.street, shop.city, shop.county].filter((p) => p && p.trim() !== '').join(', '));
  }

  async function save(): Promise<boolean> {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return false;
    }
    const saved = await updateBilling(shop.id, {
      legal_name: nullable(form.legal_name),
      vat_id: normalizeCode(form.vat_id),
      reg_com: normalizeCode(form.reg_com),
      legal_address: nullable(form.legal_address),
      vat_payer: form.vat_payer,
      bank_name: nullable(form.bank_name),
      iban: normalizeCode(form.iban),
      billing_email: nullable(form.billing_email),
      legal_rep: nullable(form.legal_rep),
    });
    setForm(toForm(saved));
    return true;
  }

  return (
    <form ref={formRef} className={styles.stack} noValidate onSubmit={(e) => e.preventDefault()}>
      <h2 className={styles.section}>{t('billing.company')}</h2>
      <Field
        label={t('billing.legalName')}
        hint={t('billing.legalNameHint')}
        autoComplete="organization"
        maxLength={200}
        value={form.legal_name}
        onChange={(e) => set('legal_name', e.target.value)}
      />
      <div className={styles.grid2}>
        <Field
          label={t('billing.vatId')}
          mono
          autoCapitalize="characters"
          maxLength={14}
          value={form.vat_id}
          onChange={(e) => set('vat_id', e.target.value)}
          error={errors.vat_id}
        />
        <Field
          label={t('billing.regCom')}
          hint={t('billing.regComHint')}
          mono
          autoCapitalize="characters"
          maxLength={20}
          value={form.reg_com}
          onChange={(e) => set('reg_com', e.target.value)}
          error={errors.reg_com}
        />
      </div>
      <Field
        label={t('billing.legalAddress')}
        maxLength={300}
        value={form.legal_address}
        onChange={(e) => set('legal_address', e.target.value)}
      />
      <div>
        <Button onClick={copyWorkshopAddress}>
          <Copy size={16} aria-hidden="true" />
          {t('billing.copyAddress')}
        </Button>
      </div>
      <Card>
        <div className={styles.inlineRow} role="group" aria-labelledby="billing-vat">
          <span id="billing-vat">{t('billing.vatPayer')}</span>
          <span className={styles.chips}>
            <Chip selected={form.vat_payer} onClick={() => set('vat_payer', true)}>
              {t('common.yes')}
            </Chip>
            <Chip selected={!form.vat_payer} onClick={() => set('vat_payer', false)}>
              {t('common.no')}
            </Chip>
          </span>
        </div>
      </Card>
      <Field
        label={t('billing.legalRep')}
        autoComplete="name"
        maxLength={120}
        value={form.legal_rep}
        onChange={(e) => set('legal_rep', e.target.value)}
      />

      <h2 className={styles.section}>{t('billing.bankSection')}</h2>
      <div className={styles.grid2}>
        <Field label={t('billing.bank')} maxLength={120} value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
        <Field
          label={t('billing.iban')}
          mono
          autoCapitalize="characters"
          maxLength={34}
          placeholder="RO49 AAAA 1B31 0075 9384 0000"
          value={form.iban}
          onChange={(e) => set('iban', e.target.value)}
          error={errors.iban}
        />
      </div>
      <Field
        label={t('billing.email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        maxLength={254}
        value={form.billing_email}
        onChange={(e) => set('billing_email', e.target.value)}
        error={errors.billing_email}
      />
      <SaveButton onSave={save}>{t('billing.save')}</SaveButton>
    </form>
  );
}
