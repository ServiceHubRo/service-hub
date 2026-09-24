import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n/context';
import { passwordStrength } from '../lib/password';
import { Field, type FieldProps } from './Field';
import styles from './PasswordField.module.css';

export interface PasswordFieldProps extends Omit<FieldProps, 'type' | 'end'> {
  /** Shows the strength hint while typing (new passwords only). */
  showStrength?: boolean;
}

/** Password input with a show/hide button and, for new passwords, a strength hint in words. */
export function PasswordField({ showStrength, hint, value, ...rest }: PasswordFieldProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const text = typeof value === 'string' ? value : '';
  const strength = showStrength && text.length > 0 ? passwordStrength(text) : null;
  const strengthHint = strength ? t(`password.strength.${strength}`) : undefined;
  return (
    <Field
      {...rest}
      value={value}
      type={visible ? 'text' : 'password'}
      hint={strengthHint ?? hint}
      end={
        <button
          type="button"
          className={styles.toggle}
          aria-label={t(visible ? 'password.hide' : 'password.show')}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      }
    />
  );
}
