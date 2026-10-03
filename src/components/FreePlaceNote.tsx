import { CalendarCheck, Zap } from 'lucide-react';
import type { FreePlace } from '../data/rpc';
import { useI18n } from '../i18n/context';
import { useFreePlaceText } from '../lib/useFreePlaceText';
import styles from './FreePlaceNote.module.css';

/** A shop's first free place and whether it confirms at once, the same on the card and the page. */
export function FreePlaceNote({ free, instant }: { free: FreePlace | null; instant: boolean }) {
  const { t } = useI18n();
  const text = useFreePlaceText();
  if (!free && !instant) return null;
  return (
    <span className={styles.row}>
      {free && (
        <span className={styles.free}>
          <CalendarCheck size={14} aria-hidden="true" />
          {text(free)}
        </span>
      )}
      {instant && (
        <span className={styles.instant}>
          <Zap size={14} aria-hidden="true" />
          {t('instant.badge')}
        </span>
      )}
    </span>
  );
}
