import { Megaphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '../../app/sessionContext';
import { Button } from '../../components/Button';
import type { Notice } from '../../data/adminTools';
import { fetchUnreadNotices, markNoticeRead } from '../../data/notices';
import { subscribeRows } from '../../data/realtime';
import { useI18n } from '../../i18n/context';
import { formatDayMonth } from '../../i18n/format';
import styles from './notices.module.css';

/** One notice, in the reader's language: the team's name, the date, the title and the text. */
export function NoticeView({ notice, lang, action }: { notice: Pick<Notice, 'title_ro' | 'body_ro' | 'title_en' | 'body_en' | 'created_at'>; lang: 'ro' | 'en'; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className={styles.notice} aria-label={t('notices.label')}>
      <Megaphone size={18} className={styles.icon} aria-hidden="true" />
      <div className={styles.text}>
        <span className={styles.from}>
          {t('notices.from')} · {formatDayMonth(lang, new Date(notice.created_at))}
        </span>
        <strong className={styles.title}>{lang === 'en' ? notice.title_en : notice.title_ro}</strong>
        <p className={styles.body}>{lang === 'en' ? notice.body_en : notice.body_ro}</p>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </section>
  );
}

/**
 * Notices from the Service-Hub team (T16b) at the top of Caută (clients) and Panou (shops), until
 * "Am citit". Live: a notice sent while the screen is open appears at once (Realtime on `notices`,
 * RLS decides who receives it). Nothing shows while loading or when the read fails — a notice is
 * never in the way of the screen.
 */
export function NoticeBanner({ className }: { className?: string }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const userId = session.user?.id ?? null;
  const [notices, setNotices] = useState<Notice[]>([]);
  const latest = useRef(0);

  const load = useCallback(() => {
    if (!userId) return;
    const mine = ++latest.current;
    fetchUnreadNotices(userId).then(
      (list) => {
        if (mine === latest.current) setNotices(list);
      },
      () => {},
    );
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    return subscribeRows({ channel: `notices:${userId}`, table: 'notices', onChange: load, onResync: load });
  }, [userId, load]);

  if (notices.length === 0) return null;
  return (
    <div className={`${styles.list} ${className ?? ''}`}>
      {notices.map((n) => (
        <NoticeView
          key={n.id}
          notice={n}
          lang={lang}
          action={
            <Button
              variant="ghost"
              onClick={() => {
                setNotices((list) => list.filter((x) => x.id !== n.id));
                // Best effort: if it fails, the notice comes back on the next visit.
                markNoticeRead(n.id).catch(() => {});
              }}
            >
              {t('notices.read')}
            </Button>
          }
        />
      ))}
    </div>
  );
}
