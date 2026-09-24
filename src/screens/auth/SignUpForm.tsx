import { Car, Wrench } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionButton } from '../../components/ActionButton';
import { useCaptcha } from '../../components/useCaptcha';
import { Checkbox } from '../../components/Checkbox';
import { Field } from '../../components/Field';
import { PasswordField } from '../../components/PasswordField';
import { AuthFailure, authErrorMessage, isRetryable, signUp } from '../../data/auth';
import { useI18n } from '../../i18n/context';
import { recordEmailSent } from '../../lib/cooldown';
import { TERMS_VERSION, type LegalDocId } from '../../lib/legal';
import { looksLikeEmail, MIN_PASSWORD_LENGTH } from '../../lib/password';
import { normalizePhone } from '../../lib/validators';
import { useFocusFirstError } from './useFocusFirstError';
import styles from './auth.module.css';

type SignUpRole = 'client' | 'shop';

interface Errors {
  role?: string;
  name?: string;
  shopName?: string;
  city?: string;
  phone?: string;
  email?: string;
  password?: string;
  terms?: string;
}

/** Suggestions only; any city can be typed. Service-Hub starts in Brașov county. */
const CITY_SUGGESTIONS = [
  'Brașov', 'Codlea', 'Săcele', 'Râșnov', 'Ghimbav', 'Zărnești', 'Făgăraș', 'Predeal', 'Prejmer',
  'Hărman', 'Sânpetru', 'Cristian', 'Rupea', 'Victoria', 'Sibiu', 'București', 'Cluj-Napoca',
];

/** P4b sign-up: role cards, name, shop name + city (shops), phone, email, password, terms. */
export function SignUpForm({
  email,
  setEmail,
  onOpenDoc,
}: {
  email: string;
  setEmail: (email: string) => void;
  onOpenDoc: (doc: LegalDocId) => void;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<SignUpRole | null>(null);
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [attempt, setAttempt] = useState(0);
  const captcha = useCaptcha();
  useFocusFirstError(formRef, errors, attempt);

  function validate(): Errors {
    const next: Errors = {};
    if (!role) next.role = t('auth.error.roleRequired');
    if (name.trim() === '') next.name = t('auth.error.nameRequired');
    if (role === 'shop' && shopName.trim() === '') next.shopName = t('auth.error.shopNameRequired');
    if (role === 'shop' && city.trim() === '') next.city = t('auth.error.cityRequired');
    if (!normalizePhone(phone)) next.phone = t('auth.error.phoneInvalid');
    if (!looksLikeEmail(email)) next.email = t('auth.error.emailFormat');
    if (password.length < MIN_PASSWORD_LENGTH) next.password = t('auth.error.passwordShort', { min: MIN_PASSWORD_LENGTH });
    if (!terms) next.terms = t('auth.error.termsRequired');
    return next;
  }

  async function submit() {
    const next = validate();
    setErrors(next);
    setAttempt((a) => a + 1);
    if (Object.keys(next).length > 0 || !role) return;
    if (!captcha.ready) throw new AuthFailure('captcha_failed');
    let result;
    try {
      result = await signUp({
        role,
        name,
        phone: normalizePhone(phone) ?? phone,
        email,
        password,
        lang,
        termsVersion: TERMS_VERSION,
        shopName: role === 'shop' ? shopName : undefined,
        city: role === 'shop' ? city : undefined,
        captchaToken: captcha.token,
      });
    } finally {
      captcha.reset();
    }
    // The confirmation email just went out: "Retrimite" waits 60 s from now.
    recordEmailSent('signup', email);
    if (result === 'confirm_email') navigate('/confirma-email', { state: { email: email.trim() } });
    // 'signed_in' (confirmation turned off): the route sends the user home.
  }

  function clear(field: keyof Errors) {
    if (!errors[field]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  return (
    <form ref={formRef} className={styles.form} noValidate onSubmit={(e) => e.preventDefault()}>
      <div>
        <p className={styles.groupLabel} id="signup-role">
          {t('auth.roleQuestion')}
        </p>
        <div className={styles.roles} role="group" aria-labelledby="signup-role">
          <button
            type="button"
            className={styles.role}
            aria-pressed={role === 'client'}
            aria-invalid={errors.role ? true : undefined}
            onClick={() => {
              setRole('client');
              clear('role');
            }}
          >
            <Car size={28} aria-hidden="true" />
            {t('auth.roleClient')}
          </button>
          <button
            type="button"
            className={styles.role}
            aria-pressed={role === 'shop'}
            onClick={() => {
              setRole('shop');
              clear('role');
            }}
          >
            <Wrench size={28} aria-hidden="true" />
            {t('auth.roleShop')}
          </button>
        </div>
        {errors.role && (
          <p className={styles.fieldError} role="alert">
            {errors.role}
          </p>
        )}
      </div>

      <Field
        label={t('auth.name')}
        autoComplete="name"
        maxLength={120}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          clear('name');
        }}
        error={errors.name}
      />
      {role === 'shop' && (
        <>
          <Field
            label={t('auth.shopName')}
            autoComplete="organization"
            maxLength={120}
            value={shopName}
            onChange={(e) => {
              setShopName(e.target.value);
              clear('shopName');
            }}
            error={errors.shopName}
          />
          <Field
            label={t('auth.city')}
            autoComplete="address-level2"
            list="signup-cities"
            maxLength={80}
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              clear('city');
            }}
            error={errors.city}
          />
          <datalist id="signup-cities">
            {CITY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </>
      )}
      <Field
        label={t('auth.phone')}
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        mono
        placeholder="0723 375 248"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          clear('phone');
        }}
        error={errors.phone}
      />
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          clear('email');
        }}
        error={errors.email}
      />
      <PasswordField
        label={t('auth.password')}
        autoComplete="new-password"
        showStrength
        hint={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clear('password');
        }}
        error={errors.password}
      />
      <div>
        <Checkbox
          checked={terms}
          aria-invalid={errors.terms ? true : undefined}
          onChange={(e) => {
            setTerms(e.target.checked);
            clear('terms');
          }}
        >
          {t('auth.termsBefore')}
          <button
            type="button"
            className={styles.linkButton}
            onClick={(e) => {
              e.preventDefault();
              onOpenDoc('termeni');
            }}
          >
            {t('auth.termsLink')}
          </button>
          {t('auth.termsMiddle')}
          <button
            type="button"
            className={styles.linkButton}
            onClick={(e) => {
              e.preventDefault();
              onOpenDoc('confidentialitate');
            }}
          >
            {t('auth.privacyLink')}
          </button>
          {t('auth.termsAfter')}
        </Checkbox>
        {errors.terms && (
          <p className={styles.fieldError} role="alert">
            {errors.terms}
          </p>
        )}
      </div>
      {captcha.element}
      <ActionButton submit onAction={submit} errorMessage={(e) => authErrorMessage(lang, e)} canRetry={isRetryable}>
        {t('auth.createAccount')}
      </ActionButton>
    </form>
  );
}
