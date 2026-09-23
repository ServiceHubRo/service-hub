import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';

export function buttonClass(variant: ButtonVariant = 'secondary', block = false, extra?: string): string {
  return [styles.button, styles[variant], block ? styles.block : '', extra ?? ''].filter(Boolean).join(' ');
}
