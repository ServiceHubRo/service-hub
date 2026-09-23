import { useI18n } from '../i18n/context';
import { STATUS_TONE, type BookingStatus } from '../lib/status';
import styles from './StatusBadge.module.css';

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { t } = useI18n();
  return <span className={`${styles.pill} ${styles[STATUS_TONE[status]]}`}>{t(`status.${status}`)}</span>;
}
