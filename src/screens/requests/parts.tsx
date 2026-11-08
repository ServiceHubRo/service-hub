import type { RequestFile } from '../../data/supportFiles';
import type { RequestStatus } from '../../data/supportRequests';
import { FileList } from './Attachments';
import { useI18n } from '../../i18n/context';
import styles from './requests.module.css';

const TONE: Record<RequestStatus, 'blue' | 'amber' | 'green' | 'grey' | 'red'> = {
  new: 'blue',
  in_progress: 'amber',
  waiting_user: 'blue',
  resolved: 'green',
  closed: 'grey',
  planned: 'amber',
  done: 'green',
  declined: 'grey',
};

/**
 * A request's state as a word in a colored pill (never color alone). The author reads its own words
 * („Primită”, „Așteaptă răspunsul tău”); the team reads its own („Nouă”, „Așteaptă utilizatorul”).
 */
export function RequestStatusPill({ status, staff = false }: { status: RequestStatus; staff?: boolean }) {
  const { t } = useI18n();
  return <span className={`${styles.pill} ${styles[TONE[status]]}`}>{t(`${staff ? 'support.staffStatus' : 'support.status'}.${status}`)}</span>;
}

export interface ConversationItem {
  id: string;
  side: 'author' | 'team';
  who: string;
  when: string;
  body: string;
  /** A3b: the files sent with it. */
  files?: RequestFile[];
}

/** The request's description and its messages, oldest first, each with its files. */
export function Conversation({ items, label, showOpens = false }: { items: ConversationItem[]; label: string; showOpens?: boolean }) {
  return (
    <ol className={styles.conversation} aria-label={label}>
      {items.map((m) => (
        <li key={m.id} className={styles.message} data-side={m.side}>
          <span className={styles.messageHead}>
            <span className={styles.messageWho}>{m.who}</span>
            <span>{m.when}</span>
          </span>
          <p className={styles.messageBody}>{m.body}</p>
          {m.files && m.files.length > 0 && <FileList files={m.files} showOpens={showOpens} />}
        </li>
      ))}
    </ol>
  );
}
