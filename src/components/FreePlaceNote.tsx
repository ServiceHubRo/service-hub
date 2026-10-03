import { CalendarCheck, MessageCircleReply, Zap } from 'lucide-react';
import type { FreePlace, ResponseBadge } from '../data/rpc';
import { useI18n } from '../i18n/context';
import { useFreePlaceText } from '../lib/useFreePlaceText';
import styles from './FreePlaceNote.module.css';

/**
 * A shop's first free place, whether it confirms at once (T28a) and how quickly it usually answers
 * (T28b), the same on the search card and the shop page.
 */
export function FreePlaceNote({ free, instant, response = null }: { free: FreePlace | null; instant: boolean; response?: ResponseBadge }) {
  const { t } = useI18n();
  const text = useFreePlaceText();
  if (!free && !instant && !response) return null;
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
      {/* An instant shop needs no promise about answers. */}
      {!instant && response && (
        <span className={styles.instant}>
          <MessageCircleReply size={14} aria-hidden="true" />
          {t(response === 'hour' ? 'response.hour' : 'response.hours')}
        </span>
      )}
    </span>
  );
}
