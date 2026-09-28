import { ChevronDown, Megaphone } from 'lucide-react';
import type { Notice } from '../../data/adminTools';
import { useI18n } from '../../i18n/context';
import { formatDayMonth } from '../../i18n/format';
import styles from './notices.module.css';

type NoticeContent = Pick<Notice, 'title_ro' | 'body_ro' | 'title_en' | 'body_en' | 'created_at'>;

/**
 * A notice from the Service-Hub team in Mesaje (T20a): the megaphone, "Echipa Service-Hub", the date
 * and the title; "Nou" and the amber edge until it is opened. The head is a button that opens the
 * whole text below it (closed, the first line of the text shows in the head). Without `onToggle`
 * (the admin's preview) it is shown open and nothing is a button.
 */
export function NoticeItem({
  notice,
  lang,
  isNew,
  open,
  onToggle,
  id,
}: {
  notice: NoticeContent;
  lang: 'ro' | 'en';
  isNew: boolean;
  open: boolean;
  onToggle?: () => void;
  /** Names the text for the head's aria-controls. */
  id?: string;
}) {
  const { t } = useI18n();
  const title = lang === 'en' ? notice.title_en : notice.title_ro;
  const body = lang === 'en' ? notice.body_en : notice.body_ro;
  const bodyId = id ? `${id}-text` : undefined;
  const head = (
    <>
      <span className={styles.avatar} aria-hidden="true">
        <Megaphone size={20} />
      </span>
      <span className={styles.text}>
        <span className={styles.top}>
          <span className={styles.from}>{t('notices.from')}</span>
          {isNew && <span className={styles.new}>{t('notices.new')}</span>}
          <span className={`mono ${styles.date}`}>{formatDayMonth(lang, new Date(notice.created_at))}</span>
        </span>
        <span className={styles.title}>{title}</span>
        {!open && <span className={styles.preview}>{body}</span>}
      </span>
      {onToggle && <ChevronDown size={18} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true" />}
    </>
  );
  return (
    <section className={`${styles.notice} ${isNew ? styles.unread : ''}`} aria-label={t('notices.label')}>
      {onToggle ? (
        <button type="button" className={styles.head} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          {head}
        </button>
      ) : (
        <div className={styles.head}>{head}</div>
      )}
      {open && (
        <p id={bodyId} className={styles.body}>
          {body}
        </p>
      )}
    </section>
  );
}
