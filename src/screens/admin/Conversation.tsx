import type { AdminMessage } from '../../data/admin';
import { useI18n } from '../../i18n/context';
import { systemMessageText } from '../../lib/messages';
import { dateTime } from './format';
import styles from './admin.module.css';

/**
 * A client–shop conversation, read-only (FR §5.8): the client on the left, the shop on the right,
 * automatic messages in the middle as the client read them. The admin never writes into a thread.
 */
export function Conversation({ messages, shopName, clientName }: { messages: AdminMessage[]; shopName: string; clientName: string }) {
  const { t, lang } = useI18n();
  if (messages.length === 0) return <p className={styles.muted}>{t('admin.thread.empty')}</p>;
  return (
    <ol className={styles.messages}>
      {messages.map((m) => {
        const cls = m.side === 'system' ? styles.msgSystem : m.side === 'client' ? styles.msgClient : styles.msgShop;
        const who =
          m.side === 'system'
            ? t('admin.thread.system')
            : m.side === 'client'
              ? clientName
              : [shopName, m.sender_name].filter(Boolean).join(' · ') || shopName;
        return (
          <li key={m.id} className={`${styles.msg} ${cls}`}>
            <span className={styles.msgWho}>
              {who} · {dateTime(lang, m.created_at)}
            </span>
            <span className={styles.msgBody}>
              {m.kind === 'system' ? systemMessageText(lang, 'client', m.event, m.params) : m.body}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
