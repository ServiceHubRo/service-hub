import { ChevronDown } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useI18n } from '../i18n/context';
import { phoneCountryOptions, PHONE_COUNTRIES } from '../lib/phone';
import fieldStyles from './Field.module.css';
import styles from './PhoneField.module.css';

export interface PhoneFieldProps {
  label: string;
  country: string;
  onCountryChange: (code: string) => void;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
}

/**
 * Phone with its country: a native select (the phone's own picker, names in the app's language)
 * shown as `+40`, and the number. The label names the number; the select has its own name.
 */
export function PhoneField({ label, country, onCountryChange, value, onChange, hint, error }: PhoneFieldProps) {
  const { t, lang } = useI18n();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const options = useMemo(() => phoneCountryOptions(lang), [lang]);
  const dial = PHONE_COUNTRIES.find((c) => c.code === country)?.dial ?? '40';
  return (
    <div className={fieldStyles.field}>
      <label htmlFor={id} className={fieldStyles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <div className={styles.country}>
          <span className={`${styles.shown} mono`} aria-hidden="true">
            +{dial}
            <ChevronDown size={16} className={styles.chevron} />
          </span>
          <select
            className={styles.select}
            aria-label={t('auth.phoneCountry')}
            value={country}
            onChange={(e) => onCountryChange(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name} (+{o.dial})
              </option>
            ))}
          </select>
        </div>
        <input
          id={id}
          type="tel"
          autoComplete="tel-national"
          inputMode="tel"
          className={`${fieldStyles.input} mono`}
          placeholder={country === 'RO' ? t('auth.phonePlaceholder') : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        />
      </div>
      {hint && !error && (
        <span id={hintId} className={fieldStyles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={fieldStyles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
