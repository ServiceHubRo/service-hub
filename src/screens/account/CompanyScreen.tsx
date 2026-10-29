import { useRef, useState } from 'react';
import { useSession } from '../../app/sessionContext';
import { BackLink } from '../../components/BackLink';
import { Card } from '../../components/Card';
import { Chip, ChipRow } from '../../components/Chip';
import { Field } from '../../components/Field';
import { updateDocParty, type DocParty } from '../../data/profile';
import { useI18n } from '../../i18n/context';
import { isValidCui, isValidRegCom, normalizeCode } from '../../lib/validators';
import { SaveButton } from '../shop/settings/SaveButton';
import styles from './account.module.css';

type Kind = DocParty['doc_party'];
type FieldName = 'personAddress' | 'name' | 'vat' | 'regCom' | 'address';

/**
 * Date pentru deviz (T50): who the client's quotes are issued to. A person (the account's name and
 * phone, an optional address) or a company (its name; CUI, trade register number and registered
 * address optional). Quotes sent after a change carry the new details; older ones keep theirs.
 */
export function CompanyScreen() {
  const { t } = useI18n();
  const { user, profile, setProfile } = useSession();
  const [kind, setKind] = useState<Kind>(profile?.doc_party === 'company' ? 'company' : 'person');
  const [personAddress, setPersonAddress] = useState(profile?.person_address ?? '');
  const [name, setName] = useState(profile?.company_name ?? '');
  const [vat, setVat] = useState(profile?.company_vat_id ?? '');
  const [regCom, setRegCom] = useState(profile?.company_reg_com ?? '');
  const [address, setAddress] = useState(profile?.company_address ?? '');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const refs = {
    personAddress: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    vat: useRef<HTMLInputElement>(null),
    regCom: useRef<HTMLInputElement>(null),
    address: useRef<HTMLInputElement>(null),
  };

  const clear = (f: FieldName) => setErrors((e) => ({ ...e, [f]: undefined }));

  async function save(): Promise<boolean> {
    if (!user) return false;
    const next: Partial<Record<FieldName, string>> = {};
    if (kind === 'company') {
      if (!name.trim()) next.name = t('co.name.required');
      if (vat.trim() && !isValidCui(vat.trim())) next.vat = t('co.vat.invalid');
      if (regCom.trim() && !isValidRegCom(regCom.trim())) next.regCom = t('co.regCom.invalid');
    }
    setErrors(next);
    const first = (['name', 'vat', 'regCom'] as const).find((f) => next[f]);
    if (first) {
      refs[first].current?.focus();
      return false;
    }
    // Both sets of details are kept: switching back finds them as they were.
    const saved = await updateDocParty(user.id, {
      doc_party: kind,
      person_address: personAddress.trim() || null,
      company_name: name.trim() || null,
      company_vat_id: vat.trim() ? normalizeCode(vat.trim()) : null,
      company_reg_com: regCom.trim() ? normalizeCode(regCom.trim()) : null,
      company_address: address.trim() || null,
    });
    setProfile(saved);
    return true;
  }

  const field = (f: FieldName, label: string, value: string, set: (v: string) => void, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field
      ref={refs[f]}
      label={label}
      value={value}
      autoComplete="off"
      error={errors[f]}
      onChange={(e) => {
        set(extra.upper ? e.target.value.toUpperCase() : e.target.value);
        clear(f);
      }}
      {...extra}
    />
  );

  return (
    <div className={styles.page}>
      <BackLink to="/c/cont" label={t('nav.account')} />
      <h1>{t('co.title')}</h1>
      <Card className={styles.stack}>
        <span className={styles.label}>{t('co.kind')}</span>
        <ChipRow label={t('co.kind')}>
          <Chip selected={kind === 'person'} onClick={() => setKind('person')}>
            {t('co.kind.person')}
          </Chip>
          <Chip selected={kind === 'company'} onClick={() => setKind('company')}>
            {t('co.kind.company')}
          </Chip>
        </ChipRow>
        {kind === 'person' ? (
          <>
            <p className={styles.intro}>{t('co.person.body', { name: profile?.name ?? '' })}</p>
            {field('personAddress', t('co.person.address'), personAddress, setPersonAddress, {
              maxLength: 300,
              autoComplete: 'street-address',
            })}
          </>
        ) : (
          <>
            {field('name', t('co.name'), name, setName, { maxLength: 200, autoComplete: 'organization' })}
            {field('vat', t('co.vat'), vat, setVat, { maxLength: 14, mono: true, upper: true })}
            {field('regCom', t('co.regCom'), regCom, setRegCom, { maxLength: 20, mono: true, upper: true })}
            {field('address', t('co.address'), address, setAddress, { maxLength: 300, autoComplete: 'street-address' })}
          </>
        )}
      </Card>
      <SaveButton onSave={save}>{t('common.save')}</SaveButton>
    </div>
  );
}
