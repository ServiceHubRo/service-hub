import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClass } from '../../components/buttonClass';
import { useI18n } from '../../i18n/context';
import type { Side } from '../../lib/messages';
import { bookingMessagesPath } from './paths';
import styles from './messages.module.css';

/** "Mesaj" on a booking card (both sides, P9): opens the conversation of that booking's client and shop. */
export function MessageLink({ side, bookingId }: { side: Side; bookingId: string }) {
  const { t } = useI18n();
  return (
    <Link to={bookingMessagesPath(side, bookingId)} className={buttonClass('secondary', false, styles.messageLink)}>
      <MessageSquare size={16} aria-hidden="true" />
      {t('msg.button')}
    </Link>
  );
}
