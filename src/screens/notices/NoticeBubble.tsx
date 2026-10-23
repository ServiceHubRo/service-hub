import type { Notice } from '../../data/adminTools';
import { useI18n } from '../../i18n/context';
import { formatTime } from '../../i18n/format';
import styles from './notices.module.css';

type NoticeContent = Pick<Notice, 'title_ro' | 'body_ro' | 'title_en' | 'body_en' | 'created_at'>;

/**
 * One notice from the Service-Hub team, as a message in the team's conversation (Eduard, 23 Oct):
 * the title, the text and the time; "Nou" and the amber edge when it was new on opening. The
 * admin's preview shows the same message.
 */
export function NoticeBubble({ notice, lang, isNew, id }: { notice: NoticeContent; lang: 'ro' | 'en'; isNew: boolean; id?: string }) {
  const { t } = useI18n();
  const title = lang === 'en' ? notice.title_en : notice.title_ro;
  const body = lang === 'en' ? notice.body_en : notice.body_ro;
  return (
    <section id={id} className={`${styles.bubble} ${isNew ? styles.bubbleNew : ''}`} aria-label={t('notices.label')} tabIndex={-1}>
      <h2 className={styles.title}>
        {title}
        {isNew && <span className={styles.new}>{t('notices.new')}</span>}
      </h2>
      <p className={styles.body}>{body}</p>
      <span className={`mono ${styles.time}`}>{formatTime(lang, new Date(notice.created_at))}</span>
    </section>
  );
}
